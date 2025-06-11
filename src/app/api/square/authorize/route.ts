import { NextResponse } from "next/server"
import { v4 as uuidv4 } from "uuid"
import { createClient } from "@/lib/db"
import { logger } from "@/lib/logger"

export async function GET(request: Request) {
  try {
    const url = new URL(request.url)
    const organizationId = url.searchParams.get("organization_id") || "default"
    const deviceId = url.searchParams.get("device_id")

    const SQUARE_APP_ID = process.env.SQUARE_APP_ID
    const REDIRECT_URI = process.env.REDIRECT_URI
    const SQUARE_ENVIRONMENT = process.env.SQUARE_ENVIRONMENT || "production"

    if (!SQUARE_APP_ID || !REDIRECT_URI) {
      logger.error("Missing required environment variables")
      return NextResponse.json({ error: "Missing required environment variables" }, { status: 500 })
    }

    const SQUARE_DOMAIN = SQUARE_ENVIRONMENT === "production" ? "squareup.com" : "squareupsandbox.com"

    // ✅ UPDATED: Added missing OAuth scopes for complete donation system functionality
    const scopes = [
      "MERCHANT_PROFILE_READ",    // For merchant info and locations
      "PAYMENTS_WRITE",           // For processing payments  
      "PAYMENTS_WRITE_IN_PERSON", // For in-person payments with Square hardware
      "PAYMENTS_READ",            // For reading payment details
      "ITEMS_READ",               // ❌ WAS MISSING - Required for fetching preset donation amounts
      "ITEMS_WRITE",              // ❌ WAS MISSING - Required for managing preset donation catalog  
      "ORDERS_WRITE"              // ❌ WAS MISSING - Required for creating donation orders
    ]

    const state = uuidv4()

    // Store the state in the database BEFORE returning it to the client
    try {
      const db = createClient()
      // Explicitly provide NULL values for all columns that might have NOT NULL constraints
      await db.query(
        `INSERT INTO square_pending_tokens (
          state, 
          device_id,
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
        [state, deviceId]
      )
      logger.info("Stored pending token state with device", { state, deviceId })
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

    logger.info("Generated OAuth URL with updated scopes", { 
      state, 
      organizationId, 
      scopes: scopes.join("+") 
    })
    
    return NextResponse.json({ authUrl, state })
  } catch (error) {
    logger.error("Error generating auth URL", { error })
    return NextResponse.json({ error: "Failed to generate authorization URL" }, { status: 500 })
  }
}