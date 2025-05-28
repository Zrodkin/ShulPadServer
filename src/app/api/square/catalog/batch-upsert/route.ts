import { NextResponse, type NextRequest } from "next/server"
import axios from "axios"
import { createClient } from "@/lib/db"
import { logger } from "@/lib/logger"
import { v4 as uuidv4 } from "uuid"

// Define interfaces for type safety - CORRECTED
interface CatalogItemVariationData {
  item_id: string;
  name: string;
  pricing_type: "FIXED_PRICING";
  price_money: {
    amount: number;
    currency: string;
  };
}

interface CatalogItemData {
  name: string;
  description?: string;
  is_taxable?: boolean;
  product_type?: string;
}

// ✅ FIXED: Proper CatalogObject structure
interface CatalogObject {
  type: "ITEM" | "ITEM_VARIATION";
  id: string;
  present_at_all_locations?: boolean;
  item_data?: CatalogItemData;
  item_variation_data?: CatalogItemVariationData;
}

interface CatalogObjectBatch {
  objects: CatalogObject[];
}

interface IdMapping {
  client_object_id: string;
  object_id: string;
}

interface SquareError {
  category: string;
  code: string;
  detail?: string;
  field?: string;
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { 
      organization_id, 
      amounts, 
      parent_item_id = null,
      parent_item_name = "Donations",
      parent_item_description = "Donation preset amounts",
      replace_existing = false,
      validate_existing = false,  // NEW
      force_new = false          // NEW
    } = body

    if (!organization_id) {
      logger.error("Organization ID is required for catalog operations")
      return NextResponse.json({ error: "Organization ID is required" }, { status: 400 })
    }

    if (!amounts || !Array.isArray(amounts) || amounts.length === 0) {
      logger.error("Valid amounts array is required", { amounts })
      return NextResponse.json({ error: "Amounts must be a non-empty array" }, { status: 400 })
    }

    // Validate all amounts
    for (const amount of amounts) {
      if (typeof amount !== 'number' || amount <= 0) {
        logger.error("Invalid amount in array", { amount })
        return NextResponse.json({ error: "All amounts must be positive numbers" }, { status: 400 })
      }
    }

    // Check batch size limits (from Square documentation)
    if (amounts.length > 999) { // Reserve 1 slot for parent item if needed
      logger.error("Too many amounts", { count: amounts.length })
      return NextResponse.json({ 
        error: "Too many amounts. Maximum 999 preset amounts allowed per batch" 
      }, { status: 400 })
    }

    // Get the access token from the database
    const db = createClient()
    const result = await db.query(
      "SELECT access_token, location_id FROM square_connections WHERE organization_id = $1",
      [organization_id]
    )

    if (result.rows.length === 0) {
      logger.error("No Square connection found for this organization", { organization_id })
      return NextResponse.json({ error: "Not connected to Square" }, { status: 404 })
    }

    const { access_token, location_id } = result.rows[0]

    // NEW: Validate existing parent item if provided and not forcing new
    let validatedParentId = parent_item_id;
    if (parent_item_id && validate_existing && !force_new) {
      const isValid = await validateCatalogItemInBatch(access_token, parent_item_id);
      if (!isValid) {
        logger.warn(`Parent item ${parent_item_id} no longer exists, will create new one`);
        validatedParentId = null;
      }
    }

    // Override parent_item_id if force_new is true
    if (force_new) {
      validatedParentId = null;
    }
    
    const SQUARE_ENVIRONMENT = process.env.SQUARE_ENVIRONMENT || "production"
    const SQUARE_DOMAIN = SQUARE_ENVIRONMENT === "production" ? "squareup.com" : "squareupsandbox.com"
    const SQUARE_BATCH_URL = `https://connect.${SQUARE_DOMAIN}/v2/catalog/batch-upsert`

    // Generate an idempotency key for this batch request
    const idempotencyKey = uuidv4()
    
    // ✅ FIXED: Prepare the batch objects with correct structure
    const batchObjects: CatalogObject[] = []
    
    // Determine parent item ID (use validated existing or create new temporary ID)
    let donationItemId = validatedParentId  // Changed from parent_item_id
    if (!donationItemId) {
      donationItemId = `#Donations_${uuidv4().substring(0, 8)}`
      
      // ✅ FIXED: Create parent item with correct CatalogObject structure
      const parentItem: CatalogObject = {
        type: "ITEM",
        id: donationItemId,
        present_at_all_locations: true, // ✅ FIXED: Correct field name
        item_data: { // ✅ FIXED: Correct field name
          name: parent_item_name,
          description: parent_item_description,
          is_taxable: false, // Donations are typically not taxable
          product_type: "DONATION" // ✅ ADDED: Specific product type for donations
        }
      }
      
      batchObjects.push(parentItem)
    }
    
