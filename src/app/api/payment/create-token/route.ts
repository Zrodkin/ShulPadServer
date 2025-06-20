// app/api/payment/create-token/route.ts
// This endpoint creates a card on file using a payment nonce
import { NextResponse, type NextRequest } from "next/server"
import axios from "axios"
import { createClient } from "@/lib/db"

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { 
      source_id, // Payment nonce from iOS
      location_id,
      organization_id,
      amount_money,
      autocomplete = false,
      verification_token
    } = body

    if (!source_id || !location_id || !organization_id) {
      return NextResponse.json({ 
        error: "Missing required fields" 
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
        error: "Square connection not found" 
      }, { status: 404 })
    }

    const { access_token } = result.rows[0]

    // Create payment with Square (this creates a card on file)
    const SQUARE_ENVIRONMENT = process.env.SQUARE_ENVIRONMENT || "sandbox"
    const SQUARE_DOMAIN = SQUARE_ENVIRONMENT === "production" ? "squareup.com" : "squareupsandbox.com"

    const paymentRequest = {
      idempotency_key: `payment_${organization_id}_${Date.now()}`,
      source_id: source_id,
      location_id: location_id,
      amount_money: amount_money,
      autocomplete: autocomplete,
      verification_token: verification_token,
      accept_partial_authorization: false,
      buyer_email_address: null // Optional: can add customer email
    }

    const paymentResponse = await axios.post(
      `https://connect.${SQUARE_DOMAIN}/v2/payments`,
      paymentRequest,
      {
        headers: {
          "Square-Version": "2025-05-21",
          "Authorization": `Bearer ${access_token}`,
          "Content-Type": "application/json"
        }
      }
    )

    const payment = paymentResponse.data.payment

    // Extract card details for future use
    const cardDetails = payment.card_details
    const card = cardDetails?.card

    if (!card?.id) {
      return NextResponse.json({ 
        error: "Failed to create card on file" 
      }, { status: 500 })
    }

    return NextResponse.json({
      success: true,
      payment: payment,
      card_id: card.id,
      last_4: card.last_4,
      card_brand: card.card_brand,
      exp_month: card.exp_month,
      exp_year: card.exp_year
    })

  } catch (error: any) {
    console.error("Error creating payment token:", error)
    
    if (error.response?.data) {
      console.error("Square API Error:", error.response.data)
      return NextResponse.json({ 
        error: error.response.data.errors?.[0]?.detail || "Payment processing failed" 
      }, { status: 400 })
    }

    return NextResponse.json({ 
      error: "Failed to process payment" 
    }, { status: 500 })
  }
}