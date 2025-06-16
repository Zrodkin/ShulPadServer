import { NextResponse } from "next/server"
import axios from "axios"
import { createClient } from "@/lib/db"
import { logger } from "@/lib/logger"

// Define the type for refresh results
interface RefreshResultDetail {
  organization_id: string
  status: string
  error?: any
  expires_at?: string
}

// This endpoint should be called by a cron job every day
export async function GET(request: Request) {
  try {
    const SQUARE_APP_ID = process.env.SQUARE_APP_ID
    const SQUARE_APP_SECRET = process.env.SQUARE_APP_SECRET
    const SQUARE_ENVIRONMENT = process.env.SQUARE_ENVIRONMENT || "sandbox"

    if (!SQUARE_APP_ID || !SQUARE_APP_SECRET) {
      logger.error("Missing required environment variables")
      return NextResponse.json({ error: "Missing required environment variables" }, { status: 500 })
    }

    const SQUARE_DOMAIN = SQUARE_ENVIRONMENT === "production" ? "squareup.com" : "squareupsandbox.com"
    const SQUARE_TOKEN_URL = `https://connect.${SQUARE_DOMAIN}/oauth2/token`

    // Get all connections that need to be refreshed
    // (tokens that expire in less than 7 days)
    const db = createClient()
    const result = await db.execute(
      `SELECT organization_id, refresh_token 
       FROM square_connections 
       WHERE expires_at < NOW() + INTERVAL 7 DAY`,
    )

    logger.info(`Found ${result.rows.length} tokens to refresh`)

    const refreshResults = {
      success: 0,
      failed: 0,
      details: [] as RefreshResultDetail[],
    }

    // Process each token
    for (const row of result.rows) {
      try {
        const { organization_id, refresh_token } = row
        logger.debug("Refreshing token", { organization_id })

        const response = await axios.post(
          SQUARE_TOKEN_URL,
          {
            client_id: SQUARE_APP_ID,
            client_secret: SQUARE_APP_SECRET,
            refresh_token,
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
          logger.error(`Error refreshing token for ${organization_id}:`, { error: data.error })
          refreshResults.failed++
          refreshResults.details.push({
            organization_id,
            status: "failed",
            error: data.error,
          })
          continue
        }

        // Update the tokens in the database using a transaction
        await db.execute("BEGIN")

        try {
          await db.execute(
  `UPDATE square_connections 
   SET access_token = $1, 
       refresh_token = $2, 
       expires_at = $3, 
       updated_at = NOW() 
   WHERE organization_id = $4`,
  [data.access_token, data.refresh_token, data.expires_at, organization_id],
)

          await db.execute("COMMIT")
          logger.info(`Successfully refreshed token for ${organization_id}`)
        } catch (error) {
          await db.execute("ROLLBACK")
          throw error
        }

        refreshResults.success++
        refreshResults.details.push({
          organization_id,
          status: "success",
          expires_at: data.expires_at,
        })
      } catch (error: unknown) {
        logger.error("Error refreshing token:", { error, organization_id: row.organization_id })
        refreshResults.failed++
        refreshResults.details.push({
          organization_id: row.organization_id,
          status: "failed",
          error: error instanceof Error ? error.message : String(error),
        })
      }
    }

    return NextResponse.json(refreshResults)
  } catch (error: unknown) {
    logger.error("Server error:", { error })
    return NextResponse.json({ error: "Server error during token refresh" }, { status: 500 })
  }
}
