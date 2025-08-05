// app/api/stripe/session/status/route.ts
import { NextResponse } from "next/server"
import Stripe from "stripe"
import { createClient } from "@/lib/db"
import { logger } from "@/lib/logger"

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!)

// Helper to convert Date to MySQL format
function toMySQLDateTime(date: Date): string {
  return date.toISOString().slice(0, 19).replace('T', ' ')
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const sessionId = searchParams.get('session_id')
    
    if (!sessionId) {
      return NextResponse.json({ 
        error: "Session ID is required" 
      }, { status: 400 })
    }
    
    // Retrieve the session from Stripe
    const session = await stripe.checkout.sessions.retrieve(sessionId, {
      expand: ['subscription']
    })
    
    if (!session.subscription || typeof session.subscription === 'string') {
      return NextResponse.json({
        error: "No subscription found for this session"
      }, { status: 404 })
    }
    
    const organizationId = session.metadata?.organization_id
    if (!organizationId) {
      return NextResponse.json({
        error: "No organization ID in session metadata"
      }, { status: 400 })
    }
    
    const subscription = session.subscription as Stripe.Subscription
    const db = createClient()
    
    // Check if subscription already exists
    const existing = await db.execute(
      "SELECT id FROM stripe_subscriptions WHERE organization_id = ?",
      [organizationId]
    )
    
    if (existing.rows.length === 0) {
      // Create the subscription record if webhook hasn't processed it yet
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
      
      logger.info("Created subscription from session check", {
        organization_id: organizationId,
        subscription_id: subscription.id,
        session_id: sessionId
      })
    }
    
    return NextResponse.json({
      success: true,
      subscription_id: subscription.id,
      status: subscription.status,
      organization_id: organizationId
    })
    
  } catch (error: any) {
    logger.error("Error checking session status:", error)
    return NextResponse.json(
      { error: "Failed to check session status" },
      { status: 500 }
    )
  }
}