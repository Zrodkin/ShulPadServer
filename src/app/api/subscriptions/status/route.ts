// app/api/subscriptions/status/route.ts - ENHANCED WITH CLEAR CANCELLATION STATUS
import { NextResponse } from 'next/server';
import { createClient } from "@/lib/db";
import axios from 'axios';

// Helper function to map Square's status to your local status values
function mapSquareStatus(status: string): string {
  switch (status) {
    case 'ACTIVE': return 'active';
    case 'PAUSED': return 'paused';
    case 'CANCELED': return 'canceled';
    case 'PENDING': return 'pending';
    case 'DEACTIVATED': return 'deactivated';
    default: return 'unknown';
  }
}

// NEW: Enhanced status analysis that considers cancellation timing
function analyzeSubscriptionStatus(subscription: any, squareSubscription?: any) {
  const now = new Date();
  const isSquareCanceled = squareSubscription?.status === 'CANCELED';
  const localStatus = subscription.status;
  
  // Determine actual service end date
  const serviceEndsDate = squareSubscription?.charged_through_date || 
                         squareSubscription?.canceled_date ||
                         subscription.current_period_end ||
                         subscription.canceled_at;
  
  const serviceEndDate = serviceEndsDate ? new Date(serviceEndsDate) : null;
  const isServiceExpired = serviceEndDate ? now > serviceEndDate : false;
  
  // Determine final status and kiosk access
  let finalStatus = localStatus;
  let canUseKiosk = false;
  let statusReason = '';
  
  if (isSquareCanceled || localStatus === 'canceled') {
    if (isServiceExpired) {
      finalStatus = 'canceled';
      canUseKiosk = false;
      statusReason = 'subscription_expired';
    } else if (serviceEndDate) {
      finalStatus = 'canceled'; // Still marked as canceled
      canUseKiosk = true;  // But still functional
      statusReason = 'canceled_but_active';
    } else {
      finalStatus = 'canceled';
      canUseKiosk = false;
      statusReason = 'canceled_immediate';
    }
  } else if (localStatus === 'active') {
    finalStatus = 'active';
    canUseKiosk = true;
    statusReason = 'fully_active';
  } else if (localStatus === 'paused') {
    finalStatus = 'paused';
    canUseKiosk = false;
    statusReason = 'subscription_paused';
  } else {
    finalStatus = localStatus;
    canUseKiosk = false;
    statusReason = 'unknown_status';
  }
  
  return {
    finalStatus,
    canUseKiosk,
    statusReason,
    serviceEndsDate,
    isServiceExpired,
    isCanceledButActive: statusReason === 'canceled_but_active'
  };
}

function calculateGracePeriodMessage(analysis: any): { 
  message: string | null,
  urgencyLevel: 'none' | 'warning' | 'critical'
} {
  const { statusReason, serviceEndsDate, isCanceledButActive } = analysis;
  
  if (!isCanceledButActive || !serviceEndsDate) {
    return { message: null, urgencyLevel: 'none' };
  }

  const now = new Date();
  const endsDate = new Date(serviceEndsDate);
  const daysRemaining = Math.ceil((endsDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));

  if (daysRemaining <= 0) {
    return {
      message: "Your subscription has expired. Resubscribe now to restore access to your donation kiosk.",
      urgencyLevel: 'critical'
    };
  }

  let message: string;
  let urgencyLevel: 'none' | 'warning' | 'critical';

  if (daysRemaining <= 3) {
    urgencyLevel = 'critical';
    message = `Your cancelled subscription ends in ${daysRemaining} day${daysRemaining === 1 ? '' : 's'}. Reactivate now to avoid service interruption.`;
  } else if (daysRemaining <= 7) {
    urgencyLevel = 'warning';
    message = `Your cancelled subscription ends in ${daysRemaining} days on ${formatDate(serviceEndsDate)}. Reactivate to continue your service.`;
  } else {
    urgencyLevel = 'warning';
    message = `Your subscription was cancelled and will end on ${formatDate(serviceEndsDate)}. You can reactivate anytime before then.`;
  }

  return { message, urgencyLevel };
}

