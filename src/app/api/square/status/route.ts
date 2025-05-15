import { type NextRequest, NextResponse } from "next/server"
import axios from "axios"
import { createClient } from "@/lib/db"

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams
    const organizationId = searchParams.get("organization_id")

    if (!organizationId) {
      return NextResponse.json({ error: "Organization ID is required" }, { status: 400 })
    }

    const SQUARE_ENVIRONMENT = process.env.SQUARE_ENVIRONMENT || "sandbox"
    const SQUARE_DOMAIN = SQUARE_ENVIRONMENT === "production" ? "squareup.com" : "squareupsandbox.com"

    // Get the access token from the database
    const db = createClient()
    const result = await db.query(
      "SELECT access_token, expires_at FROM square_connections WHERE organization_id = $1",
      [organizationId],
    )

    if (result.rows.length === 0) {
      return NextResponse.json({
        connected: false,
        message: "No Square connection found",
      })
    }

    const { access_token, expires_at } = result.rows[0]

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
  } catch (error) {
    console.error("Server error:", error)
    return NextResponse.json({ error: "Server error checking connection status" }, { status: 500 })
  }
}
