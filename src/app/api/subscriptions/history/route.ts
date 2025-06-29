// ==========================================
// 9. GET SUBSCRIPTION HISTORY
// app/api/subscriptions/history/route.ts
// ==========================================
import { NextResponse } from 'next/server';
import { createClient } from "@/lib/db";

// ==========================================
// HELPER FUNCTIONS
// ==========================================

function mapSquareStatus(squareStatus: string): string {
  const statusMap: Record<string, string> = {
    'ACTIVE': 'active',
    'CANCELED': 'canceled',
    'PENDING': 'pending',
    'DEACTIVATED': 'deactivated',
    'PAUSED': 'paused'
  };
  return statusMap[squareStatus] || 'unknown';
}

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
    const { searchParams } = new URL(request.url);
    const merchant_id = searchParams.get('merchant_id');

    if (!merchant_id) {
      return NextResponse.json({ error: "Missing merchant_id" }, { status: 400 });
    }

    const db = createClient();

    // Get all subscriptions for the merchant
    const subscriptionsResult = await db.execute(
      `SELECT
        id,
        square_subscription_id,
        plan_type,
        device_count,
        total_price_cents,
        status,
        created_at,
        canceled_at,
        promo_code
       FROM subscriptions
       WHERE merchant_id = ?
       ORDER BY created_at DESC`,
      [merchant_id]
    );

    const subscriptions = subscriptionsResult.rows as any[];
    if (subscriptions.length === 0) {
        return NextResponse.json({ history: [] });
    }

    // Get events for all subscriptions
    const subscriptionIds = subscriptions.map((s: any) => s.id);

    let events: any[] = [];
    if (subscriptionIds.length > 0) {
      const eventsResult = await db.execute(
        `SELECT
          subscription_id,
          event_type,
          event_data,
          created_at
         FROM subscription_events
         WHERE subscription_id IN (?)
         ORDER BY created_at DESC`,
        [subscriptionIds]
      );
      events = eventsResult.rows as any[];
    }

    // Format response
    const history = subscriptions.map((sub: any) => ({
      id: sub.square_subscription_id,
      plan_type: sub.plan_type,
      device_count: sub.device_count,
      total_price: sub.total_price_cents / 100,
      status: sub.status,
      created_at: sub.created_at,
      canceled_at: sub.canceled_at,
      promo_code: sub.promo_code,
      events: events
        .filter((e: any) => e.subscription_id === sub.id)
        .map((e: any) => ({
          type: e.event_type,
          data: JSON.parse(e.event_data || '{}'),
          created_at: e.created_at
        }))
    }));

    return NextResponse.json({ history });

  } catch (error: any) {
    console.error("Error fetching subscription history:", error);
    return NextResponse.json({
      error: "Failed to fetch subscription history",
      details: error.message
    }, { status: 500 });
  }
}
