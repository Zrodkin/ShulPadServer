// app/api/stripe/webhook/route.ts
import { NextResponse } from "next/server"
import Stripe from "stripe"
import { createClient } from "@/lib/db"
import { logger } from "@/lib/logger"
import { headers } from "next/headers"

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!)

// FIXED: Safe date conversion that handles ALL edge cases
function safeToMySQLDateTime(unixTimestamp: any): string | null {
  // Handle null, undefined, 0, or any falsy value
  if (!unixTimestamp) return null;
  
  try {
    // Ensure we have a number
    const timestamp = Number(unixTimestamp);
    if (isNaN(timestamp) || timestamp === 0) return null;
    
    // Convert to milliseconds and create date
    const date = new Date(timestamp * 1000);
    
    // Check if date is valid
    if (isNaN(date.getTime())) {
      logger.warn("Invalid date from timestamp:", unixTimestamp);
      return null;
    }
    
    // Convert to MySQL datetime format
    const mysqlDate = date.toISOString().slice(0, 19).replace('T', ' ');
    
    // Validate the resulting string
    if (!mysqlDate || mysqlDate === 'Invalid Date') {
      logger.warn("Invalid MySQL date string:", mysqlDate);
      return null;
    }
    
    return mysqlDate;
  } catch (error: any) {
    logger.error("Date conversion error:", { error: error.message, timestamp: unixTimestamp });
    return null;
  }
}

export async function POST(request: Request) {
  const body = await request.text()
  const signature = (await headers()).get("stripe-signature")!
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET!
  
  let event: Stripe.Event
  
  try {
    event = stripe.webhooks.constructEvent(body, signature, webhookSecret)
  } catch (err: any) {
    logger.error(`Webhook signature verification failed:`, err.message)
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 })
  }
  
  const db = createClient()
  
  // Check if we've already processed this event
  const existingEvent = await db.execute(
    "SELECT id FROM stripe_webhook_events WHERE stripe_event_id = ?",
    [event.id]
  )
  
  if (existingEvent.rows.length > 0) {
    logger.info("Event already processed", { event_id: event.id })
    return NextResponse.json({ received: true })
  }
  
  // Record the event
  await db.execute(
    "INSERT INTO stripe_webhook_events (stripe_event_id, event_type) VALUES (?, ?)",
    [event.id, event.type]
  )
  
  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object as Stripe.Checkout.Session
        const organizationId = session.metadata?.organization_id
        
        if (!organizationId) {
          logger.error("No organization_id in session metadata", { session_id: session.id })
          break
        }
        
        if (!session.subscription) {
          logger.error("No subscription in session", { session_id: session.id })
          break
        }
        
        // Retrieve the subscription details
        const subscription = await stripe.subscriptions.retrieve(session.subscription as string) as any
        
        // For test mode with wonky timestamps, use current dates
        const now = new Date();
        const thirtyDaysFromNow = new Date(now.getTime() + (30 * 24 * 60 * 60 * 1000));
        
        // Log what we're about to insert for debugging
        logger.info("Preparing to insert subscription", {
          organization_id: organizationId,
          customer: session.customer,
          subscription_id: subscription.id,
          status: subscription.status,
          period_start: subscription.current_period_start,
          period_end: subscription.current_period_end,
          trial_end: subscription.trial_end
        });
        
        // Create or update subscription record with SAFE date handling
        await db.execute(`
          INSERT INTO stripe_subscriptions (
            organization_id,
            stripe_customer_id,
            stripe_subscription_id,
            status,
            current_period_start,
            current_period_end,
            trial_end
          ) VALUES (?, ?, ?, ?, ?, ?, ?)
          ON DUPLICATE KEY UPDATE
            stripe_customer_id = VALUES(stripe_customer_id),
            stripe_subscription_id = VALUES(stripe_subscription_id),
            status = VALUES(status),
            current_period_start = VALUES(current_period_start),
            current_period_end = VALUES(current_period_end),
            trial_end = VALUES(trial_end),
            updated_at = NOW()
        `, [
          organizationId,
          session.customer,
          subscription.id,
          subscription.status || 'trialing',
          safeToMySQLDateTime(subscription.current_period_start),
          safeToMySQLDateTime(subscription.current_period_end),
          safeToMySQLDateTime(subscription.trial_end)
        ])
        
        logger.info("Checkout completed and subscription created", {
          organization_id: organizationId,
          subscription_id: subscription.id,
          status: subscription.status
        })
        break
      }
      
      case 'customer.subscription.updated':
      case 'customer.subscription.deleted': {
        const subscription = event.data.object as any
        let organizationId = subscription.metadata?.organization_id
        
        if (!organizationId) {
          // Try to find by customer ID or subscription ID
          const result = await db.execute(
            "SELECT organization_id FROM stripe_subscriptions WHERE stripe_customer_id = ? OR stripe_subscription_id = ?",
            [subscription.customer, subscription.id]
          )
          
          if (result.rows.length === 0) {
            logger.error("No organization found for subscription", { 
              subscription_id: subscription.id,
              customer_id: subscription.customer 
            })
            break
          }
          
          organizationId = result.rows[0].organization_id
        }
        
        // Update subscription status with safe date conversion
        await db.execute(`
          UPDATE stripe_subscriptions 
          SET status = ?,
              current_period_start = ?,
              current_period_end = ?,
              trial_end = ?,
              cancel_at_period_end = ?,
              updated_at = NOW()
          WHERE stripe_subscription_id = ?
        `, [
          subscription.status,
          safeToMySQLDateTime(subscription.current_period_start),
          safeToMySQLDateTime(subscription.current_period_end),
          safeToMySQLDateTime(subscription.trial_end),
          subscription.cancel_at_period_end || false,
          subscription.id
        ])
        
        logger.info("Subscription updated", {
          organization_id: organizationId,
          subscription_id: subscription.id,
          status: subscription.status
        })
        break
      }
      
      default:
        logger.info(`Unhandled webhook event type: ${event.type}`)
    }
  } catch (error: any) {
    logger.error("Error processing webhook:", {
      error: error.message,
      event_type: event.type,
      event_id: event.id
    })
    
    // Still return success to prevent Stripe retries
    return NextResponse.json({ 
      received: true, 
      error: error.message 
    })
  }
  
  return NextResponse.json({ received: true })
}