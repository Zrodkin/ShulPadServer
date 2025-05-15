import { type NextRequest, NextResponse } from "next/server"
import axios from "axios"
import { createClient } from "@/lib/db"

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { organization_id } = body

    if (!organization_id) {
      return NextResponse.json({ error: "Organization ID is required" }, { status: 400 })
    }

    const SQUARE_APP_ID = process.env.SQUARE_APP_ID
    const SQUARE_APP_SECRET = process.env.SQUARE_APP_SECRET
    const SQUARE_ENVIRONMENT = process.env.SQUARE_ENVIRONMENT || "sandbox"

    if (!SQUARE_APP_ID || !SQUARE_APP_SECRET) {
      return NextResponse.json({ error: "Missing required environment variables" }, { status: 500 })
    }

    // Get the refresh token from the database
    const db = createClient()
    const result = await db.query("SELECT refresh_token FROM square_connections WHERE organization_id = $1", [
      organization_id,
    ])

    if (result.rows.length === 0) {
      return NextResponse.json({ error: "No Square connection found for this organization" }, { status: 404 })
    }

    const refresh_token = result.rows[0].refresh_token

    const SQUARE_DOMAIN = SQUARE_ENVIRONMENT === "production" ? "squareup.com" : "squareupsandbox.com"
    const SQUARE_TOKEN_URL = `https://connect.${SQUARE_DOMAIN}/oauth2/token`

    const response = await axios.post(
      SQUARE_TOKEN_URL,
      {
        client_id: SQUARE_APP_ID,
        client_secret: SQUARE_APP_SECRET,
        refresh_token,
        grant_type: "refresh_token",
      },
      {
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
      },
    )

    const data = response.data

    if (data.error) {
      return NextResponse.json({ error: data.error }, { status: 400 })
    }

    // Update the tokens in the database
    await db.query(
      `UPDATE square_connections 
       SET access_token = $1, 
           refresh_token = $2, 
           expires_at = $3, 
           updated_at = NOW() 
       WHERE organization_id = $4`,
      [data.access_token, data.refresh_token, data.expires_at, organization_id],
    )

    return NextResponse.json({
      success: true,
      expires_at: data.expires_at,
    })
  } catch (error) {
    console.error("Server error:", error)
    return NextResponse.json({ error: "Server error during token refresh" }, { status: 500 })
  }
}
