// ==========================================
// ENHANCED WEBHOOK HANDLER FOR SQUARE SUBSCRIPTIONS
// app/api/subscriptions/webhook/route.ts
// ==========================================

import { NextResponse, type NextRequest } from "next/server"
import { createClient } from "@/lib/db"
import crypto from 'crypto'

// Webhook event tracking for idempotency
const processedEvents = new Map<string, boolean>()

export async function POST(request: NextRequest) {
  const startTime = Date.now()
  
  try {
    const body = await request.text()
    const signature = request.headers.get('x-square-hmacsha256-signature')
    
    // Verify webhook signature
    if (!verifySquareWebhook(body, signature)) {
      console.error("❌ Invalid webhook signature")
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const event = JSON.parse(body)
    const eventId = event.event_id || `${event.type}_${Date.now()}`
    const merchantId = event.merchant_id
    
    console.log("📥 Received subscription webhook", { 
      event_id: eventId,
      event_type: event.type,
      merchant_id: merchantId,
      subscription_id: event.data?.object?.subscription?.id,
      timestamp: new Date().toISOString()
    })

    // Idempotency check - prevent duplicate processing
    if (processedEvents.has(eventId)) {
      console.log("🔄 Event already processed, skipping", { event_id: eventId })
      return NextResponse.json({ received: true, status: "already_processed" })
    }

    const db = createClient()

    // Store webhook event for persistent idempotency
    try {
      await db.execute(
        `INSERT INTO webhook_events (id, event_type, processed_at, processing_result)
         VALUES (?, ?, NOW(), ?)
         ON DUPLICATE KEY UPDATE processed_at = NOW()`,
        [eventId, event.type, JSON.stringify({ status: 'processing' })]
      )
    } catch (dbError) {
      // If this fails due to duplicate key, event was already processed
      console.log("🔄 Event already processed in database, skipping", { event_id: eventId })
      return NextResponse.json({ received: true, status: "already_processed" })
    }

    // Process the webhook event based on correct Square payload structure
    let result
    switch (event.type) {
      case 'subscription.created':
        result = await handleSubscriptionCreated(db, event.data.object.subscription, event)
        break
        
      case 'subscription.updated':
        result = await handleSubscriptionUpdated(db, event.data.object.subscription, event)
        break
        
      // Note: These events may not exist in Square's actual webhook events
      // but keeping them for potential future use or custom logic
      case 'subscription.activated':
        result = await handleSubscriptionActivated(db, event.data.object.subscription, event)
        break
        
      case 'subscription.deactivated':
        result = await handleSubscriptionDeactivated(db, event.data.object.subscription, event)
        break
        
      case 'subscription.canceled':
        result = await handleSubscriptionCanceled(db, event.data.object.subscription, event)
        break
        
      case 'subscription.paused':
        result = await handleSubscriptionPaused(db, event.data.object.subscription, event)
        break
        
      case 'subscription.resumed':
        result = await handleSubscriptionResumed(db, event.data.object.subscription, event)
        break
        
      case 'invoice.payment_made':
        result = await handleInvoicePaymentMade(db, event.data.object, event)
        break
        
      case 'invoice.payment_failed':
        result = await handleInvoicePaymentFailed(db, event.data.object, event)
        break
        
      case 'payment.updated':
        if (event.data.object.status === 'FAILED') {
          result = await handlePaymentFailed(db, event.data.object, event)
        } else {
          result = { status: 'skipped', reason: 'payment_not_failed' }
        }
        break
        
      default:
        console.log("⚠️ Unhandled webhook event type", { event_type: event.type })
        result = { status: 'unhandled', message: `Event type ${event.type} not implemented` }
    }

    // Update webhook event record with final result
    await db.execute(
      `UPDATE webhook_events SET processing_result = ? WHERE id = ?`,
      [JSON.stringify(result), eventId]
    )

    // Mark event as processed
    processedEvents.set(eventId, true)
    
    // Clean up old processed events (keep last 1000)
    if (processedEvents.size > 1000) {
      const entries = Array.from(processedEvents.entries())
      entries.slice(0, 500).forEach(([key]) => processedEvents.delete(key))
    }

    const processingTime = Date.now() - startTime
    console.log("✅ Webhook processed successfully", { 
      event_id: eventId,
      event_type: event.type,
      processing_time_ms: processingTime,
      result
    })

    return NextResponse.json({ 
      received: true, 
      event_id: eventId,
      processing_time_ms: processingTime,
      result 
    })

  } catch (error: any) {
    const processingTime = Date.now() - startTime
    console.error("❌ Error processing subscription webhook", {
      error: error.message,
      stack: error.stack,
      processing_time_ms: processingTime
    })
    
    return NextResponse.json({ 
      error: "Webhook processing failed",
      details: error.message 
    }, { status: 500 })
  }
}

// ==========================================
// WEBHOOK SIGNATURE VERIFICATION
// ==========================================

function verifySquareWebhook(body: string, signature: string | null): boolean {
  if (!signature) return false
  
  const webhookSignatureKey = process.env.SQUARE_WEBHOOK_SIGNATURE_KEY
  if (!webhookSignatureKey) {
    console.error("❌ SQUARE_WEBHOOK_SIGNATURE_KEY not configured")
    return false
  }

  const expectedSignature = 'sha256=' + crypto
    .createHmac('sha256', webhookSignatureKey)
    .update(body)
    .digest('base64')

  return crypto.timingSafeEqual(
    Buffer.from(signature),
    Buffer.from(expectedSignature)
  )
}

// ==========================================
// SUBSCRIPTION EVENT HANDLERS
// ==========================================

async function handleSubscriptionCreated(db: any, subscription: any, event: any) {
  console.log("🆕 Processing subscription created", { 
    subscription_id: subscription.id,
    status: subscription.status,
    customer_id: subscription.customer_id,
    plan_variation_id: subscription.plan_variation_id,
    start_date: subscription.start_date
  })

  // Store subscription event for audit trail
  await logSubscriptionEvent(db, subscription.id, 'created', { subscription, event })
  
  // If this subscription was created outside our API (e.g., Square Dashboard),
  // we might want to create a record in our database
  try {
    const existingResult = await db.execute(
      "SELECT id FROM subscriptions WHERE square_subscription_id = ?",
      [subscription.id]
    )
    
    if (existingResult.rows.length === 0) {
      console.log("⚠️ Subscription created outside our system, creating database record")
      
      // Try to find organization by customer_id or location_id
      const orgResult = await db.execute(
        `SELECT organization_id FROM square_connections 
         WHERE location_id = ? OR merchant_id = ?`,
        [subscription.location_id, event.merchant_id]
      )
      
      if (orgResult.rows.length > 0) {
        const organizationId = orgResult.rows[0].organization_id
        
        await db.execute(`
          INSERT INTO subscriptions (
            organization_id,
            square_subscription_id,
            plan_type,
            device_count,
            base_price_cents,
            total_price_cents,
            status,
            current_period_start,
            created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW())
        `, [
          organizationId,
          subscription.id,
          'monthly', // Default, will be updated when we get plan details
          1, // Default device count
          0, // Will be updated with actual pricing
          0, // Will be updated with actual pricing
          mapSquareStatusToOurStatus(subscription.status),
          subscription.start_date
        ])
      }
    }
  } catch (error) {
    console.error("Error handling external subscription creation:", error)
  }
  
  return { status: 'processed', action: 'subscription_created' }
}

async function handleSubscriptionUpdated(db: any, subscription: any, event: any) {
  console.log("🔄 Processing subscription updated", { 
    subscription_id: subscription.id,
    status: subscription.status,
    version: subscription.version,
    plan_variation_id: subscription.plan_variation_id
  })
  
  const newStatus = mapSquareStatusToOurStatus(subscription.status)
  
  await db.transaction(async (tx: any) => {
    // Update subscription status and details
    const updateResult = await tx.execute(
      `UPDATE subscriptions 
       SET status = ?, 
           current_period_start = ?,
           current_period_end = ?,
           canceled_at = ?,
           updated_at = NOW()
       WHERE square_subscription_id = ?`,
      [
        newStatus,
        subscription.start_date || subscription.created_date,
        subscription.charged_through_date || null,
        subscription.canceled_date ? new Date(subscription.canceled_date) : null,
        subscription.id
      ]
    )

    // Log the event
    await logSubscriptionEvent(tx, subscription.id, 'updated', { subscription, event })
    
    console.log(`✅ Updated ${updateResult.rowsAffected} subscription record(s)`)
  })
  
  return { 
    status: 'processed', 
    action: 'subscription_updated', 
    new_status: newStatus,
    subscription_id: subscription.id
  }
}

async function handleSubscriptionActivated(db: any, subscription: any, event: any) {
  console.log("✅ Processing subscription activated", { 
    subscription_id: subscription.id,
    start_date: subscription.start_date
  })

  await db.transaction(async (tx: any) => {
    await tx.execute(
      `UPDATE subscriptions 
       SET status = 'active', 
           current_period_start = ?,
           current_period_end = ?,
           updated_at = NOW()
       WHERE square_subscription_id = ?`,
      [
        subscription.start_date || subscription.created_date,
        subscription.charged_through_date || null,
        subscription.id
      ]
    )

    await logSubscriptionEvent(tx, subscription.id, 'activated', { subscription, event })
  })

  return { status: 'processed', action: 'subscription_activated' }
}

async function handleSubscriptionDeactivated(db: any, subscription: any, event: any) {
  console.log("❌ Processing subscription deactivated", { 
    subscription_id: subscription.id
  })

  await db.transaction(async (tx: any) => {
    await tx.execute(
      `UPDATE subscriptions 
       SET status = 'deactivated',
           updated_at = NOW()
       WHERE square_subscription_id = ?`,
      [subscription.id]
    )

    await logSubscriptionEvent(tx, subscription.id, 'deactivated', { subscription, event })
  })

  return { status: 'processed', action: 'subscription_deactivated' }
}

async function handleSubscriptionCanceled(db: any, subscription: any, event: any) {
  console.log("🚫 Processing subscription canceled", { 
    subscription_id: subscription.id,
    canceled_date: subscription.canceled_date
  })

  await db.transaction(async (tx: any) => {
    await tx.execute(
      `UPDATE subscriptions 
       SET status = 'canceled',
           canceled_at = ?,
           updated_at = NOW()
       WHERE square_subscription_id = ?`,
      [
        subscription.canceled_date ? new Date(subscription.canceled_date) : new Date(),
        subscription.id
      ]
    )

    await logSubscriptionEvent(tx, subscription.id, 'canceled', { subscription, event })
  })

  return { status: 'processed', action: 'subscription_canceled' }
}

async function handleSubscriptionPaused(db: any, subscription: any, event: any) {
  console.log("⏸️ Processing subscription paused", { 
    subscription_id: subscription.id
  })

  await db.transaction(async (tx: any) => {
    await tx.execute(
      `UPDATE subscriptions 
       SET status = 'paused',
           updated_at = NOW()
       WHERE square_subscription_id = ?`,
      [subscription.id]
    )

    await logSubscriptionEvent(tx, subscription.id, 'paused', { subscription, event })
  })

  return { status: 'processed', action: 'subscription_paused' }
}

async function handleSubscriptionResumed(db: any, subscription: any, event: any) {
  console.log("▶️ Processing subscription resumed", { 
    subscription_id: subscription.id
  })

  await db.transaction(async (tx: any) => {
    await tx.execute(
      `UPDATE subscriptions 
       SET status = 'active',
           updated_at = NOW()
       WHERE square_subscription_id = ?`,
      [subscription.id]
    )

    await logSubscriptionEvent(tx, subscription.id, 'resumed', { subscription, event })
  })

  return { status: 'processed', action: 'subscription_resumed' }
}

// ==========================================
// PAYMENT EVENT HANDLERS (Updated for correct payload)
// ==========================================

async function handleInvoicePaymentMade(db: any, invoice: any, event: any) {
  const subscriptionId = invoice.subscription_id || invoice.order?.metadata?.subscription_id
  
  if (!subscriptionId) {
    return { status: 'skipped', reason: 'no_subscription_id' }
  }
  
  console.log("💳 Processing invoice payment made", { 
    invoice_id: invoice.id,
    subscription_id: subscriptionId,
    amount: invoice.order?.total_money?.amount
  })

  await db.transaction(async (tx: any) => {
    // Activate subscription if it was pending
    await tx.execute(
      `UPDATE subscriptions 
       SET status = 'active',
           updated_at = NOW()
       WHERE square_subscription_id = ? AND status IN ('pending', 'trial_ended')`,
      [subscriptionId]
    )

    // Log payment event
    await tx.execute(
      `INSERT INTO subscription_events (subscription_id, event_type, metadata, created_at)
       SELECT id, 'payment_made', ?, NOW()
       FROM subscriptions 
       WHERE square_subscription_id = ?`,
      [JSON.stringify({ invoice, event }), subscriptionId]
    )
  })

  return { status: 'processed', action: 'payment_made' }
}

async function handleInvoicePaymentFailed(db: any, invoice: any, event: any) {
  const subscriptionId = invoice.subscription_id || invoice.order?.metadata?.subscription_id
  
  if (!subscriptionId) {
    return { status: 'skipped', reason: 'no_subscription_id' }
  }
  
  console.log("❌ Processing invoice payment failed", { 
    invoice_id: invoice.id,
    subscription_id: subscriptionId
  })

  await db.transaction(async (tx: any) => {
    // Log payment failure
    await tx.execute(
      `INSERT INTO subscription_events (subscription_id, event_type, metadata, created_at)
       SELECT id, 'payment_failed', ?, NOW()
       FROM subscriptions 
       WHERE square_subscription_id = ?`,
      [JSON.stringify({ invoice, event }), subscriptionId]
    )

    // Optionally mark subscription as having payment issues
    // You might want to set a flag or change status based on your business logic
  })

  return { status: 'processed', action: 'payment_failed' }
}

async function handlePaymentFailed(db: any, payment: any, event: any) {
  console.error("💥 Processing payment failed", { 
    payment_id: payment.id,
    reference_id: payment.reference_id
  })

  // This is for individual payments, not subscription payments
  // Log for monitoring purposes
  await db.execute(
    `INSERT INTO subscription_events (subscription_id, event_type, metadata, created_at)
     VALUES (NULL, 'individual_payment_failed', ?, NOW())`,
    [JSON.stringify({ payment, event })]
  )

  return { status: 'processed', action: 'individual_payment_failed' }
}

// ==========================================
// UTILITY FUNCTIONS (Updated)
// ==========================================

async function logSubscriptionEvent(dbOrTx: any, subscriptionId: string, eventType: string, metadata: any) {
  try {
    await dbOrTx.execute(
      `INSERT INTO subscription_events (subscription_id, event_type, metadata, created_at)
       SELECT id, ?, ?, NOW()
       FROM subscriptions 
       WHERE square_subscription_id = ?`,
      [eventType, JSON.stringify(metadata), subscriptionId]
    )
  } catch (error) {
    console.error("Failed to log subscription event:", error)
    // Don't throw - logging failure shouldn't break webhook processing
  }
}

function mapSquareStatusToOurStatus(squareStatus: string): string {
  switch (squareStatus) {
    case 'ACTIVE':
      return 'active'
    case 'CANCELED':
      return 'canceled'
    case 'DEACTIVATED':
      return 'deactivated'
    case 'PAUSED':
      return 'paused'
    case 'PENDING':
      return 'pending'
    default:
      return 'pending'
  }
}