// src/app/api/subscriptions/create/route.ts - FIXED CUSTOM PHASES VERSION
import { NextResponse, type NextRequest } from "next/server"
import axios from "axios"
import { createClient } from "@/lib/db"

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { 
      merchant_id,  // ✅ Using merchant_id as primary identifier
      plan_type,
      device_count = 1,
      customer_email,
      source_id,
      promo_code = null
    } = body

    console.log("🚀 Creating subscription:", { merchant_id, plan_type, device_count, customer_email })

    // Validate required fields
    if (!merchant_id || !plan_type || !source_id) {
      return NextResponse.json({ error: "Missing required fields: merchant_id, plan_type, source_id" }, { status: 400 })
    }

    if (plan_type !== 'monthly' && plan_type !== 'yearly') {
      return NextResponse.json({ error: "Invalid plan_type. Must be 'monthly' or 'yearly'" }, { status: 400 })
    }

    const db = createClient()

    // Get Square connection by merchant_id
    const connectionResult = await db.execute(
      "SELECT access_token, location_id, merchant_email, organization_id FROM square_connections WHERE merchant_id = ?",
      [merchant_id]
    )

    if (connectionResult.rows.length === 0) {
      return NextResponse.json({ error: "Merchant not connected to Square" }, { status: 404 })
    }

    const { access_token, location_id, merchant_email, organization_id } = connectionResult.rows[0]

    // Use merchant email as fallback
    const finalCustomerEmail = customer_email || merchant_email

    if (!finalCustomerEmail) {
      return NextResponse.json({ 
        error: "Email required for subscription. Please provide customer email or ensure Square account has email." 
      }, { status: 400 })
    }

    console.log("📧 Using email for subscription:", finalCustomerEmail)

    // Calculate pricing (as per original plan)
    const pricing = {
      monthly: { base: 4900, extra: 1500 }, // $49 + $15 per extra device
      yearly: { base: 49000, extra: 15000 }  // $490 + $150 per extra device
    }

    const basePriceCents = pricing[plan_type as keyof typeof pricing].base
    const extraDeviceCost = (device_count - 1) * pricing[plan_type as keyof typeof pricing].extra
    const totalPrice = basePriceCents + extraDeviceCost

    const SQUARE_ENVIRONMENT = process.env.SQUARE_ENVIRONMENT || "production"
    const SQUARE_DOMAIN = SQUARE_ENVIRONMENT === "production" ? "squareup.com" : "squareupsandbox.com"

    console.log("💰 Final price:", totalPrice, "cents")

    // Step 1: Create customer in Square
    console.log("📝 Creating Square customer...")
    const customerResponse = await axios.post(
      `https://connect.${SQUARE_DOMAIN}/v2/customers`,
      {
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
    console.log(`✅ Customer created: ${customerId}`)

    // Step 2: Create card on file
    console.log("💳 Creating card on file...")
    const cardResponse = await axios.post(
      `https://connect.${SQUARE_DOMAIN}/v2/cards`,
      {
        source_id: source_id,
        card: {
          customer_id: customerId
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

    const cardId = cardResponse.data.card.id
    console.log(`✅ Card stored: ${cardId}`)

    // Step 3: ✅ SIMPLE: Create Square subscription using CUSTOM PHASES
    console.log("📅 Creating Square subscription with custom phases...")
    
    const subscriptionResponse = await axios.post(
      `https://connect.${SQUARE_DOMAIN}/v2/subscriptions`,
      {
        idempotency_key: `sub_${merchant_id}_${Date.now()}`,
        location_id: location_id,
        customer_id: customerId,
        card_id: cardId,
        start_date: new Date().toISOString().split('T')[0], // Today
        
        // ✅ SIMPLE: Custom phases with dynamic pricing (no catalog plans needed!)
        phases: [{
          ordinal: 0,
          pricing: {
            type: "STATIC",
            price_money: {
              amount: totalPrice,  // Your actual dynamic price
              currency: "USD"
            }
          },
          cadence: plan_type === 'monthly' ? 'MONTHLY' : 'ANNUAL'
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
    console.log(`✅ Square subscription created: ${subscription.id}`)

     // Step 4: Store in database using merchant_id (CORRECTED for your schema)
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
        merchant_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
        square_subscription_id = VALUES(square_subscription_id),
        plan_type = VALUES(plan_type),
        device_count = VALUES(device_count),
        total_price_cents = VALUES(total_price_cents),
        status = VALUES(status),
        updated_at = NOW()
    `, [
      organization_id || 'default',  // organization_id (keep for compatibility)
      subscription.id,               // square_subscription_id
      plan_type,                     // plan_type
      device_count,                  // device_count
      basePriceCents,               // base_price_cents
      totalPrice,                   // total_price_cents
      mapSquareStatusToOurStatus(subscription.status), // status
      subscription.start_date,       // current_period_start
      subscription.charged_through_date, // current_period_end
      merchant_id                    // merchant_id (PRIMARY KEY for lookups)
    ])

    // Step 5: Register device using merchant_id (CORRECTED for your schema)
    await db.execute(`
      INSERT INTO device_registrations (
        organization_id,
        device_id,
        device_name,
        status,
        merchant_id
      ) VALUES (?, ?, ?, 'active', ?)
      ON DUPLICATE KEY UPDATE last_active = NOW(), status = 'active'
    `, [
      organization_id || 'default', // organization_id (keep for compatibility)
      'primary',                    // device_id
      'Primary Device',             // device_name
      merchant_id                   // merchant_id
    ])

    console.log(`✅ Subscription stored in database`)

    return NextResponse.json({
      success: true,
      subscription: {
        id: subscription.id,
        merchant_id: merchant_id,
        status: subscription.status,
        plan_type: plan_type,
        device_count: device_count,
        total_price: totalPrice / 100,
        start_date: subscription.start_date
      }
    })

  } catch (error: any) {
    console.error("❌ Subscription creation failed:", error)
    
    if (error.response?.data?.errors) {
      const squareErrors = error.response.data.errors
      const errorMessage = squareErrors.map((e: any) => e.detail || e.code).join(', ')
      return NextResponse.json({ 
        error: `Square API error: ${errorMessage}`,
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