import { type NextRequest, NextResponse } from "next/server"
import axios from "axios"
import { createClient } from "@/lib/db"
import { logger } from "@/lib/logger"
import { normalizeOrganizationId } from "@/lib/organizationUtils"

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { organization_id, refresh_token, device_id } = body
    let normalizedOrgId = organization_id // Changed from const to let

    logger.info("Token refresh requested", { 
      rawOrganizationId: organization_id, 
      normalizedOrganizationId: normalizedOrgId, 
      device_id 
    })

    // If refresh_token is provided, use it directly
    // Otherwise, look it up in the database using organization_id
    let tokenToUse = refresh_token

    if (!tokenToUse && organization_id) {
      try {
        const db = createClient()
        
        // First try exact match
        let result = await db.execute("SELECT refresh_token, merchant_id FROM square_connections WHERE organization_id = ?", [
          organization_id,
        ])

        if (result.rows.length === 0 && organization_id.includes('_')) {
          const baseOrgId = organization_id.split('_')[0]
          result = await db.execute("SELECT refresh_token, merchant_id FROM square_connections WHERE organization_id LIKE ?", [
            `${baseOrgId}_%`,
          ])
        }
        
        if (result.rows.length > 0) {
          tokenToUse = result.rows[0].refresh_token
          // Use the actual merchant_id for proper normalization in the update
          const merchantId = result.rows[0].merchant_id
          normalizedOrgId = normalizeOrganizationId(organization_id, merchantId)
          logger.debug("Retrieved refresh token from database", { organization_id })
        } else {
          logger.warn("No refresh token found for organization", { organization_id })
          return NextResponse.json({ error: "No refresh token found for this organization" }, { status: 404 })
        }
      } catch (dbError) {
        logger.error("Database error", { error: dbError })
        return NextResponse.json({ error: "Database error while retrieving refresh token" }, { status: 500 })
      }
    } // Added missing closing brace

    if (!tokenToUse) {
      logger.warn("No refresh token provided")
      return NextResponse.json({ error: "Refresh token is required" }, { status: 400 })
    }

    const SQUARE_APP_ID = process.env.SQUARE_APP_ID
    const SQUARE_APP_SECRET = process.env.SQUARE_APP_SECRET
    const SQUARE_ENVIRONMENT = process.env.SQUARE_ENVIRONMENT || "sandbox"

    if (!SQUARE_APP_ID || !SQUARE_APP_SECRET) {
      logger.error("Missing required environment variables")
      return NextResponse.json({ error: "Missing required environment variables" }, { status: 500 })
    }

    const SQUARE_DOMAIN = SQUARE_ENVIRONMENT === "production" ? "squareup.com" : "squareupsandbox.com"
    const SQUARE_TOKEN_URL = `https://connect.${SQUARE_DOMAIN}/oauth2/token`

    logger.info("Refreshing token with Square API")
    const response = await axios.post(
      SQUARE_TOKEN_URL,
      {
        client_id: SQUARE_APP_ID,
        client_secret: SQUARE_APP_SECRET,
        refresh_token: tokenToUse,
        grant_type: "refresh_token",
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
      logger.error("Token refresh error", { error: data.error })
      return NextResponse.json({ error: data.error }, { status: 400 })
    }

    logger.info("Token refresh successful")

    // Update the tokens in the database if organization_id is provided
    if (organization_id) {
      try {
        const db = createClient()

        // Use transaction for data consistency
        await db.execute("BEGIN")

        try {
          await db.execute(
            `UPDATE square_connections 
             SET access_token = ?, 
                 refresh_token = $2, 
                 expires_at = $3, 
                 updated_at = NOW() 
             WHERE organization_id = $4`,
            [data.access_token, data.refresh_token, data.expires_at, normalizedOrgId],
          )

          await db.execute("COMMIT")
          logger.debug("Updated tokens in database", { organization_id })
        } catch (error) {
          await db.execute("ROLLBACK")
          throw error
        }
      } catch (dbError: unknown) {
        logger.error("Database error during token update", { error: dbError })
        // Continue with the flow even if database update fails
      }
    }

    return NextResponse.json(data)
  } catch (error: unknown) {
    logger.error("Server error", { error })
    return NextResponse.json({ error: "Server error during token refresh" }, { status: 500 })
  }
}