// ==========================================
// 3. CANCEL SUBSCRIPTION
// app/api/subscriptions/cancel/route.ts
// ==========================================
import { NextResponse } from 'next/server';
import { createClient } from "@/lib/db";
import axios from 'axios';

export async function POST(request: Request) {
  try {
    const body = await request.json()
    const { merchant_id } = body

    if (!merchant_id) {
      return NextResponse.json({ error: "Missing merchant_id" }, { status: 400 })
    }

    const db = createClient()

    // Get active subscription
    const result = await db.execute(
      `SELECT s.*, sc.access_token
       FROM subscriptions s
       JOIN square_connections sc ON s.merchant_id = sc.merchant_id
       WHERE s.merchant_id = ?
       AND s.status IN ('active', 'paused')
       ORDER BY s.created_at DESC
       LIMIT 1`,
      [merchant_id]
    )

    if (result.rows.length === 0) {
      return NextResponse.json({ error: "No active subscription found" }, { status: 404 })
    }

    const subscription = result.rows[0] as any;

    // Handle free subscriptions
    if (subscription.square_subscription_id.startsWith('free_')) {
      await db.execute(
        `UPDATE subscriptions
         SET status = 'canceled',
             canceled_at = NOW(),
             grace_period_start = NOW(),
             updated_at = NOW()
         WHERE id = ?`,
        [subscription.id]
      )

      return NextResponse.json({
        success: true,
        subscription: {
          id: subscription.square_subscription_id,
          status: 'canceled',
          canceled_date: new Date().toISOString()
        }
      })
    }

    // Cancel in Square for paid subscriptions
    const SQUARE_ENVIRONMENT = process.env.SQUARE_ENVIRONMENT || "production"
    const SQUARE_DOMAIN = SQUARE_ENVIRONMENT === "production" ? "squareup.com" : "squareupsandbox.com"

    try {
      const cancelResponse = await axios.post(
        `https://connect.${SQUARE_DOMAIN}/v2/subscriptions/${subscription.square_subscription_id}/cancel`,
        {},
        {
          headers: {
            "Square-Version": "2025-06-18",
            "Authorization": `Bearer ${subscription.access_token}`
          }
        }
      )

      // Update local database
      await db.execute(
        `UPDATE subscriptions
         SET status = 'canceled',
             canceled_at = NOW(),
             grace_period_start = NOW(),
             updated_at = NOW()
         WHERE id = ?`,
        [subscription.id]
      )

      // Log cancellation event
      await db.execute(
        `INSERT INTO subscription_events
         (subscription_id, event_type, event_data, created_at)
         VALUES (?, 'canceled', ?, NOW())`,
        [subscription.id, JSON.stringify({ reason: 'user_requested' })]
      )

      return NextResponse.json({
        success: true,
        subscription: {
          id: cancelResponse.data.subscription.id,
          status: 'canceled',
          canceled_date: cancelResponse.data.subscription.canceled_date
        }
      })

    } catch (squareError: any) {
      console.error("Square API Error:", squareError.response?.data)
      return NextResponse.json({
        error: "Failed to cancel subscription in Square",
        details: squareError.response?.data?.errors || squareError.message
      }, { status: 500 })
    }

  } catch (error: any) {
    console.error("Error canceling subscription:", error)
    return NextResponse.json({
      error: "Failed to cancel subscription",
      details: error.message
    }, { status: 500 })
  }
}
