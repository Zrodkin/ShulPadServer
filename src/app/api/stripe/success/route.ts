// app/api/stripe/success/route.ts
import { NextResponse } from "next/server"
import Stripe from "stripe"
import { createClient } from "@/lib/db"
import { logger } from "@/lib/logger"

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!)

// Helper to convert Date to MySQL format
function toMySQLDateTime(date: Date): string {
  return date.toISOString().slice(0, 19).replace('T', ' ')
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const sessionId = searchParams.get('session_id')
  
  // If we have a session ID, create the subscription record immediately
  if (sessionId) {
    try {
      // Retrieve the session with expanded subscription data
      const session = await stripe.checkout.sessions.retrieve(sessionId, {
        expand: ['subscription', 'customer']
      })
      
      // Check if this is a completed session with a subscription
      if (session.status === 'complete' && session.subscription) {
        const organizationId = session.metadata?.organization_id
        
        if (organizationId) {
          const subscription = typeof session.subscription === 'string' 
            ? await stripe.subscriptions.retrieve(session.subscription)
            : session.subscription as Stripe.Subscription
          
          const db = createClient()
          
          // Create or update the subscription record
          await db.execute(`
            INSERT INTO stripe_subscriptions (
              organization_id,
              stripe_customer_id,
              stripe_subscription_id,
              status,
              current_period_start,
              current_period_end,
              trial_end
            ) VALUES (?, ?, ?, ?, ?, ?, ?)
            ON DUPLICATE KEY UPDATE
              stripe_customer_id = VALUES(stripe_customer_id),
              stripe_subscription_id = VALUES(stripe_subscription_id),
              status = VALUES(status),
              current_period_start = VALUES(current_period_start),
              current_period_end = VALUES(current_period_end),
              trial_end = VALUES(trial_end),
              updated_at = NOW()
          `, [
            organizationId,
            session.customer,
            subscription.id,
            subscription.status,
            toMySQLDateTime(new Date((subscription as any).current_period_start * 1000)),
            toMySQLDateTime(new Date((subscription as any).current_period_end * 1000)),
            subscription.trial_end ? toMySQLDateTime(new Date((subscription as any).trial_end * 1000)) : null
          ])
          
          logger.info("Subscription created from success page", {
            organization_id: organizationId,
            subscription_id: subscription.id,
            session_id: sessionId
          })
        }
      }
    } catch (error: any) {
      // Log error but don't break the success page
      logger.error("Failed to create subscription on success page", {
        error: error.message,
        session_id: sessionId
      })
    }
  }
  
  // Return the success HTML page
  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <title>Subscription Successful!</title>
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <style>
        body {
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
          display: flex;
          justify-content: center;
          align-items: center;
          min-height: 100vh;
          margin: 0;
          background-color: #f0f2f5;
        }
        .container {
          text-align: center;
          padding: 40px;
          background: white;
          border-radius: 12px;
          box-shadow: 0 2px 10px rgba(0,0,0,0.1);
          max-width: 400px;
          margin: 20px;
        }
        .success-icon {
          width: 80px;
          height: 80px;
          margin: 0 auto 20px;
          background-color: #10b981;
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
        }
        .checkmark {
          width: 40px;
          height: 40px;
          stroke: white;
          stroke-width: 3;
          fill: none;
          stroke-linecap: round;
          stroke-linejoin: round;
        }
        h1 {
          color: #1f2937;
          font-size: 24px;
          margin-bottom: 10px;
        }
        p {
          color: #6b7280;
          line-height: 1.5;
          margin-bottom: 30px;
        }
        .button {
          display: inline-block;
          padding: 12px 24px;
          background-color: #3b82f6;
          color: white;
          text-decoration: none;
          border-radius: 8px;
          font-weight: 600;
          transition: background-color 0.2s;
        }
        .button:hover {
          background-color: #2563eb;
        }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="success-icon">
          <svg class="checkmark" viewBox="0 0 24 24">
            <path d="M5 13l4 4L19 7"></path>
          </svg>
        </div>
        <h1>Welcome to ShulPad!</h1>
        <p>Your subscription is now active with a 30-day free trial. You can close this window and return to the app to start using the kiosk.</p>
        <a href="shulpad://subscription-success${sessionId ? `?session_id=${sessionId}` : ''}" class="button">Return to App</a>
      </div>
      
      <script>
        // Automatically redirect to the app after 2 seconds
        setTimeout(() => {
          window.location.href = "shulpad://subscription-success${sessionId ? `?session_id=${sessionId}` : ''}";
        }, 2000);
      </script>
    </body>
    </html>
  `
  
  return new NextResponse(html, {
    headers: { 'Content-Type': 'text/html' }
  })
}