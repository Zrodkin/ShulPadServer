import { NextResponse, type NextRequest } from "next/server"
import axios from "axios"
import { createClient } from "@/lib/db"
import { logger } from "@/lib/logger"

// Define interfaces for type safety
interface CatalogItemVariationData {
  item_id: string;
  name: string;
  price_money?: {
    amount: number;
    currency: string;
  };
}

interface CatalogItemData {
  name: string;
  description?: string;
  variations?: CatalogItem[];
}

interface CatalogItem {
  id: string;
  type: string;
  item_data?: CatalogItemData;
  item_variation_data?: CatalogItemVariationData;
}

interface ProcessedItem {
  id: string;
  parent_id: string;
  name: string;
  amount: number;
  formatted_amount: string;
  type: string;
}

interface SquareError {
  category: string;
  code: string;
  detail: string;
}

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams
    const organization_id = searchParams.get("organization_id")
    const item_id = searchParams.get("item_id") // Optional: to retrieve a specific item and its variations
    const cursor = searchParams.get("cursor") // For pagination

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
      // If item_id is provided, retrieve that specific item with its variations
      const catalogResponse = await axios.get(
        `https://connect.${SQUARE_DOMAIN}/v2/catalog/object/${item_id}?include_related_objects=true`,
        {
          headers: {
            "Square-Version": "2024-12-18", // Use latest stable version
            "Authorization": `Bearer ${access_token}`,
            "Content-Type": "application/json"
          }
        }
      )
      
      donationItems = [catalogResponse.data.object]
      
      // If there are related objects (like variations), include them
      if (catalogResponse.data.related_objects) {
        donationItems = [...donationItems, ...catalogResponse.data.related_objects]
      }
    } else {
      // Search for donation-related items using Square's recommended approach
      try {
        // Strategy 1: Search for exact "Donations" item
        const searchResponse = await axios.post(
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
            ...(cursor && { cursor })
          },
          {
            headers: {
              "Square-Version": "2024-12-18",
              "Authorization": `Bearer ${access_token}`,
              "Content-Type": "application/json"
            }
          }
        )
        
        if (searchResponse.data.objects && searchResponse.data.objects.length > 0) {
          donationItems = searchResponse.data.objects
          nextCursor = searchResponse.data.cursor
          
          // Also include related objects (variations)
          if (searchResponse.data.related_objects) {
            donationItems = [...donationItems, ...searchResponse.data.related_objects]
          }
        } else {
          // Strategy 2: Use text search for donation-related items
          const textSearchResponse = await axios.post(
            `https://connect.${SQUARE_DOMAIN}/v2/catalog/search`,
            {
              objectTypes: ["ITEM"],
              query: {
                textQuery: {
                  keywords: ["donation"]
                }
              },
              includeRelatedObjects: true,
              ...(cursor && { cursor })
            },
            {
              headers: {
                "Square-Version": "2024-12-18",
                "Authorization": `Bearer ${access_token}`,
                "Content-Type": "application/json"
              }
            }
          )
          
          donationItems = textSearchResponse.data.objects || []
          nextCursor = textSearchResponse.data.cursor
          
          if (textSearchResponse.data.related_objects) {
            donationItems = [...donationItems, ...textSearchResponse.data.related_objects]
          }
        }
      } catch (searchError) {
        logger.error("Error searching for donation items", { error: searchError })
        
        // Handle Square API specific errors
        if (searchError.response?.data?.errors) {
          const squareErrors: SquareError[] = searchError.response.data.errors
          logger.error("Square API search errors", { errors: squareErrors })
          return NextResponse.json({ 
            error: "Square API search error", 
            square_errors: squareErrors 
          }, { status: searchError.response.status })
        }
        
        // Don't fallback to listing all items - return empty result instead
        logger.warn("Search failed, returning empty results to avoid inefficient full catalog list")
        donationItems = []
      }
    }
    
    // Process the items to extract donation amounts
    const processedItems: ProcessedItem[] = []
    
    // Find main donation item
    const donationItem = donationItems.find((item: CatalogItem) => 
      item.type === "ITEM" && 
      item.item_data && 
      item.item_data.name === "Donations"
    )
    
    if (donationItem) {
      // Use related objects approach (Square's recommended pattern)
      const variations = donationItems.filter((obj: CatalogItem) => 
        obj.type === "ITEM_VARIATION" && 
        obj.item_variation_data && 
        obj.item_variation_data.item_id === donationItem.id
      )
      
      // Format the variations for easier client-side processing
      variations.forEach((variation: CatalogItem) => {
        if (variation.item_variation_data && variation.item_variation_data.price_money) {
          const amount = variation.item_variation_data.price_money.amount / 100 // Convert cents to dollars
          processedItems.push({
            id: variation.id,
            parent_id: donationItem.id,
            name: variation.item_variation_data.name,
            amount: amount,
            formatted_amount: `$${amount.toFixed(2)}`,
            type: "preset"
          })
        }
      })
    } else {
      // If no exact "Donations" item, look for any donation-related items
      donationItems.forEach((item: CatalogItem) => {
        if (item.type === "ITEM" && item.item_data) {
          const itemName = item.item_data.name || ""
          const itemDesc = item.item_data.description || ""
          
          // Check if this item seems donation-related
          if (itemName.toLowerCase().includes("donation") || itemDesc.toLowerCase().includes("donation")) {
            // Find related variations through related objects
            const variations = donationItems.filter((obj: CatalogItem) => 
              obj.type === "ITEM_VARIATION" && 
              obj.item_variation_data && 
              obj.item_variation_data.item_id === item.id
            )
            
            variations.forEach((variation: CatalogItem) => {
              if (variation.item_variation_data && variation.item_variation_data.price_money) {
                const amount = variation.item_variation_data.price_money.amount / 100
                processedItems.push({
                  id: variation.id,
                  parent_id: item.id,
                  name: variation.item_variation_data.name,
                  amount: amount,
                  formatted_amount: `$${amount.toFixed(2)}`,
                  type: "preset"
                })
              }
            })
          }
        }
      })
    }
    
    logger.info("Retrieved donation items", { 
      organization_id, 
      count: processedItems.length
    })
    
    return NextResponse.json({
      donation_items: processedItems,
      cursor: nextCursor, // Include cursor for pagination
      raw_items: donationItems // Include raw items for debugging
    })
  } catch (error: any) {
    logger.error("Error retrieving catalog items", { error })
    
    // Handle Square API specific errors
    if (error.response?.data?.errors) {
      const squareErrors: SquareError[] = error.response.data.errors
      logger.error("Square API errors", { errors: squareErrors })
      return NextResponse.json({ 
        error: "Square API error", 
        square_errors: squareErrors 
      }, { status: error.response.status })
    }
    
    return NextResponse.json({ error: "Error retrieving catalog items" }, { status: 500 })
  }
}