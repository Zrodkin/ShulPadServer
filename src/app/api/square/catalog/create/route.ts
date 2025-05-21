import { NextResponse, type NextRequest } from "next/server"
import axios from "axios"
import { createClient } from "@/lib/db"
import { logger } from "@/lib/logger"
import { v4 as uuidv4 } from "uuid"

// Define interfaces for type safety
interface LineItem {
  catalog_object_id?: string;
  quantity?: string;
  base_price_money?: {
    amount: number;
    currency?: string;
  };
  name?: string;
  total_money?: {
    amount: number;
    currency: string;
  };
}

interface OrderRequest {
  idempotency_key: string;
  order: {
    location_id: string;
    line_items: LineItem[];
    state: string;
    note: string;
    customer_id?: string; // Optional property
  };
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { 
      organization_id, 
      line_items, 
      customer_id = null,
      note = "Donation",
      idempotency_key = uuidv4()
    } = body

    if (!organization_id) {
      logger.error("Organization ID is required for order creation")
      return NextResponse.json({ error: "Organization ID is required" }, { status: 400 })
    }

    if (!line_items || !Array.isArray(line_items) || line_items.length === 0) {
      logger.error("Valid line items array is required", { line_items })
      return NextResponse.json({ error: "Line items must be a non-empty array" }, { status: 400 })
    }

    // Validate line items - each must have either catalog_object_id or base_price_money
    for (const item of line_items as LineItem[]) {
      if (!item.catalog_object_id && (!item.base_price_money || !item.base_price_money.amount)) {
        logger.error("Invalid line item", { item })
        return NextResponse.json({ 
          error: "Each line item must have either catalog_object_id or base_price_money" 
        }, { status: 400 })
      }
      
      // Ensure quantity is provided or set to 1
      if (!item.quantity) {
        item.quantity = "1";
      }
    }

    // Get the access token and location_id from the database
    const db = createClient()
    const result = await db.query(
      "SELECT access_token, location_id FROM square_connections WHERE organization_id = $1",
      [organization_id]
    )

    if (result.rows.length === 0) {
      logger.error("No Square connection found for this organization", { organization_id })
      return NextResponse.json({ error: "Not connected to Square" }, { status: 404 })
    }

    const { access_token, location_id } = result.rows[0]
    
    if (!location_id) {
      logger.error("No location ID found for this organization", { organization_id })
      return NextResponse.json({ error: "No location ID found" }, { status: 400 })
    }
    
    const SQUARE_ENVIRONMENT = process.env.SQUARE_ENVIRONMENT || "sandbox"
    const SQUARE_DOMAIN = SQUARE_ENVIRONMENT === "production" ? "squareup.com" : "squareupsandbox.com"
    const SQUARE_ORDERS_URL = `https://connect.${SQUARE_DOMAIN}/v2/orders`

    // Create the order request with proper typing
    const orderRequest: OrderRequest = {
      idempotency_key,
      order: {
        location_id,
        line_items: line_items as LineItem[],
        state: "OPEN", // Order is ready for payment
        note: note
      }
    }
    
    // Add customer if provided
    if (customer_id) {
      orderRequest.order.customer_id = customer_id
    }

    // Make the request to Square API
    const response = await axios.post(
      SQUARE_ORDERS_URL,
      orderRequest,
      {
        headers: {
          "Square-Version": "2023-09-25",
          "Authorization": `Bearer ${access_token}`,
          "Content-Type": "application/json"
        }
      }
    )

    logger.info("Successfully created order", { 
      organization_id,
      order_id: response.data.order?.id,
      total_money: response.data.order?.total_money
    })

    // Return the created order details with proper typing
    return NextResponse.json({
      order_id: response.data.order?.id,
      total_money: response.data.order?.total_money,
      line_items: response.data.order?.line_items?.map((item: LineItem) => ({
        name: item.name,
        quantity: item.quantity,
        total_money: item.total_money
      }))
    })
  } catch (error: any) {
    logger.error("Error creating order", { error })
    
    // Return more detailed error info if available
    if (error.response && error.response.data) {
      return NextResponse.json({ 
        error: "Error from Square API", 
        details: error.response.data 
      }, { status: 500 })
    }
    
    return NextResponse.json({ error: "Error creating order" }, { status: 500 })
  }
}