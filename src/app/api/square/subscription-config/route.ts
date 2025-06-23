// src/app/api/square/subscription-config/route.ts
import { NextResponse } from "next/server"

export async function GET() {
  try {
    const environment = process.env.SQUARE_ENVIRONMENT || "production"
    
    // Return Square configuration for subscription checkout
    const config = {
      application_id: process.env.SQUARE_APP_ID,
      location_id: process.env.SHULPAD_SQUARE_LOCATION_ID,
      environment: environment
    }

    // Validate required config
    if (!config.application_id) {
      return NextResponse.json(
        { error: "Square Application ID not configured" },
        { status: 500 }
      )
    }

    if (!config.location_id) {
      return NextResponse.json(
        { error: "Square Location ID not configured" },
        { status: 500 }
      )
    }

    console.log(`✅ Square config provided for ${environment} environment`)
    return NextResponse.json(config)
  } catch (error) {
    console.error("Error getting Square config:", error)
    return NextResponse.json(
      { error: "Failed to get Square configuration" },
      { status: 500 }
    )
  }
}