function formatDate(dateString: string): string {
  try {
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', { 
      weekday: 'long',
      year: 'numeric', 
      month: 'long', 
      day: 'numeric' 
    });
  } catch {
    return dateString;
  }
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const merchant_id = searchParams.get('merchant_id');

    if (!merchant_id) {
      return NextResponse.json({ error: "Missing merchant_id" }, { status: 400 });
    }

    const db = createClient();

    // Get subscription with Square connection info
    const result = await db.execute(
      `SELECT
        s.*,
        sc.access_token,
        pc.code as promo_code_used,
        pc.discount_type,
        pc.discount_value
       FROM subscriptions s
       JOIN square_connections sc ON s.merchant_id = sc.merchant_id
       LEFT JOIN promo_codes pc ON s.promo_code = pc.code
       WHERE s.merchant_id = ?
       AND s.status IN ('active', 'paused', 'canceled')
       ORDER BY s.created_at DESC
       LIMIT 1`,
      [merchant_id]
    );

    // No subscription found
    if (result.rows.length === 0) {
      return NextResponse.json({
        subscription: null,
        can_use_kiosk: false,
        grace_period_ends: null,
        message: "No subscription found. Subscribe now to start accepting donations.",
        urgency_level: 'none',
        status_reason: 'no_subscription',
        is_canceled_but_active: false,
        error: null
      });
    }

    const subscription = result.rows[0] as any;

    // For free subscriptions, return simple response
    if (subscription.square_subscription_id.startsWith('free_')) {
      const canUseKiosk = subscription.status === 'active';
      
      return NextResponse.json({
        subscription: {
          id: subscription.square_subscription_id,
          status: subscription.status,
          plan_type: subscription.plan_type,
          device_count: subscription.device_count,
          total_price: subscription.total_price_cents / 100,
          next_billing_date: null,
          card_last_four: null,
          start_date: subscription.created_at,
          canceled_date: subscription.canceled_at,
          service_ends_date: subscription.canceled_at
        },
        can_use_kiosk: canUseKiosk,
        grace_period_ends: subscription.canceled_at,
        message: canUseKiosk ? null : "Your free subscription has ended. Upgrade to a paid plan to continue using the kiosk.",
        urgency_level: canUseKiosk ? 'none' : 'warning',
        status_reason: canUseKiosk ? 'free_active' : 'free_expired',
        is_canceled_but_active: false,
        error: null
      });
    }

    // For paid subscriptions, sync with Square
    const SQUARE_ENVIRONMENT = process.env.SQUARE_ENVIRONMENT || "production";
    const SQUARE_DOMAIN = SQUARE_ENVIRONMENT === "production" ? "squareup.com" : "squareupsandbox.com";

    try {
      const squareResponse = await axios.get(
        `https://connect.${SQUARE_DOMAIN}/v2/subscriptions/${subscription.square_subscription_id}`,
        {
          headers: {
            "Square-Version": "2025-06-18",
            "Authorization": `Bearer ${subscription.access_token}`
          }
        }
      );

      const squareSubscription = squareResponse.data.subscription;
      
      // NEW: Enhanced status analysis
      const analysis = analyzeSubscriptionStatus(subscription, squareSubscription);
      const { message, urgencyLevel } = calculateGracePeriodMessage(analysis);
      
      // Update local status if changed
      if (analysis.finalStatus !== subscription.status) {
        await db.execute(
          `UPDATE subscriptions
           SET status = ?, 
               current_period_end = ?,
               updated_at = NOW()
           WHERE id = ?`,
          [analysis.finalStatus, analysis.serviceEndsDate, subscription.id]
        );
      }

      return NextResponse.json({
        subscription: {
          id: subscription.square_subscription_id,
          status: analysis.finalStatus,
          plan_type: subscription.plan_type,
          device_count: subscription.device_count,
          total_price: subscription.total_price_cents / 100,
          next_billing_date: analysis.isCanceledButActive ? null : (squareSubscription.charged_through_date || analysis.serviceEndsDate),
          card_last_four: squareSubscription.card_id ? '****' : null,
          start_date: squareSubscription.start_date || subscription.created_at,
          canceled_date: squareSubscription.canceled_date || subscription.canceled_at,
          service_ends_date: analysis.serviceEndsDate
        },
        can_use_kiosk: analysis.canUseKiosk,
        grace_period_ends: analysis.isCanceledButActive ? analysis.serviceEndsDate : null,
        message: message,
        urgency_level: urgencyLevel,
        status_reason: analysis.statusReason,
        is_canceled_but_active: analysis.isCanceledButActive,
        error: null
      });

    } catch (squareError: any) {
      console.error("Square API Error:", squareError.response?.data);
      
      // Fallback to cached data with enhanced analysis
      const analysis = analyzeSubscriptionStatus(subscription);
      const { message, urgencyLevel } = calculateGracePeriodMessage(analysis);
      
      return NextResponse.json({
        subscription: {
          id: subscription.square_subscription_id,
          status: analysis.finalStatus,
          plan_type: subscription.plan_type,
          device_count: subscription.device_count,
          total_price: subscription.total_price_cents / 100,
          next_billing_date: analysis.serviceEndsDate,
          card_last_four: null,
          start_date: subscription.created_at,
          canceled_date: subscription.canceled_at,
          service_ends_date: analysis.serviceEndsDate
        },
        can_use_kiosk: analysis.canUseKiosk,
        grace_period_ends: analysis.isCanceledButActive ? analysis.serviceEndsDate : null,
        message: message || "Service status temporarily unavailable. Using cached information.",
        urgency_level: urgencyLevel,
        status_reason: analysis.statusReason,
        is_canceled_but_active: analysis.isCanceledButActive,
        error: null
      });
    }

  } catch (error: any) {
    console.error("Error fetching subscription status:", error);
    return NextResponse.json({
      subscription: null,
      can_use_kiosk: false,
      grace_period_ends: null,
      message: null,
      urgency_level: 'none',
      status_reason: 'error',
      is_canceled_but_active: false,
      error: "Unable to check subscription status. Please try again."
    }, { status: 500 });
  }
}