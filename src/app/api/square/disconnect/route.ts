// src/app/api/square/disconnect/route.ts - FIXED VERSION
import { type NextRequest, NextResponse } from "next/server"
import axios from "axios"
import { createClient } from "@/lib/db"
import { logger } from "@/lib/logger"
import { normalizeOrganizationId } from "@/lib/organizationUtils"

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { organization_id, device_id, disconnect_all_devices = false } = body

    if (!organization_id) {
      logger.error("Organization ID is required for disconnect")
      return NextResponse.json({ error: "Organization ID is required" }, { status: 400 })
    }

    logger.info("Disconnect requested", { organization_id, device_id, disconnect_all_devices })

    const db = createClient()
    
    try {
      await db.execute("START TRANSACTION")
      
      if (disconnect_all_devices) {
        const normalizedOrgId = normalizeOrganizationId(organization_id)
        const result = await db.execute(
          "SELECT access_token, merchant_id FROM square_connections WHERE organization_id = ?", 
          [normalizedOrgId]
        )

        if (result.rows.length > 0) {
          const { access_token, merchant_id } = result.rows[0]
          
          // Revoke token with Square
          try {
            const SQUARE_ENVIRONMENT = process.env.SQUARE_ENVIRONMENT || "production"
            const SQUARE_DOMAIN = SQUARE_ENVIRONMENT === "production" ? "squareup.com" : "squareupsandbox.com"
            
            await axios.post(`https://connect.${SQUARE_DOMAIN}/oauth2/revoke`, {
              client_id: process.env.SQUARE_APP_ID,
              access_token: access_token,
            }, {
              headers: {
                "Content-Type": "application/json",
                Authorization: `Client ${process.env.SQUARE_APP_SECRET}`,
              },
            })
            logger.info("Token revoked with Square", { organization_id })
          } catch (revokeError) {
            logger.error("Failed to revoke token with Square", { error: revokeError })
          }
          
          // Delete connection from database
          await db.execute("DELETE FROM square_connections WHERE organization_id = ?", [normalizedOrgId])
        }
      }
      
      // Clean up device-specific pending tokens
      if (device_id) {
        await db.execute("DELETE FROM square_pending_tokens WHERE device_id = ?", [device_id])
      }
      
      // Clean up old pending tokens
await db.execute("DELETE FROM square_pending_tokens WHERE created_at < NOW() - INTERVAL 24 HOUR")
      
      await db.execute("COMMIT")
      
      const message = disconnect_all_devices 
        ? "All devices disconnected from Square account"
        : "Device disconnected. Other devices remain connected."
        
      logger.info("Disconnection successful", { organization_id, disconnect_all_devices })
      
      return NextResponse.json({ success: true, message })
      
    } catch (dbError) {
      await db.execute("ROLLBACK")
      logger.error("Database error during disconnect", { error: dbError })
      return NextResponse.json({ error: "Database error during disconnection" }, { status: 500 })
    }
    
  } catch (error) {
    logger.error("Server error during disconnect", { error })
    return NextResponse.json({ error: "Server error during disconnection" }, { status: 500 })
  }
}