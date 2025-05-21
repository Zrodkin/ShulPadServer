import { NextResponse, type NextRequest } from "next/server"
import axios from "axios"
import { createClient } from "@/lib/db"
import { logger } from "@/lib/logger"
import { v4 as uuidv4 } from "uuid"

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { 
      organization_id, 
      amount, 
      name, 
      description = "Donation",
      is_preset = true
    } = body

    if (!organization_id) {
      logger.error("Organization ID is required for catalog operations")
      return NextResponse.json({ error: "Organization ID is required" }, { status: 400 })
    }

    if (amount === undefined || amount <= 0) {
      logger.error("Valid amount is required", { amount })
      return NextResponse.json({ error: "Amount must be a positive number" }, { status: 400 })
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

    // Generate a unique ID for the catalog item or use a deterministic one based on organization + name
    const generateItemId = () => {
      return `DONATION_${amount.toString().replace('.', '_')}_${uuidv4().substring(0, 8)}`
    }

    // Check if we're updating an existing item or creating a new one
    let catalog_item_id = body.catalog_item_id || null
    
    // If we're creating a preset donation amount, we'll first look for
    // an existing "Donations" catalog item to add our variation to
    if (is_preset && !catalog_item_id) {
      try {
        // Search for a "Donations" catalog item
        const searchResponse = await axios.post(
          `https://connect.${SQUARE_DOMAIN}/v2/catalog/search`,
          {
            object_types: ["ITEM"],
            query: {
              prefix_query: {
                attribute_name: "name",
                attribute_prefix: "Donations"
              }
            }
          },
          {
            headers: {
              "Square-Version": "2023-09-25",
              "Authorization": `Bearer ${access_token}`,
              "Content-Type": "application/json"
            }
          }
        )

        // Check if we found a "Donations" item
        if (searchResponse.data.objects && searchResponse.data.objects.length > 0) {
          // Use the existing "Donations" catalog item
          catalog_item_id = searchResponse.data.objects[0].id
        }
      } catch (searchError) {
        logger.error("Error searching for Donations catalog item", { error: searchError })
        // Continue with creating a new item - don't return an error
      }
    }

    // Generate an idempotency key for this request
    const idempotencyKey = uuidv4()
    
    // Create or update the catalog object
    let catalogObject = {}
    
    if (is_preset) {
      // For preset donations, create a CatalogItem with an ItemVariation
      if (catalog_item_id) {
        // Add a new variation to an existing item
        const variation_id = `VAR_${amount.toString().replace('.', '_')}_${uuidv4().substring(0, 8)}`
        
        catalogObject = {
          type: "ITEM_VARIATION",
          id: variation_id,
          present_at_all_locations: true,
          item_variation_data: {
            item_id: catalog_item_id,
            name: name || `$${amount} Donation`,
            pricing_type: "FIXED_PRICING",
            price_money: {
              amount: Math.round(amount * 100), // Convert to cents
              currency: "USD"
            }
          }
        }
      } else {
        // Create a new donation item with a variation
        const item_id = `ITEM_DONATIONS_${uuidv4().substring(0, 8)}`
        const variation_id = `VAR_${amount.toString().replace('.', '_')}_${uuidv4().substring(0, 8)}`
        
        catalogObject = {
          type: "ITEM",
          id: item_id,
          present_at_all_locations: true,
          item_data: {
            name: "Donations",
            description: "Donation preset amounts",
            is_taxable: false,
            variations: [
              {
                type: "ITEM_VARIATION",
                id: variation_id,
                present_at_all_locations: true,
                item_variation_data: {
                  item_id,
                  name: name || `$${amount} Donation`,
                  pricing_type: "FIXED_PRICING",
                  price_money: {
                    amount: Math.round(amount * 100), // Convert to cents
                    currency: "USD"
                  }
                }
              }
            ]
          }
        }
      }
    } else {
      // For custom donation amount, just create a simple item
      // This is typically not used since custom amounts use ad-hoc line items
      const item_id = generateItemId()
      
      catalogObject = {
        type: "ITEM",
        id: item_id,
        present_at_all_locations: true,
        item_data: {
          name: name || `Custom Donation`,
          description: description,
          is_taxable: false,
          variations: [
            {
              type: "ITEM_VARIATION",
              id: `${item_id}_VAR`,
              present_at_all_locations: true,
              item_variation_data: {
                item_id,
                name: `$${amount}`,
                pricing_type: "FIXED_PRICING",
                price_money: {
                  amount: Math.round(amount * 100), // Convert to cents
                  currency: "USD"
                }
              }
            }
          ]
        }
      }
    }

    // Make the request to Square API
    const response = await axios.post(
      SQUARE_CATALOG_URL,
      {
        idempotency_key: idempotencyKey,
        object: catalogObject
      },
      {
        headers: {
          "Square-Version": "2023-09-25",
          "Authorization": `Bearer ${access_token}`,
          "Content-Type": "application/json"
        }
      }
    )

    logger.info("Successfully created/updated catalog item", { 
      organization_id,
      catalog_object_id: response.data.catalog_object.id,
      amount
    })

    // Return the created/updated catalog object
    return NextResponse.json(response.data)
  } catch (error: any) {
    logger.error("Error creating/updating catalog item", { error })
    
    // Return more detailed error info if available
    if (error.response && error.response.data) {
      return NextResponse.json({ 
        error: "Error from Square API", 
        details: error.response.data 
      }, { status: 500 })
    }
    
    return NextResponse.json({ error: "Error creating/updating catalog item" }, { status: 500 })
  }
}