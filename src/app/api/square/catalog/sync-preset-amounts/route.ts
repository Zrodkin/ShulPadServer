// src/app/api/square/catalog/sync-preset-amounts/route.ts

import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/db";
import { logger } from "@/lib/logger";
import { v4 as uuidv4 } from "uuid";
import axios from "axios";

// Add a secret key for security
const API_SECRET = process.env.API_SECRET || "change-this-in-production";

interface CatalogItemVariationData {
  item_id: string;
  name: string;
  price_money?: {
    amount: number;
    currency: string;
  };
  user_data?: string; // Add this line
}

interface CatalogItem {
  id: string;
  type: string;
  item_variation_data?: CatalogItemVariationData;
}

interface SyncResult {
  successful: number;
  failed: number;
  details: any[];
}

export async function POST(request: NextRequest) {
  try {
    // Basic security check
    const authHeader = request.headers.get("authorization");
    const providedSecret = authHeader?.replace("Bearer ", "");
    
    if (providedSecret !== API_SECRET) {
      logger.warn("Unauthorized catalog sync attempt");
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Parse request body
    const body = await request.json();
    const { organization_id, force_sync = false } = body;

    let results: SyncResult;
    
    if (organization_id) {
      // Sync a specific organization
      logger.info(`Syncing preset amounts for organization: ${organization_id}`);
      results = await syncPresetAmountsForOrganization(organization_id, force_sync);
    } else {
      // Sync all organizations
      logger.info("Syncing preset amounts for all organizations");
      results = await syncPresetAmountsForAllOrganizations(force_sync);
    }
    
    return NextResponse.json(results);
  } catch (error) {
    logger.error("Error during Square catalog sync", { error });
    return NextResponse.json({ error: "Sync failed" }, { status: 500 });
  }
}

/**
 * Sync preset amounts for all organizations
 */
async function syncPresetAmountsForAllOrganizations(forceSynchronization: boolean = false): Promise<SyncResult> {
  const db = createClient();
  logger.info('Starting sync of preset amounts to Square catalog for all organizations');
  
  const results: SyncResult = {
    successful: 0,
    failed: 0,
    details: []
  };

  try {
    // Get all organizations with kiosk settings that have preset_amounts or need updating
   const query = forceSynchronization 
  ? `SELECT ks.id, ks.organization_id, ks.preset_amounts, ks.catalog_parent_id,
            ks.processing_fee_enabled, ks.processing_fee_percentage, ks.processing_fee_fixed_cents,
            o.id as org_id, o.square_merchant_id,
            sc.access_token, sc.location_id
     FROM kiosk_settings ks
     JOIN organizations o ON ks.organization_id = o.id
     JOIN square_connections sc ON o.id = sc.organization_id
     WHERE sc.access_token IS NOT NULL
     AND (
       (ks.preset_amounts IS NOT NULL AND JSON_LENGTH(ks.preset_amounts) > 0)
       OR ks.catalog_parent_id IS NOT NULL
     )`
  : `SELECT ks.id, ks.organization_id, ks.preset_amounts, ks.catalog_parent_id,
            ks.processing_fee_enabled, ks.processing_fee_percentage, ks.processing_fee_fixed_cents,
            o.id as org_id, o.square_merchant_id,
            sc.access_token, sc.location_id
     FROM kiosk_settings ks
     JOIN organizations o ON ks.organization_id = o.id
     JOIN square_connections sc ON o.id = sc.organization_id
     WHERE ks.preset_amounts IS NOT NULL 
     AND JSON_LENGTH(ks.preset_amounts) > 0
     AND sc.access_token IS NOT NULL`;

    const result = await db.execute(query);
    logger.info(`Found ${result.rows.length} organizations to sync`);

    // Process each organization
    for (const row of result.rows) {
      try {
        const syncResult = await processOrganizationSync(db, row, forceSynchronization);
        
        if (syncResult.success) {
          results.successful++;
          results.details.push({
            organization_id: row.organization_id,
            status: "success",
            ...syncResult.data
          });
        } else {
          results.failed++;
          results.details.push({
            organization_id: row.organization_id,
            status: "failed",
            reason: syncResult.reason
          });
        }
      } catch (error) {
        results.failed++;
        results.details.push({
          organization_id: row.organization_id,
          status: "failed",
          reason: error instanceof Error ? error.message : String(error)
        });
      }
    }

    logger.info('Sync completed', { results });
  } catch (error) {
    logger.error('Error in sync process', { error });
    throw error;
  } finally {
    
  }
  
  return results;
}

/**
 * Sync preset amounts for a specific organization
 */
async function syncPresetAmountsForOrganization(organizationId: string, forceSynchronization: boolean = false): Promise<SyncResult> {
  const db = createClient();
  logger.info(`Starting sync of preset amounts to Square catalog for organization ${organizationId}`);
  
  const results: SyncResult = {
    successful: 0,
    failed: 0,
    details: []
  };

  try {
    // Get the organization data
   const query = `
  SELECT k.id, k.organization_id, k.preset_amounts, k.catalog_parent_id,
         k.processing_fee_enabled, k.processing_fee_percentage, k.processing_fee_fixed_cents,
             o.id as org_id, o.square_merchant_id,
             s.access_token, s.location_id
      FROM kiosk_settings k
      JOIN organizations o ON k.organization_id = o.id
      JOIN square_connections s ON o.id = s.organization_id  
WHERE o.id = ?
      AND s.access_token IS NOT NULL
    `;

    const result = await db.execute(query, [organizationId]);
    
    if (result.rows.length === 0) {
      logger.warn(`Organization ${organizationId} not found or not connected to Square`);
      results.failed = 1;
      results.details.push({
        organization_id: organizationId,
        status: "failed",
        reason: "Organization not found or not connected to Square"
      });
      return results;
    }

    // Process the organization
    const row = result.rows[0];
    
    // Skip if no preset amounts and not forcing sync
    if (!forceSynchronization && 
        (!row.preset_amounts || JSON.stringify(row.preset_amounts) === '[]')) {
      logger.info(`Organization ${organizationId} has no preset amounts to sync`);
      results.details.push({
        organization_id: organizationId,
        status: "skipped",
        reason: "No preset amounts to sync"
      });
      return results;
    }

    // Process the organization
    const syncResult = await processOrganizationSync(db, row, forceSynchronization);
    
    if (syncResult.success) {
      results.successful = 1;
      results.details.push({
        organization_id: organizationId,
        status: "success",
        ...syncResult.data
      });
    } else {
      results.failed = 1;
      results.details.push({
        organization_id: organizationId,
        status: "failed",
        reason: syncResult.reason
      });
    }

    logger.info(`Sync completed for organization ${organizationId}`, { success: syncResult.success });
  } catch (error) {
    logger.error(`Error in sync process for organization ${organizationId}`, { error });
    results.failed = 1;
    results.details.push({
      organization_id: organizationId,
      status: "failed",
      reason: error instanceof Error ? error.message : String(error)
    });
  } finally {
    
  }
  
  return results;
}

/**
 * Process a single organization's preset amounts sync with robust error handling
 */
async function processOrganizationSync(db: any, row: any, forceSynchronization: boolean = false): Promise<{ 
  success: boolean; 
  reason?: string; 
  data?: any 
}> {
  const organizationId = row.organization_id;
  const kioskId = row.id;
  const presetAmounts = row.preset_amounts || [];
  const currentCatalogId = row.catalog_parent_id;
  const accessToken = row.access_token;
  const locationId = row.location_id;
  
  // SIMPLE FIX: Get processing fee settings from the row
  const processingFeeSettings = {
    enabled: row.processing_fee_enabled || false,
    percentage: row.processing_fee_percentage || 2.6,
    fixed_cents: row.processing_fee_fixed_cents || 15
  };
  
  if (!accessToken) {
    return { 
      success: false, 
      reason: "No Square access token available" 
    };
  }

  logger.info(`Processing organization ${organizationId} with ${presetAmounts.length} preset amounts`);

  // Start a transaction
  const client = await db.connect();

  try {
   

    let donationItemId = currentCatalogId;
    
    // STEP 1: Validate existing parent item (if any)
    if (donationItemId) {
      const isValid = await validateCatalogItem(accessToken, donationItemId);
      if (!isValid) {
        logger.warn(`Parent item ${donationItemId} no longer exists in Square, will create new one`);
        donationItemId = null;
        
        // Clear stale parent ID from database
        await client.execute(
          "UPDATE kiosk_settings SET catalog_parent_id = NULL WHERE id = ?",
          [kioskId]
        );
      }
    }
    
    // STEP 2: Create new parent item if needed
    if (!donationItemId || forceSynchronization) {
      donationItemId = await createDonationsItemInSquare(accessToken, locationId);
      
      if (!donationItemId) {
       
        return { 
          success: false, 
          reason: "Failed to create new Donations catalog item in Square" 
        };
      }
      
      logger.info(`Created new parent donation item: ${donationItemId}`);
    }

    
 const catalogVariations = await createDonationVariationsWithRetry(
    accessToken, 
    donationItemId, 
    presetAmounts.map((amount: string) => parseFloat(amount)),
    processingFeeSettings // Pass the settings here
  );

    if (!catalogVariations || catalogVariations.length === 0) {
      
      return { 
        success: false, 
        reason: "Failed to create catalog variations in Square" 
      };
    }

    // STEP 4: Clear existing preset_donations for this organization
    await client.execute(
      "DELETE FROM preset_donations WHERE organization_id = ?",
      [organizationId]
    );

    // STEP 5: Insert new records into preset_donations table
    for (let i = 0; i < presetAmounts.length; i++) {
      const amount = parseFloat(presetAmounts[i]);
    const variation = catalogVariations.find((v: CatalogItem) => {
  // When fees are enabled, match by the original amount stored in user_data
  if (processingFeeSettings.enabled && v.item_variation_data?.user_data) {
    try {
      const userData = JSON.parse(v.item_variation_data.user_data);
      return userData.original_amount === amount;
    } catch (e) {
      // Fallback if user_data parsing fails
      console.error('Failed to parse user_data:', e);
    }
  }
  
  // When fees are disabled, match by the catalog price
  // Note: Square stores amounts in cents, so multiply by 100
  return v.item_variation_data?.price_money?.amount === Math.round(amount * 100);
});

      if (variation) {
        await client.execute(
          `INSERT INTO preset_donations 
           (organization_id, amount, catalog_item_id, catalog_variation_id, display_order) 
           VALUES (?, ?, ?, ?, ?)`,
          [organizationId, amount, donationItemId, variation.id, i + 1]
        );
      }
    }

    // STEP 6: Update kiosk_settings with the catalog_parent_id
    await client.execute(
      `UPDATE kiosk_settings 
       SET catalog_parent_id = ?, 
           last_catalog_sync = NOW(),
           preset_amounts = NULL
       WHERE id = ?`,
      [donationItemId, kioskId]
    );

 
    
    return { 
      success: true, 
      data: {
        donation_item_id: donationItemId,
        variations_count: catalogVariations.length,
        amounts: presetAmounts.map((amount: string) => parseFloat(amount))
      }
    };
  } catch (error) {
 
    logger.error(`Error syncing preset amounts for organization ${organizationId}`, { error });
    return { 
      success: false, 
      reason: error instanceof Error ? error.message : String(error)
    };
  } finally {
    client.release();
  }
}

/**
 * NEW: Validate that a catalog item still exists in Square
 */
async function validateCatalogItem(accessToken: string, catalogItemId: string): Promise<boolean> {
  try {
    const SQUARE_ENVIRONMENT = process.env.SQUARE_ENVIRONMENT || "production";
    const SQUARE_DOMAIN = SQUARE_ENVIRONMENT === "production" ? "squareup.com" : "squareupsandbox.com";
    
    const response = await axios.get(
      `https://connect.${SQUARE_DOMAIN}/v2/catalog/object/${catalogItemId}`,
      {
        headers: {
          "Square-Version": "2023-09-25",
          "Authorization": `Bearer ${accessToken}`,
          "Content-Type": "application/json"
        }
      }
    );
    
    return response.status === 200 && response.data.object;
  } catch (error: any) {
    if (error.response?.status === 404) {
      logger.info(`Catalog item ${catalogItemId} not found in Square (deleted externally)`);
      return false;
    }
    logger.warn(`Error validating catalog item ${catalogItemId}:`, { error: error.message });
    return false; // Assume invalid if we can't verify
  }
}

/**
 * NEW: Create donation variations with retry logic for failed items
 */
async function createDonationVariationsWithRetry(
  accessToken: string, 
  donationItemId: string, 
  amounts: number[],
  processingFeeSettings?: { enabled: boolean; percentage: number; fixed_cents: number }
): Promise<CatalogItem[]> {
  try {
    const SQUARE_ENVIRONMENT = process.env.SQUARE_ENVIRONMENT || "production";
    const SQUARE_DOMAIN = SQUARE_ENVIRONMENT === "production" ? "squareup.com" : "squareupsandbox.com";
    
    // Prepare batch objects for variations
    const batchObjects = amounts.map((amount: number) => {
      let displayAmount = amount;
      let variationName = `$${amount} Donation`;
      
      // SIMPLE FIX: If processing fees are enabled, create variation with fee-inclusive amount
      if (processingFeeSettings?.enabled) {
        const amountCents = Math.round(amount * 100);
        const percentageFee = Math.round(amountCents * processingFeeSettings.percentage / 100);
        const totalFee = percentageFee + processingFeeSettings.fixed_cents;
        const totalCents = amountCents + totalFee;
        displayAmount = totalCents / 100;
        
        // Show both the donation and total in the name
        variationName = `$${amount} Donation → $${displayAmount.toFixed(2)} Total`;
      }
      
      const variation_id = `VAR_${amount.toString().replace('.', '_')}_${uuidv4().substring(0, 8)}`;
      
      return {
        type: "ITEM_VARIATION",
        id: variation_id,
        present_at_all_locations: true,
        item_variation_data: {
          item_id: donationItemId,
          name: variationName,
          pricing_type: "FIXED_PRICING",
          price_money: {
            amount: Math.round(displayAmount * 100), // Use display amount (with fee if enabled)
            currency: "USD"
          },
          // Store original donation amount in user_data for reference
          user_data: JSON.stringify({ 
            original_amount: amount,
            fee_included: processingFeeSettings?.enabled || false
          })
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

/**
 * Create a Donations catalog item in Square
 */
async function createDonationsItemInSquare(accessToken: string, locationId: string): Promise<string | null> {
  try {
    const SQUARE_ENVIRONMENT = process.env.SQUARE_ENVIRONMENT || "production";
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

/**
 * Create donation variations in Square
 */
async function createDonationVariationsInSquare(
  accessToken: string, 
  donationItemId: string, 
  amounts: number[]
): Promise<CatalogItem[]> {
  try {
    const SQUARE_ENVIRONMENT = process.env.SQUARE_ENVIRONMENT || "production";
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