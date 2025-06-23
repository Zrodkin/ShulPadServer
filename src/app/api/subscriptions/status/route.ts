// ==========================================
// 3. SUBSCRIPTION STATUS ENDPOINT
// app/api/subscriptions/status/route.ts
// ==========================================

import { NextResponse } from "next/server"
import axios from "axios"
import { createClient } from "@/lib/db"


export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const organization_id = searchParams.get('organization_id')

    if (!organization_id) {
      return NextResponse.json({ error: "Missing organization_id" }, { status: 400 })
    }

    const db = createClient()

    // Get subscription from database
    const result = await db.execute(`
      SELECT s.*, sc.access_token 
      FROM subscriptions s
      JOIN square_connections sc ON s.organization_id = sc.organization_id
      WHERE s.organization_id = ? AND s.status IN ('active', 'pending', 'paused')
      ORDER BY s.created_at DESC 
      LIMIT 1
    `, [organization_id])

    if (result.rows.length === 0) {
      return NextResponse.json({ subscription: null })
    }

    const subscription = result.rows[0]

    // Get latest status from Square
    const SQUARE_ENVIRONMENT = process.env.SQUARE_ENVIRONMENT || "production"
    const SQUARE_DOMAIN = SQUARE_ENVIRONMENT === "production" ? "squareup.com" : "squareupsandbox.com"

    try {
      const squareResponse = await axios.get(
        `https://connect.${SQUARE_DOMAIN}/v2/subscriptions/${subscription.square_subscription_id}`,
        {
          headers: {
            "Square-Version": "2025-06-18",
            "Authorization": `Bearer ${subscription.access_token}`
          }
        }
      )

      const squareSubscription = squareResponse.data.subscription

      // Update local database with latest info
      await db.execute(`
        UPDATE subscriptions 
        SET status = ?, current_period_start = ?, current_period_end = ?, updated_at = NOW()
        WHERE square_subscription_id = ?
      `, [
        mapSquareStatusToOurStatus(squareSubscription.status),
        squareSubscription.start_date,
        squareSubscription.charged_through_date,
        subscription.square_subscription_id
      ])

      // Return formatted subscription details
      return NextResponse.json({
        subscription: {
          id: squareSubscription.id,
          status: squareSubscription.status.toLowerCase(),
          plan_type: subscription.plan_type,
          device_count: subscription.device_count,
          total_price: subscription.total_price_cents / 100,
          next_billing_date: squareSubscription.charged_through_date,
          card_last_four: squareSubscription.card_id ? "****" : null,
          start_date: squareSubscription.start_date
        }
      })

    } catch (squareError) {
      // If Square API fails, return cached data
      console.warn("Failed to fetch from Square, returning cached data:", squareError)
      
      return NextResponse.json({
        subscription: {
          id: subscription.square_subscription_id,
          status: subscription.status,
          plan_type: subscription.plan_type,
          device_count: subscription.device_count,
          total_price: subscription.total_price_cents / 100,
          next_billing_date: subscription.current_period_end,
          card_last_four: "****",
          start_date: subscription.current_period_start
        }
      })
    }

  } catch (error: any) {
    console.error("Error fetching subscription status:", error)
    return NextResponse.json({ 
      error: "Failed to fetch subscription status",
      details: error.message 
    }, { status: 500 })
  }
  function mapSquareStatusToOurStatus(squareStatus: string): string {
  switch (squareStatus) {
    case 'ACTIVE':
      return 'active'
    case 'CANCELED':
      return 'canceled'
    case 'DEACTIVATED':
      return 'deactivated'
    case 'PAUSED':
      return 'paused'
    case 'PENDING':
      return 'pending'
    default:
      return 'pending'
  }
}
}