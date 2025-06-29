// ==========================================
// 2. GET SUBSCRIPTION STATUS
// app/api/subscriptions/status/route.ts
// ==========================================
import { NextResponse } from 'next/server';
import { createClient } from "@/lib/db";
import axios from 'axios';

// Helper function to map Square's status to your local status values
function mapSquareStatus(status: string): string {
  switch (status) {
    case 'ACTIVE':
      return 'active';
    case 'PAUSED':
      return 'paused';
    case 'CANCELED':
      return 'canceled';
    case 'PENDING':
      return 'pending';
    case 'DEACTIVATED':
      return 'deactivated';
    default:
      return 'unknown';
  }
}

// Helper function to calculate the next billing date as a fallback
function calculateNextBillingDate(subscription: any): string | null {
  if (subscription.current_period_end) {
    return new Date(subscription.current_period_end).toISOString().split('T')[0];
  }
  if (subscription.current_period_start && subscription.plan_type) {
    const startDate = new Date(subscription.current_period_start);
    if (subscription.plan_type === 'monthly') {
      startDate.setMonth(startDate.getMonth() + 1);
    } else {
      startDate.setFullYear(startDate.getFullYear() + 1);
    }
    return startDate.toISOString().split('T')[0];
  }
  return null;
}


export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const merchant_id = searchParams.get('merchant_id')

    if (!merchant_id) {
      return NextResponse.json({ error: "Missing merchant_id" }, { status: 400 })
    }

    const db = createClient()

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
       AND s.status IN ('active', 'paused', 'grace_period')
       ORDER BY s.created_at DESC
       LIMIT 1`,
      [merchant_id]
    );

    if (result.rows.length === 0) {
      return NextResponse.json({
        subscription: null,
        can_use_kiosk: false,
        message: "No active subscription found"
      })
    }

    const subscription = result.rows[0] as any;

    // For free subscriptions, just return the local data
    if (subscription.square_subscription_id.startsWith('free_')) {
      return NextResponse.json({
        subscription: {
          id: subscription.square_subscription_id,
          status: subscription.status,
          plan_type: subscription.plan_type,
          device_count: subscription.device_count,
          total_price: subscription.total_price_cents / 100,
          next_billing_date: calculateNextBillingDate(subscription),
          can_use_kiosk: true
        }
      })
    }

    // For paid subscriptions, sync with Square
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
      const currentStatus = mapSquareStatus(squareSubscription.status)

      // Update local status if changed
      if (currentStatus !== subscription.status) {
        await db.execute(
          `UPDATE subscriptions
           SET status = ?, updated_at = NOW()
           WHERE id = ?`,
          [currentStatus, subscription.id]
        )
      }

      // Grace period logic
      let canUseKiosk = false
      let gracePeriodEnd = null

      if (currentStatus === 'active' || currentStatus === 'paused') {
        canUseKiosk = true
      } else if (currentStatus === 'canceled' && subscription.grace_period_start) {
        const gracePeriodDays = 7
        gracePeriodEnd = new Date(subscription.grace_period_start)
        gracePeriodEnd.setDate(gracePeriodEnd.getDate() + gracePeriodDays)

        if (new Date() < gracePeriodEnd) {
          canUseKiosk = true
        }
      }

      return NextResponse.json({
        subscription: {
          id: subscription.square_subscription_id,
          status: currentStatus,
          plan_type: subscription.plan_type,
          device_count: subscription.device_count,
          total_price: subscription.total_price_cents / 100,
          next_billing_date: squareSubscription.charged_through_date,
          card_last_four: squareSubscription.card_id ? '****' : null,
          can_use_kiosk: canUseKiosk,
          grace_period_end: gracePeriodEnd
        }
      })

    } catch (squareError: any) {
      console.error("Square API Error:", squareError.response?.data)
      // Return cached data if Square is down
      return NextResponse.json({
        subscription: {
          id: subscription.square_subscription_id,
          status: subscription.status,
          plan_type: subscription.plan_type,
          device_count: subscription.device_count,
          total_price: subscription.total_price_cents / 100,
          next_billing_date: calculateNextBillingDate(subscription),
          can_use_kiosk: subscription.status === 'active',
          cached: true
        }
      })
    }

  } catch (error: any) {
    console.error("Error fetching subscription status:", error)
    return NextResponse.json({
      error: "Failed to fetch subscription status",
      details: error.message
    }, { status: 500 })
  }
}
