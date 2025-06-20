import { NextResponse } from "next/server"
import { createClient } from "@/lib/db"

export async function GET() {
  try {
    const db = createClient()
    
    // Quick DB health check
    await db.execute("SELECT 1")
    
    return NextResponse.json({ 
      status: "healthy",
      timestamp: new Date().toISOString(),
      deployment: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) || "unknown"
    })
  } catch (error) {
    return NextResponse.json({ 
      status: "unhealthy",
      error: "Database connection failed",
      timestamp: new Date().toISOString()
    }, { status: 503 })
  }
}