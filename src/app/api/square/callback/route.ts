import { type NextRequest, NextResponse } from "next/server"
import axios from "axios"
import { createClient } from "@/lib/db"
import { logger } from "@/lib/logger"

// Add this helper function after imports
function normalizeOrganizationId(orgId: string): string {
  // Handle device-specific IDs like "default_FC6DCB02-74E8-4E69-AFCA-A614F66D23A9"
  // Extract just the base part "default"
  if (orgId && orgId.includes('_') && orgId.length > 20) {
    const parts = orgId.split('_');
    return parts[0]; // Return "default" from "default_DEVICEID"
  }
  return orgId;
}

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams
    const code = searchParams.get("code")
    const state = searchParams.get("state")
    const deviceId = searchParams.get("device_id") // NEW: Get device_id if passed
    let rawOrganizationId = searchParams.get("organization_id") || "default"
let organizationId = normalizeOrganizationId(rawOrganizationId)

    logger.info("Received OAuth callback", { 
  rawOrganizationId,
  normalizedOrganizationId: organizationId,
  state, 
  hasCode: !!code, 
  deviceId 
})

    if (!code) {
      logger.error("Authorization code is missing")
      return NextResponse.redirect(`${request.nextUrl.origin}/api/square/success?success=false&error=missing_code`)
    }

    if (!state) {
      logger.error("No state parameter received")
      return NextResponse.redirect(`${request.nextUrl.origin}/api/square/success?success=false&error=missing_state`)
    }

    // Initialize database connection
    const db = createClient()

    // Validate that the state exists in our database
    try {
const stateResult = await db.query(
  "SELECT state FROM square_pending_tokens WHERE state = $1 AND (device_id = $2 OR device_id IS NULL)", 
  [state, deviceId]
)
      if (stateResult.rows.length === 0) {
        logger.error("Invalid state parameter received", { state })
        return NextResponse.redirect(`${request.nextUrl.origin}/api/square/success?success=false&error=invalid_state`)
      }

      logger.debug("State validation successful", { state })
    } catch (dbError) {
      logger.error("Database error during state validation", { error: dbError })
      return NextResponse.redirect(`${request.nextUrl.origin}/api/square/success?success=false&error=database_error`)
    }

    const SQUARE_APP_ID = process.env.SQUARE_APP_ID
    const SQUARE_APP_SECRET = process.env.SQUARE_APP_SECRET
    const REDIRECT_URI = process.env.REDIRECT_URI
    const SQUARE_ENVIRONMENT = process.env.SQUARE_ENVIRONMENT || "production"

    if (!SQUARE_APP_ID || !SQUARE_APP_SECRET || !REDIRECT_URI) {
      logger.error("Missing required environment variables")
      return NextResponse.redirect(
        `${request.nextUrl.origin}/api/square/success?success=false&error=server_configuration`,
      )
    }

    const SQUARE_DOMAIN = SQUARE_ENVIRONMENT === "production" ? "squareup.com" : "squareupsandbox.com"
    const SQUARE_TOKEN_URL = `https://connect.${SQUARE_DOMAIN}/oauth2/token`

    logger.info("Exchanging authorization code for tokens")

    // Exchange the authorization code for access token
    let tokenData
    try {
      const response = await axios.post(
        SQUARE_TOKEN_URL,
        {
          client_id: SQUARE_APP_ID,
          client_secret: SQUARE_APP_SECRET,
          code,
          grant_type: "authorization_code",
          redirect_uri: REDIRECT_URI,
        },
        {
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
          },
        },
      )

      tokenData = response.data
      logger.debug("Token exchange successful")

      if (tokenData.error) {
        logger.error("Token exchange error", { error: tokenData.error })
        return NextResponse.redirect(`${request.nextUrl.origin}/api/square/success?success=false&error=token_exchange`)
      }
    } catch (error) {
      logger.error("Error during token exchange", { error })
      return NextResponse.redirect(`${request.nextUrl.origin}/api/square/success?success=false&error=token_exchange`)
    }

    const { access_token, refresh_token, expires_at, merchant_id } = tokenData

    // Get the merchant's locations
    try {
      logger.info("Fetching merchant locations")
      const locationsResponse = await axios.get(`https://connect.${SQUARE_DOMAIN}/v2/locations`, {
        headers: {
          Authorization: `Bearer ${access_token}`,
          "Content-Type": "application/json",
          "Square-Version": "2023-09-25",
        },
      })

      const locations = locationsResponse.data.locations
      logger.info("Found locations", { count: locations.length })

      // Define interface for location object
      interface SquareLocation {
        id: string;
        name: string;
        status: string;
        address?: {
          address_line_1?: string;
          locality?: string;
          administrative_district_level_1?: string;
        };
        [key: string]: any;
      }

      if (!locations || locations.length === 0) {
        logger.warn("No locations found for merchant")
        return NextResponse.redirect(
          `${request.nextUrl.origin}/api/square/success?success=false&error=no_locations`
        )
      }

      // Filter to only active locations
      const activeLocations = locations.filter((loc: SquareLocation) => loc.status === "ACTIVE")
      
      if (activeLocations.length === 0) {
        logger.warn("No active locations found for merchant")
        return NextResponse.redirect(
          `${request.nextUrl.origin}/api/square/success?success=false&error=no_active_locations`
        )
      }

      // Check if merchant has multiple active locations
      if (activeLocations.length === 1) {
        // Only one location - auto-select it and proceed normally
        const singleLocation = activeLocations[0]
        logger.info("Single location found, auto-selecting", { 
          location_id: singleLocation.id, 
          location_name: singleLocation.name 
        })

        // Store directly in permanent table since there's only one choice
        try {
          await db.query("BEGIN")

          // Update pending tokens with location info
          await db.query(
            `UPDATE square_pending_tokens SET
              access_token = $2, 
              refresh_token = $3, 
              merchant_id = $4,
              location_id = $5,
              expires_at = $6
            WHERE state = $1`,
            [state, access_token, refresh_token, merchant_id, singleLocation.id, expires_at]
          )

          // Store in permanent table
        await db.query(
  `INSERT INTO square_connections (
    organization_id, 
    merchant_id,
    location_id,
    access_token, 
    refresh_token, 
    expires_at, 
    created_at
  ) VALUES ($1, $2, $3, $4, $5, $6, NOW())`,
  [organizationId, merchant_id, singleLocation.id, access_token, refresh_token, expires_at]
)

          await db.query("COMMIT")
          logger.info("Single location setup completed", { 
            organizationId, 
            merchantId: merchant_id, 
            locationId: singleLocation.id,
            locationName: singleLocation.name
          })

          // Redirect to success page
          return NextResponse.redirect(
            `${request.nextUrl.origin}/api/square/success?success=true&location=${encodeURIComponent(singleLocation.name)}`
          )

        } catch (error) {
          await db.query("ROLLBACK")
          logger.error("Error storing single location", { error })
          return NextResponse.redirect(
            `${request.nextUrl.origin}/api/square/success?success=false&error=database_error`
          )
        }
      } else {
        // Multiple locations - need user to select
        logger.info("Multiple locations found, redirecting to selection", { 
          locations_count: activeLocations.length 
        })

        // Store ALL locations in pending tokens for selection
        try {
          await db.query(
            `UPDATE square_pending_tokens SET
              access_token = $2, 
              refresh_token = $3, 
              merchant_id = $4,
              location_data = $5,
              expires_at = $6
            WHERE state = $1`,
            [
              state, 
              access_token, 
              refresh_token, 
              merchant_id, 
              JSON.stringify(activeLocations),
              expires_at
            ]
          )

          logger.info("OAuth completed, awaiting location selection", { 
            merchant_id, 
            locations_count: activeLocations.length 
          })

          // Redirect to location selection page
          return NextResponse.redirect(
            `${request.nextUrl.origin}/api/square/location-select?state=${state}&success=true`
          )

        } catch (error) {
          logger.error("Error storing location data for selection", { error })
          return NextResponse.redirect(
            `${request.nextUrl.origin}/api/square/success?success=false&error=database_error`
          )
        }
      }

    } catch (error) {
      logger.error("Error fetching merchant locations", { error })
      return NextResponse.redirect(
        `${request.nextUrl.origin}/api/square/success?success=false&error=location_fetch_failed`
      )
    }

  } catch (error) {
    logger.error("Server error during OAuth flow", { error })
    return NextResponse.redirect(`${request.nextUrl.origin}/api/square/success?success=false&error=server_error`)
  }
}