// src/app/api/subscriptions/status/route.ts - FIXED TO DETECT PENDING CANCELLATION
import { NextResponse } from "next/server"
import axios from "axios"
import { createClient } from "@/lib/db"

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const merchant_id = searchParams.get('merchant_id')

    if (!merchant_id) {
      return NextResponse.json({ error: "Missing merchant_id" }, { status: 400 })
    }

    const db = createClient()

    // Get subscription by merchant_id (primary key)
    const result = await db.execute(`
      SELECT s.*, sc.access_token 
      FROM subscriptions s
      JOIN square_connections sc ON s.merchant_id = sc.merchant_id
      WHERE s.merchant_id = ? AND s.status IN ('active', 'pending', 'paused', 'grace_period', 'pending_cancellation')
      ORDER BY s.created_at DESC 
      LIMIT 1
    `, [merchant_id])

    if (result.rows.length === 0) {
      return NextResponse.json({ 
        subscription: null,
        can_use_kiosk: false,
        message: "No active subscription found",
        grace_period_ends: null
      })
    }

    const subscription = result.rows[0]

    // Get latest status from Square
    const SQUARE_ENVIRONMENT = process.env.SQUARE_ENVIRONMENT || "production"
    const SQUARE_DOMAIN = SQUARE_ENVIRONMENT === "production" ? "squareup.com" : "squareupsandbox.com"

    try {
      const squareResponse = await axios.get(
        `https://connect.${SQUARE_DOMAIN}/v2/subscriptions/${subscription.square_subscription_id}`,
        {
          headers: {
            "Square-Version": "2025-06-18",
            "Authorization": `Bearer ${subscription.access_token}`
          }
        }
      )

      const squareSubscription = squareResponse.data.subscription
      let currentStatus = mapSquareStatusToOurStatus(squareSubscription.status)

      // ✅ CRITICAL FIX: Check for pending cancellation
      let finalStatus = currentStatus
      let gracePeriodEnd = null
      let canUseKiosk = false
      let cancelDate = null

      // 🔥 NEW LOGIC: Detect pending cancellation
      if (squareSubscription.canceled_date && currentStatus === 'active') {
        finalStatus = 'pending_cancellation'
        cancelDate = squareSubscription.canceled_date
        canUseKiosk = true // Still works until cancel date
        
        console.log("🚨 Detected pending cancellation:", {
          subscription_id: squareSubscription.id,
          canceled_date: cancelDate,
          current_square_status: squareSubscription.status
        })

        // Update our database
        await db.execute(`
          UPDATE subscriptions 
          SET status = 'pending_cancellation', canceled_at = ?, updated_at = NOW()
          WHERE merchant_id = ?
        `, [cancelDate, merchant_id])

      } else if (currentStatus === 'active') {
        canUseKiosk = true
        // Clear any existing grace period
        await db.execute(`
          UPDATE subscriptions 
          SET status = 'active', grace_period_start = NULL, updated_at = NOW()
          WHERE merchant_id = ?
        `, [merchant_id])
        
      } else if (currentStatus === 'pending' && subscription.grace_period_start) {
        // Check if still in grace period
        const gracePeriodStart = new Date(subscription.grace_period_start)
        const threeDaysLater = new Date(gracePeriodStart.getTime() + (3 * 24 * 60 * 60 * 1000))
        gracePeriodEnd = threeDaysLater.toISOString()
        
        if (new Date() < threeDaysLater) {
          finalStatus = 'grace_period'
          canUseKiosk = true  // Still works during grace period
        } else {
          finalStatus = 'deactivated'
          canUseKiosk = false  // Grace period expired
          
          // Update to deactivated
          await db.execute(`
            UPDATE subscriptions 
            SET status = 'deactivated', updated_at = NOW()
            WHERE merchant_id = ?
          `, [merchant_id])
        }
      } else {
        // Update database with latest info
        await db.execute(`
          UPDATE subscriptions 
          SET status = ?, current_period_start = ?, current_period_end = ?, updated_at = NOW()
          WHERE merchant_id = ?
        `, [
          currentStatus,
          squareSubscription.start_date,
          squareSubscription.charged_through_date,
          merchant_id
        ])
      }

      return NextResponse.json({
        subscription: {
          id: squareSubscription.id,
          merchant_id: merchant_id,
          status: finalStatus,
          plan_type: subscription.plan_type,
          device_count: subscription.device_count,
          total_price: subscription.total_price_cents / 100,
          next_billing_date: squareSubscription.charged_through_date,
          card_last_four: squareSubscription.card_id ? "****" : null,
          start_date: squareSubscription.start_date,
          canceled_date: cancelDate // ✅ NEW: Include cancel date
        },
        can_use_kiosk: canUseKiosk,
        grace_period_ends: gracePeriodEnd,
        canceled_on: cancelDate, // ✅ NEW: When subscription will end
        message: getStatusMessage(finalStatus, canUseKiosk, gracePeriodEnd, cancelDate)
      })

    } catch (squareError) {
      // If Square API fails, use cached data with grace period logic
      console.warn("Failed to fetch from Square, returning cached data:", squareError)
      
      let canUseKiosk = subscription.status === 'active' || subscription.status === 'pending_cancellation'
      let gracePeriodEnd = null
      let finalStatus = subscription.status

      // Check grace period for cached data too
      if (subscription.status === 'grace_period' && subscription.grace_period_start) {
        const gracePeriodStart = new Date(subscription.grace_period_start)
        const threeDaysLater = new Date(gracePeriodStart.getTime() + (3 * 24 * 60 * 60 * 1000))
        gracePeriodEnd = threeDaysLater.toISOString()
        
        if (new Date() < threeDaysLater) {
          canUseKiosk = true
        } else {
          canUseKiosk = false
          finalStatus = 'deactivated'
        }
      }
      
      return NextResponse.json({
        subscription: {
          id: subscription.square_subscription_id,
          merchant_id: merchant_id,
          status: finalStatus,
          plan_type: subscription.plan_type,
          device_count: subscription.device_count,
          total_price: subscription.total_price_cents / 100,
          next_billing_date: subscription.current_period_end,
          card_last_four: "****",
          start_date: subscription.current_period_start,
          canceled_date: subscription.canceled_at
        },
        can_use_kiosk: canUseKiosk,
        grace_period_ends: gracePeriodEnd,
        canceled_on: subscription.canceled_at,
        message: getStatusMessage(finalStatus, canUseKiosk, gracePeriodEnd, subscription.canceled_at) + " (cached)"
      })
    }

  } catch (error: any) {
    console.error("Error fetching subscription status:", error)
    return NextResponse.json({ 
      error: "Failed to fetch subscription status",
      subscription: null,
      can_use_kiosk: false,
      details: error.message 
    }, { status: 500 })
  }
}

