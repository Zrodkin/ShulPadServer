// app/api/stripe/create-checkout-session/route.ts
import { NextResponse } from "next/server"
import Stripe from "stripe"
import { createClient } from "@/lib/db"
import { logger } from "@/lib/logger"

// Initialize Stripe
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!)

export async function POST(request: Request) {
  try {
    const body = await request.json()
    const { organization_id, merchant_email } = body
    
    if (!organization_id) {
      return NextResponse.json({ error: "Organization ID is required" }, { status: 400 })
    }
    
    const db = createClient()
    
    // Check if customer already exists
    const existingCustomer = await db.execute(
      "SELECT stripe_customer_id FROM stripe_subscriptions WHERE organization_id = ?",
      [organization_id]
    )
    
    let customerId: string | undefined
    
    if (existingCustomer.rows.length > 0 && existingCustomer.rows[0].stripe_customer_id) {
      customerId = existingCustomer.rows[0].stripe_customer_id
    } else if (merchant_email) {
      // Create a new customer if email provided
      const customer = await stripe.customers.create({
        email: merchant_email,
        metadata: {
          organization_id: organization_id
        }
      })
      customerId = customer.id
    }
    
    // Get the price ID for $49/month plan
    // You should create this price in your Stripe Dashboard first
    const priceId = process.env.STRIPE_MONTHLY_PRICE_ID || "price_YOUR_PRICE_ID"
    
    // Create Checkout Session
    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      customer_email: !customerId ? merchant_email : undefined,
      billing_address_collection: 'auto',
      allow_promotion_codes: true,
      line_items: [
        {
          price: priceId,
          quantity: 1,
        },
      ],
      mode: 'subscription',
      success_url: `${process.env.NEXT_PUBLIC_APP_URL}/api/stripe/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${process.env.NEXT_PUBLIC_APP_URL}/api/stripe/cancel`,
      subscription_data: {
        trial_period_days: 30, // 30-day free trial
        metadata: {
          organization_id: organization_id
        }
      },
      metadata: {
        organization_id: organization_id
      }
    })
    
    logger.info("Stripe checkout session created", {
      organization_id,
      session_id: session.id,
      customer_id: customerId
    })
    
    return NextResponse.json({ 
      url: session.url,
      session_id: session.id 
    })
    
  } catch (error: any) {
    logger.error("Error creating checkout session:", error)
    return NextResponse.json(
      { error: error.message || "Failed to create checkout session" },
      { status: 500 }
    )
  }
}