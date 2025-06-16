// src/app/api/square/orders/create/route.ts - COMPLETE FIX

import { NextResponse, type NextRequest } from "next/server"
import axios from "axios"
import { createClient } from "@/lib/db"
import { logger } from "@/lib/logger"
import { v4 as uuidv4 } from "uuid"

interface LineItem {
  catalogObjectId?: string;
  quantity?: string;
  basePriceMoney?: {
    amount: number;
    currency?: string;
  };
  name?: string;
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { 
      organization_id, 
      line_items, 
      customer_id = null,
      reference_id = null,
      state = "OPEN",
      idempotency_key = uuidv4(),
      // NEW: Custom amount support
      is_custom_amount = false,
      custom_amount = null
    } = body

    logger.info("Order creation request", { 
      organization_id, 
      is_custom_amount, 
      custom_amount,
      has_line_items: !!line_items 
    })

    if (!organization_id) {
      logger.error("Organization ID is required for order creation")
      return NextResponse.json({ error: "Organization ID is required" }, { status: 400 })
    }

    // Get the access token and location_id from the database
    const db = createClient()
    const result = await db.execute(
      "SELECT access_token, location_id FROM square_connections WHERE organization_id = ?",
      [organization_id]
    )

    if (result.rows.length === 0) {
      logger.error("No Square connection found for this organization", { organization_id })
      return NextResponse.json({ error: "Not connected to Square" }, { status: 404 })
    }

    const { access_token, location_id } = result.rows[0]
    
    const SQUARE_ENVIRONMENT = process.env.SQUARE_ENVIRONMENT || "sandbox"
    const SQUARE_DOMAIN = SQUARE_ENVIRONMENT === "production" ? "squareup.com" : "squareupsandbox.com"
    const SQUARE_ORDERS_URL = `https://connect.${SQUARE_DOMAIN}/v2/orders`

    let processedLineItems: any[] = []

    // Handle custom amounts with proper Square integration
    if (is_custom_amount && custom_amount && custom_amount > 0) {
      logger.info("Processing custom amount order", { custom_amount })
      
      // Method 1: Try to use existing "Custom Amount" variation
      try {
        // First, find the existing Custom Amount variation
        const catalogResponse = await axios.get(
          `https://connect.${SQUARE_DOMAIN}/v2/catalog/list?types=ITEM_VARIATION`,
          {
            headers: {
              "Square-Version": "2025-05-21",
              "Authorization": `Bearer ${access_token}`,
              "Content-Type": "application/json"
            }
          }
        )

        // Look for the Custom Amount variation with VARIABLE_PRICING
        const customAmountVariation = catalogResponse.data.objects?.find((obj: any) => 
          obj.type === "ITEM_VARIATION" && 
          obj.item_variation_data?.name === "Custom Amount" &&
          obj.item_variation_data?.pricing_type === "VARIABLE_PRICING"
        )

        if (customAmountVariation) {
          // SUCCESS: Use existing Custom Amount variation with price override
          processedLineItems.push({
            quantity: "1",
            catalog_object_id: customAmountVariation.id,
            // This is the key: override the price for variable pricing
            base_price_money: {
              amount: Math.round(custom_amount * 100), // Convert to cents
              currency: "USD"
            },
            // Optional: Add a note to identify this as a custom amount
            note: `Custom donation amount: $${custom_amount}`
          })
          
          logger.info("Using existing Custom Amount variation", { 
            variation_id: customAmountVariation.id,
            amount: custom_amount,
            amount_cents: Math.round(custom_amount * 100)
          })
        } else {
          throw new Error("Custom Amount variation not found in catalog")
        }
      } catch (catalogError) {
        logger.warn("Could not use Custom Amount variation, creating ad-hoc item", { 
          error: catalogError instanceof Error ? catalogError.message : catalogError 
        })
        
        // Method 2: Fallback to ad-hoc line item
        processedLineItems.push({
          quantity: "1",
          name: `Custom Donation - $${custom_amount}`,
          base_price_money: {
            amount: Math.round(custom_amount * 100),
            currency: "USD"
          },
          note: "Custom donation amount"
        })
        
        logger.info("Created ad-hoc custom amount item", { 
          amount: custom_amount,
          amount_cents: Math.round(custom_amount * 100)
        })
      }
    } else if (line_items && Array.isArray(line_items) && line_items.length > 0) {
      // Handle regular preset amounts
      logger.info("Processing preset amount order", { line_items_count: line_items.length })
      
      // Validate line items
      for (const item of line_items as LineItem[]) {
        if (!item.catalogObjectId && (!item.basePriceMoney || !item.basePriceMoney.amount || !item.name)) {
          logger.error("Invalid line item", { item })
          return NextResponse.json({ 
            error: "Each line item must have either catalogObjectId or both basePriceMoney and name" 
          }, { status: 400 })
        }
        
        if (!item.quantity) {
          item.quantity = "1";
        }
      }

      // Process regular line items
      processedLineItems = line_items.map((item: LineItem) => {
        const lineItem: any = {
          quantity: item.quantity || "1"
        }

        if (item.catalogObjectId) {
          // Preset donation - reference catalog item
          lineItem.catalog_object_id = item.catalogObjectId
          logger.debug("Using catalog item", { catalog_id: item.catalogObjectId })
        } else {
          // Ad-hoc line item
          lineItem.name = item.name || "Donation"
          lineItem.base_price_money = {
            amount: item.basePriceMoney!.amount,
            currency: item.basePriceMoney!.currency || "USD"
          }
          logger.debug("Using ad-hoc item", { name: lineItem.name, amount: lineItem.base_price_money.amount })
        }

        return lineItem
      })
    } else {
      // No valid line items provided
      logger.error("No valid line items or custom amount provided")
      return NextResponse.json({ 
        error: "Either line_items or custom_amount must be provided" 
      }, { status: 400 })
    }

