import { NextResponse } from "next/server"
import { v4 as uuidv4 } from "uuid"
import { createClient } from "@/lib/db"
import { logger } from "@/lib/logger"

export async function GET(request: Request) {
  try {
    const url = new URL(request.url)
    const organizationId = url.searchParams.get("organization_id") || "default"

    const SQUARE_APP_ID = process.env.SQUARE_APP_ID
    const REDIRECT_URI = process.env.REDIRECT_URI
    const SQUARE_ENVIRONMENT = process.env.SQUARE_ENVIRONMENT || "sandbox"

    if (!SQUARE_APP_ID || !REDIRECT_URI) {
      logger.error("Missing required environment variables")
      return NextResponse.json({ error: "Missing required environment variables" }, { status: 500 })
    }

    const SQUARE_DOMAIN = SQUARE_ENVIRONMENT === "production" ? "squareup.com" : "squareupsandbox.com"

    const scopes = ["MERCHANT_PROFILE_READ", "PAYMENTS_WRITE", "PAYMENTS_WRITE_IN_PERSON", "PAYMENTS_READ"]

    const state = uuidv4()

    // Store the state in the database BEFORE returning it to the client
    try {
      const db = createClient()
      // Explicitly provide NULL values for all columns that might have NOT NULL constraints
      await db.query(
        `INSERT INTO square_pending_tokens (
          state, 
          access_token, 
          refresh_token, 
          merchant_id, 
          expires_at, 
          created_at
        ) VALUES (
          $1, 
          NULL, 
          NULL, 
          NULL, 
          NULL, 
          NOW()
        ) ON CONFLICT (state) DO NOTHING`,
        [state]
      )
      logger.info("Stored pending token state", { state })
    } catch (dbError) {
      logger.error("Database error storing state", { error: dbError })
      // Continue even if storage fails
      
      // Add more detailed error logging to help diagnose the issue
      if (dbError instanceof Error) {
        logger.error("Database error details", {
          message: dbError.message,
          stack: dbError.stack,
          name: dbError.name
        })
      }
    }

    const authUrl =
      `https://connect.${SQUARE_DOMAIN}/oauth2/authorize?` +
      `client_id=${SQUARE_APP_ID}` +
      `&scope=${scopes.join("+")}` +
      `&state=${state}` +
      `&session=false` + // Added this required parameter
      `&redirect_uri=${REDIRECT_URI}` +
      (organizationId ? `&organization_id=${organizationId}` : "")

    logger.info("Generated OAuth URL", { state, organizationId })
    return NextResponse.json({ authUrl, state })
  } catch (error) {
    logger.error("Error generating auth URL", { error })
    return NextResponse.json({ error: "Failed to generate authorization URL" }, { status: 500 })
  }
}