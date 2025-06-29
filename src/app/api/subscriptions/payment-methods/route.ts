// ==========================================
// 7. GET PAYMENT METHODS
// app/api/subscriptions/payment-methods/route.ts
// ==========================================
import { NextResponse } from 'next/server';
import { createClient } from "@/lib/db";
import axios from 'axios';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const merchant_id = searchParams.get('merchant_id')

    if (!merchant_id) {
      return NextResponse.json({ error: "Missing merchant_id" }, { status: 400 })
    }

    const db = createClient()

    // Get merchant connection and subscription
    const result = await db.execute(
      `SELECT
        s.square_customer_id,
        sc.access_token
       FROM subscriptions s
       JOIN square_connections sc ON s.merchant_id = sc.merchant_id
       WHERE s.merchant_id = ?
       AND s.status IN ('active', 'paused')
       ORDER BY s.created_at DESC
       LIMIT 1`,
      [merchant_id]
    )

    if (result.rows.length === 0) {
      return NextResponse.json({
        payment_methods: [],
        message: "No active subscription found"
      })
    }

    const { square_customer_id, access_token } = result.rows[0] as any;

    if (!square_customer_id) {
      return NextResponse.json({ payment_methods: [] })
    }

    const SQUARE_ENVIRONMENT = process.env.SQUARE_ENVIRONMENT || "production"
    const SQUARE_DOMAIN = SQUARE_ENVIRONMENT === "production" ? "squareup.com" : "squareupsandbox.com"

    try {
      // Get customer's cards
      const cardsResponse = await axios.get(
        `https://connect.${SQUARE_DOMAIN}/v2/cards?customer_id=${square_customer_id}`,
        {
          headers: {
            "Square-Version": "2025-06-18",
            "Authorization": `Bearer ${access_token}`
          }
        }
      )

      const cards = cardsResponse.data.cards || []

      const paymentMethods = cards.map((card: any) => ({
        id: card.id,
        brand: card.card_brand,
        last_four: card.last_4,
        exp_month: card.exp_month,
        exp_year: card.exp_year,
        billing_postal_code: card.billing_address?.postal_code,
        is_default: card.id === cards[0]?.id
      }))

      return NextResponse.json({ payment_methods: paymentMethods })

    } catch (squareError: any) {
      console.error("Square API Error:", squareError.response?.data)
      return NextResponse.json({
        payment_methods: [],
        error: "Failed to fetch payment methods"
      })
    }

  } catch (error: any) {
    console.error("Error fetching payment methods:", error)
    return NextResponse.json({
      error: "Failed to fetch payment methods",
      details: error.message
    }, { status: 500 })
  }
}