    // Create the order request
    const orderRequest = {
      idempotency_key,
      order: {
        location_id: location_id,
        line_items: processedLineItems,
        state: state,
        ...(customer_id && { customer_id }),
        ...(reference_id && { reference_id })
      }
    }

    logger.info("Creating Square order", { 
      organization_id,
      line_items_count: processedLineItems.length,
      is_custom_amount,
      custom_amount,
      state,
      location_id
    })

    // Make the request to Square API
    const response = await axios.post(
      SQUARE_ORDERS_URL,
      orderRequest,
      {
        headers: {
          "Square-Version": "2025-05-21",
          "Authorization": `Bearer ${access_token}`,
          "Content-Type": "application/json"
        }
      }
    )

    const order = response.data.order

    logger.info("Successfully created order", { 
      organization_id,
      order_id: order?.id,
      total_money: order?.totalMoney,
      state: order?.state,
      line_items_created: order?.lineItems?.length
    })

    // Return formatted response
    return NextResponse.json({
      success: true,
      order_id: order?.id,
      state: order?.state,
      total_money: order?.totalMoney,
      line_items: order?.lineItems?.map((item: any) => ({
        uid: item.uid,
        name: item.name,
        quantity: item.quantity,
        total_money: item.totalMoney,
        catalog_object_id: item.catalogObjectId || null,
        base_price_money: item.basePriceMoney,
        is_custom_amount: is_custom_amount && custom_amount > 0
      })),
      location_id: order?.locationId,
      created_at: order?.createdAt,
      updated_at: order?.updatedAt
    })

  } catch (error: any) {
    logger.error("Error creating order", { error: error.message || error })
    
    // Handle Square API specific errors
    if (error.response?.data?.errors) {
      const squareErrors = error.response.data.errors
      logger.error("Square API errors", { errors: squareErrors })
      
      const firstError = squareErrors[0]
      return NextResponse.json({ 
        success: false,
        error: firstError.detail || firstError.code,
        square_error: {
          category: firstError.category,
          code: firstError.code,
          detail: firstError.detail,
          field: firstError.field
        },
        square_errors: squareErrors
      }, { status: error.response.status })
    }
    
    return NextResponse.json({ 
      success: false,
      error: "Error creating order",
      details: error.message 
    }, { status: 500 })
  }
}