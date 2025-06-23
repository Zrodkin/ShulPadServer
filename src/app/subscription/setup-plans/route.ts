// ==========================================
// 1. SUBSCRIPTION PLANS SETUP (One-time setup)
// app/api/subscription/setup-plans/route.ts
// ==========================================

import { createClient } from "@/lib/db"
import { NextResponse } from "next/server"
import axios from "axios"

export async function POST() {
  try {
    const accessToken = process.env.SQUARE_ACCESS_TOKEN
    const locationId = process.env.SHULPAD_SQUARE_LOCATION_ID
    const SQUARE_ENVIRONMENT = process.env.SQUARE_ENVIRONMENT || "production"
    const SQUARE_DOMAIN = SQUARE_ENVIRONMENT === "production" ? "squareup.com" : "squareupsandbox.com"

    if (!accessToken || !locationId) {
      return NextResponse.json({ error: "Missing Square configuration" }, { status: 500 })
    }

    // Create Monthly Plan
    const monthlyPlan = await createSubscriptionPlan({
      accessToken,
      squareDomain: SQUARE_DOMAIN,
      planData: {
        name: "ShulPad Monthly Plan",
        description: "Monthly subscription for ShulPad donation platform",
        cadence: "MONTHLY",
        basePrice: 4900, // $49.00
        extraDevicePrice: 1500 // $15.00 per extra device
      }
    })

    // Create Yearly Plan  
    const yearlyPlan = await createSubscriptionPlan({
      accessToken,
      squareDomain: SQUARE_DOMAIN,
      planData: {
        name: "ShulPad Yearly Plan", 
        description: "Yearly subscription for ShulPad donation platform",
        cadence: "ANNUAL",
        basePrice: 49000, // $490.00
        extraDevicePrice: 15000 // $150.00 per extra device
      }
    })

    // Store plan IDs in database
    const db = createClient()
    await db.execute(`
      INSERT INTO subscription_plans (plan_type, square_plan_id, square_variation_id, base_price_cents, extra_device_price_cents)
      VALUES 
        ('monthly', ?, ?, 4900, 1500),
        ('yearly', ?, ?, 49000, 15000)
      ON DUPLICATE KEY UPDATE
        square_plan_id = VALUES(square_plan_id),
        square_variation_id = VALUES(square_variation_id)
    `, [
      monthlyPlan.planId, monthlyPlan.variationId,
      yearlyPlan.planId, yearlyPlan.variationId
    ])

    return NextResponse.json({
      success: true,
      plans: { monthly: monthlyPlan, yearly: yearlyPlan }
    })

  } catch (error: any) {
    console.error("Error setting up subscription plans:", error)
    return NextResponse.json({ 
      error: "Failed to setup subscription plans",
      details: error.message 
    }, { status: 500 })
  }
}

async function createSubscriptionPlan({ accessToken, squareDomain, planData }: any) {
  // Create the subscription plan object in Square Catalog
  const catalogResponse = await axios.post(
    `https://connect.${squareDomain}/v2/catalog/object`,
    {
      idempotency_key: `plan_${planData.cadence.toLowerCase()}_${Date.now()}`,
      object: {
        type: "SUBSCRIPTION_PLAN",
        id: `#${planData.name.replace(/\s+/g, "_").toUpperCase()}`,
        subscription_plan_data: {
          name: planData.name,
          subscription_plan_variations: [{
            type: "SUBSCRIPTION_PLAN_VARIATION",
            id: `#${planData.name.replace(/\s+/g, "_").toUpperCase()}_VARIATION`,
            subscription_plan_variation_data: {
              name: `${planData.name} - Base`,
              phases: [{
                cadence: planData.cadence,
                recurring_price_money: {
                  amount: planData.basePrice,
                  currency: "USD"
                }
              }]
            }
          }]
        }
      }
    },
    {
      headers: {
        "Square-Version": "2025-06-18",
        "Authorization": `Bearer ${accessToken}`,
        "Content-Type": "application/json"
      }
    }
  )

  const plan = catalogResponse.data.catalog_object
  const variation = plan.subscription_plan_data.subscription_plan_variations[0]

  return {
    planId: plan.id,
    variationId: variation.id,
    name: planData.name
  }
}