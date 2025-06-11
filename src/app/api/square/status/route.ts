import { type NextRequest, NextResponse } from "next/server"
import axios from "axios"
import { createClient } from "@/lib/db"
import { logger } from "@/lib/logger"
import { normalizeOrganizationId } from "@/lib/organizationUtils" 




export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams
  const rawOrganizationId = searchParams.get("organization_id")
let organizationId = rawOrganizationId
    const state = searchParams.get("state")
    const deviceId = searchParams.get("device_id") // NEW: Add device_id

    logger.info("Status check requested", { 
  rawOrganizationId, 
  normalizedOrganizationId: organizationId, 
  state, 
  deviceId 
})

    const db = createClient()

    // Path 1: Checking by state parameter (for OAuth flow tracking)
    if (state) {
      logger.debug("Checking authorization status by state", { state, deviceId })

      // UPDATE: Include device_id in pending tokens query
      const pendingResult = await db.query(
        "SELECT access_token, refresh_token, merchant_id, location_id, location_data, expires_at FROM square_pending_tokens WHERE state = $1 AND (device_id = $2 OR device_id IS NULL)",
        [state, deviceId]
      )

      if (pendingResult.rows.length > 0) {
        const row = pendingResult.rows[0]

        // Check if we have tokens AND a specific location_id (final state)
        if (row.access_token && row.location_id) {
          // ✅ FINAL STATE: We have tokens and user has selected a location
          const { access_token, refresh_token, merchant_id, location_id, expires_at } = row

          // Mark as obtained instead of deleting immediately
          await db.query("UPDATE square_pending_tokens SET obtained = true WHERE state = $1", [state]);
          logger.info("Found completed authorization with location", { state, merchantId: merchant_id, locationId: location_id });
    
          // Return the tokens - this is what iOS needs
          return NextResponse.json({
            connected: true,
            access_token,
            refresh_token,
            merchant_id,
            location_id,
            expires_at,
          })
        } 
        // Check if we have tokens but multiple locations (needs user selection)
        else if (row.access_token && row.location_data) {
          // ✅ INTERMEDIATE STATE: We have tokens but user needs to select location
          logger.debug("Found pending authorization with multiple locations", { state })
          
          let locations = []
          try {
            locations = JSON.parse(row.location_data)
          } catch (e) {
            logger.error("Failed to parse location_data", { error: e, state })
          }
          
          return NextResponse.json({
            connected: false,
            message: "location_selection_required",
            merchant_id: row.merchant_id,
            locations: locations,
            // Include enough info for location selection
            selection_url: `/api/square/location-select?state=${state}`,
          })
        }
        // We have the state but no tokens yet (still in OAuth flow)
        else {
          logger.debug("Found pending state but no tokens yet", { state })
          return NextResponse.json({
            connected: false,
            message: "authorization_in_progress",
          })
        }
      } else {
        // No pending authorization found
        logger.debug("No pending authorization found for state", { state })
        return NextResponse.json({
          connected: false,
          message: "invalid_state",
        })
      }
    }

    // Path 2: Checking by organization ID (normal status check)
    else if (organizationId) {
logger.debug("Checking authorization status by organization ID", { 
  rawOrganizationId, 
  normalizedOrganizationId: organizationId 
})
      const SQUARE_ENVIRONMENT = process.env.SQUARE_ENVIRONMENT || "sandbox"
      const SQUARE_DOMAIN = SQUARE_ENVIRONMENT === "production" ? "squareup.com" : "squareupsandbox.com"

      // Get the access token from the database
      let result = await db.query(
  "SELECT access_token, refresh_token, expires_at, merchant_id, location_id FROM square_connections WHERE organization_id = $1",
  [organizationId],
)

      if (result.rows.length === 0 && rawOrganizationId && rawOrganizationId.includes('_')) {
  const baseOrgId = rawOrganizationId.split('_')[0]
  result = await db.query(
    "SELECT access_token, refresh_token, expires_at, merchant_id, location_id FROM square_connections WHERE organization_id LIKE $1",
    [`${baseOrgId}_%`],
  )
}

      const { access_token, refresh_token, expires_at, merchant_id, location_id } = result.rows[0]

      // Check if token is expired
      const expirationDate = new Date(expires_at)
      if (expirationDate < new Date()) {
        logger.warn("Token expired", { organizationId, expires_at })
        return NextResponse.json({
          connected: false,
          message: "Token expired",
          needs_refresh: true,
        })
      }

      // Verify token by making a simple API call
      try {
        logger.debug("Verifying token with Square API", { organizationId })
        await axios.get(`https://connect.${SQUARE_DOMAIN}/v2/locations`, {
          headers: {
            Authorization: `Bearer ${access_token}`,
            "Content-Type": "application/json",
            "Square-Version": "2023-09-25",
          },
        })

        logger.info("Token verification successful", { organizationId })
        return NextResponse.json({
          connected: true,
          merchant_id,
          location_id,
          expires_at: expires_at,
          // ✅ IMPORTANT: Include access_token for iOS app
          access_token,
          refresh_token,
        })
      } catch (apiError) {
        logger.error("API error checking token", { error: apiError, organizationId })
        return NextResponse.json({
          connected: false,
          message: "Token validation failed",
          needs_refresh: true,
        })
      }
    } else {
      logger.warn("Missing required parameters")
      return NextResponse.json({ error: "Either organization_id or state parameter is required" }, { status: 400 })
    }
  } catch (error) {
    logger.error("Server error", { error })
    return NextResponse.json({ error: "Server error checking connection status" }, { status: 500 })
  }
}