import { NextResponse, type NextRequest } from "next/server"
import { createClient } from "@/lib/db"
import crypto from 'crypto'

export async function POST(request: NextRequest) {
  try {
    const body = await request.text()
    const signature = request.headers.get('x-square-hmacsha256-signature')
    
    // Verify webhook signature
    if (!verifySquareWebhook(body, signature)) {
      console.error("Invalid webhook signature")
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const event = JSON.parse(body)
    console.log("Received subscription webhook", { 
      event_type: event.type,
      subscription_id: event.data?.object?.subscription?.id 
    })

    const db = createClient()

    switch (event.type) {
      case 'subscription.updated':
        await handleSubscriptionUpdated(db, event.data.object.subscription)
        break
        
      case 'invoice.payment_made':
        await handlePaymentMade(db, event.data.object)
        break
        
      case 'payment.updated':
        if (event.data.object.status === 'FAILED') {
          await handlePaymentFailed(db, event.data.object)
        }
        break
        
      default:
        console.log("Unhandled webhook event type", { event_type: event.type })
    }

    return NextResponse.json({ received: true })

  } catch (error: any) {
    console.error("Error processing subscription webhook", error)
    return NextResponse.json({ error: "Webhook processing failed" }, { status: 500 })
  }
}

function verifySquareWebhook(body: string, signature: string | null): boolean {
  if (!signature) return false
  
  const webhookSignatureKey = process.env.SQUARE_WEBHOOK_SIGNATURE_KEY
  if (!webhookSignatureKey) {
    console.error("SQUARE_WEBHOOK_SIGNATURE_KEY not configured")
    return false
  }

  const expectedSignature = 'sha256=' + crypto
    .createHmac('sha256', webhookSignatureKey)
    .update(body)
    .digest('base64')

  return crypto.timingSafeEqual(
    Buffer.from(signature),
    Buffer.from(expectedSignature)
  )
}

async function handleSubscriptionUpdated(db: any, subscription: any) {
  console.log("Processing subscription updated", { 
    subscription_id: subscription.id,
    status: subscription.status 
  })
  
  const newStatus = mapSquareStatusToOurStatus(subscription.status)
  
  await db.execute(
    `UPDATE subscriptions 
     SET status = ?, 
         current_period_start = ?,
         current_period_end = ?,
         canceled_at = ?
     WHERE square_subscription_id = ?`,
    [
      newStatus,
      subscription.charged_through_date ? new Date(subscription.charged_through_date) : null,
      subscription.paid_until_date ? new Date(subscription.paid_until_date) : null,
      subscription.canceled_date ? new Date(subscription.canceled_date) : null,
      subscription.id
    ]
  )
}

async function handlePaymentMade(db: any, invoice: any) {
  if (!invoice.subscription_id) return
  
  console.log("Processing payment made", { 
    invoice_id: invoice.id,
    subscription_id: invoice.subscription_id 
  })

  await db.execute(
    `UPDATE subscriptions 
     SET status = 'active'
     WHERE square_subscription_id = ? AND status IN ('pending', 'trial_ended')`,
    [invoice.subscription_id]
  )
}

async function handlePaymentFailed(db: any, payment: any) {
  console.error("Processing payment failed", { 
    payment_id: payment.id
  })

  // Find subscription by payment and deactivate
  const result = await db.execute(
    "SELECT square_subscription_id FROM subscriptions WHERE organization_id = ?",
    [payment.reference_id] // Assuming reference_id contains organization_id
  )

  if (result.rows.length > 0) {
    await db.execute(
      `UPDATE subscriptions 
       SET status = 'deactivated'
       WHERE square_subscription_id = ?`,
      [result.rows[0].square_subscription_id]
    )
  }
}

function mapSquareStatusToOurStatus(squareStatus: string): string {
  switch (squareStatus) {
    case 'ACTIVE':
      return 'active'
    case 'CANCELED':
      return 'canceled'
    case 'DEACTIVATED':
      return 'deactivated'
    case 'PAUSED':
      return 'paused'
    case 'PENDING':
      return 'pending'
    default:
      return 'pending'
  }
}