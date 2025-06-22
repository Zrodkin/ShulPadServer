// app/api/square/subscription-config/route.ts
import { NextResponse } from "next/server"

export async function GET() {
  try {
    const applicationId = process.env.SQUARE_APP_ID
    const locationId = process.env.SHULPAD_SQUARE_LOCATION_ID
    
    // Validate required environment variables
    if (!applicationId) {
      console.error('SQUARE_APP_ID not configured')
      return NextResponse.json({ 
        error: "Payment configuration incomplete: Missing application ID" 
      }, { status: 500 })
    }
    
    if (!locationId) {
      console.error('SHULPAD_SQUARE_LOCATION_ID not configured')
      return NextResponse.json({ 
        error: "Payment configuration incomplete: Missing location ID" 
      }, { status: 500 })
    }
    
    // Optional: Verify the location exists (requires access token)
    const accessToken = process.env.SQUARE_ACCESS_TOKEN
    if (accessToken) {
      try {
        const locationResponse = await fetch(`https://connect.squareup.com/v2/locations/${locationId}`, {
          headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Square-Version': '2025-05-21'
          },
          // Add timeout
          signal: AbortSignal.timeout(5000)
        })
        
        if (!locationResponse.ok) {
          console.error(`Invalid location ID: ${locationId}`, {
            status: locationResponse.status,
            statusText: locationResponse.statusText
          })
          return NextResponse.json({ 
            error: "Payment configuration error: Invalid location" 
          }, { status: 500 })
        }
        
        const locationData = await locationResponse.json()
        console.log(`✅ Verified location: ${locationData.location?.name || 'Unknown'}`)
        
      } catch (verificationError) {
        console.warn('Could not verify location (proceeding anyway):', verificationError)
        // Don't fail the request - just log the warning
      }
    }
    
    // Return the configuration
    return NextResponse.json({
      application_id: applicationId,
      location_id: locationId
    })
    
  } catch (error) {
    console.error('Error in subscription config endpoint:', error)
    return NextResponse.json({ 
      error: "Failed to load payment configuration" 
    }, { status: 500 })
  }
}

// Optional: Add security headers
export async function OPTIONS() {
  return new NextResponse(null, {
    status: 200,
    headers: {
      'Access-Control-Allow-Origin': process.env.NODE_ENV === 'production' 
        ? 'https://api.shulpad.com' 
        : '*',
      'Access-Control-Allow-Methods': 'GET',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  })
}