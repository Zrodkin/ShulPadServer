import { type NextRequest, NextResponse } from "next/server"
import axios from "axios"
import { createClient } from "@/lib/db"

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams
    const code = searchParams.get("code")
    const state = searchParams.get("state")
    const organizationId = searchParams.get("organization_id") // Added to track which organization this is for

    if (!code) {
      return NextResponse.json({ error: "Authorization code is missing" }, { status: 400 })
    }

    const SQUARE_APP_ID = process.env.SQUARE_APP_ID
    const SQUARE_APP_SECRET = process.env.SQUARE_APP_SECRET
    const REDIRECT_URI = process.env.REDIRECT_URI
    const SQUARE_ENVIRONMENT = process.env.SQUARE_ENVIRONMENT || "sandbox"

    if (!SQUARE_APP_ID || !SQUARE_APP_SECRET || !REDIRECT_URI) {
      return NextResponse.json({ error: "Missing required environment variables" }, { status: 500 })
    }

    const SQUARE_DOMAIN = SQUARE_ENVIRONMENT === "production" ? "squareup.com" : "squareupsandbox.com"
    const SQUARE_TOKEN_URL = `https://connect.${SQUARE_DOMAIN}/oauth2/token`

    // Exchange the authorization code for access token
    const response = await axios.post(
      SQUARE_TOKEN_URL,
      {
        client_id: SQUARE_APP_ID,
        client_secret: SQUARE_APP_SECRET,
        code,
        grant_type: "authorization_code",
        redirect_uri: REDIRECT_URI,
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
      console.error("Token exchange error:", data)
      return NextResponse.json({ error: data.error }, { status: 400 })
    }

    // Extract tokens and merchant info
    const { access_token, refresh_token, expires_at, merchant_id } = data

    // Store tokens securely in database
    try {
      const db = createClient()

      // Store the tokens in the database
      await db.query(
        `INSERT INTO square_connections (
          organization_id, 
          merchant_id, 
          access_token, 
          refresh_token, 
          expires_at, 
          created_at
        ) VALUES ($1, $2, $3, $4, $5, NOW())
        ON CONFLICT (organization_id) 
        DO UPDATE SET 
          merchant_id = $2,
          access_token = $3,
          refresh_token = $4,
          expires_at = $5,
          updated_at = NOW()`,
        [
          organizationId || "default", // Use a default if not provided
          merchant_id,
          access_token,
          refresh_token,
          expires_at,
        ],
      )

      console.log(`Stored Square OAuth tokens for merchant: ${merchant_id}`)
    } catch (dbError) {
      console.error("Database error storing tokens:", dbError)
      // Continue with the flow even if DB storage fails
      // In production, you might want to handle this differently
    }

    // Redirect back to your app with a success parameter
    // Your iOS app should handle this URL through Universal Links or custom URL scheme
    return NextResponse.redirect(`charitypad://callback?success=true&merchant_id=${merchant_id}`)
  } catch (error) {
    console.error("Server error:", error)
    return NextResponse.json({ error: "Server error during token exchange" }, { status: 500 })
  }
}
