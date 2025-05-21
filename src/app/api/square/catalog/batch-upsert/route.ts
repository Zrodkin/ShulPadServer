import { NextResponse, type NextRequest } from "next/server"
import axios from "axios"
import { createClient } from "@/lib/db"
import { logger } from "@/lib/logger"
import { v4 as uuidv4 } from "uuid"

// Define an interface for the mapping
interface IdMapping {
  client_object_id: string;
  object_id: string;
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { organization_id, amounts, parent_item_id = null } = body

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
    const SQUARE_BATCH_URL = `https://connect.${SQUARE_DOMAIN}/v2/catalog/batch-upsert`

    // Find or create a parent "Donations" item
    let donationItemId = parent_item_id
    
    if (!donationItemId) {
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
          donationItemId = searchResponse.data.objects[0].id
        }
      } catch (searchError) {
        logger.warn("Error searching for Donations catalog item", { error: searchError })
        // Continue with creating a new item
      }
    }

    // Generate an idempotency key for this batch request
    const idempotencyKey = uuidv4()
    
    // Prepare the batch objects
    const batchObjects = []
    
    // If we need to create a parent item
    if (!donationItemId) {
      const item_id = `ITEM_DONATIONS_${uuidv4().substring(0, 8)}`
      
      batchObjects.push({
        type: "ITEM",
        id: item_id,
        present_at_all_locations: true,
        item_data: {
          name: "Donations",
          description: "Donation preset amounts",
          is_taxable: false,
          variations: [] // We'll create variations separately
        }
      })
      
      donationItemId = item_id
    }
    
    // Create variation objects for each amount
    for (const amount of amounts) {
      const variation_id = `VAR_${amount.toString().replace('.', '_')}_${uuidv4().substring(0, 8)}`
      
      batchObjects.push({
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
      })
    }

    // Make the request to Square API
    const response = await axios.post(
      SQUARE_BATCH_URL,
      {
        idempotency_key: idempotencyKey,
        batches: [
          {
            objects: batchObjects
          }
        ]
      },
      {
        headers: {
          "Square-Version": "2023-09-25",
          "Authorization": `Bearer ${access_token}`,
          "Content-Type": "application/json"
        }
      }
    )

    logger.info("Successfully batch upserted catalog items", { 
      organization_id,
      item_count: batchObjects.length,
      parent_id: donationItemId
    })

    // Format the response with object IDs for client reference
    const formattedResponse = {
      parent_id: donationItemId,
      variation_ids: response.data.id_mappings?.map((mapping: IdMapping) => mapping.client_object_id) || [],
      amounts: amounts,
      raw_response: response.data // Include raw response for debugging
    }

    // Return the created/updated catalog objects
    return NextResponse.json(formattedResponse)
  } catch (error: any) {
    logger.error("Error batch upserting catalog items", { error })
    
    // Return more detailed error info if available
    if (error.response && error.response.data) {
      return NextResponse.json({ 
        error: "Error from Square API", 
        details: error.response.data 
      }, { status: 500 })
    }
    
    return NextResponse.json({ error: "Error batch upserting catalog items" }, { status: 500 })
  }
}