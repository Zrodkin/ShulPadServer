import { NextResponse, type NextRequest } from "next/server"
import axios from "axios"
import { createClient } from "@/lib/db"
import { logger } from "@/lib/logger"
import { v4 as uuidv4 } from "uuid"

// Define interfaces for type safety
interface CatalogItemVariation {
  type: "ITEM_VARIATION";
  id: string;
  presentAtAllLocations: boolean;
  itemVariationData: {
    itemId: string;
    name: string;
    pricingType: "FIXED_PRICING";
    priceMoney: {
      amount: number;
      currency: string;
    };
  };
}

interface CatalogItem {
  type: "ITEM";
  id: string;
  presentAtAllLocations: boolean;
  itemData: {
    name: string;
    description: string;
    variations?: CatalogItemVariation[];
  };
}

interface CatalogObjectBatch {
  objects: (CatalogItem | CatalogItemVariation)[];
}

interface IdMapping {
  clientObjectId: string;
  objectId: string;
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
      replace_existing = false // Whether to replace all existing variations
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

    // Check batch size limits (Square allows up to 10,000 objects total, 1,000 per batch)
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
    
    const SQUARE_ENVIRONMENT = process.env.SQUARE_ENVIRONMENT || "sandbox"
    const SQUARE_DOMAIN = SQUARE_ENVIRONMENT === "production" ? "squareup.com" : "squareupsandbox.com"
    const SQUARE_BATCH_URL = `https://connect.${SQUARE_DOMAIN}/v2/catalog/batch-upsert`

    // Generate an idempotency key for this batch request
    const idempotencyKey = uuidv4()
    
    // Prepare the batch objects
    const batchObjects: (CatalogItem | CatalogItemVariation)[] = []
    
    // Determine parent item ID (use existing or create new temporary ID)
    let donationItemId = parent_item_id
    if (!donationItemId) {
      donationItemId = `#Donations_${uuidv4().substring(0, 8)}`
      
      // Create parent item
      const parentItem: CatalogItem = {
        type: "ITEM",
        id: donationItemId,
        presentAtAllLocations: true,
        itemData: {
          name: parent_item_name,
          description: parent_item_description
          // Note: variations will be added separately in batch
        }
      }
      
      batchObjects.push(parentItem)
    }
    
    // Create variation objects for each amount
    amounts.forEach((amount: number, index: number) => {
      const variationId = `#Donation_${amount.toString().replace('.', '_')}_${uuidv4().substring(0, 8)}`
      
      const variation: CatalogItemVariation = {
        type: "ITEM_VARIATION",
        id: variationId,
        presentAtAllLocations: true,
        itemVariationData: {
          itemId: donationItemId!,
          name: `$${amount} Donation`,
          pricingType: "FIXED_PRICING",
          priceMoney: {
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
      replace_existing
    })

    // Make the request to Square API
    const response = await axios.post(
      SQUARE_BATCH_URL,
      {
        idempotencyKey: idempotencyKey,
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
      id_mappings_count: response.data.idMappings?.length || 0
    })

    // Process the response to extract useful information
    const idMappings: IdMapping[] = response.data.idMappings || []
    const createdObjects = response.data.objects || []
    
    // Find the parent item in the response
    const parentObject = createdObjects.find((obj: any) => obj.type === "ITEM")
    const actualParentId = parentObject?.id || donationItemId
    
    // Extract variation details
    const variations = createdObjects
      .filter((obj: any) => obj.type === "ITEM_VARIATION")
      .map((variation: any) => ({
        id: variation.id,
        name: variation.itemVariationData?.name,
        amount: variation.itemVariationData?.priceMoney?.amount / 100, // Convert back to dollars
        formatted_amount: `$${(variation.itemVariationData?.priceMoney?.amount / 100).toFixed(2)}`,
        ordinal: variation.itemVariationData?.ordinal
      }))

    // Format the response
    const formattedResponse = {
      parent_item_id: actualParentId,
      parent_item_name: parentObject?.itemData?.name || parent_item_name,
      variations_created: variations.length,
      variations: variations,
      id_mappings: idMappings,
      updated_at: response.data.updatedAt,
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