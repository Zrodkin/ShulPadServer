// ==========================================
// FIXED CREATE SUBSCRIPTION ENDPOINT  
// app/api/subscriptions/create/route.ts
// ==========================================

import { NextResponse, type NextRequest } from "next/server"
import axios from "axios"
import { createClient } from "@/lib/db"

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { 
      organization_id, 
      plan_type, // 'monthly' or 'yearly'
      device_count = 1,
      customer_email,
      card_id,
      customer_id,
      promo_code = null
    } = body

    // Validate input
    if (!organization_id || !plan_type || !customer_email || !card_id || !customer_id) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 })
    }

    const db = createClient()

    // Get Square connection for this org
    const connectionResult = await db.execute(
      "SELECT access_token, location_id FROM square_connections WHERE organization_id = ?",
      [organization_id]
    )

    if (connectionResult.rows.length === 0) {
      return NextResponse.json({ error: "Not connected to Square" }, { status: 404 })
    }

    const { access_token, location_id } = connectionResult.rows[0]
// Validate plan_type
if (plan_type !== 'monthly' && plan_type !== 'yearly') {
  return NextResponse.json({ error: "Invalid plan_type. Must be 'monthly' or 'yearly'" }, { status: 400 })
}

// Cast type for TypeScript
const typedPlanType = plan_type as 'monthly' | 'yearly'

// Calculate pricing
const pricing = {
  monthly: { base: 4900, extra: 1500 }, // $49 + $15/device
  yearly: { base: 49000, extra: 15000 }  // $490 + $150/device  
}

const basePriceCents = pricing[typedPlanType].base
const extraDeviceCost = (device_count - 1) * pricing[typedPlanType].extra


    const totalPrice = basePriceCents + extraDeviceCost

    // Apply promo code if provided
    let promoDiscount = 0
    if (promo_code) {
      const promoResult = await db.execute(
        `SELECT discount_type, discount_value, max_uses, used_count 
         FROM promo_codes 
         WHERE code = ? AND active = TRUE AND (max_uses IS NULL OR used_count < max_uses)`,
        [promo_code]
      )

      if (promoResult.rows.length > 0) {
        const promo = promoResult.rows[0]
        if (promo.discount_type === 'percentage') {
          promoDiscount = Math.round(totalPrice * (promo.discount_value / 100))
        } else {
          promoDiscount = promo.discount_value
        }
      }
    }

    const finalPrice = Math.max(100, totalPrice - promoDiscount) // Minimum $1.00

    const SQUARE_ENVIRONMENT = process.env.SQUARE_ENVIRONMENT || "production"
    const SQUARE_DOMAIN = SQUARE_ENVIRONMENT === "production" ? "squareup.com" : "squareupsandbox.com"

    // Create Square subscription using CUSTOM PHASES (no plan needed!)
    const subscriptionResponse = await axios.post(
      `https://connect.${SQUARE_DOMAIN}/v2/subscriptions`,
      {
        idempotency_key: `sub_${organization_id}_${Date.now()}`,
        location_id: location_id,
        customer_id: customer_id,
        card_id: card_id,
        start_date: new Date().toISOString().split('T')[0], // Today
        phases: [{
          ordinal: 0,
          pricing: {
            type: "STATIC",
            price_money: {
              amount: finalPrice,
              currency: "USD"
            }
          },
          cadence: typedPlanType === 'monthly' ? 'MONTHLY' : 'ANNUAL'
        }],
        source: {
          name: "ShulPad"
        }
      },
      {
        headers: {
          "Square-Version": "2025-06-18",
          "Authorization": `Bearer ${access_token}`,
          "Content-Type": "application/json"
        }
      }
    )

    const subscription = subscriptionResponse.data.subscription

    // Store subscription in database
    await db.execute(`
      INSERT INTO subscriptions (
        organization_id,
        square_subscription_id,
        plan_type,
        device_count,
        base_price_cents,
        total_price_cents,
        status,
        current_period_start,
        current_period_end,
        promo_code,
        promo_discount_cents
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      organization_id,
      subscription.id,
      plan_type,
      device_count,
      basePriceCents,
      finalPrice,
      mapSquareStatusToOurStatus(subscription.status),
      subscription.start_date,
      subscription.charged_through_date,
      promo_code,
      promoDiscount
    ])

    // Update promo code usage
    if (promo_code && promoDiscount > 0) {
      await db.execute(
        "UPDATE promo_codes SET used_count = used_count + 1 WHERE code = ?",
        [promo_code]
      )
    }

    // Register device
    await db.execute(`
      INSERT INTO device_registrations (organization_id, device_id, device_name, status)
      VALUES (?, ?, ?, 'active')
      ON DUPLICATE KEY UPDATE last_active = NOW(), status = 'active'
    `, [organization_id, 'primary', 'Primary Device'])

    return NextResponse.json({
      success: true,
      subscription: {
        id: subscription.id,
        status: subscription.status,
        plan_type: plan_type,
        device_count: device_count,
        total_price: finalPrice / 100,
        start_date: subscription.start_date
      }
    })

  } catch (error: any) {
    console.error("Error creating subscription:", error)
    
    if (error.response?.data?.errors) {
      const squareErrors = error.response.data.errors
      return NextResponse.json({ 
        error: squareErrors[0]?.detail || "Square API error",
        square_errors: squareErrors
      }, { status: 400 })
    }

    return NextResponse.json({ 
      error: "Failed to create subscription",
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