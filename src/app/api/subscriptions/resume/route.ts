// ==========================================
// 6. RESUME SUBSCRIPTION ENDPOINT  
// app/api/subscriptions/resume/route.ts
// ==========================================
import { NextResponse, type NextRequest } from "next/server"
import axios from "axios"
import { createClient } from "@/lib/db"

export async function POST(request: Request) {
  try {
    const body = await request.json()
    const { organization_id } = body

    const db = createClient()
    const result = await db.execute(`
      SELECT s.square_subscription_id, sc.access_token 
      FROM subscriptions s
      JOIN square_connections sc ON s.organization_id = sc.organization_id
      WHERE s.organization_id = ? AND s.status = 'paused'
    `, [organization_id])

    if (result.rows.length === 0) {
      return NextResponse.json({ error: "No paused subscription found" }, { status: 404 })
    }

    const { square_subscription_id, access_token } = result.rows[0]
    const SQUARE_ENVIRONMENT = process.env.SQUARE_ENVIRONMENT || "production"
    const SQUARE_DOMAIN = SQUARE_ENVIRONMENT === "production" ? "squareup.com" : "squareupsandbox.com"

    const resumeResponse = await axios.post(
      `https://connect.${SQUARE_DOMAIN}/v2/subscriptions/${square_subscription_id}/resume`,
      {},
      {
        headers: {
          "Square-Version": "2025-06-18",
          "Authorization": `Bearer ${access_token}`
        }
      }
    )

    await db.execute(`
      UPDATE subscriptions SET status = 'active', updated_at = NOW()
      WHERE square_subscription_id = ?
    `, [square_subscription_id])

    return NextResponse.json({ success: true, subscription: resumeResponse.data.subscription })

  } catch (error: any) {
    console.error("Error resuming subscription:", error)
    return NextResponse.json({ error: "Failed to resume subscription" }, { status: 500 })
  }
}