function mapSquareStatusToOurStatus(squareStatus: string): string {
  switch (squareStatus) {
    case 'ACTIVE': return 'active'
    case 'CANCELED': return 'canceled'
    case 'DEACTIVATED': return 'deactivated'
    case 'PAUSED': return 'paused'
    case 'PENDING': return 'pending'
    default: return 'pending'
  }
}

function getStatusMessage(status: string, canUseKiosk: boolean, gracePeriodEnd: string | null, cancelDate: string | null): string {
  if (status === 'pending_cancellation' && cancelDate) {
    const cancelDateObj = new Date(cancelDate)
    const daysUntilCancel = Math.ceil((cancelDateObj.getTime() - new Date().getTime()) / (24 * 60 * 60 * 1000))
    return `Subscription ends on ${cancelDateObj.toLocaleDateString()} (${daysUntilCancel} days)`
  } else if (status === 'active') {
    return "Subscription active"
  } else if (status === 'grace_period' && gracePeriodEnd) {
    const daysLeft = Math.ceil((new Date(gracePeriodEnd).getTime() - new Date().getTime()) / (24 * 60 * 60 * 1000))
    return `Payment failed - ${daysLeft} days left in grace period`
  } else if (status === 'deactivated') {
    return "Subscription deactivated - payment required"
  } else {
    return `Subscription status: ${status}`
  }
}