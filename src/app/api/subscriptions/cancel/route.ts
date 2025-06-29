// app/api/subscriptions/cancel/route.ts - PROFESSIONAL CANCELLATION HANDLING
import { NextResponse } from 'next/server';
import { createClient } from "@/lib/db";
import axios from 'axios';

export async function POST(request: Request) {
  try {
    const body = await request.json()
    const { merchant_id } = body

    if (!merchant_id) {
      return NextResponse.json({ error: "Missing merchant_id" }, { status: 400 })
    }

    const db = createClient()

    // Get active subscription
    const result = await db.execute(
      `SELECT s.*, sc.access_token
       FROM subscriptions s
       JOIN square_connections sc ON s.merchant_id = sc.merchant_id
       WHERE s.merchant_id = ?
       AND s.status IN ('active', 'paused')
       ORDER BY s.created_at DESC
       LIMIT 1`,
      [merchant_id]
    )

    if (result.rows.length === 0) {
      return NextResponse.json({ error: "No active subscription found" }, { status: 404 })
    }

    const subscription = result.rows[0] as any;

    // Handle free subscriptions
    if (subscription.square_subscription_id.startsWith('free_')) {
      await db.execute(
        `UPDATE subscriptions
         SET status = 'canceled',
             canceled_at = NOW(),
             grace_period_start = NOW(),
             updated_at = NOW()
         WHERE id = ?`,
        [subscription.id]
      )

      return NextResponse.json({
        success: true,
        subscription: {
          id: subscription.square_subscription_id,
          status: 'canceled',
          canceled_date: new Date().toISOString(),
          service_ends_date: new Date().toISOString(),
          message: "Your free subscription has been cancelled. You can reactivate it anytime."
        }
      })
    }

    const SQUARE_ENVIRONMENT = process.env.SQUARE_ENVIRONMENT || "production"
    const SQUARE_DOMAIN = SQUARE_ENVIRONMENT === "production" ? "squareup.com" : "squareupsandbox.com"

    try {
      // First, get current subscription status from Square
      const statusResponse = await axios.get(
        `https://connect.${SQUARE_DOMAIN}/v2/subscriptions/${subscription.square_subscription_id}`,
        {
          headers: {
            "Square-Version": "2025-06-18",
            "Authorization": `Bearer ${subscription.access_token}`
          }
        }
      )

      const currentSquareSubscription = statusResponse.data.subscription

      // Check if already cancelled
      if (currentSquareSubscription.status === 'CANCELED') {
        // Extract service end date (when access actually stops)
        const serviceEndsDate = currentSquareSubscription.charged_through_date || 
                               currentSquareSubscription.canceled_date

        // Update local database to reflect current state
        await db.execute(
          `UPDATE subscriptions
           SET status = 'canceled',
               canceled_at = ?,
               grace_period_start = ?,
               current_period_end = ?,
               updated_at = NOW()
           WHERE id = ?`,
          [
            currentSquareSubscription.canceled_date || new Date(),
            currentSquareSubscription.canceled_date || new Date(),
            serviceEndsDate,
            subscription.id
          ]
        )

        return NextResponse.json({
          success: true,
          subscription: {
            id: currentSquareSubscription.id,
            status: 'canceled',
            canceled_date: currentSquareSubscription.canceled_date,
            service_ends_date: serviceEndsDate,
            message: `Your subscription has been cancelled and will remain active until ${formatDate(serviceEndsDate)}. You can resubscribe anytime to continue your service.`
          }
        })
      }

      // Attempt cancellation
      const cancelResponse = await axios.post(
        `https://connect.${SQUARE_DOMAIN}/v2/subscriptions/${subscription.square_subscription_id}/cancel`,
        {},
        {
          headers: {
            "Square-Version": "2025-06-18",
            "Authorization": `Bearer ${subscription.access_token}`
          }
        }
      )

      const canceledSubscription = cancelResponse.data.subscription
      const serviceEndsDate = canceledSubscription.charged_through_date || 
                             canceledSubscription.canceled_date

      // Update local database
      await db.execute(
        `UPDATE subscriptions
         SET status = 'canceled',
             canceled_at = ?,
             grace_period_start = ?,
             current_period_end = ?,
             updated_at = NOW()
         WHERE id = ?`,
        [
          canceledSubscription.canceled_date,
          canceledSubscription.canceled_date,
          serviceEndsDate,
          subscription.id
        ]
      )

      // Log cancellation event
      await db.execute(
        `INSERT INTO subscription_events
         (subscription_id, event_type, event_data, created_at)
         VALUES (?, 'canceled', ?, NOW())`,
        [subscription.id, JSON.stringify({ 
          reason: 'user_requested',
          service_ends_date: serviceEndsDate,
          canceled_date: canceledSubscription.canceled_date
        })]
      )

      return NextResponse.json({
        success: true,
        subscription: {
          id: canceledSubscription.id,
          status: 'canceled',
          canceled_date: canceledSubscription.canceled_date,
          service_ends_date: serviceEndsDate,
          message: `Your subscription has been cancelled and will remain active until ${formatDate(serviceEndsDate)}. You can resubscribe anytime to continue your service without interruption.`
        }
      })

    } catch (squareError: any) {
      // Handle Square-specific errors professionally
      if (squareError.response?.data?.errors?.[0]) {
        const error = squareError.response.data.errors[0]
        
        // Handle "already cancelled" case
        if (error.code === 'BAD_REQUEST' && error.detail?.includes('pending cancel date')) {
          // Extract the pending cancel date from error message
          const pendingDateMatch = error.detail.match(/pending cancel date of `([^`]+)`/)
          const pendingCancelDate = pendingDateMatch ? pendingDateMatch[1] : null

          // Update local database to reflect the current state
          await db.execute(
            `UPDATE subscriptions
             SET status = 'canceled',
                 canceled_at = NOW(),
                 grace_period_start = NOW(),
                 current_period_end = ?,
                 updated_at = NOW()
             WHERE id = ?`,
            [pendingCancelDate, subscription.id]
          )

          return NextResponse.json({
            success: true,
            subscription: {
              id: subscription.square_subscription_id,
              status: 'canceled',
              canceled_date: new Date().toISOString(),
              service_ends_date: pendingCancelDate,
              message: `Your subscription has been cancelled and will remain active until ${formatDate(pendingCancelDate)}. You can resubscribe anytime to continue your service.`
            }
          })
        }
      }

      console.error("Square API Error:", squareError.response?.data)
      return NextResponse.json({
        error: "Unable to process cancellation request",
        details: "Please try again or contact support if the issue persists."
      }, { status: 500 })
    }

  } catch (error: any) {
    console.error("Error canceling subscription:", error)
    return NextResponse.json({
      error: "Service temporarily unavailable",
      details: "Please try again in a few moments."
    }, { status: 500 })
  }
}

// Helper function to format dates nicely
function formatDate(dateString: string): string {
  if (!dateString) return 'your next billing date'
  
  try {
    const date = new Date(dateString)
    return date.toLocaleDateString('en-US', { 
      weekday: 'long',
      year: 'numeric', 
      month: 'long', 
      day: 'numeric' 
    })
  } catch {
    return dateString
  }
}