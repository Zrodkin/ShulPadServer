// ==========================================
// COMPLETE SUBSCRIPTION SYSTEM - ALL ROUTES
// Based on industry best practices from Stripe, Paddle, etc.
// ==========================================

// ==========================================
// 1. CREATE SUBSCRIPTION
// app/api/subscriptions/create/route.ts
// ==========================================
import { NextResponse } from "next/server"
import axios from "axios"
import { createClient } from "@/lib/db"
import { v4 as uuidv4 } from 'uuid'

interface CreateSubscriptionRequest {
  merchant_id: string
  plan_type: 'monthly' | 'yearly'
  device_count?: number
  customer_email?: string
  source_id?: string | null
  promo_code?: string | null
}

export async function POST(request: Request) {
  try {
    const body: CreateSubscriptionRequest = await request.json()
    const { 
      merchant_id,
      plan_type,
      device_count = 1,
      customer_email,
      source_id,
      promo_code
    } = body

    console.log("🚀 Creating subscription:", { merchant_id, plan_type, device_count })

    // Validation
    if (!merchant_id || !plan_type) {
      return NextResponse.json({ 
        error: "Missing required fields",
        details: { merchant_id: !merchant_id, plan_type: !plan_type }
      }, { status: 400 })
    }

    const db = createClient()
    
    // Get merchant connection
    const connectionResult = await db.execute(
      `SELECT access_token, location_id, merchant_email 
       FROM square_connections 
       WHERE merchant_id = ?`,
      [merchant_id]
    )

    if (connectionResult.rows.length === 0) {
      return NextResponse.json({ error: "Merchant not connected" }, { status: 404 })
    }

    const { access_token, location_id, merchant_email } = connectionResult.rows[0]
    const finalCustomerEmail = customer_email || merchant_email

    // Check for existing active subscription
    const existingSubResult = await db.execute(
      `SELECT id FROM subscriptions 
       WHERE merchant_id = ? AND status IN ('active', 'paused')`,
      [merchant_id]
    )

    if (existingSubResult.rows.length > 0) {
      return NextResponse.json({ 
        error: "Active subscription already exists",
        subscription_id: existingSubResult.rows[0].id 
      }, { status: 409 })
    }

    // Calculate pricing
    const basePrices = {
      monthly: 9900, // $99.00
      yearly: 99900  // $999.00
    }
    
    const extraDevicePrice = plan_type === 'monthly' ? 1000 : 10000 // $10 or $100
    const basePrice = basePrices[plan_type]
    let totalPrice = basePrice + ((device_count - 1) * extraDevicePrice)

    // Apply promo code if provided
    let promoDiscount = 0
    if (promo_code) {
      const promoResult = await db.execute(
        `SELECT * FROM promo_codes 
         WHERE code = ? AND active = true 
         AND (valid_until IS NULL OR valid_until > NOW())
         AND (max_uses IS NULL OR used_count < max_uses)`,
        [promo_code]
      )

      if (promoResult.rows.length > 0) {
        const promo = promoResult.rows[0]
        if (promo.discount_type === 'percentage') {
          promoDiscount = Math.floor(totalPrice * (promo.discount_value / 100))
        } else {
          promoDiscount = promo.discount_value
        }
        totalPrice = Math.max(0, totalPrice - promoDiscount)

        // Increment promo usage
        await db.execute(
          `UPDATE promo_codes SET used_count = used_count + 1 WHERE id = ?`,
          [promo.id]
        )
      }
    }

    const SQUARE_ENVIRONMENT = process.env.SQUARE_ENVIRONMENT || "production"
    const SQUARE_DOMAIN = SQUARE_ENVIRONMENT === "production" ? "squareup.com" : "squareupsandbox.com"

    let subscriptionData

    if (totalPrice > 0 && source_id) {
      // PAID SUBSCRIPTION - Create in Square
      try {
        // Create customer
        const customerResponse = await axios.post(
          `https://connect.${SQUARE_DOMAIN}/v2/customers`,
          {
            idempotency_key: `customer-${merchant_id}-${Date.now()}`,
            given_name: finalCustomerEmail.split('@')[0],
            email_address: finalCustomerEmail
          },
          {
            headers: {
              "Square-Version": "2025-06-18",
              "Authorization": `Bearer ${access_token}`,
              "Content-Type": "application/json"
            }
          }
        )
        const customerId = customerResponse.data.customer.id

        // Create card
        const cardResponse = await axios.post(
          `https://connect.${SQUARE_DOMAIN}/v2/cards`,
          {
            idempotency_key: `card-${merchant_id}-${Date.now()}`,
            source_id: source_id,
            card: { customer_id: customerId }
          },
          {
            headers: {
              "Square-Version": "2025-06-18",
              "Authorization": `Bearer ${access_token}`,
              "Content-Type": "application/json"
            }
          }
        )
        const cardId = cardResponse.data.card.id

        // Create subscription with custom phases
        const phases = []
        
        // Add trial phase if applicable
        if (promo_code === 'TRIAL30') {
          const trialEndDate = new Date()
          trialEndDate.setDate(trialEndDate.getDate() + 30)
          
          phases.push({
            ordinal: 0,
            periods: 1,
            plan_phase_pricing: {
              pricing: {
                price_money: { amount: 0, currency: "USD" }
              }
            }
          })
        }

        // Regular subscription phase
        phases.push({
          ordinal: phases.length,
          plan_phase_pricing: {
            pricing: {
              price_money: { 
                amount: totalPrice, 
                currency: "USD" 
              }
            }
          }
        })

        const subscriptionResponse = await axios.post(
          `https://connect.${SQUARE_DOMAIN}/v2/subscriptions`,
          {
            idempotency_key: `sub_${merchant_id}_${Date.now()}`,
            location_id: location_id,
            customer_id: customerId,
            card_id: cardId,
            start_date: new Date().toISOString().split('T')[0],
            phases: phases,
            source: { name: "ShulPad" }
          },
          {
            headers: {
              "Square-Version": "2025-06-18",
              "Authorization": `Bearer ${access_token}`,
              "Content-Type": "application/json"
            }
          }
        )

        subscriptionData = subscriptionResponse.data.subscription
        console.log(`✅ Square subscription created: ${subscriptionData.id}`)

      } catch (squareError: any) {
        console.error("Square API Error:", squareError.response?.data)
        return NextResponse.json({ 
          error: "Failed to create Square subscription",
          details: squareError.response?.data?.errors || squareError.message
        }, { status: 500 })
      }

    } else {
      // FREE SUBSCRIPTION - Local only
      subscriptionData = {
        id: `free_${uuidv4()}`,
        status: 'ACTIVE',
        created_at: new Date().toISOString(),
        start_date: new Date().toISOString().split('T')[0]
      }
    }

    // Save to database
    await db.execute(
      `INSERT INTO subscriptions (
        merchant_id,
        square_subscription_id,
        square_customer_id,
        plan_type,
        device_count,
        base_price_cents,
        total_price_cents,
        promo_code,
        promo_discount_cents,
        status,
        current_period_start,
        created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
      [
        merchant_id,
        subscriptionData.id,
        subscriptionData.customer_id || null,
        plan_type,
        device_count,
        basePrice,
        totalPrice,
        promo_code,
        promoDiscount,
        'active',
        subscriptionData.start_date
      ]
    )

    return NextResponse.json({
      success: true,
      subscription: {
        id: subscriptionData.id,
        status: 'active',
        plan_type,
        device_count,
        total_price: totalPrice / 100,
        start_date: subscriptionData.start_date
      }
    })

  } catch (error: any) {
    console.error("Error creating subscription:", error)
    return NextResponse.json({ 
      error: "Failed to create subscription",
      details: error.message 
    }, { status: 500 })
  }
}