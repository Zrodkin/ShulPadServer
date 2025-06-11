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
    const client = await db.connect()
    
    try {
      await client.query("BEGIN")
      
      if (disconnect_all_devices) {
        // FULL DISCONNECT - like the original behavior
        // Get the access token and revoke it
const normalizedOrgId = normalizeOrganizationId(organization_id)
        const result = await client.query(
          "SELECT access_token, merchant_id FROM square_connections WHERE organization_id = $1", 
          [normalizedOrgId]
        )

        if (result.rows.length > 0) {
          const { access_token, merchant_id } = result.rows[0]
          
          // Create proper normalized org ID with merchant_id
          const properNormalizedOrgId = normalizeOrganizationId(organization_id, merchant_id)
          
          // Revoke token with Square
          try {
            const SQUARE_ENVIRONMENT = process.env.SQUARE_ENVIRONMENT || "sandbox"
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
          await client.query("DELETE FROM square_connections WHERE organization_id = $1", [properNormalizedOrgId])
        }
      }
      
      // Always clean up device-specific pending tokens
      if (device_id) {
        await client.query("DELETE FROM square_pending_tokens WHERE device_id = $1", [device_id])
      }
      
      // Clean up pending tokens for this organization
      await client.query("DELETE FROM square_pending_tokens WHERE state LIKE $1", [`%${organization_id}%`])
      
      await client.query("COMMIT")
      
      const message = disconnect_all_devices 
        ? "All devices disconnected from Square account"
        : "Device disconnected. Other devices remain connected."
        
      logger.info("Disconnection successful", { organization_id, disconnect_all_devices })
      
    } catch (dbError) {
      await client.query("ROLLBACK")
      logger.error("Database error during disconnect", { error: dbError })
      return NextResponse.json({ error: "Database error during disconnection" }, { status: 500 })
    } finally {
      client.release()
    }

    return NextResponse.json({ success: true })
    
  } catch (error) {
    logger.error("Server error during disconnect", { error })
    return NextResponse.json({ error: "Server error during disconnection" }, { status: 500 })
  }
}