// app/api/square/webhooks/route.ts
// THIS IS YOUR COMPLETE UPDATED WEBHOOK FILE - REPLACE YOUR EXISTING FILE WITH THIS

import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/db"
import { logger } from "@/lib/logger"
import { createHmac } from "crypto"

// Define webhook event types
interface WebhookEvent {
  merchant_id?: string;
  location_id?: string;
  event_id: string;
  created_at: string;
  type: string;
  data: {
    type?: string;
    id?: string;
    object?: any;
  };
}

interface WebhookPayload {
  merchant_id?: string;
  location_id?: string;
  event_id: string;
  created_at: string;
  type: string;
  data: any;
}

// Webhook signature verification
function verifyWebhookSignature(body: string, signature: string, webhookSignatureKey: string): boolean {
  try {
    // Square webhook signature format: "sha1=<hash>"
    if (!signature.startsWith('sha1=')) {
      return false
    }
    
    const hash = signature.substring(5) // Remove "sha1=" prefix
    const expectedHash = createHmac('sha1', webhookSignatureKey)
      .update(body, 'utf8')
      .digest('hex')
    
    return hash === expectedHash
  } catch (error) {
    logger.error("Error verifying webhook signature", { error })
    return false
  }
}

export async function POST(request: NextRequest) {
  try {
    // Get the raw body for signature verification
    const rawBody = await request.text()
    
    // Parse the JSON body
    let webhookEvent: WebhookEvent
    try {
      webhookEvent = JSON.parse(rawBody)
    } catch (error) {
      logger.error("Invalid JSON in webhook payload", { error })
      return NextResponse.json({ error: "Invalid JSON payload" }, { status: 400 })
    }

    // Get signature from headers
    const signature = request.headers.get('x-square-signature')
    const webhookSignatureKey = process.env.SQUARE_WEBHOOK_SIGNATURE_KEY

    // Verify signature if we have the signature key configured
    if (webhookSignatureKey && signature) {
      if (!verifyWebhookSignature(rawBody, signature, webhookSignatureKey)) {
        logger.warn("Invalid webhook signature", { 
          event_type: webhookEvent.type,
          event_id: webhookEvent.event_id 
        })
        return NextResponse.json({ error: "Invalid signature" }, { status: 401 })
      }
      logger.debug("Webhook signature verified successfully")
    } else if (process.env.NODE_ENV === "production") {
      logger.warn("Webhook signature verification skipped - signature key not configured", {
        has_signature: !!signature,
        has_key: !!webhookSignatureKey
      })
    }

    logger.info("Received Square webhook", { 
      type: webhookEvent.type,
      event_id: webhookEvent.event_id,
      merchant_id: webhookEvent.merchant_id,
      created_at: webhookEvent.created_at
    })

    const db = createClient()

    // Handle different webhook event types
    switch (webhookEvent.type) {
      case 'oauth.authorization.revoked':
        await handleOAuthRevocation(db, webhookEvent)
        break
        
      case 'catalog.version.updated':
        await handleCatalogUpdate(db, webhookEvent)
        break
        
      case 'inventory.count.updated':
        await handleInventoryUpdate(db, webhookEvent)
        break
        
      case 'payment.created':
      case 'payment.updated':
        await handlePaymentEvent(db, webhookEvent)
        break
        
      case 'order.created':
      case 'order.updated':
      case 'order.paid':
      case 'order.fulfilled':
        await handleOrderEvent(db, webhookEvent)
        break
        
      // ===== NEW: SUBSCRIPTION EVENTS =====
      case 'subscription.created':
      case 'subscription.updated':
      case 'subscription.canceled':
      case 'subscription.paused':
      case 'subscription.resumed':
        await handleSubscriptionEvent(db, webhookEvent)
        break
        
      // ===== UPDATED: INVOICE EVENTS (for subscription billing) =====
      case 'invoice.created':
      case 'invoice.updated':
      case 'invoice.payment_made':
      case 'invoice.canceled':
        await handleInvoiceEvent(db, webhookEvent)
        break
        
      default:
        logger.info("Unhandled webhook event type", { 
          type: webhookEvent.type,
          event_id: webhookEvent.event_id 
        })
        // Still return success for unhandled events
        break
    }

    // Log the webhook event for auditing
    try {
      await db.execute(
        `INSERT INTO webhook_events (
  event_id, event_type, merchant_id, location_id, 
  created_at, processed_at, payload
) VALUES (?, ?, ?, ?, ?, NOW(), ?)
ON DUPLICATE KEY UPDATE 
  processed_at = NOW(), 
  payload = VALUES(payload)`,
        [
          webhookEvent.event_id,
          webhookEvent.type,
          webhookEvent.merchant_id,
          webhookEvent.location_id,
          webhookEvent.created_at,
          JSON.stringify(webhookEvent)
        ]
      )
    } catch (dbError) {
      // Don't fail the webhook if logging fails
      logger.error("Failed to log webhook event", { error: dbError, event_id: webhookEvent.event_id })
    }

    return NextResponse.json({ received: true, event_id: webhookEvent.event_id })
    
  } catch (error) {
    logger.error("Webhook processing error", { error })
    return NextResponse.json(
      { error: "Failed to process webhook", received: false },
      { status: 500 }
    )
  }
}

