import { NextResponse, type NextRequest } from "next/server"
import axios from "axios"
import { createClient } from "@/lib/db"
import { logger } from "@/lib/logger"

// Define interfaces for type safety
interface CatalogItemVariationData {
  itemId: string;
  name: string;
  priceMoney?: {
    amount: number;
    currency: string;
  };
  ordinal?: number;
}

interface CatalogItemData {
  name: string;
  description?: string;
  variations?: CatalogItem[];
}

interface CatalogItem {
  id: string;
  type: string;
  itemData?: CatalogItemData;
  itemVariationData?: CatalogItemVariationData;
  updatedAt?: string;
  version?: number;
}

interface ProcessedItem {
  id: string;
  parentId: string;
  name: string;
  amount: number;
  formattedAmount: string;
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
    
    let donationItems: CatalogItem[] = []
    let nextCursor: string | undefined = undefined
    
    if (item_id) {
      // Retrieve specific item with its variations
      try {
        const catalogResponse = await axios.get(
          `https://connect.${SQUARE_DOMAIN}/v2/catalog/object/${item_id}?include_related_objects=true`,
          {
            headers: {
              "Square-Version": "2025-05-21", // Latest API version
              "Authorization": `Bearer ${access_token}`,
              "Content-Type": "application/json"
            }
          }
        )
        
        donationItems = [catalogResponse.data.object]
        
        // Include related objects (variations)
        if (catalogResponse.data.relatedObjects) {
          donationItems = [...donationItems, ...catalogResponse.data.relatedObjects]
        }
      } catch (fetchError) {
        logger.error("Error fetching specific catalog item", { error: fetchError, item_id })
        return NextResponse.json({ 
          error: `Item ${item_id} not found or inaccessible` 
        }, { status: 404 })
      }
    } else {
      // Search for donation-related items
      try {
        // Strategy 1: Search for exact "Donations" item first
        const exactSearchResponse = await axios.post(
          `https://connect.${SQUARE_DOMAIN}/v2/catalog/search`,
          {
            objectTypes: ["ITEM"],
            query: {
              exactQuery: {
                attributeName: "name",
                attributeValue: "Donations"
              }
            },
            includeRelatedObjects: true,
            ...(cursor && { cursor }),
            ...(include_inactive && { includeDeletedObjects: true })
          },
          {
            headers: {
              "Square-Version": "2025-05-21", // Latest API version
              "Authorization": `Bearer ${access_token}`,
              "Content-Type": "application/json"
            }
          }
        )
        
        if (exactSearchResponse.data.objects && exactSearchResponse.data.objects.length > 0) {
          donationItems = exactSearchResponse.data.objects
          nextCursor = exactSearchResponse.data.cursor
          
          // Include related objects (variations)
          if (exactSearchResponse.data.relatedObjects) {
            donationItems = [...donationItems, ...exactSearchResponse.data.relatedObjects]
          }
        } else {
          // Strategy 2: Fallback to text search for donation-related items
          const textSearchResponse = await axios.post(
            `https://connect.${SQUARE_DOMAIN}/v2/catalog/search`,
            {
              objectTypes: ["ITEM"],
              query: {
                textQuery: {
                  keywords: ["donation", "donate", "charity"]
                }
              },
              includeRelatedObjects: true,
              ...(cursor && { cursor }),
              ...(include_inactive && { includeDeletedObjects: true })
            },
            {
              headers: {
                "Square-Version": "2025-05-21",
                "Authorization": `Bearer ${access_token}`,
                "Content-Type": "application/json"
              }
            }
          )
          
          donationItems = textSearchResponse.data.objects || []
          nextCursor = textSearchResponse.data.cursor
          
          if (textSearchResponse.data.relatedObjects) {
            donationItems = [...donationItems, ...textSearchResponse.data.relatedObjects]
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
        
        // Don't fallback to listing all items - return empty result
        logger.warn("Search failed, returning empty results to avoid inefficient full catalog list")
        donationItems = []
      }
    }
    
    // Process the items to extract donation amounts
    const processedItems: ProcessedItem[] = []
    
    // Find main donation item(s)
    const donationMainItems = donationItems.filter((item: CatalogItem) => 
      item.type === "ITEM" && 
      item.itemData && 
      (item.itemData.name === "Donations" || 
       item.itemData.name?.toLowerCase().includes("donation"))
    )
    
    // Process each main donation item
    donationMainItems.forEach((donationItem: CatalogItem) => {
      // Find related variations
      const variations = donationItems.filter((obj: CatalogItem) => 
        obj.type === "ITEM_VARIATION" && 
        obj.itemVariationData && 
        obj.itemVariationData.itemId === donationItem.id
      )
      
      // Process variations into standardized format
      variations.forEach((variation: CatalogItem) => {
        if (variation.itemVariationData && variation.itemVariationData.priceMoney) {
          const amount = variation.itemVariationData.priceMoney.amount / 100 // Convert cents to dollars
          processedItems.push({
            id: variation.id,
            parentId: donationItem.id,
            name: variation.itemVariationData.name,
            amount: amount,
            formattedAmount: `${amount.toFixed(2)}`,
            type: "preset",
            ordinal: variation.itemVariationData.ordinal
          })
        }
      })
    })
    
    // If no "Donations" items found, look for any donation-related items
    if (processedItems.length === 0) {
      donationItems.forEach((item: CatalogItem) => {
        if (item.type === "ITEM" && item.itemData) {
          const itemName = item.itemData.name || ""
          const itemDesc = item.itemData.description || ""
          
          // Check if this item seems donation-related
          if (itemName.toLowerCase().includes("donation") || 
              itemDesc.toLowerCase().includes("donation") ||
              itemName.toLowerCase().includes("charity")) {
            
            // Find related variations
            const variations = donationItems.filter((obj: CatalogItem) => 
              obj.type === "ITEM_VARIATION" && 
              obj.itemVariationData && 
              obj.itemVariationData.itemId === item.id
            )
            
            variations.forEach((variation: CatalogItem) => {
              if (variation.itemVariationData && variation.itemVariationData.priceMoney) {
                const amount = variation.itemVariationData.priceMoney.amount / 100
                processedItems.push({
                  id: variation.id,
                  parentId: item.id,
                  name: variation.itemVariationData.name,
                  amount: amount,
                  formattedAmount: `${amount.toFixed(2)}`,
                  type: "preset",
                  ordinal: variation.itemVariationData.ordinal
                })
              }
            })
          }
        }
      })
    }
    
    // Sort by ordinal if available, otherwise by amount
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
    
    // Return formatted response
    return NextResponse.json({
      donation_items: processedItems,
      parent_items: donationMainItems.map((item: CatalogItem) => ({
        id: item.id,
        name: item.itemData?.name,
        description: item.itemData?.description,
        updated_at: item.updatedAt,
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
                        donationMainItems.length > 0 ? "exact_match" : "text_search"
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