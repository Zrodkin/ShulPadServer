import { NextResponse, type NextRequest } from "next/server"
import axios from "axios"
import { createClient } from "@/lib/db"
import { logger } from "@/lib/logger"
import { v4 as uuidv4 } from "uuid"

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { organization_id, object_id } = body

    if (!organization_id) {
      logger.error("Organization ID is required for catalog operations")
      return NextResponse.json({ error: "Organization ID is required" }, { status: 400 })
    }

    if (!object_id) {
      logger.error("Object ID is required for deletion")
      return NextResponse.json({ error: "Object ID is required" }, { status: 400 })
    }

    // Get the access token from the database
    const db = createClient()
    const result = await db.query(
      "SELECT access_token FROM square_connections WHERE organization_id = $1",
      [organization_id]
    )

    if (result.rows.length === 0) {
      logger.error("No Square connection found for this organization", { organization_id })
      return NextResponse.json({ error: "Not connected to Square" }, { status: 404 })
    }

    const { access_token } = result.rows[0]
    
    const SQUARE_ENVIRONMENT = process.env.SQUARE_ENVIRONMENT || "sandbox"
    const SQUARE_DOMAIN = SQUARE_ENVIRONMENT === "production" ? "squareup.com" : "squareupsandbox.com"
    const SQUARE_DELETE_URL = `https://connect.${SQUARE_DOMAIN}/v2/catalog/object/${object_id}`

    // Make the request to Square API
    const response = await axios.delete(
      SQUARE_DELETE_URL,
      {
        headers: {
          "Square-Version": "2023-09-25",
          "Authorization": `Bearer ${access_token}`,
          "Content-Type": "application/json"
        }
      }
    )

    logger.info("Successfully deleted catalog object", { 
      organization_id,
      object_id
    })

    // Return success response
    return NextResponse.json({ 
      success: true,
      deleted_id: object_id
    })
  } catch (error: any) {
    logger.error("Error deleting catalog object", { error })
    
    // Return more detailed error info if available
    if (error.response && error.response.data) {
      return NextResponse.json({ 
        error: "Error from Square API", 
        details: error.response.data 
      }, { status: 500 })
    }
    
    return NextResponse.json({ error: "Error deleting catalog object" }, { status: 500 })
  }
}