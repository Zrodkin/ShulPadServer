// ==========================================
// 4. CANCEL SUBSCRIPTION ENDPOINT
// app/api/subscriptions/cancel/route.ts
// ==========================================

import { NextResponse } from "next/server"
import axios from "axios"
import { createClient } from "@/lib/db"

export async function POST(request: Request) {
  try {
    const body = await request.json()
    const { merchant_id } = body

    if (!merchant_id) {
      return NextResponse.json({ error: "Missing merchant_id" }, { status: 400 })
    }

    const db = createClient()

    // Get active subscription using merchant_id
    const result = await db.execute(`
      SELECT s.square_subscription_id, sc.access_token 
      FROM subscriptions s
      JOIN square_connections sc ON s.merchant_id = sc.merchant_id
      WHERE s.merchant_id = ? AND s.status IN ('active', 'paused')
      ORDER BY s.created_at DESC 
      LIMIT 1
    `, [merchant_id])

    if (result.rows.length === 0) {
      return NextResponse.json({ error: "No active subscription found" }, { status: 404 })
    }

    const { square_subscription_id, access_token } = result.rows[0]

    const SQUARE_ENVIRONMENT = process.env.SQUARE_ENVIRONMENT || "production"
    const SQUARE_DOMAIN = SQUARE_ENVIRONMENT === "production" ? "squareup.com" : "squareupsandbox.com"

    // Cancel subscription in Square
    const cancelResponse = await axios.post(
      `https://connect.${SQUARE_DOMAIN}/v2/subscriptions/${square_subscription_id}/cancel`,
      {},
      {
        headers: {
          "Square-Version": "2025-06-18",
          "Authorization": `Bearer ${access_token}`
        }
      }
    )

    const canceledSubscription = cancelResponse.data.subscription

    // Update local database
    await db.execute(`
      UPDATE subscriptions 
      SET status = 'canceled', canceled_at = NOW(), updated_at = NOW()
      WHERE square_subscription_id = ?
    `, [square_subscription_id])

    return NextResponse.json({
      success: true,
      subscription: {
        id: canceledSubscription.id,
        status: 'canceled',
        canceled_date: canceledSubscription.canceled_date
      }
    })

  } catch (error: any) {
    console.error("Error canceling subscription:", error)
    
    if (error.response?.data?.errors) {
      const squareErrors = error.response.data.errors
      return NextResponse.json({ 
        error: squareErrors[0]?.detail || "Square API error",
        square_errors: squareErrors
      }, { status: 400 })
    }

    return NextResponse.json({ 
      error: "Failed to cancel subscription",
      details: error.message 
    }, { status: 500 })
  }
}