import { type NextRequest, NextResponse } from "next/server"
import axios from "axios"
import { createClient } from "@/lib/db"
import { logger } from "@/lib/logger"

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams
    const code = searchParams.get("code")
    const state = searchParams.get("state")
    // Get organization_id from request or use a unique value based on merchant_id later
    let organizationId = searchParams.get("organization_id") || "default"

    logger.info("Received OAuth callback", { state, hasCode: !!code, hasOrgId: !!organizationId })

    if (!code) {
      logger.error("Authorization code is missing")
      return NextResponse.redirect(`${request.nextUrl.origin}/api/square/success?success=false&error=missing_code`)
    }

    if (!state) {
      logger.error("No state parameter received")
      return NextResponse.redirect(`${request.nextUrl.origin}/api/square/success?success=false&error=missing_state`)
    }

    // Validate that the state exists in our database
    try {
      const db = createClient()
      const stateResult = await db.query("SELECT state FROM square_pending_tokens WHERE state = $1", [state])

      if (stateResult.rows.length === 0) {
        logger.error("Invalid state parameter received", { state })
        // Redirect to error page instead of returning JSON
        return NextResponse.redirect(`${request.nextUrl.origin}/api/square/success?success=false&error=invalid_state`)
      }

      logger.debug("State validation successful", { state })
    } catch (dbError) {
      logger.error("Database error during state validation", { error: dbError })
      // Redirect to error page instead of returning JSON
      return NextResponse.redirect(`${request.nextUrl.origin}/api/square/success?success=false&error=database_error`)
    }

    const SQUARE_APP_ID = process.env.SQUARE_APP_ID
    const SQUARE_APP_SECRET = process.env.SQUARE_APP_SECRET
    const REDIRECT_URI = process.env.REDIRECT_URI
    const SQUARE_ENVIRONMENT = process.env.SQUARE_ENVIRONMENT || "sandbox"

    if (!SQUARE_APP_ID || !SQUARE_APP_SECRET || !REDIRECT_URI) {
      logger.error("Missing required environment variables")
      return NextResponse.redirect(
        `${request.nextUrl.origin}/api/square/success?success=false&error=server_configuration`,
      )
    }

    const SQUARE_DOMAIN = SQUARE_ENVIRONMENT === "production" ? "squareup.com" : "squareupsandbox.com"
    const SQUARE_TOKEN_URL = `https://connect.${SQUARE_DOMAIN}/oauth2/token`

    logger.info("Exchanging authorization code for tokens")

    // Exchange the authorization code for access token
    let data
    try {
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

      data = response.data
      logger.debug("Token exchange successful")

      if (data.error) {
        logger.error("Token exchange error", { error: data.error })
        return NextResponse.redirect(`${request.nextUrl.origin}/api/square/success?success=false&error=token_exchange`)
      }
    } catch (error) {
      logger.error("Error during token exchange", { error })
      return NextResponse.redirect(`${request.nextUrl.origin}/api/square/success?success=false&error=token_exchange`)
    }

    const { access_token, refresh_token, expires_at, merchant_id } = data

    // If no organization_id was provided, create one based on merchant_id
    if (!organizationId || organizationId === "default") {
      organizationId = `org_${merchant_id}`
      logger.info("Generated organization ID from merchant ID", { organizationId })
    }

    // Store tokens in both places using a transaction
    try {
      const db = createClient()

      // Begin transaction
      await db.query("BEGIN")

      try {
        // Store in temporary table for OAuth flow completion
        await db.query(
          `UPDATE square_pending_tokens SET
          access_token = $2, 
          refresh_token = $3, 
          merchant_id = $4, 
          expires_at = $5
        WHERE state = $1`,
          [state, access_token, refresh_token, merchant_id, expires_at],
        )

        // Store in permanent table for future use
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
          [organizationId, merchant_id, access_token, refresh_token, expires_at],
        )

        // Commit transaction
        await db.query("COMMIT")
        logger.info("Tokens stored successfully", { organizationId, merchantId: merchant_id })
      } catch (error) {
        // Rollback transaction on error
        await db.query("ROLLBACK")
        throw error
      }
    } catch (dbError) {
      logger.error("Database error storing tokens", { error: dbError })
      // Continue with the flow even if database storage fails
    }

    // Redirect to success page
    logger.info("OAuth flow completed successfully", { organizationId, merchantId: merchant_id })
    return NextResponse.redirect(`${request.nextUrl.origin}/api/square/success?success=true`)
  } catch (error) {
    logger.error("Server error during OAuth flow", { error })
    return NextResponse.redirect(`${request.nextUrl.origin}/api/square/success?success=false&error=server_error`)
  }
}
