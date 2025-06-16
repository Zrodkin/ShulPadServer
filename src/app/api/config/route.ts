// src/app/api/config/route.ts
import { NextResponse } from "next/server"

export async function GET() {
  try {
    // Get the current deployment URL from Vercel environment variables
    const deploymentUrl = process.env.VERCEL_URL 
    const customDomain = process.env.DEPLOYMENT_URL 
    
    // Priority: Custom domain > Vercel URL > fallback
    let baseURL = customDomain || deploymentUrl || "charity-pad-server.vercel.app"
    
    // Ensure it has https:// prefix (Vercel URLs don't include protocol)
    if (!baseURL.startsWith('http')) {
      baseURL = `https://${baseURL}`
    }
    
    const config = {
      backendBaseURL: baseURL,
      redirectURI: `${baseURL}/api/square/callback`,
      
      // Add environment info for debugging
      environment: process.env.SQUARE_ENVIRONMENT || "production",
      version: "1.0.0", // Increment this when you change URLs
      deploymentTime: new Date().toISOString(),
      
      // Optional: Add feature flags or other config
      features: {
        adaptivePolling: true,
        offlineSupport: true
      }
    }
    
    console.log("📱 Config API called, returning:", config)
    
    // Set CORS headers for iOS app
    const response = NextResponse.json(config)
    response.headers.set('Access-Control-Allow-Origin', '*')
    response.headers.set('Access-Control-Allow-Methods', 'GET')
    response.headers.set('Access-Control-Allow-Headers', 'Content-Type')
    response.headers.set('Cache-Control', 'public, max-age=300') // Cache for 5 minutes
    
    return response
  } catch (error) {
    console.error('❌ Config endpoint error:', error)
    return NextResponse.json({ error: 'Failed to load configuration' }, { status: 500 })
  }
}