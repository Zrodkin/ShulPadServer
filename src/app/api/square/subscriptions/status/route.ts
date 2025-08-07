// app/api/square/subscriptions/status/[id]/route.ts
import { NextResponse, type NextRequest } from "next/server"
import axios from "axios"
import { createClient } from "@/lib/db"
import { logger } from "@/lib/logger"
import { v4 as uuidv4 } from "uuid"

interface SquareError {
  category: string
  code: string
  detail?: string
  field?: string
}

// GET - Check subscription status
export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const subscriptionId = params.id
    const searchParams = request.nextUrl.searchParams
    const organizationId = searchParams.get("organization_id")

    if (!subscriptionId) {
      logger.error("Subscription ID is required")
      return NextResponse.json({ error: "Subscription ID is required" }, { status: 400 })
    }

    if (!organizationId) {
      logger.error("Organization ID is required")
      return NextResponse.json({ error: "Organization ID is required" }, { status: 400 })
    }

    // Get the access token from the database
    const db = createClient()
    const result = await db.execute(
      "SELECT access_token FROM square_connections WHERE organization_id = ?",
      [organizationId]
    )

    if (result.rows.length === 0) {
      logger.error("No Square connection found for this organization", { organization_id: organizationId })
      return NextResponse.json({ error: "Not connected to Square" }, { status: 404 })
    }

    const { access_token } = result.rows[0]
    
    const SQUARE_ENVIRONMENT = process.env.SQUARE_ENVIRONMENT || "sandbox"
    const SQUARE_DOMAIN = SQUARE_ENVIRONMENT === "production" ? "squareup.com" : "squareupsandbox.com"
    
    logger.info("Retrieving subscription status", { 
      subscription_id: subscriptionId,
      organization_id: organizationId
    })

    // Retrieve subscription from Square
    try {
      const subscriptionUrl = `https://connect.${SQUARE_DOMAIN}/v2/subscriptions/${subscriptionId}`
      const subscriptionResponse = await axios.get(
        subscriptionUrl,
        {
          headers: {
            "Square-Version": "2025-07-16",
            "Authorization": `Bearer ${access_token}`,
            "Content-Type": "application/json"
          }
        }
      )

      const subscription = subscriptionResponse.data.subscription
      
      // Get customer details for more info
      let customerEmail = null
      let customerName = null
      try {
        const customerUrl = `https://connect.${SQUARE_DOMAIN}/v2/customers/${subscription.customer_id}`
        const customerResponse = await axios.get(customerUrl, {
          headers: {
            "Square-Version": "2025-07-16",
            "Authorization": `Bearer ${access_token}`,
            "Content-Type": "application/json"
          }
        })
        
        const customer = customerResponse.data.customer
        customerEmail = customer.email_address
        customerName = [customer.given_name, customer.family_name]
          .filter(Boolean)
          .join(" ") || null
      } catch (customerError) {
        logger.warn("Could not fetch customer details", { error: customerError })
      }

      // Get next billing date from upcoming invoice
      let nextBillingDate = null
      let nextBillingAmount = null
      if (subscription.status === "ACTIVE" && subscription.invoice_ids && subscription.invoice_ids.length > 0) {
        try {
          // Get the most recent invoice
          const invoiceId = subscription.invoice_ids[subscription.invoice_ids.length - 1]
          const invoiceUrl = `https://connect.${SQUARE_DOMAIN}/v2/invoices/${invoiceId}`
          const invoiceResponse = await axios.get(invoiceUrl, {
            headers: {
              "Square-Version": "2025-07-16",
              "Authorization": `Bearer ${access_token}`,
              "Content-Type": "application/json"
            }
          })
          
          const invoice = invoiceResponse.data.invoice
          if (invoice.status === "SCHEDULED" || invoice.status === "PENDING") {
            nextBillingDate = invoice.scheduled_at
            nextBillingAmount = invoice.payment_requests?.[0]?.computed_amount_money?.amount
          }
        } catch (invoiceError) {
          logger.warn("Could not fetch invoice details", { error: invoiceError })
        }
      }

      // Get plan details to show donation amount
      let donationAmount = null
      try {
        const catalogUrl = `https://connect.${SQUARE_DOMAIN}/v2/catalog/object/${subscription.plan_variation_id}`
        const catalogResponse = await axios.get(catalogUrl, {
          headers: {
            "Square-Version": "2025-07-16",
            "Authorization": `Bearer ${access_token}`,
            "Content-Type": "application/json"
          }
        })
        
        const planVariation = catalogResponse.data.object
        if (planVariation?.subscription_plan_variation_data?.phases?.[0]?.pricing?.price?.amount) {
          donationAmount = planVariation.subscription_plan_variation_data.phases[0].pricing.price.amount
        }
      } catch (catalogError) {
        logger.warn("Could not fetch plan details", { error: catalogError })
      }

      // Format the response
      const response = {
        subscription_id: subscription.id,
        status: subscription.status,
        customer_id: subscription.customer_id,
        customer_email: customerEmail,
        customer_name: customerName,
        plan_variation_id: subscription.plan_variation_id,
        donation_amount_cents: donationAmount,
        donation_amount: donationAmount ? (donationAmount / 100).toFixed(2) : null,
        start_date: subscription.start_date,
        created_at: subscription.created_at,
        canceled_date: subscription.canceled_date || null,
        next_billing_date: nextBillingDate,
        next_billing_amount_cents: nextBillingAmount,
        next_billing_amount: nextBillingAmount ? (nextBillingAmount / 100).toFixed(2) : null,
        card_id: subscription.card_id,
        actions: subscription.actions || [],
        can_cancel: subscription.status === "ACTIVE" || subscription.status === "PENDING"
      }

      logger.info("Retrieved subscription status", {
        subscription_id: subscription.id,
        status: subscription.status
      })

      return NextResponse.json(response)

    } catch (fetchError: any) {
      if (fetchError.response?.status === 404) {
        return NextResponse.json({ 
          error: "Subscription not found",
          subscription_id: subscriptionId 
        }, { status: 404 })
      }
      
      throw fetchError
    }

  } catch (error: any) {
    logger.error("Error retrieving subscription status", { error })
    
    if (error.response?.data?.errors) {
      const squareErrors: SquareError[] = error.response.data.errors
      const firstError = squareErrors[0]
      return NextResponse.json({ 
        error: firstError.detail || firstError.code,
        square_errors: squareErrors
      }, { status: error.response.status })
    }
    
    return NextResponse.json({ 
      error: "Error retrieving subscription status",
      details: error.message 
    }, { status: 500 })
  }
}

