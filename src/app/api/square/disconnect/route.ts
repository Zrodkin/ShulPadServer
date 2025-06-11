import { type NextRequest, NextResponse } from "next/server"
import axios from "axios"
import { createClient } from "@/lib/db"
import { logger } from "@/lib/logger"

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { organization_id, device_id } = body // NEW: Extract device_id

    if (!organization_id) {
      logger.error("Organization ID is required for disconnect")
      return NextResponse.json({ error: "Organization ID is required" }, { status: 400 })
    }

    logger.info("Disconnect requested", { organization_id, device_id })

    const SQUARE_APP_ID = process.env.SQUARE_APP_ID
    const SQUARE_APP_SECRET = process.env.SQUARE_APP_SECRET
    const SQUARE_ENVIRONMENT = process.env.SQUARE_ENVIRONMENT || "sandbox"

    if (!SQUARE_APP_ID || !SQUARE_APP_SECRET) {
      logger.error("Missing required environment variables")
      return NextResponse.json({ error: "Missing required environment variables" }, { status: 500 })
    }

    // Get the access token from the database
    const db = createClient()
    let client
    
    try {
      // Get connection
      client = await db.connect()
      
      const result = await client.query("SELECT access_token FROM square_connections WHERE organization_id = $1", [
        organization_id,
      ])

      if (result.rows.length === 0) {
        logger.warn("No Square connection found for this organization", { organization_id })
        // Even if no connection exists, consider this a "success" to avoid client-side errors
        return NextResponse.json({ success: true, message: "No connection to disconnect" })
      }

      const access_token = result.rows[0].access_token

      const SQUARE_DOMAIN = SQUARE_ENVIRONMENT === "production" ? "squareup.com" : "squareupsandbox.com"
      const SQUARE_REVOKE_URL = `https://connect.${SQUARE_DOMAIN}/oauth2/revoke`

      try {
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
        
        logger.info("Token successfully revoked with Square API", { organization_id })
      } catch (revokeError) {
        // Log the error but continue to remove the connection from the database
        logger.error("Error revoking token with Square API", { error: revokeError, organization_id })
      }

      // Remove the connection from the database
      try {
        // Use a transaction for data consistency
        await client.query("BEGIN")
        
        // Delete from square_connections
        await client.query("DELETE FROM square_connections WHERE organization_id = $1", [organization_id])
        
        // ALSO: Clean up any pending tokens for this device
    if (device_id) {
      await client.query(
        "DELETE FROM square_pending_tokens WHERE device_id = $1", 
        [device_id]
      )
    }
    
        // Also clean up any pending tokens for this organization
        await client.query("DELETE FROM square_pending_tokens WHERE state LIKE $1", [`%${organization_id}%`])
        
        await client.query("COMMIT")
        
        logger.info("Connection records deleted from database", { organization_id })
      } catch (dbError) {
        // Roll back on database error
        try {
          await client.query("ROLLBACK")
        } catch (_) {}
        
        logger.error("Database error during disconnect", { error: dbError, organization_id })
        return NextResponse.json({ error: "Database error during disconnection" }, { status: 500 })
      }
    } finally {
      // Release the client back to the pool if it exists
      if (client) {
        client.release()
      }
    }

    logger.info("Disconnection successful", { organization_id })
    return NextResponse.json({ success: true })
  } catch (error) {
    logger.error("Server error during disconnect", { error })
    return NextResponse.json({ error: "Server error during disconnection" }, { status: 500 })
  }
}