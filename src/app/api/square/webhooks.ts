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
        
      case 'invoice.created':
      case 'invoice.updated':
      case 'invoice.payment_made':
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
      await db.query(
        `INSERT INTO webhook_events (
          event_id, event_type, merchant_id, location_id, 
          created_at, processed_at, payload
        ) VALUES ($1, $2, $3, $4, $5, NOW(), $6)
        ON CONFLICT (event_id) DO UPDATE SET 
          processed_at = NOW(), 
          payload = $6`,
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

// Handler for OAuth authorization revocation
async function handleOAuthRevocation(db: any, event: WebhookEvent) {
  logger.warn("OAuth authorization revoked", { 
    merchant_id: event.merchant_id,
    event_id: event.event_id 
  })
  
  try {
    // Find and deactivate the connection
    const result = await db.query(
      "UPDATE square_connections SET is_active = false, revoked_at = NOW() WHERE merchant_id = $1",
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
    await db.query(
      "UPDATE square_connections SET last_catalog_sync = NOW() WHERE merchant_id = $1",
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
    await db.query(
      `INSERT INTO payment_events (
        payment_id, event_type, merchant_id, location_id,
        event_data, created_at
      ) VALUES ($1, $2, $3, $4, $5, $6)
      ON CONFLICT (payment_id, event_type) DO UPDATE SET
        event_data = $5, updated_at = NOW()`,
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
    await db.query(
      `INSERT INTO order_events (
        order_id, event_type, merchant_id, location_id,
        event_data, created_at
      ) VALUES ($1, $2, $3, $4, $5, $6)
      ON CONFLICT (order_id, event_type) DO UPDATE SET
        event_data = $5, updated_at = NOW()`,
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

// Handler for invoice events
async function handleInvoiceEvent(db: any, event: WebhookEvent) {
  const invoiceId = event.data?.id
  
  logger.info("Invoice event received", { 
    type: event.type,
    invoice_id: invoiceId,
    merchant_id: event.merchant_id,
    event_id: event.event_id 
  })
  
  // TODO: Handle invoice events if your charity app uses Square Invoices
  // This might be relevant for:
  // - Recurring donations
  // - Large donation campaigns
  // - Corporate sponsorship invoicing
}