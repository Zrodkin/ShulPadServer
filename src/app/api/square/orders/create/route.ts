import { NextResponse, type NextRequest } from "next/server"
import axios from "axios"
import { createClient } from "@/lib/db"
import { logger } from "@/lib/logger"
import { v4 as uuidv4 } from "uuid"

// Define interfaces for type safety
interface LineItem {
  catalogObjectId?: string;
  quantity?: string;
  basePriceMoney?: {
    amount: number;
    currency?: string;
  };
  name?: string;
}

interface OrderRequest {
  idempotencyKey: string;
  order: {
    locationId: string;
    lineItems: LineItem[];
    state?: string;
    referenceId?: string;
    customerId?: string;
  };
}

interface SquareError {
  category: string;
  code: string;
  detail?: string;
  field?: string;
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { 
      organization_id, 
      line_items, 
      customer_id = null,
      reference_id = null,
      state = "OPEN", // Default to OPEN for immediate payment processing
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

    // Validate line items - each must have either catalogObjectId or basePriceMoney + name
    for (const item of line_items as LineItem[]) {
      if (!item.catalogObjectId && (!item.basePriceMoney || !item.basePriceMoney.amount || !item.name)) {
        logger.error("Invalid line item", { item })
        return NextResponse.json({ 
          error: "Each line item must have either catalogObjectId or both basePriceMoney and name for ad-hoc items" 
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

    // Create the order request with proper typing and latest API structure
    const orderRequest: OrderRequest = {
      idempotencyKey: idempotency_key,
      order: {
        locationId: location_id,
        lineItems: line_items.map((item: LineItem) => {
          // Format line item according to Square's API
          const lineItem: any = {
            quantity: item.quantity || "1"
          }

          if (item.catalogObjectId) {
            // Preset donation - reference catalog item
            lineItem.catalogObjectId = item.catalogObjectId
          } else {
            // Custom donation - ad-hoc line item
            lineItem.name = item.name
            lineItem.basePriceMoney = {
              amount: item.basePriceMoney!.amount,
              currency: item.basePriceMoney!.currency || "USD"
            }
          }

          return lineItem
        }),
        state: state
      }
    }
    
    // Add optional fields if provided
    if (customer_id) {
      orderRequest.order.customerId = customer_id
    }
    
    if (reference_id) {
      orderRequest.order.referenceId = reference_id
    }

    logger.info("Creating Square order", { 
      organization_id,
      line_items_count: line_items.length,
      state,
      has_customer: !!customer_id
    })

    // Make the request to Square API with latest version
    const response = await axios.post(
      SQUARE_ORDERS_URL,
      orderRequest,
      {
        headers: {
          "Square-Version": "2025-05-21", // Latest API version
          "Authorization": `Bearer ${access_token}`,
          "Content-Type": "application/json"
        }
      }
    )

    logger.info("Successfully created order", { 
      organization_id,
      order_id: response.data.order?.id,
      total_money: response.data.order?.totalMoney,
      state: response.data.order?.state
    })

    // Return the created order details with clean structure
    return NextResponse.json({
      order_id: response.data.order?.id,
      state: response.data.order?.state,
      total_money: response.data.order?.totalMoney,
      line_items: response.data.order?.lineItems?.map((item: any) => ({
        uid: item.uid,
        name: item.name,
        quantity: item.quantity,
        total_money: item.totalMoney,
        catalog_object_id: item.catalogObjectId || null
      })),
      location_id: response.data.order?.locationId,
      created_at: response.data.order?.createdAt,
      updated_at: response.data.order?.updatedAt
    })

  } catch (error: any) {
    logger.error("Error creating order", { error })
    
    // Handle Square API specific errors with proper structure
    if (error.response?.data?.errors) {
      const squareErrors: SquareError[] = error.response.data.errors
      logger.error("Square API errors", { errors: squareErrors })
      
      // Return first error with Square's standard format
      const firstError = squareErrors[0]
      return NextResponse.json({ 
        error: firstError.detail || firstError.code,
        square_error: {
          category: firstError.category,
          code: firstError.code,
          detail: firstError.detail,
          field: firstError.field
        },
        square_errors: squareErrors // Include all errors for debugging
      }, { status: error.response.status })
    }
    
    return NextResponse.json({ error: "Error creating order" }, { status: 500 })
  }
}