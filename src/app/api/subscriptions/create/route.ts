// app/api/subscriptions/create/route.ts
import { NextResponse, type NextRequest } from "next/server"
import axios from "axios"
import { createClient } from "@/lib/db"

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { 
      organization_id, 
      plan_type,
      device_count = 1,
      customer_email,
      promo_code = null,
      card_id // This is the card ID from the iOS payment collection
    } = body

    console.log("Creating subscription:", { 
      organization_id, 
      plan_type, 
      device_count, 
      customer_email, 
      has_card_id: !!card_id 
    })

    if (!organization_id || !plan_type || !customer_email || !card_id) {
      return NextResponse.json({ 
        success: false,
        error: "Missing required fields: organization_id, plan_type, customer_email, card_id" 
      }, { status: 400 })
    }

    const db = createClient()

    // Get Square connection for this org
    const result = await db.execute(
      "SELECT access_token, location_id FROM square_connections WHERE organization_id = ?",
      [organization_id]
    )

    if (result.rows.length === 0) {
      return NextResponse.json({ 
        success: false,
        error: "Not connected to Square" 
      }, { status: 404 })
    }

    const { access_token, location_id } = result.rows[0]

    // Get subscription plan details
    const planResult = await db.execute(
      "SELECT * FROM subscription_plans WHERE plan_type = ?",
      [plan_type]
    )

    if (planResult.rows.length === 0) {
      return NextResponse.json({ 
        success: false,
        error: "Subscription plan not found" 
      }, { status: 404 })
    }

    const plan = planResult.rows[0]
    
    // Calculate total price
    const basePrice = plan.base_price_cents
    const extraDevicesPrice = (device_count - 1) * plan.extra_device_price_cents
    let totalPrice = basePrice + extraDevicesPrice

    // Apply promo code if provided
    let promoDiscount = 0
    if (promo_code) {
      const promoResult = await db.execute(
        "SELECT * FROM promo_codes WHERE code = ? AND active = TRUE AND (valid_until IS NULL OR valid_until > NOW())",
        [promo_code]
      )

      if (promoResult.rows.length > 0) {
        const promo = promoResult.rows[0]
        if (promo.discount_type === 'percentage') {
          promoDiscount = Math.floor(totalPrice * promo.discount_value / 100)
        } else {
          promoDiscount = promo.discount_value
        }
        totalPrice = Math.max(0, totalPrice - promoDiscount)

        // Update promo code usage
        await db.execute(
          "UPDATE promo_codes SET used_count = used_count + 1 WHERE id = ?",
          [promo.id]
        )
      }
    }

    // Create or find customer in Square
    const customerResult = await createOrUpdateSquareCustomer(
      access_token, 
      customer_email, 
      organization_id
    )
    
    if (!customerResult.success) {
      return NextResponse.json({ 
        success: false,
        error: "Failed to create customer" 
      }, { status: 500 })
    }

    const customerId = customerResult.customer_id

    // Create subscription in Square
    const SQUARE_ENVIRONMENT = process.env.SQUARE_ENVIRONMENT || "sandbox"
    const SQUARE_DOMAIN = SQUARE_ENVIRONMENT === "production" ? "squareup.com" : "squareupsandbox.com"

    const subscriptionPayload = {
      idempotency_key: `sub_${organization_id}_${Date.now()}`,
      location_id: location_id,
      plan_variation_id: plan.square_variation_id,
      customer_id: customerId,
      card_id: card_id, // Use the card ID from payment collection
      start_date: new Date().toISOString().split('T')[0],
      monthly_billing_anchor_date: 1,
      phases: [
        {
          ordinal: 0,
          order_template_id: null,
          pricing: {
            type: "STATIC",
            price: {
              amount: 0, // 30-day free trial
              currency: "USD"
            }
          },
          periods: 1
        },
        {
          ordinal: 1,
          order_template_id: null,
          pricing: {
            type: "STATIC",
            price: {
              amount: totalPrice,
              currency: "USD"
            }
          }
        }
      ]
    }

    console.log("Creating Square subscription with payload:", JSON.stringify(subscriptionPayload, null, 2))

    const subscriptionResponse = await axios.post(
      `https://connect.${SQUARE_DOMAIN}/v2/subscriptions`,
      subscriptionPayload,
      {
        headers: {
          "Square-Version": "2025-05-21",
          "Authorization": `Bearer ${access_token}`,
          "Content-Type": "application/json"
        }
      }
    )

    const squareSubscription = subscriptionResponse.data.subscription

    console.log("Square subscription created:", squareSubscription.id)

    // Calculate trial end date (30 days from now)
    const trialEndDate = new Date()
    trialEndDate.setDate(trialEndDate.getDate() + 30)

    // Store subscription in database
    const subscriptionResult = await db.execute(
      `INSERT INTO subscriptions (
        organization_id, square_subscription_id, plan_type, device_count, 
        base_price_cents, total_price_cents, status, trial_end_date,
        current_period_start, promo_code, promo_discount_cents
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        organization_id,
        squareSubscription.id,
        plan_type,
        device_count,
        basePrice,
        totalPrice,
        'active',
        trialEndDate,
        new Date(),
        promo_code,
        promoDiscount
      ]
    )

    console.log("Subscription stored in database with ID:", subscriptionResult.insertId)

    return NextResponse.json({
      success: true,
      subscription: {
        id: subscriptionResult.insertId,
        square_subscription_id: squareSubscription.id,
        status: 'active',
        trial_end_date: trialEndDate,
        plan_type,
        device_count,
        total_price: totalPrice / 100,
        promo_discount: promoDiscount / 100
      }
    })

  } catch (error: any) {
    console.error("Error creating subscription:", error)
    
    if (error.response?.data) {
      console.error("Square API Error:", error.response.data)
      return NextResponse.json({ 
        success: false,
        error: error.response.data.errors?.[0]?.detail || "Failed to create subscription" 
      }, { status: 500 })
    }

    return NextResponse.json({ 
      success: false,
      error: "Failed to create subscription" 
    }, { status: 500 })
  }
}

async function createOrUpdateSquareCustomer(accessToken: string, email: string, organizationId: string) {
  try {
    const SQUARE_ENVIRONMENT = process.env.SQUARE_ENVIRONMENT || "sandbox"
    const SQUARE_DOMAIN = SQUARE_ENVIRONMENT === "production" ? "squareup.com" : "squareupsandbox.com"

    // First, try to find existing customer
    const searchResponse = await axios.post(
      `https://connect.${SQUARE_DOMAIN}/v2/customers/search`,
      {
        filter: {
          email_address: {
            exact: email
          }
        }
      },
      {
        headers: {
          "Square-Version": "2025-05-21",
          "Authorization": `Bearer ${accessToken}`,
          "Content-Type": "application/json"
        }
      }
    )

    if (searchResponse.data.customers && searchResponse.data.customers.length > 0) {
      console.log("Found existing customer:", searchResponse.data.customers[0].id)
      return {
        success: true,
        customer_id: searchResponse.data.customers[0].id
      }
    }

    // Create new customer if not found
    const customerResponse = await axios.post(
      `https://connect.${SQUARE_DOMAIN}/v2/customers`,
      {
        given_name: `Org-${organizationId.substring(0, 8)}`,
        email_address: email,
        reference_id: organizationId,
        company_name: organizationId
      },
      {
        headers: {
          "Square-Version": "2025-05-21",
          "Authorization": `Bearer ${accessToken}`,
          "Content-Type": "application/json"
        }
      }
    )

    console.log("Created new customer:", customerResponse.data.customer.id)

    return {
      success: true,
      customer_id: customerResponse.data.customer.id
    }

  } catch (error: any) {
    console.error("Error creating/finding customer:", error)
    return {
      success: false,
      error: error.message
    }
  }
}