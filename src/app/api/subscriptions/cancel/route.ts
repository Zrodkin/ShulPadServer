// app/api/subscriptions/cancel/route.ts - ENHANCED WITH CLEAR CANCELLATION MESSAGING
import { NextResponse } from 'next/server';
import { createClient } from "@/lib/db";
import axios from 'axios';

function formatCancellationMessage(subscription: any, serviceEndsDate: string): string {
  const endDate = new Date(serviceEndsDate);
  const now = new Date();
  const daysRemaining = Math.ceil((endDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
  
  const formattedDate = endDate.toLocaleDateString('en-US', { 
    weekday: 'long',
    year: 'numeric', 
    month: 'long', 
    day: 'numeric' 
  });
  
  if (daysRemaining <= 0) {
    return "Your subscription has been cancelled and service has ended. You can resubscribe anytime to restore access.";
  } else if (daysRemaining === 1) {
    return `Your subscription has been cancelled successfully. Your service will continue until tomorrow (${formattedDate}). You can reactivate anytime before then to avoid interruption.`;
  } else if (daysRemaining <= 7) {
    return `Your subscription has been cancelled successfully. Your service will continue for ${daysRemaining} more days until ${formattedDate}. You can reactivate anytime before then to avoid interruption.`;
  } else {
    return `Your subscription has been cancelled successfully. Your service will continue until ${formattedDate} (${daysRemaining} days). You can reactivate anytime before then without losing access.`;
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { merchant_id } = body;

    if (!merchant_id) {
      return NextResponse.json({ error: "Missing merchant_id" }, { status: 400 });
    }

    const db = createClient();

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
    );

    if (result.rows.length === 0) {
      return NextResponse.json({ 
        error: "No active subscription found",
        details: "You don't have an active subscription to cancel."
      }, { status: 404 });
    }

    const subscription = result.rows[0] as any;

    // Handle free subscriptions with immediate feedback
    if (subscription.square_subscription_id.startsWith('free_')) {
      await db.execute(
        `UPDATE subscriptions
         SET status = 'canceled',
             canceled_at = NOW(),
             grace_period_start = NOW(),
             updated_at = NOW()
         WHERE id = ?`,
        [subscription.id]
      );

      return NextResponse.json({
        success: true,
        cancellation: {
          id: subscription.square_subscription_id,
          status: 'canceled',
          canceled_date: new Date().toISOString(),
          service_ends_date: new Date().toISOString(),
          immediate_effect: true,
          message: "Your free subscription has been cancelled immediately. You can reactivate it anytime by upgrading to a paid plan."
        }
      });
    }

    const SQUARE_ENVIRONMENT = process.env.SQUARE_ENVIRONMENT || "production";
    const SQUARE_DOMAIN = SQUARE_ENVIRONMENT === "production" ? "squareup.com" : "squareupsandbox.com";

    try {
      // First, check current subscription status from Square
      const statusResponse = await axios.get(
        `https://connect.${SQUARE_DOMAIN}/v2/subscriptions/${subscription.square_subscription_id}`,
        {
          headers: {
            "Square-Version": "2025-06-18",
            "Authorization": `Bearer ${subscription.access_token}`
          }
        }
      );

      const currentSquareSubscription = statusResponse.data.subscription;

      // Check if already cancelled
      if (currentSquareSubscription.status === 'CANCELED') {
        const serviceEndsDate = currentSquareSubscription.charged_through_date || 
                               currentSquareSubscription.canceled_date;
        
        const message = serviceEndsDate ? 
          formatCancellationMessage(subscription, serviceEndsDate) :
          "Your subscription was already cancelled.";

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
        );

        return NextResponse.json({
          success: true,
          cancellation: {
            id: currentSquareSubscription.id,
            status: 'canceled',
            canceled_date: currentSquareSubscription.canceled_date,
            service_ends_date: serviceEndsDate,
            immediate_effect: false,
            was_already_canceled: true,
            message: message
          }
        });
      }

      // Proceed with cancellation
      console.log(`🚫 Cancelling Square subscription: ${subscription.square_subscription_id}`);
      
      const cancelResponse = await axios.post(
        `https://connect.${SQUARE_DOMAIN}/v2/subscriptions/${subscription.square_subscription_id}/cancel`,
        {},
        {
          headers: {
            "Square-Version": "2025-06-18",
            "Authorization": `Bearer ${subscription.access_token}`
          }
        }
      );

      const canceledSubscription = cancelResponse.data.subscription;
      const serviceEndsDate = canceledSubscription.charged_through_date || 
                             canceledSubscription.canceled_date;

      console.log(`✅ Square cancellation successful. Service ends: ${serviceEndsDate}`);

      // Generate appropriate user message
      const userMessage = serviceEndsDate ? 
        formatCancellationMessage(subscription, serviceEndsDate) :
        "Your subscription has been cancelled successfully. Please contact support if you need assistance with reactivation.";

      // Update local database with detailed cancellation info
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
      );

      // Log cancellation event with detailed info
      await db.execute(
        `INSERT INTO subscription_events
         (subscription_id, event_type, event_data, created_at)
         VALUES (?, 'canceled', ?, NOW())`,
        [subscription.id, JSON.stringify({ 
          reason: 'user_requested',
          service_ends_date: serviceEndsDate,
          canceled_date: canceledSubscription.canceled_date,
          immediate_effect: !serviceEndsDate || serviceEndsDate === canceledSubscription.canceled_date,
          square_response: {
            status: canceledSubscription.status,
            charged_through_date: canceledSubscription.charged_through_date
          }
        })]
      );

      return NextResponse.json({
        success: true,
        cancellation: {
          id: canceledSubscription.id,
          status: 'canceled',
          canceled_date: canceledSubscription.canceled_date,
          service_ends_date: serviceEndsDate,
          immediate_effect: !serviceEndsDate || serviceEndsDate === canceledSubscription.canceled_date,
          was_already_canceled: false,
          days_remaining: serviceEndsDate ? Math.ceil((new Date(serviceEndsDate).getTime() - new Date().getTime()) / (1000 * 60 * 60 * 24)) : 0,
          message: userMessage
        }
      });

    } catch (squareError: any) {
      // Enhanced error handling with specific messaging
      console.error("Square cancellation error:", squareError.response?.data);
      
      if (squareError.response?.data?.errors?.[0]) {
        const error = squareError.response.data.errors[0];
        
        // Handle "already cancelled" case with pending cancel date
        if (error.code === 'BAD_REQUEST' && error.detail?.includes('pending cancel date')) {
          const pendingDateMatch = error.detail.match(/pending cancel date of `([^`]+)`/);
          const pendingCancelDate = pendingDateMatch ? pendingDateMatch[1] : null;

          const message = pendingCancelDate ? 
            formatCancellationMessage(subscription, pendingCancelDate) :
            "Your subscription has already been cancelled.";

          // Update local database to reflect the pending cancellation
          await db.execute(
            `UPDATE subscriptions
             SET status = 'canceled',
                 canceled_at = NOW(),
                 grace_period_start = NOW(),
                 current_period_end = ?,
                 updated_at = NOW()
             WHERE id = ?`,
            [pendingCancelDate, subscription.id]
          );

          return NextResponse.json({
            success: true,
            cancellation: {
              id: subscription.square_subscription_id,
              status: 'canceled',
              canceled_date: new Date().toISOString(),
              service_ends_date: pendingCancelDate,
              immediate_effect: false,
              was_already_canceled: true,
              message: message
            }
          });
        }
        
        // Handle other specific Square errors
        if (error.code === 'NOT_FOUND') {
          return NextResponse.json({
            error: "Subscription not found",
            details: "Your subscription may have already been cancelled or doesn't exist in Square's system."
          }, { status: 404 });
        }
        
        if (error.code === 'FORBIDDEN') {
          return NextResponse.json({
            error: "Unable to cancel subscription",
            details: "You don't have permission to cancel this subscription. Please contact support."
          }, { status: 403 });
        }
      }

      // Generic Square API error
      return NextResponse.json({
        error: "Unable to process cancellation request",
        details: "There was an issue communicating with Square. Please try again in a few minutes, or contact support if the problem persists.",
        support_message: "If this error continues, please contact support with your merchant ID for assistance."
      }, { status: 500 });
    }

  } catch (error: any) {
    console.error("Error canceling subscription:", error);
    return NextResponse.json({
      error: "Service temporarily unavailable",
      details: "We're experiencing technical difficulties. Please try again in a few moments.",
      support_message: "If this error persists, please contact support for assistance with your cancellation request."
    }, { status: 500 });
  }
}