// ========================================
// EXISTING HANDLERS (unchanged)
// ========================================

// Handler for OAuth authorization revocation
async function handleOAuthRevocation(db: any, event: WebhookEvent) {
  logger.warn("OAuth authorization revoked", { 
    merchant_id: event.merchant_id,
    event_id: event.event_id 
  })
  
  try {
    // Find and deactivate the connection
    const result = await db.execute(
      "UPDATE square_connections SET is_active = false, revoked_at = NOW() WHERE merchant_id = ?",
      [event.merchant_id]
    )
    
    if (result.rowCount > 0) {
      logger.info("Deactivated Square connection due to revocation", { 
        merchant_id: event.merchant_id 
      })
      
      // TODO: Notify the application/user about the revocation
      // This could involve:
      // - Sending push notifications to mobile apps
      // - Updating real-time dashboards
      // - Sending email notifications to administrators
    }
  } catch (error) {
    logger.error("Failed to handle OAuth revocation", { error, merchant_id: event.merchant_id })
  }
}

// Handler for catalog updates
async function handleCatalogUpdate(db: any, event: WebhookEvent) {
  logger.info("Catalog updated", { 
    merchant_id: event.merchant_id,
    event_id: event.event_id 
  })
  
  try {
    // Update the last catalog sync time for relevant organizations
    await db.execute(
      "UPDATE square_connections SET last_catalog_sync = NOW() WHERE merchant_id = ?",
      [event.merchant_id]
    )
    
    // TODO: Notify applications about catalog changes
    // This could trigger:
    // - Refreshing cached catalog data
    // - Updating kiosk displays
    // - Syncing with internal inventory systems
  } catch (error) {
    logger.error("Failed to handle catalog update", { error, merchant_id: event.merchant_id })
  }
}

// Handler for inventory updates
async function handleInventoryUpdate(db: any, event: WebhookEvent) {
  logger.info("Inventory updated", { 
    merchant_id: event.merchant_id,
    location_id: event.location_id,
    event_id: event.event_id 
  })
  
  // TODO: Handle inventory changes if relevant to your donation app
  // For donation apps, this might not be directly relevant unless
  // you're tracking "inventory" of donation items
}

// Handler for payment events
async function handlePaymentEvent(db: any, event: WebhookEvent) {
  const paymentId = event.data?.id
  
  logger.info("Payment event received", { 
    type: event.type,
    payment_id: paymentId,
    merchant_id: event.merchant_id,
    event_id: event.event_id 
  })
  
  try {
    // Log payment events for donation tracking
    await db.execute(
      `INSERT INTO payment_events (
  payment_id, event_type, merchant_id, location_id,
  event_data, created_at
) VALUES (?, ?, ?, ?, ?, ?)
ON DUPLICATE KEY UPDATE
  event_data = VALUES(event_data), updated_at = NOW()`,
      [
        paymentId,
        event.type,
        event.merchant_id,
        event.location_id,
        JSON.stringify(event.data),
        event.created_at
      ]
    )
    
    // TODO: Handle payment-specific logic
    // - Update donation records
    // - Send thank you emails
    // - Update reporting dashboards
    // - Trigger receipt generation
  } catch (error) {
    logger.error("Failed to handle payment event", { error, payment_id: paymentId })
  }
}

