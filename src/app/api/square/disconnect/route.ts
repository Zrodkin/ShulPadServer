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

    // Get the access token from the database
    const db = createClient()
    const result = await db.query("SELECT access_token FROM square_connections WHERE organization_id = $1", [
      organization_id,
    ])

    if (result.rows.length === 0) {
      return NextResponse.json({ error: "No Square connection found for this organization" }, { status: 404 })
    }

    const access_token = result.rows[0].access_token

    const SQUARE_DOMAIN = SQUARE_ENVIRONMENT === "production" ? "squareup.com" : "squareupsandbox.com"
    const SQUARE_REVOKE_URL = `https://connect.${SQUARE_DOMAIN}/oauth2/revoke`

    // Revoke the token
    await axios.post(
      SQUARE_REVOKE_URL,
      {
        client_id: SQUARE_APP_ID,
        access_token: access_token,
      },
      {
        headers: {
          "Content-Type": "application/json",
          Authorization: `Client ${SQUARE_APP_SECRET}`,
        },
      },
    )

    // Remove the connection from the database
    await db.query("DELETE FROM square_connections WHERE organization_id = $1", [organization_id])

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error("Server error:", error)
    return NextResponse.json({ error: "Server error during disconnection" }, { status: 500 })
  }
}
