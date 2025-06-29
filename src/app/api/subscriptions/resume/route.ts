// ==========================================
// 6. RESUME SUBSCRIPTION ENDPOINT  
// app/api/subscriptions/resume/route.ts
// ==========================================
import { NextResponse } from "next/server"
import axios from "axios"
import { createClient } from "@/lib/db"

export async function POST(request: Request) {
  try {
    const body = await request.json()
    const { merchant_id } = body

    console.log("🔄 Resume subscription request:", { merchant_id })

    if (!merchant_id) {
      return NextResponse.json({ error: "Missing merchant_id" }, { status: 400 })
    }

    const db = createClient()
    
    // Look for paused subscription
    const result = await db.execute(`
      SELECT s.square_subscription_id, sc.access_token 
      FROM subscriptions s
      JOIN square_connections sc ON s.merchant_id = sc.merchant_id
      WHERE s.merchant_id = ? AND s.status = 'paused'
      ORDER BY s.created_at DESC 
      LIMIT 1
    `, [merchant_id])

    if (result.rows.length === 0) {
      console.log("❌ No paused subscription found for merchant:", merchant_id)
      return NextResponse.json({ error: "No paused subscription found" }, { status: 404 })
    }

    const { square_subscription_id, access_token } = result.rows[0]
    
    console.log("📋 Found paused subscription:", { 
      square_subscription_id,
      has_access_token: !!access_token 
    })

    if (!access_token) {
      return NextResponse.json({ error: "No access token available" }, { status: 401 })
    }

    const SQUARE_ENVIRONMENT = process.env.SQUARE_ENVIRONMENT || "production"
    const SQUARE_DOMAIN = SQUARE_ENVIRONMENT === "production" ? "squareup.com" : "squareupsandbox.com"

    console.log("🔄 Attempting to resume subscription with Square API...")

    // Resume subscription in Square
    const resumeResponse = await axios.post(
      `https://connect.${SQUARE_DOMAIN}/v2/subscriptions/${square_subscription_id}/resume`,
      {},
      {
        headers: {
          "Square-Version": "2025-06-18",
          "Authorization": `Bearer ${access_token}`,
          "Content-Type": "application/json"
        },
        timeout: 10000 // 10 second timeout
      }
    )

    console.log("✅ Square API resume successful:", {
      subscription_id: resumeResponse.data.subscription?.id,
      status: resumeResponse.data.subscription?.status
    })

    // Update local database
    await db.execute(`
      UPDATE subscriptions 
      SET status = 'active', updated_at = NOW()
      WHERE square_subscription_id = ?
    `, [square_subscription_id])

    console.log("✅ Database updated - subscription resumed")

    return NextResponse.json({ 
      success: true, 
      subscription: resumeResponse.data.subscription,
      message: "Subscription resumed successfully"
    })

  } catch (error: any) {
    console.error("❌ Error resuming subscription:", error)
    
    // Handle specific Square API errors
    if (error.response?.data?.errors) {
      const squareErrors = error.response.data.errors
      console.error("Square API errors:", squareErrors)
      
      const firstError = squareErrors[0]
      const errorMessage = firstError?.detail || firstError?.code || "Square API error"
      
      return NextResponse.json({ 
        error: errorMessage,
        square_errors: squareErrors,
        code: firstError?.code
      }, { status: error.response.status || 400 })
    }

    // Handle network/timeout errors
    if (error.code === 'ECONNABORTED' || error.message?.includes('timeout')) {
      return NextResponse.json({ 
        error: "Request timeout - please try again" 
      }, { status: 408 })
    }

    // Handle axios errors
    if (error.response) {
      console.error("HTTP error:", {
        status: error.response.status,
        data: error.response.data
      })
      
      return NextResponse.json({ 
        error: `HTTP ${error.response.status}: ${error.response.statusText}`,
        details: error.response.data
      }, { status: error.response.status })
    }

    // Generic error fallback
    return NextResponse.json({ 
      error: "Failed to resume subscription",
      details: error.message 
    }, { status: 500 })
  }
}