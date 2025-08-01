// app/api/stripe/webhook/route.ts
import { NextResponse } from "next/server"
import Stripe from "stripe"
import { createClient } from "@/lib/db"
import { logger } from "@/lib/logger"
import { headers } from "next/headers"

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!,)

// Helper to convert Date to MySQL format
function toMySQLDateTime(date: Date): string {
  return date.toISOString().slice(0, 19).replace('T', ' ')
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
        
        // Retrieve the subscription details
        const subscription = await stripe.subscriptions.retrieve(session.subscription as string) as any
        
        // Create or update subscription record
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
          subscription.status,
          toMySQLDateTime(new Date(subscription.current_period_start * 1000)),
          toMySQLDateTime(new Date(subscription.current_period_end * 1000)),
          subscription.trial_end ? toMySQLDateTime(new Date(subscription.trial_end * 1000)) : null
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
        const organizationId = subscription.metadata?.organization_id
        
        if (!organizationId) {
          // Try to find by customer ID
          const result = await db.execute(
            "SELECT organization_id FROM stripe_subscriptions WHERE stripe_customer_id = ?",
            [subscription.customer]
          )
          
          if (result.rows.length === 0) {
            logger.error("No organization found for subscription", { 
              subscription_id: subscription.id,
              customer_id: subscription.customer 
            })
            break
          }
        }
        
        // Update subscription status
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
          toMySQLDateTime(new Date(subscription.current_period_start * 1000)),
          toMySQLDateTime(new Date(subscription.current_period_end * 1000)),
          subscription.trial_end ? toMySQLDateTime(new Date(subscription.trial_end * 1000)) : null,
          subscription.cancel_at_period_end,
          subscription.id
        ])
        
        logger.info(`Subscription ${event.type}`, {
          subscription_id: subscription.id,
          status: subscription.status
        })
        break
      }
      
      case 'customer.subscription.trial_will_end': {
        const subscription = event.data.object as Stripe.Subscription
        logger.info("Trial ending soon", {
          subscription_id: subscription.id,
          trial_end: subscription.trial_end
        })
        // You can add email notification logic here
        break
      }
      
      default:
        logger.info(`Unhandled event type: ${event.type}`)
    }
    
    return NextResponse.json({ received: true })
    
  } catch (error: any) {
    logger.error("Webhook handler error:", error)
    return NextResponse.json(
      { error: "Webhook handler failed" },
      { status: 500 }
    )
  }
}