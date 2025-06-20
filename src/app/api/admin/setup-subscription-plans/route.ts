import { NextResponse } from "next/server"
import axios from "axios"
import { createClient } from "@/lib/db"

export async function POST() {
  try {
    const SQUARE_ENVIRONMENT = process.env.SQUARE_ENVIRONMENT || "sandbox"
    const SQUARE_DOMAIN = SQUARE_ENVIRONMENT === "production" ? "squareup.com" : "squareupsandbox.com"
    const SQUARE_ACCESS_TOKEN = process.env.SQUARE_APPLICATION_ACCESS_TOKEN
    
    if (!SQUARE_ACCESS_TOKEN) {
      return NextResponse.json({ error: "Square access token not configured" }, { status: 500 })
    }

    const plans = [
      {
        name: "ShulPad Monthly",
        type: "monthly", 
        basePrice: 4900, // $49.00
        extraDevicePrice: 1500, // $15.00
        billingInterval: "MONTHLY"
      },
      {
        name: "ShulPad Yearly",
        type: "yearly",
        basePrice: 49000, // $490.00  
        extraDevicePrice: 15000, // $150.00
        billingInterval: "ANNUAL"
      }
    ]

    const createdPlans = []

    for (const plan of plans) {
      // Create subscription plan
      const planResponse = await axios.post(
        `https://connect.${SQUARE_DOMAIN}/v2/catalog/object`,
        {
          idempotency_key: `plan_${plan.type}_${Date.now()}`,
          object: {
            type: "SUBSCRIPTION_PLAN",
            id: `#${plan.type}_plan`,
            subscription_plan_data: {
              name: plan.name,
              eligible_category_ids: [],
              all_items: false
            }
          }
        },
        {
          headers: {
            "Square-Version": "2025-05-21",
            "Authorization": `Bearer ${SQUARE_ACCESS_TOKEN}`,
            "Content-Type": "application/json"
          }
        }
      )

      const planId = planResponse.data.catalog_object.id

      // Create plan variation
      const variationResponse = await axios.post(
        `https://connect.${SQUARE_DOMAIN}/v2/catalog/object`,
        {
          idempotency_key: `variation_${plan.type}_1device_${Date.now()}`,
          object: {
            type: "SUBSCRIPTION_PLAN_VARIATION",
            id: `#${plan.type}_variation_1device`,
            subscription_plan_variation_data: {
              name: `${plan.name} - 1 Device`,
              subscription_plan_id: planId,
              monthly_billing_anchor_date: 1,
              can_prorate: true,
              phases: [
                {
                  cadence: plan.billingInterval,
                  ordinal: 0,
                  periods: 1,
                  pricing: {
                    type: "STATIC",
                    price: { amount: 0, currency: "USD" }
                  }
                },
                {
                  cadence: plan.billingInterval,
                  ordinal: 1,
                  pricing: {
                    type: "STATIC", 
                    price: { amount: plan.basePrice, currency: "USD" }
                  }
                }
              ]
            }
          }
        },
        {
          headers: {
            "Square-Version": "2025-05-21",
            "Authorization": `Bearer ${SQUARE_ACCESS_TOKEN}`,
            "Content-Type": "application/json"
          }
        }
      )

      createdPlans.push({
        type: plan.type,
        plan_id: planId,
        variation_id: variationResponse.data.catalog_object.id,
        base_price: plan.basePrice,
        extra_device_price: plan.extraDevicePrice
      })
    }

    // Store plan IDs in database
    const db = createClient()
    for (const plan of createdPlans) {
      await db.execute(
        `INSERT INTO subscription_plans (plan_type, square_plan_id, square_variation_id, base_price_cents, extra_device_price_cents) 
         VALUES (?, ?, ?, ?, ?) 
         ON DUPLICATE KEY UPDATE 
         square_plan_id = VALUES(square_plan_id), 
         square_variation_id = VALUES(square_variation_id)`,
        [plan.type, plan.plan_id, plan.variation_id, plan.base_price, plan.extra_device_price]
      )
    }

    return NextResponse.json({
      success: true,
      plans: createdPlans
    })

  } catch (error: any) {
    console.error("Error setting up subscription plans", error)
    return NextResponse.json({ error: "Failed to setup subscription plans" }, { status: 500 })
  }
}