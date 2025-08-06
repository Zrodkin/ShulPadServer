// app/api/stripe/subscription/status/route.ts
import { NextResponse } from "next/server"
import { createClient } from "@/lib/db"
import { logger } from "@/lib/logger"

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const organizationId = searchParams.get('organization_id')
    
    if (!organizationId) {
      return NextResponse.json({ 
        error: "Organization ID is required" 
      }, { status: 400 })
    }
    
    const db = createClient()
    
    // Get subscription details
    const result = await db.execute(`
      SELECT 
        stripe_customer_id,
        stripe_subscription_id,
        status,
        current_period_start,
        current_period_end,
        trial_end,
        cancel_at_period_end
      FROM stripe_subscriptions 
      WHERE organization_id = ?
    `, [organizationId])
    
    if (result.rows.length === 0) {
      return NextResponse.json({
        has_subscription: false,
        status: 'none',
        can_use_kiosk: false
      })
    }
    
    const subscription = result.rows[0]
    const now = new Date()
    const trialEnd = subscription.trial_end ? new Date(subscription.trial_end) : null
    const periodEnd = new Date(subscription.current_period_end)
    
    // Determine if they can use the kiosk
    const canUseKiosk = (
      subscription.status === 'active' || 
      subscription.status === 'trialing' ||
      (subscription.status === 'canceled' && periodEnd > now) // Grace period
    )
    
    // Calculate days remaining
    let daysRemaining = null
    if (subscription.status === 'trialing' && trialEnd) {
      daysRemaining = Math.ceil((trialEnd.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))
    } else if (subscription.status === 'active' || subscription.status === 'canceled') {
      daysRemaining = Math.ceil((periodEnd.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))
    }
    
    return NextResponse.json({
      has_subscription: true,
      status: subscription.status,
      can_use_kiosk: canUseKiosk,
      trial_end: subscription.trial_end,
      current_period_end: subscription.current_period_end,
      cancel_at_period_end: Boolean(subscription.cancel_at_period_end), // FIX: Convert 0/1 to boolean
      days_remaining: daysRemaining,
      stripe_customer_id: subscription.stripe_customer_id,
      stripe_subscription_id: subscription.stripe_subscription_id
    })
    
  } catch (error: any) {
    logger.error("Error checking subscription status:", error)
    return NextResponse.json(
      { error: "Failed to check subscription status" },
      { status: 500 }
    )
  }
}