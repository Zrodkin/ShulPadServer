// src/app/api/subscriptions/create/route.ts - UPDATED WITH 30-DAY FREE TRIAL LOGIC
import { NextResponse, type NextRequest } from "next/server"
import axios from "axios"
import { createClient } from "@/lib/db"

// Type definitions
type PlanType = 'monthly' | 'yearly';
// Updated to match your schema: 'percentage' | 'fixed_amount'
type DiscountType = 'percentage' | 'fixed_amount';

interface SubscriptionRequest {
  merchant_id: string;
  plan_type: PlanType;
  device_count?: number;
  customer_email?: string;
  source_id: string;
  promo_code?: string | null;
}

// Updated PromoCode interface to match your table structure
interface PromoCode {
  id: number;
  code: string;
  discount_type: DiscountType;
  discount_value: number; // Stored as percentage (e.g., 10 for 10%) or cents (e.g., 500 for $5.00)
  max_uses: number | null;
  used_count: number;
  valid_until: string | null; // Will be a string from the DB
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

    if (!merchant_id || !plan_type || !source_id) {
      return NextResponse.json({ error: "Missing required fields: merchant_id, plan_type, source_id" }, { status: 400 })
    }

    if (plan_type !== 'monthly' && plan_type !== 'yearly') {
      return NextResponse.json({ error: "Invalid plan_type. Must be 'monthly' or 'yearly'" }, { status: 400 })
    }

    const db = createClient()

    // --- DATABASE MODIFICATION NEEDED ---
    // You must add a `created_at` DATETIME or TIMESTAMP column to your `square_connections` table
    // for the free trial logic to work.
    const connectionResult = await db.execute(
      "SELECT access_token, location_id, merchant_email, organization_id, created_at FROM square_connections WHERE merchant_id = ?",
      [merchant_id]
    )

    if (connectionResult.rows.length === 0) {
      return NextResponse.json({ error: "Merchant not connected to Square" }, { status: 404 })
    }

    const { access_token, location_id, merchant_email, organization_id, created_at } = connectionResult.rows[0] as any;

    const finalCustomerEmail = customer_email || merchant_email

    if (!finalCustomerEmail) {
      return NextResponse.json({ 
        error: "Email required for subscription. Please provide customer email or ensure Square account has email." 
      }, { status: 400 })
    }

    console.log("📧 Using email for subscription:", finalCustomerEmail)

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

    // --- FREE TRIAL LOGIC START ---
    if (created_at) {
      const accountCreationDate = new Date(created_at);
      const thirtyDaysAfterCreation = new Date(accountCreationDate.getTime());
      thirtyDaysAfterCreation.setDate(accountCreationDate.getDate() + 30);
      const currentDate = new Date();

      if (currentDate < thirtyDaysAfterCreation) {
        console.log("✅ Account is within 30-day free trial period.");
        isTrialPeriod = true;
        finalPrice = 0; // The price is $0 for the trial
        discountAmount = initialTotalPrice; // The discount is the full price
      }
    }
    // --- FREE TRIAL LOGIC END ---

    // --- PROMO CODE LOGIC START (Updated to only run if not in trial) ---
    if (!isTrialPeriod && promo_code) {
      console.log(`🔍 Searching for promo code: ${promo_code}`);
      
      const promoCodeResult = await db.execute(
        "SELECT id, code, discount_type, discount_value, max_uses, used_count, valid_until, active FROM promo_codes WHERE code = ? AND active = TRUE",
        [promo_code]
      );

      if (promoCodeResult.rows.length > 0) {
        const potentialPromo = promoCodeResult.rows[0] as unknown as PromoCode;
        let isValid = true;

        if (potentialPromo.max_uses !== null && potentialPromo.used_count >= potentialPromo.max_uses) {
          console.log(`⚠️ Promo code "${promo_code}" has reached its usage limit.`);
          isValid = false;
        }

        if (potentialPromo.valid_until && new Date(potentialPromo.valid_until) < new Date()) {
          console.log(`⚠️ Promo code "${promo_code}" has expired.`);
          isValid = false;
        }

        if (isValid) {
          appliedPromoCode = potentialPromo;
          console.log(`✅ Found valid promo code:`, appliedPromoCode);

          if (appliedPromoCode.discount_type === 'percentage') {
            discountAmount = Math.round(initialTotalPrice * (appliedPromoCode.discount_value / 100));
          } else if (appliedPromoCode.discount_type === 'fixed_amount') {
            discountAmount = appliedPromoCode.discount_value;
          }

          finalPrice = initialTotalPrice - discountAmount;
          if (finalPrice < 0) {
              finalPrice = 0;
              discountAmount = initialTotalPrice;
          }
          
          console.log(`💰 Discount applied: ${discountAmount} cents. New price: ${finalPrice} cents.`);
        }
      } 
      
      if (!appliedPromoCode) {
        console.log(`⚠️ Promo code "${promo_code}" not found, is inactive, or has expired.`);
      }
    }
    // --- PROMO CODE LOGIC END ---


