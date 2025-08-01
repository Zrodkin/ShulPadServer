// api/square/authorize/route.ts - FIXED VERSION

import { NextResponse } from "next/server"
import { v4 as uuidv4 } from "uuid"
import { createClient } from "@/lib/db"
import { logger } from "@/lib/logger"

export async function GET(request: Request) {
  try {
    const url = new URL(request.url)
const organizationId = url.searchParams.get("organization_id")
if (!organizationId || organizationId === "default") {
  logger.error("Missing or invalid organization_id")
  return NextResponse.json({ error: "Organization ID is required" }, { status: 400 })
}
    const deviceId = url.searchParams.get("device_id")

    logger.info("🚀 Authorize endpoint called", { organizationId, deviceId })

    const SQUARE_APP_ID = process.env.SQUARE_APP_ID
    const REDIRECT_URI = process.env.REDIRECT_URI
    const SQUARE_ENVIRONMENT = process.env.SQUARE_ENVIRONMENT || "production"

    if (!SQUARE_APP_ID || !REDIRECT_URI) {
      logger.error("Missing required environment variables")
      return NextResponse.json({ error: "Missing required environment variables" }, { status: 500 })
    }

    const SQUARE_DOMAIN = SQUARE_ENVIRONMENT === "production" ? "squareup.com" : "squareupsandbox.com"

    // ✅ FIXED: Added CUSTOMERS_WRITE and SUBSCRIPTIONS_WRITE scopes
    const scopes = [
      "MERCHANT_PROFILE_READ",
      "PAYMENTS_WRITE",
      "PAYMENTS_WRITE_IN_PERSON", 
      "PAYMENTS_READ",
      "ITEMS_READ",
      "ITEMS_WRITE",
      "ORDERS_WRITE",
      "CUSTOMERS_WRITE",        // ✅ ADDED: Required for creating customers
      "CUSTOMERS_READ",         // ✅ ADDED: Helpful for subscription management
      "SUBSCRIPTIONS_WRITE",    // ✅ ADDED: Required for creating subscriptions
      "SUBSCRIPTIONS_READ",     // ✅ ADDED: Required for checking subscription status
      "INVOICES_WRITE",         // ✅ ADDED: Required for subscription invoicing
      "INVOICES_READ"           // ✅ ADDED: Helpful for tracking payments
    ]

    const state = uuidv4()

    // Store the state in the database
   try {
      // ✅ FIXED: Simplified the INSERT query to only include columns with explicit values.
      // The other columns (access_token, etc.) will use their default values (NULL)
      // and created_at will use NOW() as defined in the table schema.
      const db = createClient();
      await db.execute(
        `INSERT INTO square_pending_tokens (state, organization_id, device_id) VALUES (?, ?, ?)`,
        [state, organizationId, deviceId]
      );
      logger.info("Stored pending token in database", { state, organizationId, deviceId });
    } catch (dbError) {
      logger.error("Database error while storing pending token", { dbError });
      return NextResponse.json({
        error: "Database error"
      }, {
        status: 500
      });
    }

    const authUrl =
      `https://connect.${SQUARE_DOMAIN}/oauth2/authorize?` +
      `client_id=${SQUARE_APP_ID}` +
      `&scope=${scopes.join("+")}` +
      `&state=${state}` +
      `&session=false` +
      `&redirect_uri=${REDIRECT_URI}` +
      (organizationId ? `&organization_id=${organizationId}` : "")

    logger.info("✅ Generated OAuth URL with all required scopes", { 
      state, 
      organizationId, 
      deviceId,
      scopes: scopes.join("+"),
      scopeCount: scopes.length
    })
    
    return NextResponse.json({ authUrl, state })
  } catch (error) {
    logger.error("❌ Error generating auth URL", { error })
    return NextResponse.json({ error: "Failed to generate authorization URL" }, { status: 500 })
  }
}