import { NextResponse, type NextRequest } from "next/server"
import axios from "axios"
import { createClient } from "@/lib/db"
import { logger } from "@/lib/logger"
import { v4 as uuidv4 } from "uuid"

// Define interfaces for type safety
interface CatalogItemVariation {
  type: "ITEM_VARIATION";
  id: string;
  presentAtAllLocations?: boolean;
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
  presentAtAllLocations?: boolean;
  itemData: {
    name: string;
    description?: string;
    variations?: CatalogItemVariation[];
  };
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
      parent_item_name = "Donations",
      parent_item_description = "Donation preset amounts",
      parent_item_id = null, // If updating existing item
      parent_item_version = null // Required for updates
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
    const SQUARE_CATALOG_URL = `https://connect.${SQUARE_DOMAIN}/v2/catalog/object`

    // Generate idempotency key for this request
    const idempotencyKey = uuidv4()
    
    // Determine if we're creating a new item or updating existing
    const itemId = parent_item_id || `#Donations_${uuidv4().substring(0, 8)}`
    
    // Create variations for each amount
    const variations: CatalogItemVariation[] = amounts.map((amount: number, index: number) => ({
      type: "ITEM_VARIATION",
      id: `#Donation_${amount.toString().replace('.', '_')}_${index}`,
      presentAtAllLocations: true,
      itemVariationData: {
        itemId: itemId,
        name: `$${amount} Donation`,
        pricingType: "FIXED_PRICING",
        priceMoney: {
          amount: Math.round(amount * 100), // Convert to cents
          currency: "USD"
        }
      }
    }))

    // Create the catalog item with variations
    const catalogObject: CatalogItem = {
      type: "ITEM",
      id: itemId,
      presentAtAllLocations: true,
      // Include version for updates (required by Square for existing objects)
      ...(parent_item_id && parent_item_version && { version: parent_item_version }),
      itemData: {
        name: parent_item_name,
        description: parent_item_description,
        variations: variations
      }
    }

    logger.info("Creating/updating donation catalog item", { 
      organization_id,
      amounts_count: amounts.length,
      parent_item_name,
      is_update: !!parent_item_id
    })

    // Make the request to Square API
    const response = await axios.post(
      SQUARE_CATALOG_URL,
      {
        idempotencyKey: idempotencyKey,
        object: catalogObject
      },
      {
        headers: {
          "Square-Version": "2025-05-21", // Latest API version
          "Authorization": `Bearer ${access_token}`,
          "Content-Type": "application/json"
        }
      }
    )

    logger.info("Successfully created/updated catalog item", { 
      organization_id,
      catalog_object_id: response.data.catalogObject?.id,
      variations_count: response.data.catalogObject?.itemData?.variations?.length
    })

    // Extract variation details for response
    const createdVariations = response.data.catalogObject?.itemData?.variations?.map((variation: any) => ({
      id: variation.id,
      name: variation.itemVariationData?.name,
      amount: variation.itemVariationData?.priceMoney?.amount / 100, // Convert back to dollars
      formatted_amount: `$${(variation.itemVariationData?.priceMoney?.amount / 100).toFixed(2)}`
    })) || []

    // Return the created/updated catalog object details
    return NextResponse.json({
      parent_item_id: response.data.catalogObject?.id,
      parent_item_name: response.data.catalogObject?.itemData?.name,
      variations: createdVariations,
      id_mappings: response.data.idMappings || [],
      created_at: response.data.catalogObject?.createdAt,
      updated_at: response.data.catalogObject?.updatedAt,
      version: response.data.catalogObject?.version
    })

  } catch (error: any) {
    logger.error("Error creating/updating catalog item", { error })
    
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
    
    return NextResponse.json({ error: "Error creating/updating catalog item" }, { status: 500 })
  }
}