    const SQUARE_ENVIRONMENT = process.env.SQUARE_ENVIRONMENT || "production"
    const SQUARE_DOMAIN = SQUARE_ENVIRONMENT === "production" ? "squareup.com" : "squareupsandbox.com"

    console.log("💰 Final price after all discounts:", finalPrice, "cents")

    // Step 1: Create customer
    const customerResponse = await axios.post(
      `https://connect.${SQUARE_DOMAIN}/v2/customers`,
      { idempotency_key: `customer-${merchant_id}-${Date.now()}`, given_name: finalCustomerEmail.split('@')[0], email_address: finalCustomerEmail },
      { headers: { "Square-Version": "2025-06-18", "Authorization": `Bearer ${access_token}`, "Content-Type": "application/json" } }
    )
    const customerId = customerResponse.data.customer.id
    console.log(`✅ Customer created: ${customerId}`)

    // Step 2: Create card
    const cardResponse = await axios.post(
      `https://connect.${SQUARE_DOMAIN}/v2/cards`,
      { idempotency_key: `card-${merchant_id}-${Date.now()}`, source_id: source_id, card: { customer_id: customerId } },
      { headers: { "Square-Version": "2025-06-18", "Authorization": `Bearer ${access_token}`, "Content-Type": "application/json" } }
    )
    const cardId = cardResponse.data.card.id
    console.log(`✅ Card stored: ${cardId}`)

    // Step 3: Create subscription
    const PLAN_VARIATION_IDS: Record<PlanType, string> = {
      monthly: process.env.SQUARE_MONTHLY_PLAN_VARIATION_ID || "EUJVMU555VG5VCARC4AOO33U",
      yearly: process.env.SQUARE_YEARLY_PLAN_VARIATION_ID || "AYDMP6K4DAFD2XHZQZMSDZHY"
    }

    const subscriptionResponse = await axios.post(
      `https://connect.${SQUARE_DOMAIN}/v2/subscriptions`,
      {
        idempotency_key: `sub_${merchant_id}_${Date.now()}`,
        location_id: location_id,
        customer_id: customerId,
        card_id: cardId,
        start_date: new Date().toISOString().split('T')[0],
        plan_variation_id: PLAN_VARIATION_IDS[plan_type],
        price_override_money: { amount: finalPrice, currency: "USD" },
        source: { name: "ShulPad" }
      },
      { headers: { "Square-Version": "2025-06-18", "Authorization": `Bearer ${access_token}`, "Content-Type": "application/json" } }
    )
    const subscription = subscriptionResponse.data.subscription
    console.log(`✅ Square subscription created: ${subscription.id}`)

    // --- DATABASE UPDATES ---
    await db.transaction(async (tx: any) => {
        // Step 4a: Store subscription info
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
          organization_id || 'default', subscription.id, plan_type, device_count, basePriceCents,
          finalPrice, mapSquareStatusToOurStatus(subscription.status), subscription.start_date,
          subscription.charged_through_date, merchant_id, isTrialPeriod ? '30_DAY_TRIAL' : appliedPromoCode?.code, discountAmount
        ]);

        // Step 4b: Increment promo code usage if one was applied and it wasn't a trial
        if (!isTrialPeriod && appliedPromoCode) {
            await tx.execute(
                "UPDATE promo_codes SET used_count = used_count + 1 WHERE id = ?",
                [appliedPromoCode.id]
            );
            console.log(`📈 Incremented usage count for promo code: ${appliedPromoCode.code}`);
        }
    });

    // Step 5: Register device
    await db.execute(`
      INSERT INTO device_registrations (
        organization_id, device_id, device_name, status, merchant_id
      ) VALUES (?, ?, ?, 'active', ?)
      ON DUPLICATE KEY UPDATE last_active = NOW(), status = 'active'
    `, [
      organization_id || 'default', 'primary', 'Primary Device', merchant_id
    ]);

    console.log(`✅ Subscription and device registration stored in database`);

    return NextResponse.json({
      success: true,
      subscription: {
        id: subscription.id,
        merchant_id: merchant_id,
        status: subscription.status,
        plan_type: plan_type,
        device_count: device_count,
        initial_price: initialTotalPrice / 100,
        discount: discountAmount / 100,
        total_price: finalPrice / 100,
        start_date: subscription.start_date,
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