// Handler for order events
async function handleOrderEvent(db: any, event: WebhookEvent) {
  const orderId = event.data?.id
  
  logger.info("Order event received", { 
    type: event.type,
    order_id: orderId,
    merchant_id: event.merchant_id,
    event_id: event.event_id 
  })
  
  try {
    // Log order events for donation tracking
    await db.execute(
      `INSERT INTO order_events (
  order_id, event_type, merchant_id, location_id,
  event_data, created_at
) VALUES (?, ?, ?, ?, ?, ?)
ON DUPLICATE KEY UPDATE
  event_data = VALUES(event_data), updated_at = NOW()`,
      [
        orderId,
        event.type,
        event.merchant_id,
        event.location_id,
        JSON.stringify(event.data),
        event.created_at
      ]
    )
    
    // TODO: Handle order-specific logic for donations
    // - Update order status in local database
    // - Trigger fulfillment processes
    // - Send confirmation emails
  } catch (error) {
    logger.error("Failed to handle order event", { error, order_id: orderId })
  }
}

// ========================================
// NEW HANDLERS FOR SUBSCRIPTIONS
// ========================================

// Handler for subscription events
async function handleSubscriptionEvent(db: any, event: WebhookEvent) {
  const subscription = event.data?.object?.subscription
  
  if (!subscription) {
    logger.warn("Subscription event missing subscription data", { event_id: event.event_id })
    return
  }

  logger.info("Processing subscription event", {
    type: event.type,
    subscription_id: subscription.id,
    status: subscription.status,
    customer_id: subscription.customer_id
  })

  try {
    // Log the event in subscription_events table
    await db.execute(
      `INSERT INTO subscription_events 
       (square_subscription_id, event_type, event_data, webhook_event_id, processed_at)
       VALUES (?, ?, ?, ?, NOW())
       ON DUPLICATE KEY UPDATE processed_at = NOW()`,
      [
        subscription.id,
        event.type,
        JSON.stringify(subscription),
        event.event_id
      ]
    )

    // Update subscription status in donor_subscriptions table
    switch (event.type) {
      case 'subscription.created':
        await db.execute(
          `UPDATE donor_subscriptions 
           SET status = ?, start_date = ?, updated_at = NOW()
           WHERE square_subscription_id = ?`,
          [subscription.status, subscription.start_date, subscription.id]
        )
        logger.info("Subscription created and status updated", { 
          subscription_id: subscription.id 
        })
        break
        
      case 'subscription.updated':
        await db.execute(
          `UPDATE donor_subscriptions 
           SET status = ?, updated_at = NOW()
           WHERE square_subscription_id = ?`,
          [subscription.status, subscription.id]
        )
        logger.info("Subscription status updated", { 
          subscription_id: subscription.id,
          status: subscription.status 
        })
        break
        
      case 'subscription.canceled':
        await db.execute(
          `UPDATE donor_subscriptions 
           SET status = 'CANCELED', 
               canceled_at = NOW(), 
               cancel_reason = ?,
               updated_at = NOW()
           WHERE square_subscription_id = ?`,
          [subscription.canceled_reason || 'Canceled', subscription.id]
        )
        logger.info("Subscription canceled", { 
          subscription_id: subscription.id 
        })
        break
        
      case 'subscription.paused':
        await db.execute(
          `UPDATE donor_subscriptions 
           SET status = 'PAUSED', updated_at = NOW()
           WHERE square_subscription_id = ?`,
          [subscription.id]
        )
        logger.info("Subscription paused", { 
          subscription_id: subscription.id 
        })
        break
        
      case 'subscription.resumed':
        await db.execute(
          `UPDATE donor_subscriptions 
           SET status = 'ACTIVE', updated_at = NOW()
           WHERE square_subscription_id = ?`,
          [subscription.id]
        )
        logger.info("Subscription resumed", { 
          subscription_id: subscription.id 
        })
        break
    }
  } catch (error) {
    logger.error("Error handling subscription event", { 
      error, 
      event_type: event.type,
      subscription_id: subscription.id 
    })
  }
}

