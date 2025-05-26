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

// ✅ FIXED: Proper CatalogObject structure for embedded variations
interface CatalogObjectVariation {
  type: "ITEM_VARIATION";
  id: string;
  item_variation_data: CatalogItemVariationData;
}

interface CatalogObject {
  type: "ITEM";
  id: string;
  present_at_all_locations?: boolean;
  version?: number; // Required for updates
  item_data: CatalogItemData & {
    variations?: CatalogObjectVariation[];
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
    
    // ✅ FIXED: Create variations with correct structure for embedded approach
    const variations: CatalogObjectVariation[] = amounts.map((amount: number, index: number) => ({
      type: "ITEM_VARIATION",
      id: `#Donation_${amount.toString().replace('.', '_')}_${index}`,
      item_variation_data: {
        item_id: itemId,
        name: `$${amount} Donation`,
        pricing_type: "FIXED_PRICING",
        price_money: {
          amount: Math.round(amount * 100), // Convert to cents
          currency: "USD"
        }
      }
    }))

    // ✅ FIXED: Create the catalog item with correct structure
    const catalogObject: CatalogObject = {
      type: "ITEM",
      id: itemId,
      present_at_all_locations: true, // ✅ FIXED: Correct field name
      // Include version for updates (required by Square for existing objects)
      ...(parent_item_id && parent_item_version && { version: parent_item_version }),
      item_data: {
        name: parent_item_name,
        description: parent_item_description,
        is_taxable: false, // Donations are typically not taxable
        product_type: "DONATION", // ✅ ADDED: Specific product type for donations
        variations: variations
      }
    }

    logger.info("Creating/updating donation catalog item", { 
      organization_id,
      amounts_count: amounts.length,
      parent_item_name,
      is_update: !!parent_item_id
    })

    // ✅ FIXED: Make the request with correct field names
    const response = await axios.post(
      SQUARE_CATALOG_URL,
      {
        idempotency_key: idempotencyKey, // ✅ FIXED: Correct field name
        object: catalogObject
      },
      {
        headers: {
          "Square-Version": "2025-05-21", // ✅ FIXED: Latest API version
          "Authorization": `Bearer ${access_token}`,
          "Content-Type": "application/json"
        }
      }
    )

    logger.info("Successfully created/updated catalog item", { 
      organization_id,
      catalog_object_id: response.data.catalog_object?.id,
      variations_count: response.data.catalog_object?.item_data?.variations?.length
    })

    // ✅ FIXED: Extract variation details for response with correct field names
    const createdVariations = response.data.catalog_object?.item_data?.variations?.map((variation: any) => ({
      id: variation.id,
      name: variation.item_variation_data?.name,
      amount: variation.item_variation_data?.price_money?.amount / 100, // Convert back to dollars
      formatted_amount: `$${(variation.item_variation_data?.price_money?.amount / 100).toFixed(2)}`
    })) || []

    // ✅ FIXED: Return the created/updated catalog object details with correct field names
    return NextResponse.json({
      parent_item_id: response.data.catalog_object?.id,
      parent_item_name: response.data.catalog_object?.item_data?.name,
      variations: createdVariations,
      id_mappings: response.data.id_mappings || [],
      created_at: response.data.catalog_object?.created_at,
      updated_at: response.data.catalog_object?.updated_at,
      version: response.data.catalog_object?.version
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