import { NextResponse, type NextRequest } from "next/server"
import axios from "axios"
import { createClient } from "@/lib/db"
import { logger } from "@/lib/logger"

// Define interfaces for type safety - CORRECTED
interface CatalogItemVariationData {
  item_id: string;
  name: string;
  price_money?: {
    amount: number;
    currency: string;
  };
  ordinal?: number;
}

interface CatalogItemData {
  name: string;
  description?: string;
  product_type?: string;
}

interface CatalogObject {
  id: string;
  type: string;
  item_data?: CatalogItemData;
  item_variation_data?: CatalogItemVariationData;
  updated_at?: string;
  version?: number;
}

interface ProcessedItem {
  id: string;
  parent_id: string;
  name: string;
  amount: number;
  formatted_amount: string;
  type: string;
  ordinal?: number;
}

interface SquareError {
  category: string;
  code: string;
  detail?: string;
  field?: string;
}

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams
    const organization_id = searchParams.get("organization_id")
    const item_id = searchParams.get("item_id") // Optional: to retrieve a specific item
    const cursor = searchParams.get("cursor") // For pagination
    const include_inactive = searchParams.get("include_inactive") === "true"

    if (!organization_id) {
      logger.error("Organization ID is required for catalog operations")
      return NextResponse.json({ error: "Organization ID is required" }, { status: 400 })
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
    
    let donationItems: CatalogObject[] = []
    let nextCursor: string | undefined = undefined
    
    if (item_id) {
      // ✅ FIXED: Retrieve specific item with its variations
      try {
        const catalogResponse = await axios.get(
          `https://connect.${SQUARE_DOMAIN}/v2/catalog/object/${item_id}?include_related_objects=true`,
          {
            headers: {
              "Square-Version": "2025-05-21", // ✅ FIXED: Latest API version
              "Authorization": `Bearer ${access_token}`,
              "Content-Type": "application/json"
            }
          }
        )
        
        donationItems = [catalogResponse.data.object]
        
        // Include related objects (variations)
        if (catalogResponse.data.related_objects) {
          donationItems = [...donationItems, ...catalogResponse.data.related_objects]
        }
      } catch (fetchError) {
        logger.error("Error fetching specific catalog item", { error: fetchError, item_id })
        return NextResponse.json({ 
          error: `Item ${item_id} not found or inaccessible` 
        }, { status: 404 })
      }
    } else {
      // ✅ IMPROVED: Better search strategy for donation-related items
      try {
        // Strategy 1: Use ListCatalog to get all items, then filter for donations
        const listResponse = await axios.get(
          `https://connect.${SQUARE_DOMAIN}/v2/catalog/list?types=ITEM,ITEM_VARIATION${cursor ? `&cursor=${cursor}` : ''}`,
          {
            headers: {
              "Square-Version": "2025-05-21", // ✅ FIXED: Latest API version
              "Authorization": `Bearer ${access_token}`,
              "Content-Type": "application/json"
            }
          }
        )
        
        const allItems = listResponse.data.objects || []
        nextCursor = listResponse.data.cursor
        
        // Filter for donation-related items
        donationItems = allItems.filter((item: CatalogObject) => {
          if (item.type === "ITEM") {
            const itemName = item.item_data?.name?.toLowerCase() || ""
            const itemDesc = item.item_data?.description?.toLowerCase() || ""
            const productType = item.item_data?.product_type || ""
            
            // Check if this is a donation item
            return itemName.includes("donation") || 
                   itemDesc.includes("donation") ||
                   itemName.includes("charity") ||
                   productType === "DONATION" ||
                   itemName === "Donations" // Exact match for our parent item
          }
          
          // Include all variations for potential filtering
          return item.type === "ITEM_VARIATION"
        })
        
        // If no donation items found via list, try search as fallback
        if (donationItems.filter(item => item.type === "ITEM").length === 0) {
          logger.info("No donation items found via list, trying search fallback")
          
          const searchResponse = await axios.post(
            `https://connect.${SQUARE_DOMAIN}/v2/catalog/search`,
            {
              object_types: ["ITEM"],
              query: {
                text_query: {
                  keywords: ["donation", "donate", "charity"]
                }
              },
              include_related_objects: true,
              ...(cursor && { cursor }),
              ...(include_inactive && { include_deleted_objects: true })
            },
            {
              headers: {
                "Square-Version": "2025-05-21",
                "Authorization": `Bearer ${access_token}`,
                "Content-Type": "application/json"
              }
            }
          )
          
          donationItems = searchResponse.data.objects || []
          nextCursor = searchResponse.data.cursor
          
          if (searchResponse.data.related_objects) {
            donationItems = [...donationItems, ...searchResponse.data.related_objects]
          }
        }
        
      } catch (searchError) {
        logger.error("Error searching for donation items", { error: searchError })
        
        // Handle Square API specific errors
        if (searchError.response?.data?.errors) {
          const squareErrors: SquareError[] = searchError.response.data.errors
          logger.error("Square API search errors", { errors: squareErrors })
          
          const firstError = squareErrors[0]
          return NextResponse.json({ 
            error: firstError.detail || firstError.code,
            square_error: {
              category: firstError.category,
              code: firstError.code,
              detail: firstError.detail,
              field: firstError.field
            }
          }, { status: searchError.response.status })
        }
        
        // Return empty result on search failure
        logger.warn("Search failed, returning empty results")
        donationItems = []
      }
    }
    
    // ✅ IMPROVED: Process the items to extract donation amounts
    const processedItems: ProcessedItem[] = []
    
    // Find main donation item(s)
    const donationMainItems = donationItems.filter((item: CatalogObject) => 
      item.type === "ITEM" && 
      item.item_data && 
      (item.item_data.name === "Donations" || 
       item.item_data.name?.toLowerCase().includes("donation") ||
       item.item_data.product_type === "DONATION")
    )
    
    // Process each main donation item
    donationMainItems.forEach((donationItem: CatalogObject) => {
      // Find related variations
      const variations = donationItems.filter((obj: CatalogObject) => 
        obj.type === "ITEM_VARIATION" && 
        obj.item_variation_data && 
        obj.item_variation_data.item_id === donationItem.id
      )
      
      // Process variations into standardized format
      variations.forEach((variation: CatalogObject) => {
        if (variation.item_variation_data && variation.item_variation_data.price_money) {
          const amount = variation.item_variation_data.price_money.amount / 100 // Convert cents to dollars
          processedItems.push({
            id: variation.id,
            parent_id: donationItem.id,
            name: variation.item_variation_data.name,
            amount: amount,
            formatted_amount: `$${amount.toFixed(2)}`,
            type: "preset",
            ordinal: variation.item_variation_data.ordinal
          })
        }
      })
    })
    
    // ✅ IMPROVED: Sort by ordinal if available, otherwise by amount
    processedItems.sort((a, b) => {
      if (a.ordinal !== undefined && b.ordinal !== undefined) {
        return a.ordinal - b.ordinal
      }
      return a.amount - b.amount
    })
    
    logger.info("Retrieved donation items", { 
      organization_id, 
      total_objects: donationItems.length,
      processed_items: processedItems.length,
      main_items: donationMainItems.length
    })
    
    // ✅ IMPROVED: Return formatted response with better metadata
    return NextResponse.json({
      donation_items: processedItems,
      parent_items: donationMainItems.map((item: CatalogObject) => ({
        id: item.id,
        name: item.item_data?.name,
        description: item.item_data?.description,
        product_type: item.item_data?.product_type,
        updated_at: item.updated_at,
        version: item.version
      })),
      pagination: {
        cursor: nextCursor,
        has_more: !!nextCursor
      },
      metadata: {
        total_variations: processedItems.length,
        total_parent_items: donationMainItems.length,
        search_strategy: item_id ? "specific_item" : 
                        donationMainItems.length > 0 ? "list_filtered" : "search_fallback"
      }
    })

  } catch (error: any) {
    logger.error("Error retrieving catalog items", { error })
    
    // Handle Square API specific errors
    if (error.response?.data?.errors) {
      const squareErrors: SquareError[] = error.response.data.errors
      logger.error("Square API errors", { errors: squareErrors })
      
      const firstError = squareErrors[0]
      return NextResponse.json({ 
        error: firstError.detail || firstError.code,
        square_error: {
          category: firstError.category,
          code: firstError.code,
          detail: firstError.detail,
          field: firstError.field
        }
      }, { status: error.response.status })
    }
    
    return NextResponse.json({ error: "Error retrieving catalog items" }, { status: 500 })
  }
}