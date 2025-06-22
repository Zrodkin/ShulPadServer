import { NextResponse } from "next/server"
import axios from "axios"
import { createClient } from "@/lib/db"

export async function POST(request: Request) {
  try {
    const body = await request.json()
    const { source_id, organization_id, customer_email } = body
    
    if (!source_id || !organization_id || !customer_email) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 })
    }
    
    const db = createClient()
    
    // Get Square connection for this org
    const result = await db.execute(
      "SELECT access_token, location_id FROM square_connections WHERE organization_id = ?",
      [organization_id]
    )
    
    if (result.rows.length === 0) {
      return NextResponse.json({ error: "Not connected to Square" }, { status: 404 })
    }
    
    const { access_token, location_id } = result.rows[0]
    
    const SQUARE_ENVIRONMENT = process.env.SQUARE_ENVIRONMENT || "production"
    const SQUARE_DOMAIN = SQUARE_ENVIRONMENT === "production" ? "squareup.com" : "squareupsandbox.com"
    
    // Step 1: Create or get customer
    const customerResponse = await createOrGetCustomer(
      access_token,
      customer_email,
      organization_id,
      SQUARE_DOMAIN
    )
    
    if (!customerResponse.success) {
      return NextResponse.json({ error: "Failed to create customer" }, { status: 500 })
    }
    
    // Step 2: Create card on file
    const cardResponse = await axios.post(
      `https://connect.${SQUARE_DOMAIN}/v2/cards`,
      {
        idempotency_key: `card_${Date.now()}_${organization_id}`,
        source_id: source_id,
        card: {
          customer_id: customerResponse.customer_id
        }
      },
      {
        headers: {
          "Square-Version": "2025-05-21",
          "Authorization": `Bearer ${access_token}`,
          "Content-Type": "application/json"
        }
      }
    )
    
    return NextResponse.json({
      success: true,
      card_id: cardResponse.data.card.id,
      customer_id: customerResponse.customer_id
    })
    
  } catch (error: any) {
    console.error("Error creating payment method:", error)
    return NextResponse.json({ 
      error: error.response?.data?.errors?.[0]?.detail || "Failed to create payment method" 
    }, { status: 500 })
  }
}

async function createOrGetCustomer(
  accessToken: string, 
  email: string, 
  organizationId: string,
  squareDomain: string
) {
  try {
    // First, try to find existing customer
    const searchResponse = await axios.post(
      `https://connect.${squareDomain}/v2/customers/search`,
      {
        filter: {
          email_address: { exact: email }
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
      return {
        success: true,
        customer_id: searchResponse.data.customers[0].id
      }
    }
    
    // Create new customer
    const createResponse = await axios.post(
      `https://connect.${squareDomain}/v2/customers`,
      {
        idempotency_key: `customer_${organizationId}_${Date.now()}`,
        email_address: email,
        reference_id: organizationId
      },
      {
        headers: {
          "Square-Version": "2025-05-21",
          "Authorization": `Bearer ${accessToken}`,
          "Content-Type": "application/json"
        }
      }
    )
    
    return {
      success: true,
      customer_id: createResponse.data.customer.id
    }
    
  } catch (error) {
    console.error("Error creating/getting customer:", error)
    return { success: false }
  }
}