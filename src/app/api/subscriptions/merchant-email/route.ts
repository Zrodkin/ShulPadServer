// src/app/api/subscriptions/merchant-email/route.ts - MERCHANT_ID VERSION
import { NextResponse } from "next/server"
import { createClient } from "@/lib/db"

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const merchant_id = searchParams.get('merchant_id')  // ✅ CHANGED: Using merchant_id

    if (!merchant_id) {
      return NextResponse.json({ error: "Missing merchant_id" }, { status: 400 })
    }

    const db = createClient()

    // ✅ CHANGED: Query by merchant_id
    const result = await db.execute(
      "SELECT merchant_email FROM square_connections WHERE merchant_id = ?",
      [merchant_id]
    )

    if (result.rows.length === 0) {
      return NextResponse.json({ error: "Merchant connection not found" }, { status: 404 })
    }

    const { merchant_email } = result.rows[0]

    return NextResponse.json({
      merchant_email: merchant_email,
      has_email: !!merchant_email
    })

  } catch (error: any) {
    console.error("Error fetching merchant email:", error)
    return NextResponse.json({ 
      error: "Failed to fetch merchant email" 
    }, { status: 500 })
  }
}