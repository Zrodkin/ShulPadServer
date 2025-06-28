// src/app/api/subscriptions/create/route.ts - FIXED to handle free subscriptions reliably
import { NextResponse, type NextRequest } from "next/server"
import axios from "axios"
import { createClient } from "@/lib/db"

// Type definitions
type PlanType = 'monthly' | 'yearly';
type DiscountType = 'percentage' | 'fixed_amount';

interface SubscriptionRequest {
  merchant_id: string;
  plan_type: PlanType;
  device_count?: number;
  customer_email?: string;
  source_id: string | null; // Can be null for free subscriptions
  promo_code?: string | null;
}

interface PromoCode {
  id: number;
  code: string;
  discount_type: DiscountType;
  discount_value: number;
  max_uses: number | null;
  used_count: number;
  valid_until: string | null;
  active: boolean;
}

export async function POST(request: NextRequest) {
  try {
    const body: SubscriptionRequest = await request.json()
    const { 
      merchant_id,
      plan_type,
      device_count = 1,
      customer_email,
      source_id,
      promo_code = null
    } = body

    console.log("🚀 Creating subscription:", { merchant_id, plan_type, device_count, customer_email, promo_code })

    if (!merchant_id || !plan_type) {
      return NextResponse.json({ error: "Missing required fields: merchant_id, plan_type" }, { status: 400 })
    }

    if (plan_type !== 'monthly' && plan_type !== 'yearly') {
      return NextResponse.json({ error: "Invalid plan_type. Must be 'monthly' or 'yearly'" }, { status: 400 })
    }

    const db = createClient()
    
    const connectionResult = await db.execute(
      "SELECT access_token, location_id, merchant_email, organization_id, created_at FROM square_connections WHERE merchant_id = ?",
      [merchant_id]
    )

    if (connectionResult.rows.length === 0) {
      return NextResponse.json({ error: "Merchant not connected" }, { status: 404 })
    }

    const { access_token, location_id, merchant_email, organization_id, created_at } = connectionResult.rows[0] as any;

    const finalCustomerEmail = customer_email || merchant_email

    if (!finalCustomerEmail) {
      return NextResponse.json({ error: "Email required for subscription." }, { status: 400 })
    }

    const pricing: Record<PlanType, { base: number; extra: number }> = {
      monthly: { base: 4900, extra: 1500 },
      yearly: { base: 49000, extra: 15000 }
    }

    const basePriceCents = pricing[plan_type].base
    const extraDeviceCost = Math.max(0, device_count - 1) * pricing[plan_type].extra
    const initialTotalPrice = basePriceCents + extraDeviceCost
    
    let finalPrice = initialTotalPrice;
    let discountAmount = 0;
    let appliedPromoCode: PromoCode | null = null;
    let isTrialPeriod = false;

    // --- FREE TRIAL LOGIC ---
    if (created_at) {
      const accountCreationDate = new Date(created_at);
      const thirtyDaysAfterCreation = new Date(accountCreationDate.getTime());
      thirtyDaysAfterCreation.setDate(accountCreationDate.getDate() + 30);
      const currentDate = new Date();

      if (currentDate < thirtyDaysAfterCreation) {
        isTrialPeriod = true;
      }
    }

    // --- PROMO CODE LOGIC ---
    if (promo_code) {
      const promoCodeResult = await db.execute(
        "SELECT id, code, discount_type, discount_value, max_uses, used_count, valid_until, active FROM promo_codes WHERE code = ? AND active = TRUE",
        [promo_code]
      );

      if (promoCodeResult.rows.length > 0) {
        const potentialPromo = promoCodeResult.rows[0] as unknown as PromoCode;
        let isValid = true;
        if ((potentialPromo.max_uses !== null && potentialPromo.used_count >= potentialPromo.max_uses) || (potentialPromo.valid_until && new Date(potentialPromo.valid_until) < new Date())) {
          isValid = false;
        }
        if (isValid) appliedPromoCode = potentialPromo;
      }
    }

    // --- FINAL PRICE CALCULATION ---
    if (isTrialPeriod) {
        console.log("✅ Account is within 30-day free trial period.");
        finalPrice = 0;
        discountAmount = initialTotalPrice;
    } else if (appliedPromoCode) {
        console.log(`✅ Found valid promo code:`, appliedPromoCode);
        if (appliedPromoCode.discount_type === 'percentage') {
            discountAmount = Math.round(initialTotalPrice * (appliedPromoCode.discount_value / 100));
        } else if (appliedPromoCode.discount_type === 'fixed_amount') {
            discountAmount = appliedPromoCode.discount_value;
        }
        finalPrice = Math.max(0, initialTotalPrice - discountAmount);
    }
    
    console.log("💰 Final price after all discounts:", finalPrice, "cents")

    let subscriptionResponseData: any;

    if (finalPrice > 0) {
      // --- PAID SUBSCRIPTION FLOW (REQUIRES CARD) ---
      console.log("💳 Starting paid subscription flow with Square...");
      if (!source_id) {
        return NextResponse.json({ error: "Missing required field: source_id for paid subscription" }, { status: 400 })
      }

      const SQUARE_ENVIRONMENT = process.env.SQUARE_ENVIRONMENT || "production"
      const SQUARE_DOMAIN = SQUARE_ENVIRONMENT === "production" ? "squareup.com" : "squareupsandbox.com"
      
      const customerResponse = await axios.post(`https://connect.${SQUARE_DOMAIN}/v2/customers`,
        { idempotency_key: `customer-${merchant_id}-${Date.now()}`, given_name: finalCustomerEmail.split('@')[0], email_address: finalCustomerEmail },
        { headers: { "Square-Version": "2025-06-18", "Authorization": `Bearer ${access_token}`, "Content-Type": "application/json" } })
      const customerId = customerResponse.data.customer.id;

      const cardResponse = await axios.post(`https://connect.${SQUARE_DOMAIN}/v2/cards`,
        { idempotency_key: `card-${merchant_id}-${Date.now()}`, source_id: source_id, card: { customer_id: customerId } },
        { headers: { "Square-Version": "2025-06-18", "Authorization": `Bearer ${access_token}`, "Content-Type": "application/json" } })
      const cardId = cardResponse.data.card.id;

      const PLAN_VARIATION_IDS: Record<PlanType, string> = {
        monthly: process.env.SQUARE_MONTHLY_PLAN_VARIATION_ID || "EUJVMU555VG5VCARC4AOO33U",
        yearly: process.env.SQUARE_YEARLY_PLAN_VARIATION_ID || "AYDMP6K4DAFD2XHZQZMSDZHY"
      }

      const subscriptionResponse = await axios.post(`https://connect.${SQUARE_DOMAIN}/v2/subscriptions`,
        { idempotency_key: `sub_${merchant_id}_${Date.now()}`, location_id: location_id, customer_id: customerId, card_id: cardId, start_date: new Date().toISOString().split('T')[0], plan_variation_id: PLAN_VARIATION_IDS[plan_type], price_override_money: { amount: finalPrice, currency: "USD" }, source: { name: "ShulPad" } },
        { headers: { "Square-Version": "2025-06-18", "Authorization": `Bearer ${access_token}`, "Content-Type": "application/json" } })
      
      subscriptionResponseData = subscriptionResponse.data.subscription;
      console.log(`✅ Square subscription created: ${subscriptionResponseData.id}`)
    } else {
      // --- FREE SUBSCRIPTION FLOW (NO CARD NEEDED) ---
      console.log("🎉 Starting free subscription flow (local record only)...");
      const startDate = new Date();
      const endDate = new Date(startDate);
      if (plan_type === 'monthly') {
        endDate.setMonth(startDate.getMonth() + 1);
      } else { // yearly
        endDate.setFullYear(startDate.getFullYear() + 1);
      }

      subscriptionResponseData = {
        // FIXED: Replaced crypto.randomUUID() with a more reliable method.
        id: `local-${merchant_id}-${Date.now()}`, 
        status: 'ACTIVE',
        start_date: startDate.toISOString().split('T')[0],
        charged_through_date: endDate.toISOString().split('T')[0],
      };
      console.log(`✅ Local free subscription record created: ${subscriptionResponseData.id}`);
    }

    // --- DATABASE UPDATES (COMMON TO BOTH FLOWS) ---
    await db.transaction(async (tx: any) => {
      await tx.execute(`
        INSERT INTO subscriptions (
          organization_id, square_subscription_id, plan_type, device_count, base_price_cents,
          total_price_cents, status, current_period_start, current_period_end, merchant_id,
          promo_code_used, discount_amount_cents
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE
          square_subscription_id = VALUES(square_subscription_id), plan_type = VALUES(plan_type),
          device_count = VALUES(device_count), total_price_cents = VALUES(total_price_cents),
          status = VALUES(status), promo_code_used = VALUES(promo_code_used),
          discount_amount_cents = VALUES(discount_amount_cents), updated_at = NOW()
      `, [
        organization_id || 'default', 
        subscriptionResponseData.id.startsWith('local-') ? null : subscriptionResponseData.id,
        plan_type, device_count, basePriceCents, finalPrice, 
        mapSquareStatusToOurStatus(subscriptionResponseData.status), 
        subscriptionResponseData.start_date, 
        subscriptionResponseData.charged_through_date, 
        merchant_id, 
        isTrialPeriod ? '30_DAY_TRIAL' : appliedPromoCode?.code, 
        discountAmount
      ]);

      if (!isTrialPeriod && appliedPromoCode) {
        await tx.execute("UPDATE promo_codes SET used_count = used_count + 1 WHERE id = ?", [appliedPromoCode.id]);
        console.log(`📈 Incremented usage count for promo code: ${appliedPromoCode.code}`);
      }
    });

    await db.execute(`
      INSERT INTO device_registrations (organization_id, device_id, device_name, status, merchant_id) 
      VALUES (?, ?, ?, 'active', ?) ON DUPLICATE KEY UPDATE last_active = NOW(), status = 'active'`, 
      [organization_id || 'default', 'primary', 'Primary Device', merchant_id]
    );

    console.log(`✅ Subscription and device registration stored in database`);

    return NextResponse.json({
      success: true,
      subscription: {
        id: subscriptionResponseData.id,
        merchant_id: merchant_id,
        status: subscriptionResponseData.status,
        plan_type: plan_type,
        device_count: device_count,
        initial_price: initialTotalPrice / 100,
        discount: discountAmount / 100,
        total_price: finalPrice / 100,
        start_date: subscriptionResponseData.start_date,
        promo_code_used: isTrialPeriod ? '30_DAY_TRIAL' : appliedPromoCode?.code,
        is_trial: isTrialPeriod
      }
    });

  } catch (error: any) {
    console.error("❌ Subscription creation failed:", error)
    if (error.response?.data?.errors) {
      const squareErrors = error.response.data.errors
      const errorMessage = squareErrors.map((e: any) => e.detail || e.code).join(', ')
      return NextResponse.json({ error: `Square API error: ${errorMessage}`, square_errors: squareErrors }, { status: 400 })
    }
    return NextResponse.json({ error: "Failed to create subscription", details: error.message }, { status: 500 })
  }
}

function mapSquareStatusToOurStatus(squareStatus: string): string {
  switch (squareStatus.toUpperCase()) {
    case 'ACTIVE': return 'active'
    case 'CANCELED': return 'canceled'
    case 'DEACTIVATED': return 'deactivated'
    case 'PAUSED': return 'paused'
    case 'PENDING': return 'pending'
    default: return 'pending'
  }
}
