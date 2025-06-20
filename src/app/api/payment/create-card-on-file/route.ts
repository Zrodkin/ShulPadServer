// app/api/payment/create-card-on-file/route.ts
// This endpoint creates a card on file from Square In-App Payments SDK nonce
import { NextResponse, type NextRequest } from "next/server"
import axios from "axios"
import { createClient } from "@/lib/db"

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { 
      nonce, // Payment nonce from Square In-App Payments SDK
      location_id,
      organization_id
    } = body

    console.log("Creating card on file:", { organization_id, location_id, has_nonce: !!nonce })

    if (!nonce || !location_id || !organization_id) {
      return NextResponse.json({ 
        success: false,
        error: "Missing required fields: nonce, location_id, organization_id" 
      }, { status: 400 })
    }

    const db = createClient()

    // Get Square access token for this organization
    const result = await db.execute(
      "SELECT access_token FROM square_connections WHERE organization_id = ?",
      [organization_id]
    )

    if (result.rows.length === 0) {
      return NextResponse.json({ 
        success: false,
        error: "Square connection not found" 
      }, { status: 404 })
    }

    const { access_token } = result.rows[0]

    // Create a customer first (required for card on file)
    const customerId = await createSquareCustomer(access_token, organization_id)

    // Create card on file using the nonce
    const SQUARE_ENVIRONMENT = process.env.SQUARE_ENVIRONMENT || "sandbox"
    const SQUARE_DOMAIN = SQUARE_ENVIRONMENT === "production" ? "squareup.com" : "squareupsandbox.com"

    const cardRequest = {
      idempotency_key: `card_${organization_id}_${Date.now()}`,
      source_id: nonce,
      card: {
        customer_id: customerId
      }
    }

    console.log("Creating card with Square API...")

    const cardResponse = await axios.post(
      `https://connect.${SQUARE_DOMAIN}/v2/cards`,
      cardRequest,
      {
        headers: {
          "Square-Version": "2025-05-21",
          "Authorization": `Bearer ${access_token}`,
          "Content-Type": "application/json"
        }
      }
    )

    const card = cardResponse.data.card

    if (!card?.id) {
      return NextResponse.json({ 
        success: false,
        error: "Failed to create card on file" 
      }, { status: 500 })
    }

    console.log("✅ Card on file created successfully:", card.id)

    return NextResponse.json({
      success: true,
      card_id: card.id,
      customer_id: customerId,
      last_4: card.last_4,
      card_brand: card.card_brand,
      exp_month: card.exp_month,
      exp_year: card.exp_year
    })

  } catch (error: any) {
    console.error("Error creating card on file:", error)
    
    if (error.response?.data) {
      console.error("Square API Error:", error.response.data)
      return NextResponse.json({ 
        success: false,
        error: error.response.data.errors?.[0]?.detail || "Failed to create card on file" 
      }, { status: 400 })
    }

    return NextResponse.json({ 
      success: false,
      error: "Failed to create card on file" 
    }, { status: 500 })
  }
}

async function createSquareCustomer(accessToken: string, organizationId: string) {
  const SQUARE_ENVIRONMENT = process.env.SQUARE_ENVIRONMENT || "sandbox"
  const SQUARE_DOMAIN = SQUARE_ENVIRONMENT === "production" ? "squareup.com" : "squareupsandbox.com"

  try {
    // Try to find existing customer by reference_id
    const searchResponse = await axios.post(
      `https://connect.${SQUARE_DOMAIN}/v2/customers/search`,
      {
        filter: {
          reference_id: {
            exact: organizationId
          }
        }
      },
      {
        headers: {
          "Square-Version": "2025-05-21",
          "Authorization": `Bearer ${accessToken}`,
          "Content-Type": "application/json"
        }
      }
    )

    if (searchResponse.data.customers && searchResponse.data.customers.length > 0) {
      console.log("Found existing customer:", searchResponse.data.customers[0].id)
      return searchResponse.data.customers[0].id
    }

    // Create new customer if not found
    const customerResponse = await axios.post(
      `https://connect.${SQUARE_DOMAIN}/v2/customers`,
      {
        given_name: `Org-${organizationId.substring(0, 8)}`,
        reference_id: organizationId,
        company_name: organizationId
      },
      {
        headers: {
          "Square-Version": "2025-05-21",
          "Authorization": `Bearer ${accessToken}`,
          "Content-Type": "application/json"
        }
      }
    )

    console.log("Created new customer:", customerResponse.data.customer.id)
    return customerResponse.data.customer.id

  } catch (error: any) {
    console.error("Error creating/finding customer:", error)
    throw error
  }
}