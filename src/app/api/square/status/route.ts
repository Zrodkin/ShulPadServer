import { type NextRequest, NextResponse } from "next/server"
import axios from "axios"
import { createClient } from "@/lib/db"

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams
    const organizationId = searchParams.get("organization_id")
    const state = searchParams.get("state")

    const db = createClient()

    // Path 1: Checking by state parameter (for OAuth flow tracking)
    if (state) {
      console.log("Checking authorization status by state:", state)

      // Get pending tokens from temporary storage
      const pendingResult = await db.query(
        "SELECT access_token, refresh_token, merchant_id, expires_at FROM square_pending_tokens WHERE state = $1",
        [state],
      )

      if (pendingResult.rows.length > 0) {
        // Successfully found pending authorization
        const { access_token, refresh_token, merchant_id, expires_at } = pendingResult.rows[0]

        // Clean up the pending token
        await db.query("DELETE FROM square_pending_tokens WHERE state = $1", [state])

        // Return the tokens
        return NextResponse.json({
          connected: true,
          access_token,
          refresh_token,
          merchant_id,
          expires_at,
        })
      } else {
        // No pending authorization found
        return NextResponse.json({
          connected: false,
          message: "token_not_found",
        })
      }
    }

    // Path 2: Checking by organization ID (your existing implementation)
    else if (organizationId) {
      const SQUARE_ENVIRONMENT = process.env.SQUARE_ENVIRONMENT || "sandbox"
      const SQUARE_DOMAIN = SQUARE_ENVIRONMENT === "production" ? "squareup.com" : "squareupsandbox.com"

      // Get the access token from the database
      const result = await db.query(
        "SELECT access_token, refresh_token, expires_at, merchant_id FROM square_connections WHERE organization_id = $1",
        [organizationId],
      )

      if (result.rows.length === 0) {
        return NextResponse.json({
          connected: false,
          message: "No Square connection found",
        })
      }

      const { access_token, refresh_token, expires_at, merchant_id } = result.rows[0]

      // Check if token is expired
      const expirationDate = new Date(expires_at)
      if (expirationDate < new Date()) {
        return NextResponse.json({
          connected: false,
          message: "Token expired",
          needs_refresh: true,
        })
      }

      // Verify token by making a simple API call
      try {
        await axios.get(`https://connect.${SQUARE_DOMAIN}/v2/locations`, {
          headers: {
            Authorization: `Bearer ${access_token}`,
            "Content-Type": "application/json",
            "Square-Version": "2023-09-25",
          },
        })

        return NextResponse.json({
          connected: true,
          merchant_id,
          expires_at: expires_at,
        })
      } catch (apiError) {
        console.error("API error checking token:", apiError)
        return NextResponse.json({
          connected: false,
          message: "Token validation failed",
          needs_refresh: true,
        })
      }
    } else {
      return NextResponse.json({ error: "Either organization_id or state parameter is required" }, { status: 400 })
    }
  } catch (error) {
    console.error("Server error:", error)
    return NextResponse.json({ error: "Server error checking connection status" }, { status: 500 })
  }
}
