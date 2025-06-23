// ==========================================
// 7. UPGRADE/DOWNGRADE SUBSCRIPTION
// app/api/subscriptions/change-plan/route.ts
// ==========================================

import { NextResponse, type NextRequest } from "next/server"
import axios from "axios"
import { createClient } from "@/lib/db"

export async function POST(request: Request) {
  try {
    const body = await request.json()
    const { organization_id, new_plan_type, new_device_count } = body

    const db = createClient()
    
    // Get current subscription
    const result = await db.execute(`
      SELECT s.*, sc.access_token 
      FROM subscriptions s
      JOIN square_connections sc ON s.organization_id = sc.organization_id
      WHERE s.organization_id = ? AND s.status = 'active'
    `, [organization_id])

    if (result.rows.length === 0) {
      return NextResponse.json({ error: "No active subscription found" }, { status: 404 })
    }

    const subscription = result.rows[0]

    // Get new plan details
    const planResult = await db.execute(
      "SELECT square_variation_id, base_price_cents, extra_device_price_cents FROM subscription_plans WHERE plan_type = ?",
      [new_plan_type]
    )

    if (planResult.rows.length === 0) {
      return NextResponse.json({ error: "New plan not found" }, { status: 404 })
    }

    const newPlan = planResult.rows[0]
    const newTotalPrice = newPlan.base_price_cents + ((new_device_count - 1) * newPlan.extra_device_price_cents)

    const SQUARE_ENVIRONMENT = process.env.SQUARE_ENVIRONMENT || "production"
    const SQUARE_DOMAIN = SQUARE_ENVIRONMENT === "production" ? "squareup.com" : "squareupsandbox.com"

    // Swap plan in Square
    const swapResponse = await axios.post(
      `https://connect.${SQUARE_DOMAIN}/v2/subscriptions/${subscription.square_subscription_id}/swap-plan`,
      {
        new_plan_variation_id: newPlan.square_variation_id
      },
      {
        headers: {
          "Square-Version": "2025-06-18",
          "Authorization": `Bearer ${subscription.access_token}`
        }
      }
    )

    // Update local database
    await db.execute(`
      UPDATE subscriptions 
      SET plan_type = ?, device_count = ?, base_price_cents = ?, total_price_cents = ?, updated_at = NOW()
      WHERE square_subscription_id = ?
    `, [new_plan_type, new_device_count, newPlan.base_price_cents, newTotalPrice, subscription.square_subscription_id])

    return NextResponse.json({ 
      success: true, 
      subscription: swapResponse.data.subscription 
    })

  } catch (error: any) {
    console.error("Error changing subscription plan:", error)
    return NextResponse.json({ error: "Failed to change plan" }, { status: 500 })
  }
}