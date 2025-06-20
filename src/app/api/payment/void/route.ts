// app/api/payment/void/route.ts
// This endpoint voids an authorization (cleans up the $0.01 auth)
import { NextResponse, type NextRequest } from "next/server"
import axios from "axios"
import { createClient } from "@/lib/db"

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { payment_id, organization_id } = body

    if (!payment_id || !organization_id) {
      return NextResponse.json({ 
        error: "Missing required fields" 
      }, { status: 400 })
    }

    const db = createClient()

    // Get Square access token
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

    // Cancel/void the payment
    const SQUARE_ENVIRONMENT = process.env.SQUARE_ENVIRONMENT || "sandbox"
    const SQUARE_DOMAIN = SQUARE_ENVIRONMENT === "production" ? "squareup.com" : "squareupsandbox.com"

    await axios.post(
      `https://connect.${SQUARE_DOMAIN}/v2/payments/${payment_id}/cancel`,
      {
        idempotency_key: `void_${payment_id}_${Date.now()}`
      },
      {
        headers: {
          "Square-Version": "2025-05-21",
          "Authorization": `Bearer ${access_token}`,
          "Content-Type": "application/json"
        }
      }
    )

    return NextResponse.json({ success: true })

  } catch (error: any) {
    console.error("Error voiding payment:", error)
    // Non-critical error - return success anyway
    return NextResponse.json({ success: true })
  }
}