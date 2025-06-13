// src/app/api/square/status/route.ts - FIXED VERSION
import { NextResponse, type NextRequest } from "next/server"
import { createClient } from "@/lib/db"
import { logger } from "@/lib/logger"
import { normalizeOrganizationId } from "@/lib/organizationUtils"

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const organizationId = searchParams.get('organization_id')
    const state = searchParams.get('state')
    const deviceId = searchParams.get('device_id')

    logger.info("Status check requested", {
      rawOrganizationId: organizationId,
      normalizedOrganizationId: organizationId,
      state,
      deviceId
    })

    const db = createClient()

    // SCENARIO 1: State-based check (during OAuth flow)
    if (state) {
      logger.info("Checking state-based auth status", { state })
      
      // First check pending tokens table
      const pendingResult = await db.query(
        `SELECT * FROM square_pending_tokens WHERE state = $1`,
        [state]
      )

      if (pendingResult.rows.length > 0) {
        const pendingToken = pendingResult.rows[0]
        
        // If we have all required data, auth is complete
   if (pendingToken.access_token && 
    pendingToken.refresh_token && 
    pendingToken.merchant_id && 
    pendingToken.location_id) { 
          
          logger.info("State-based auth completed successfully", { 
            state, 
            merchant_id: pendingToken.merchant_id,
            location_id: pendingToken.location_id 
          })
          
          return NextResponse.json({
            connected: true,
            access_token: pendingToken.access_token,
            refresh_token: pendingToken.refresh_token,
            merchant_id: pendingToken.merchant_id,
            location_id: pendingToken.location_id,
            expires_at: pendingToken.expires_at
          })
        }
        
        // Check if location selection is needed
        if (pendingToken.access_token && pendingToken.merchant_id && !pendingToken.location_id) {
          logger.info("Location selection required", { state })
          return NextResponse.json({ 
            connected: false, 
            message: "location_selection_required",
            merchant_id: pendingToken.merchant_id 
          })
        }
        
        // Otherwise, still in progress
        logger.info("Authorization still in progress", { state })
        return NextResponse.json({ 
          connected: false, 
          message: "authorization_in_progress" 
        })
      }

      // 🔧 CRITICAL FIX: If state not found in pending, check if tokens were finalized
      // This happens when location-select completes and moves tokens to square_connections
      logger.info("State not found in pending tokens, checking finalized connections", { state })
      
      // Try to find the connection by looking for recent entries
      // Since we don't have direct state->org mapping, we'll check recent connections
      const recentConnectionResult = await db.query(
        `SELECT * FROM square_connections 
         WHERE created_at > NOW() - INTERVAL '10 minutes' 
         ORDER BY created_at DESC 
         LIMIT 1`
      )

      if (recentConnectionResult.rows.length > 0) {
        const connection = recentConnectionResult.rows[0]
        
        logger.info("Found recent connection that matches timeframe", { 
          organization_id: connection.organization_id,
          merchant_id: connection.merchant_id,
          location_id: connection.location_id 
        })
        
        return NextResponse.json({
          connected: true,
          access_token: connection.access_token,
          refresh_token: connection.refresh_token,
          merchant_id: connection.merchant_id,
          location_id: connection.location_id,
          expires_at: connection.expires_at
        })
      }

      // If we still can't find it, it's truly not ready yet
      logger.info("State not found anywhere, still waiting", { state })
      return NextResponse.json({ 
        connected: false, 
        message: "token_not_found" 
      })
    }

    // SCENARIO 2: Organization-based check (normal operation)
    if (organizationId) {
      const normalizedOrgId = normalizeOrganizationId(organizationId)
      
      logger.info("Checking organization-based auth status", { 
        original: organizationId, 
        normalized: normalizedOrgId 
      })

      const result = await db.query(
        `SELECT * FROM square_connections WHERE organization_id = $1`,
        [normalizedOrgId]
      )

      if (result.rows.length === 0) {
        logger.info("No connection found for organization", { 
          organizationId: normalizedOrgId 
        })
        return NextResponse.json({ connected: false })
      }

      const connection = result.rows[0]
      const now = new Date()
      const expiresAt = new Date(connection.expires_at)

      // Check if token is expired
      if (expiresAt <= now) {
        logger.info("Token expired for organization", { 
          organizationId: normalizedOrgId,
          expiresAt: connection.expires_at 
        })
        return NextResponse.json({ 
          connected: false, 
          needs_refresh: true,
          expires_at: connection.expires_at 
        })
      }

      // Check if token needs refresh (expires in less than 7 days)
      const sevenDaysFromNow = new Date(now.getTime() + (7 * 24 * 60 * 60 * 1000))
      const needsRefresh = expiresAt <= sevenDaysFromNow

      logger.info("Organization connection found", { 
        organizationId: normalizedOrgId,
        merchantId: connection.merchant_id,
        locationId: connection.location_id,
        needsRefresh 
      })

      return NextResponse.json({
        connected: true,
        access_token: connection.access_token,
        refresh_token: connection.refresh_token,
        merchant_id: connection.merchant_id,
        location_id: connection.location_id,
        expires_at: connection.expires_at,
        needs_refresh: needsRefresh
      })
    }

    // SCENARIO 3: Invalid request - neither state nor organization_id provided
    logger.warn("Status check missing required parameters", { 
      hasState: !!state, 
      hasOrgId: !!organizationId 
    })
    
    return NextResponse.json({ 
      error: "Missing required parameters: state or organization_id" 
    }, { status: 400 })

  } catch (error: any) {
    logger.error("Error in status check", { error: error.message, stack: error.stack })
    return NextResponse.json({ 
      error: "Internal server error" 
    }, { status: 500 })
  }
}