// UPDATED Handler for invoice events (now handles subscription invoices)
async function handleInvoiceEvent(db: any, event: WebhookEvent) {
  const invoice = event.data?.object?.invoice
  
  if (!invoice) {
    logger.warn("Invoice event missing invoice data", { event_id: event.event_id })
    return
  }

  // Check if this invoice is related to a subscription
  if (!invoice.subscription_id) {
    logger.info("Invoice not related to subscription, skipping detailed handling", { 
      invoice_id: invoice.id 
    })
    // You can still log it for general invoice tracking if needed
    return
  }

  logger.info("Processing subscription invoice event", {
    type: event.type,
    invoice_id: invoice.id,
    subscription_id: invoice.subscription_id,
    status: invoice.status
  })

  try {
    // Get organization_id from the subscription
    const subResult = await db.execute(
      `SELECT organization_id, donor_email, donor_name, amount_cents 
       FROM donor_subscriptions 
       WHERE square_subscription_id = ?`,
      [invoice.subscription_id]
    )

    if (subResult.rows.length === 0) {
      logger.warn("No subscription found for invoice", { 
        invoice_id: invoice.id,
        subscription_id: invoice.subscription_id 
      })
      return
    }

    const { organization_id, donor_email, donor_name, amount_cents } = subResult.rows[0]

    switch (event.type) {
      case 'invoice.created':
        // Store the new invoice
        await db.execute(
          `INSERT INTO subscription_invoices 
           (organization_id, square_subscription_id, square_invoice_id, 
            amount_cents, currency, status, scheduled_at, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, NOW())
           ON DUPLICATE KEY UPDATE 
            status = VALUES(status),
            updated_at = NOW()`,
          [
            organization_id,
            invoice.subscription_id,
            invoice.id,
            invoice.payment_requests?.[0]?.computed_amount_money?.amount || amount_cents,
            invoice.payment_requests?.[0]?.computed_amount_money?.currency || 'USD',
            invoice.status,
            invoice.scheduled_at
          ]
        )
        logger.info("Subscription invoice created", { 
          invoice_id: invoice.id 
        })
        break
        
      case 'invoice.updated':
        // Update invoice status
        await db.execute(
          `UPDATE subscription_invoices 
           SET status = ?, updated_at = NOW()
           WHERE square_invoice_id = ?`,
          [invoice.status, invoice.id]
        )
        logger.info("Subscription invoice updated", { 
          invoice_id: invoice.id,
          status: invoice.status 
        })
        break
        
      case 'invoice.payment_made':
        // Mark invoice as paid
        await db.execute(
          `UPDATE subscription_invoices 
           SET status = 'PAID', 
               paid_at = NOW(),
               square_payment_id = ?,
               updated_at = NOW()
           WHERE square_invoice_id = ?`,
          [invoice.payment_ids?.[0] || null, invoice.id]
        )
        
        // Create a donation record for the recurring payment
        await db.execute(
          `INSERT INTO donations 
           (organization_id, amount, currency, donor_name, donor_email, 
            square_payment_id, status, is_recurring, created_at)
           VALUES (?, ?, ?, ?, ?, ?, 'completed', true, NOW())`,
          [
            organization_id,
            amount_cents / 100, // Convert cents to dollars
            'USD',
            donor_name,
            donor_email,
            invoice.payment_ids?.[0] || null
          ]
        )
        
        logger.info("Subscription payment successful and donation recorded", {
          invoice_id: invoice.id,
          subscription_id: invoice.subscription_id,
          amount: amount_cents / 100
        })
        break
        
      case 'invoice.canceled':
        // Mark invoice as canceled
        await db.execute(
          `UPDATE subscription_invoices 
           SET status = 'CANCELED', updated_at = NOW()
           WHERE square_invoice_id = ?`,
          [invoice.id]
        )
        logger.info("Subscription invoice canceled", { 
          invoice_id: invoice.id 
        })
        break
    }
  } catch (error) {
    logger.error("Error handling invoice event", { 
      error, 
      event_type: event.type,
      invoice_id: invoice.id 
    })
  }
}