// DELETE - Cancel subscription
export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const subscriptionId = params.id
    const body = await request.json()
    const { organization_id, reason } = body

    if (!subscriptionId) {
      logger.error("Subscription ID is required for cancellation")
      return NextResponse.json({ error: "Subscription ID is required" }, { status: 400 })
    }

    if (!organization_id) {
      logger.error("Organization ID is required for cancellation")
      return NextResponse.json({ error: "Organization ID is required" }, { status: 400 })
    }

    // Get the access token from the database
    const db = createClient()
    const result = await db.execute(
      "SELECT access_token FROM square_connections WHERE organization_id = ?",
      [organization_id]
    )

    if (result.rows.length === 0) {
      logger.error("No Square connection found for this organization", { organization_id })
      return NextResponse.json({ error: "Not connected to Square" }, { status: 404 })
    }

    const { access_token } = result.rows[0]
    
    const SQUARE_ENVIRONMENT = process.env.SQUARE_ENVIRONMENT || "sandbox"
    const SQUARE_DOMAIN = SQUARE_ENVIRONMENT === "production" ? "squareup.com" : "squareupsandbox.com"
    
    logger.info("Canceling subscription", { 
      subscription_id: subscriptionId,
      organization_id,
      reason
    })

    // Cancel the subscription
    try {
      const cancelUrl = `https://connect.${SQUARE_DOMAIN}/v2/subscriptions/${subscriptionId}/cancel`
      const cancelResponse = await axios.post(
        cancelUrl,
        {}, // Empty body - Square doesn't require any data for cancellation
        {
          headers: {
            "Square-Version": "2025-07-16",
            "Authorization": `Bearer ${access_token}`,
            "Content-Type": "application/json"
          }
        }
      )

      const subscription = cancelResponse.data.subscription
      const actions = cancelResponse.data.actions || []
      
      logger.info("Successfully canceled subscription", {
        subscription_id: subscription.id,
        status: subscription.status,
        canceled_date: subscription.canceled_date
      })

      // Update database record
      try {
        await db.execute(
          `UPDATE donor_subscriptions 
           SET status = ?, canceled_date = ?, updated_at = NOW()
           WHERE square_subscription_id = ?`,
          ["CANCELED", subscription.canceled_date || new Date().toISOString(), subscriptionId]
        )

        // Also log the cancellation reason if provided
        if (reason) {
          await db.execute(
            `INSERT INTO subscription_events 
             (organization_id, subscription_id, event_type, event_data, created_at)
             VALUES (?, ?, 'CANCELLATION', ?, NOW())`,
            [organization_id, subscriptionId, JSON.stringify({ reason })]
          )
        }
      } catch (dbError) {
        logger.warn("Failed to update subscription record", { error: dbError })
      }

      return NextResponse.json({
        success: true,
        subscription_id: subscription.id,
        status: subscription.status,
        canceled_date: subscription.canceled_date,
        effective_date: actions[0]?.effective_date || subscription.canceled_date,
        message: "Monthly donation subscription has been canceled"
      })

    } catch (cancelError: any) {
      if (cancelError.response?.status === 404) {
        return NextResponse.json({ 
          error: "Subscription not found",
          subscription_id: subscriptionId 
        }, { status: 404 })
      }

      if (cancelError.response?.data?.errors) {
        const squareErrors: SquareError[] = cancelError.response.data.errors
        
        // Check if subscription is already canceled
        const alreadyCanceled = squareErrors.some(err => 
          err.code === 'INVALID_REQUEST_ERROR' && 
          err.detail?.includes('already canceled')
        )
        
        if (alreadyCanceled) {
          return NextResponse.json({
            success: false,
            error: "Subscription is already canceled",
            subscription_id: subscriptionId
          }, { status: 400 })
        }
        
        const firstError = squareErrors[0]
        return NextResponse.json({ 
          error: firstError.detail || firstError.code,
          square_errors: squareErrors
        }, { status: cancelError.response.status })
      }
      
      throw cancelError
    }

  } catch (error: any) {
    logger.error("Error canceling subscription", { error })
    
    return NextResponse.json({ 
      error: "Error canceling subscription",
      details: error.message 
    }, { status: 500 })
  }
}