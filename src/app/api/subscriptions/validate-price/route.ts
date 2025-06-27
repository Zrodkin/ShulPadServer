// src/app/api/subscriptions/validate-price/route.ts - FIXED
import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/db";

type PlanType = 'monthly' | 'yearly';
type DiscountType = 'percentage' | 'fixed_amount';

interface ValidatePriceRequest {
    merchant_id: string;
    plan_type: PlanType;
    device_count?: number;
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
    const body: ValidatePriceRequest = await request.json();
    const { merchant_id, plan_type, device_count = 1, promo_code = null } = body;

    if (!merchant_id || !plan_type) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    // This check ensures plan_type is valid and satisfies TypeScript
    if (plan_type !== 'monthly' && plan_type !== 'yearly') {
        return NextResponse.json({ error: "Invalid plan_type. Must be 'monthly' or 'yearly'." }, { status: 400 });
    }

    const db = createClient();
    
    // --- Price Calculation Logic ---

    // 1. Get Base Price
    const pricing: Record<PlanType, { base: number; extra: number }> = {
      monthly: { base: 4900, extra: 1500 },
      yearly: { base: 49000, extra: 15000 },
    };
    const basePriceCents = pricing[plan_type].base;
    const extraDeviceCost = Math.max(0, device_count - 1) * pricing[plan_type].extra;
    const initialTotalPrice = basePriceCents + extraDeviceCost;

    let finalPrice = initialTotalPrice;
    let discountAmount = 0;
    let isTrialPeriod = false;
    let appliedPromoCode: PromoCode | null = null;
    let reason = 'full_price';

    // 2. Check for Free Trial
    const connectionResult = await db.execute(
      "SELECT created_at FROM square_connections WHERE merchant_id = ?",
      [merchant_id]
    );

    if (connectionResult.rows.length > 0) {
      const { created_at } = connectionResult.rows[0] as any;
      if (created_at) {
        const accountCreationDate = new Date(created_at);
        const thirtyDaysAfterCreation = new Date(accountCreationDate.getTime());
        thirtyDaysAfterCreation.setDate(accountCreationDate.getDate() + 30);
        if (new Date() < thirtyDaysAfterCreation) {
          isTrialPeriod = true;
        }
      }
    }

    // 3. Check for Promo Code
    if (promo_code) {
      const promoResult = await db.execute(
        "SELECT id, code, discount_type, discount_value, max_uses, used_count, valid_until, active FROM promo_codes WHERE code = ? AND active = TRUE",
        [promo_code]
      );
      if (promoResult.rows.length > 0) {
        const promo = promoResult.rows[0] as unknown as PromoCode;
        const isExpired = promo.valid_until && new Date(promo.valid_until) < new Date();
        const isMaxedOut = promo.max_uses !== null && promo.used_count >= promo.max_uses;
        if (!isExpired && !isMaxedOut) {
          appliedPromoCode = promo;
        }
      }
    }
    
    // 4. Calculate Final Price
    if (isTrialPeriod) {
      discountAmount = initialTotalPrice;
      reason = '30_DAY_TRIAL';
    } else if (appliedPromoCode) {
      if (appliedPromoCode.discount_type === 'percentage') {
        discountAmount = Math.round(initialTotalPrice * (appliedPromoCode.discount_value / 100));
      } else { // fixed_amount
        discountAmount = appliedPromoCode.discount_value;
      }
      reason = `promo_${appliedPromoCode.code}`;
    }

    finalPrice = Math.max(0, initialTotalPrice - discountAmount);
    
    return NextResponse.json({
        initialPrice: initialTotalPrice / 100,
        discount: discountAmount / 100,
        finalPrice: finalPrice / 100,
        reason: reason
    });

  } catch (error: any) {
    console.error("Price validation failed:", error);
    return NextResponse.json({ error: "Failed to validate price", details: error.message }, { status: 500 });
  }
}
