import { NextResponse, type NextRequest } from "next/server"
import axios from "axios"
import { createClient } from "@/lib/db"
import { logger } from "@/lib/logger"
import { v4 as uuidv4 } from "uuid"

// Define interfaces for type safety
interface CreatePaymentRequest {
  organization_id: string;
  order_id: string;
  payment_token: string;
  amount: number; // In dollars
  idempotency_key?: string;
  tip_amount?: number; // In dollars
  customer_id?: string;
  reference_id?: string;
  note?: string;
}

interface SquareError {
  category: string;
  code: string;
  detail?: string;
  field?: string;
}

export async function POST(request: NextRequest) {
  try {
    const body: CreatePaymentRequest = await request.json()
    const { 
      organization_id, 
      order_id,
      payment_token,
      amount,
      idempotency_key = uuidv4(),
      tip_amount = 0,
      customer_id,
      reference_id,
      note
    } = body

    // Validate required fields
    if (!organization_id) {
      logger.error("Organization ID is required for payment processing")
      return NextResponse.json({ error: "Organization ID is required" }, { status: 400 })
    }

    if (!order_id) {
      logger.error("Order ID is required for payment processing")
      return NextResponse.json({ error: "Order ID is required" }, { status: 400 })
    }

    if (!payment_token) {
      logger.error("Payment token is required for payment processing")
      return NextResponse.json({ error: "Payment token is required" }, { status: 400 })
    }

    if (!amount || amount <= 0) {
      logger.error("Valid payment amount is required", { amount })
      return NextResponse.json({ error: "Valid payment amount is required" }, { status: 400 })
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
    const SQUARE_PAYMENTS_URL = `https://connect.${SQUARE_DOMAIN}/v2/payments`

    // Convert amounts to cents (Square expects amounts in smallest currency unit)
    const amountMoney = {
      amount: Math.round(amount * 100),
      currency: "USD"
    }

    const tipMoney = tip_amount > 0 ? {
      amount: Math.round(tip_amount * 100), 
      currency: "USD"
    } : undefined

    // Create the payment request according to Square API
    const createPaymentRequest = {
      idempotency_key,
      source_id: payment_token,
      amount_money: amountMoney,
      order_id: order_id,
      location_id: location_id,
      autocomplete: true, // Complete payment immediately (standard for donations)
      ...(tipMoney && { tip_money: tipMoney }),
      ...(customer_id && { customer_id }),
      ...(reference_id && { reference_id }),
      ...(note && { note })
    }

    logger.info("Creating Square payment with order", { 
      organization_id,
      order_id,
      amount_cents: amountMoney.amount,
      has_tip: !!tipMoney,
      has_customer: !!customer_id
    })

    // Make the request to Square Payments API
    const response = await axios.post(
      SQUARE_PAYMENTS_URL,
      createPaymentRequest,
      {
        headers: {
          "Square-Version": "2025-05-21", // Latest API version
          "Authorization": `Bearer ${access_token}`,
          "Content-Type": "application/json"
        }
      }
    )

    const payment = response.data.payment

    // Log successful payment
    logger.info("Successfully created payment", { 
      organization_id,
      payment_id: payment.id,
      order_id: payment.order_id,
      status: payment.status,
      amount_money: payment.amount_money,
      total_money: payment.total_money
    })

    // Store payment record for tracking (optional - for your internal records)
    try {
      await db.execute(
        `INSERT INTO payment_records (
          organization_id, 
          square_payment_id,
          square_order_id,
          amount_cents,
          tip_cents,
          status,
          payment_data,
          created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, NOW())`,
        [
          organization_id,
          payment.id,
          payment.order_id,
          payment.amount_money.amount,
          payment.tip_money?.amount || 0,
          payment.status,
          JSON.stringify(payment)
        ]
      )
    } catch (dbError) {
      // Don't fail the payment if logging fails
      logger.warn("Failed to log payment record", { error: dbError, payment_id: payment.id })
    }

    // Return successful payment response
    return NextResponse.json({
      success: true,
      payment_id: payment.id,
      order_id: payment.order_id,
      status: payment.status,
      amount_money: payment.amount_money,
      total_money: payment.total_money,
      tip_money: payment.tip_money,
      receipt_url: payment.receipt_url,
      receipt_number: payment.receipt_number,
      created_at: payment.created_at,
      card_details: payment.card_details ? {
        last_4: payment.card_details.card?.last_4,
        card_brand: payment.card_details.card?.card_brand,
        entry_method: payment.card_details.entry_method
      } : null
    })

  } catch (error: any) {
    logger.error("Error creating payment", { error })
    
    // Handle Square API specific errors
    if (error.response?.data?.errors) {
      const squareErrors: SquareError[] = error.response.data.errors
      logger.error("Square API payment errors", { errors: squareErrors })
      
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
    
    return NextResponse.json({ 
      error: "Error processing payment",
      details: error.message 
    }, { status: 500 })
  }
}