// app/api/stripe/create-portal-session/route.ts
import { NextResponse } from "next/server"
import Stripe from "stripe"
import { createClient } from "@/lib/db"
import { logger } from "@/lib/logger"

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!,)

export async function POST(request: Request) {
  try {
    const body = await request.json()
    const { organization_id, session_id } = body
    
    if (!organization_id && !session_id) {
      return NextResponse.json({ 
        error: "Either organization_id or session_id is required" 
      }, { status: 400 })
    }
    
    const db = createClient()
    let customerId: string | null = null
    
    // Get customer ID from organization
    if (organization_id) {
      const result = await db.execute(
        "SELECT stripe_customer_id FROM stripe_subscriptions WHERE organization_id = ?",
        [organization_id]
      )
      
      if (result.rows.length > 0) {
        customerId = result.rows[0].stripe_customer_id
      }
    }
    
    // If no customer ID from org, try getting from session
    if (!customerId && session_id) {
      const checkoutSession = await stripe.checkout.sessions.retrieve(session_id)
      customerId = checkoutSession.customer as string
    }
    
    if (!customerId) {
      return NextResponse.json({ 
        error: "No customer found for this organization" 
      }, { status: 404 })
    }
    
    // Create portal session
    const portalSession = await stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: `${process.env.NEXT_PUBLIC_APP_URL}/subscription/manage`,
    })
    
    logger.info("Stripe portal session created", {
      organization_id,
      customer_id: customerId,
      portal_url: portalSession.url
    })
    
    return NextResponse.json({ 
      url: portalSession.url 
    })
    
  } catch (error: any) {
    logger.error("Error creating portal session:", error)
    return NextResponse.json(
      { error: error.message || "Failed to create portal session" },
      { status: 500 }
    )
  }
}