    // ✅ FIXED: Create variation objects with correct structure
    amounts.forEach((amount: number, index: number) => {
      const variationId = `#Donation_${amount.toString().replace('.', '_')}_${uuidv4().substring(0, 8)}`
      
      const variation: CatalogObject = { // ✅ FIXED: CatalogObject, not CatalogItemVariation
        type: "ITEM_VARIATION",
        id: variationId,
        present_at_all_locations: true, // ✅ FIXED: Correct field name
        item_variation_data: { // ✅ FIXED: Correct field name
          item_id: donationItemId!,
          name: `$${amount} Donation`,
          pricing_type: "FIXED_PRICING",
          price_money: {
            amount: Math.round(amount * 100), // Convert to cents
            currency: "USD"
          }
        }
      }
      
      batchObjects.push(variation)
    })

    const batch: CatalogObjectBatch = {
      objects: batchObjects
    }

    logger.info("Batch upserting catalog items", { 
      organization_id,
      item_count: batchObjects.length,
      amounts_count: amounts.length,
      parent_id: donationItemId,
      replace_existing,
      validate_existing,
      force_new
    })

    // ✅ FIXED: Make the request with correct API version and structure
    const response = await axios.post(
      SQUARE_BATCH_URL,
      {
        idempotency_key: idempotencyKey, // ✅ FIXED: Correct field name
        batches: [batch] // Single batch for this request
      },
      {
        headers: {
          "Square-Version": "2025-05-21", // Latest API version
          "Authorization": `Bearer ${access_token}`,
          "Content-Type": "application/json"
        }
      }
    )

    logger.info("Successfully batch upserted catalog items", { 
      organization_id,
      objects_created: response.data.objects?.length || 0,
      id_mappings_count: response.data.id_mappings?.length || 0
    })

    // Process the response to extract useful information
    const idMappings: IdMapping[] = response.data.id_mappings || []
    const createdObjects = response.data.objects || []
    
    // Find the parent item in the response
    const parentObject = createdObjects.find((obj: any) => obj.type === "ITEM")
    const actualParentId = parentObject?.id || donationItemId
    
    // Extract variation details
    const variations = createdObjects
      .filter((obj: any) => obj.type === "ITEM_VARIATION")
      .map((variation: any) => ({
        id: variation.id,
        name: variation.item_variation_data?.name,
        amount: variation.item_variation_data?.price_money?.amount / 100, // Convert back to dollars
        formatted_amount: `$${(variation.item_variation_data?.price_money?.amount / 100).toFixed(2)}`,
        ordinal: variation.item_variation_data?.ordinal
      }))

    // Format the response
    const formattedResponse = {
      parent_item_id: actualParentId,
      parent_item_name: parentObject?.item_data?.name || parent_item_name,
      variations_created: variations.length,
      variations: variations,
      id_mappings: idMappings,
      updated_at: response.data.updated_at,
      batch_size: batchObjects.length,
      success: true
    }

    return NextResponse.json(formattedResponse)

  } catch (error: any) {
    logger.error("Error batch upserting catalog items", { error })
    
    // Handle Square API specific errors
    if (error.response?.data?.errors) {
      const squareErrors: SquareError[] = error.response.data.errors
      logger.error("Square API errors", { errors: squareErrors })
      
      // Return first error with Square's standard format
      const firstError = squareErrors[0]
      return NextResponse.json({ 
        error: firstError.detail || firstError.code,
        square_error: {
          category: firstError.category,
          code: firstError.code,
          detail: firstError.detail,
          field: firstError.field
        },
        square_errors: squareErrors // Include all errors for debugging
      }, { status: error.response.status })
    }
    
    return NextResponse.json({ error: "Error batch upserting catalog items" }, { status: 500 })
  }
}

/**
 * NEW: Validate catalog item for batch operations
 */
async function validateCatalogItemInBatch(accessToken: string, catalogItemId: string): Promise<boolean> {
  try {
    const SQUARE_ENVIRONMENT = process.env.SQUARE_ENVIRONMENT || "production";
    const SQUARE_DOMAIN = SQUARE_ENVIRONMENT === "production" ? "squareup.com" : "squareupsandbox.com";
    
    const response = await axios.get(
      `https://connect.${SQUARE_DOMAIN}/v2/catalog/object/${catalogItemId}`,
      {
        headers: {
          "Square-Version": "2025-05-21",
          "Authorization": `Bearer ${accessToken}`,
          "Content-Type": "application/json"
        }
      }
    );
    
    return response.status === 200 && response.data.object;
  } catch (error: any) {
    if (error.response?.status === 404) {
      return false;
    }
    return false; // Assume invalid if we can't verify
  }
}