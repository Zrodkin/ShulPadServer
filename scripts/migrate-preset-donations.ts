// scripts/migrate-preset-donations.ts

import { createClient } from '../src/lib/db';
import { v4 as uuidv4 } from 'uuid';
import axios from 'axios';
import { logger } from '../src/lib/logger';

interface KioskSettings {
  id: number;
  organization_id: number;
  preset_amounts: string[]; // JSON string array of amounts
}

interface Organization {
  id: number;
  square_merchant_id: string;
}

interface SquareConnection {
  organization_id: number;
  access_token: string;
  location_id: string;
}

interface CatalogItemVariationData {
  item_id: string;
  name: string;
  price_money?: {
    amount: number;
    currency: string;
  };
}

interface CatalogItem {
  id: string;
  type: string;
  item_variation_data?: CatalogItemVariationData;
}

async function migratePresetDonations(): Promise<void> {
  const db = createClient();
  logger.info('Starting migration of preset donations to Square catalog');

  try {
    // Get all organizations with kiosk settings that have preset_amounts
    const result = await db.query(`
      SELECT k.id, k.organization_id, k.preset_amounts, 
             o.id as org_id, o.square_merchant_id,
             s.access_token, s.location_id
      FROM kiosk_settings k
      JOIN organizations o ON k.organization_id = o.id
      JOIN square_connections s ON o.id::text = s.organization_id
      WHERE k.preset_amounts IS NOT NULL AND array_length(k.preset_amounts, 1) > 0
        AND s.access_token IS NOT NULL
    `);

    logger.info(`Found ${result.rows.length} organizations with preset amounts to migrate`);

    for (const row of result.rows) {
      const organizationId: number = row.organization_id;
      const kioskId: number = row.id;
      const presetAmounts: string[] = row.preset_amounts;
      const accessToken: string = row.access_token;
      const locationId: string = row.location_id;
      
      if (!accessToken) {
        logger.warn(`Organization ${organizationId} has no Square access token. Skipping.`);
        continue;
      }

      logger.info(`Migrating ${presetAmounts.length} preset amounts for organization ${organizationId}`);

      // Start a transaction for this organization's migration
      const client = await db.connect();

      try {
        await client.query('BEGIN');

        // Create parent "Donations" catalog item in Square
        const donationItemId = await createDonationsItemInSquare(accessToken, locationId);
        
        if (!donationItemId) {
          logger.error(`Failed to create Donations item for organization ${organizationId}`);
          await client.query('ROLLBACK');
          continue;
        }

        // Create variations for each preset amount
        const catalogVariations = await createDonationVariationsInSquare(
          accessToken, 
          donationItemId, 
          presetAmounts.map((amount: string) => parseFloat(amount))
        );

        if (!catalogVariations || catalogVariations.length === 0) {
          logger.error(`Failed to create variations for organization ${organizationId}`);
          await client.query('ROLLBACK');
          continue;
        }

        // Insert records into preset_donations table
        for (let i = 0; i < presetAmounts.length; i++) {
          const amount: number = parseFloat(presetAmounts[i]);
          const variation = catalogVariations.find((v: CatalogItem) => 
            v.item_variation_data?.price_money?.amount === Math.round(amount * 100)
          );

          if (variation) {
            await client.query(
              `INSERT INTO preset_donations 
               (organization_id, amount, catalog_item_id, catalog_variation_id, display_order) 
               VALUES ($1, $2, $3, $4, $5)`,
              [organizationId, amount, donationItemId, variation.id, i + 1]
            );
          }
        }

        // Update kiosk_settings with the new catalog parent ID and clear preset_amounts
        await client.query(
          `UPDATE kiosk_settings 
           SET catalog_parent_id = $1, 
               last_catalog_sync = NOW(),
               preset_amounts = NULL
           WHERE id = $2`,
          [donationItemId, kioskId]
        );

        await client.query('COMMIT');
        logger.info(`Successfully migrated preset amounts for organization ${organizationId}`);
      } catch (error) {
        await client.query('ROLLBACK');
        logger.error(`Error migrating preset amounts for organization ${organizationId}`, { error });
      } finally {
        client.release();
      }
    }

    logger.info('Migration completed');
  } catch (error) {
    logger.error('Error in migration script', { error });
  } finally {
    await db.end();
  }
}

async function createDonationsItemInSquare(accessToken: string, locationId: string): Promise<string | null> {
  try {
    const SQUARE_ENVIRONMENT = process.env.SQUARE_ENVIRONMENT || "sandbox";
    const SQUARE_DOMAIN = SQUARE_ENVIRONMENT === "production" ? "squareup.com" : "squareupsandbox.com";
    
    const item_id = `ITEM_DONATIONS_${uuidv4().substring(0, 8)}`;
    
    const response = await axios.post(
      `https://connect.${SQUARE_DOMAIN}/v2/catalog/object`,
      {
        idempotency_key: uuidv4(),
        object: {
          type: "ITEM",
          id: item_id,
          present_at_all_locations: true,
          item_data: {
            name: "Donations",
            description: "Donation preset amounts",
            is_taxable: false,
            variations: [] // We'll create variations separately
          }
        }
      },
      {
        headers: {
          "Square-Version": "2023-09-25",
          "Authorization": `Bearer ${accessToken}`,
          "Content-Type": "application/json"
        }
      }
    );

    if (response.data && response.data.catalog_object && response.data.catalog_object.id) {
      return response.data.catalog_object.id;
    }
    
    return null;
  } catch (error) {
    logger.error('Error creating Donations item in Square', { error });
    return null;
  }
}

async function createDonationVariationsInSquare(
  accessToken: string, 
  donationItemId: string, 
  amounts: number[]
): Promise<CatalogItem[]> {
  try {
    const SQUARE_ENVIRONMENT = process.env.SQUARE_ENVIRONMENT || "sandbox";
    const SQUARE_DOMAIN = SQUARE_ENVIRONMENT === "production" ? "squareup.com" : "squareupsandbox.com";
    
    // Prepare batch objects for variations
    const batchObjects = amounts.map((amount: number) => {
      const variation_id = `VAR_${amount.toString().replace('.', '_')}_${uuidv4().substring(0, 8)}`;
      
      return {
        type: "ITEM_VARIATION",
        id: variation_id,
        present_at_all_locations: true,
        item_variation_data: {
          item_id: donationItemId,
          name: `$${amount} Donation`,
          pricing_type: "FIXED_PRICING",
          price_money: {
            amount: Math.round(amount * 100), // Convert to cents
            currency: "USD"
          }
        }
      };
    });

    const response = await axios.post(
      `https://connect.${SQUARE_DOMAIN}/v2/catalog/batch-upsert`,
      {
        idempotency_key: uuidv4(),
        batches: [
          {
            objects: batchObjects
          }
        ]
      },
      {
        headers: {
          "Square-Version": "2023-09-25",
          "Authorization": `Bearer ${accessToken}`,
          "Content-Type": "application/json"
        }
      }
    );

    if (response.data && response.data.objects) {
      return response.data.objects as CatalogItem[];
    }
    
    return [];
  } catch (error) {
    logger.error('Error creating donation variations in Square', { error });
    return [];
  }
}

// Execute the migration
migratePresetDonations().catch((error: unknown) => {
  logger.error('Migration failed', { error });
  process.exit(1);
});