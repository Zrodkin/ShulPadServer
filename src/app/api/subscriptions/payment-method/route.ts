// ==========================================
// 8. UPDATE PAYMENT METHOD
// app/api/subscriptions/payment-method/route.ts
// ==========================================
import { NextResponse } from 'next/server';
import mysql from 'mysql2/promise';
import axios from 'axios';

export async function POST(request: Request) {
  try {
    const body = await request.json()
    const { merchant_id, source_id } = body

    if (!merchant_id || !source_id) {
      return NextResponse.json({ 
        error: "Missing required fields",
        details: { merchant_id: !merchant_id, source_id: !source_id }
      }, { status: 400 })
    }

    const db = createClient()

    // Get subscription and connection info
    const [rows] = await db.execute(
      `SELECT 
        s.*,
        sc.access_token
       FROM subscriptions s
       JOIN square_connections sc ON s.merchant_id = sc.merchant_id
       WHERE s.merchant_id = ? 
       AND s.status IN ('active', 'paused')
       ORDER BY s.created_at DESC 
       LIMIT 1`,
      [merchant_id]
    )

    if ((rows as any[]).length === 0) {
      return NextResponse.json({ error: "No active subscription found" }, { status: 404 })
    }

    const subscription = (rows as any[])[0]

    if (subscription.square_subscription_id.startsWith('free_')) {
      return NextResponse.json({ 
        error: "Cannot update payment method for free subscription" 
      }, { status: 400 })
    }

    const SQUARE_ENVIRONMENT = process.env.SQUARE_ENVIRONMENT || "production"
    const SQUARE_DOMAIN = SQUARE_ENVIRONMENT === "production" ? "squareup.com" : "squareupsandbox.com"

    try {
      // Create new card
      const cardResponse = await axios.post(
        `https://connect.${SQUARE_DOMAIN}/v2/cards`,
        {
          idempotency_key: `card_update_${merchant_id}_${Date.now()}`,
          source_id: source_id,
          card: { customer_id: subscription.square_customer_id }
        },
        {
          headers: {
            "Square-Version": "2025-06-18",
            "Authorization": `Bearer ${subscription.access_token}`,
            "Content-Type": "application/json"
          }
        }
      )

      const newCardId = cardResponse.data.card.id

      // Update subscription with new card
      const updateResponse = await axios.put(
        `https://connect.${SQUARE_DOMAIN}/v2/subscriptions/${subscription.square_subscription_id}`,
        {
          subscription: {
            card_id: newCardId,
            version: subscription.square_version
          }
        },
        {
          headers: {
            "Square-Version": "2025-06-18",
            "Authorization": `Bearer ${subscription.access_token}`,
            "Content-Type": "application/json"
          }
        }
      )

      // Update database
      await db.execute(
        `UPDATE subscriptions 
         SET square_card_id = ?,
             square_version = ?,
             updated_at = NOW()
         WHERE id = ?`,
        [newCardId, updateResponse.data.subscription.version, subscription.id]
      )

      // Log event
      await db.execute(
        `INSERT INTO subscription_events 
         (subscription_id, event_type, event_data, created_at)
         VALUES (?, 'payment_method_updated', ?, NOW())`,
        [subscription.id, JSON.stringify({ new_card_id: newCardId })]
      )

      return NextResponse.json({
        success: true,
        card: {
          id: newCardId,
          brand: cardResponse.data.card.card_brand,
          last_four: cardResponse.data.card.last_4
        }
      })

   } catch (squareError) {
      if (squareError instanceof Error && 'response' in squareError && squareError.response) {
        const axiosError = squareError as any;
        console.error("Square API Error:", axiosError.response?.data);
        return NextResponse.json({ 
          error: "Failed to update payment method",
          details: axiosError.response?.data?.errors || axiosError.message
        }, { status: 500 });
      }
      console.error("Square API Error:", squareError);
      return NextResponse.json({ 
        error: "Failed to update payment method",
        details: String(squareError)
      }, { status: 500 });
    }

  } catch (error: any) {
    console.error("Error updating payment method:", error)
    return NextResponse.json({ 
      error: "Failed to update payment method",
      details: error.message 
    }, { status: 500 })
  }
}
function createClient() {
    // You may want to load these from environment variables in production
    const connection = mysql.createPool({
        host: process.env.DB_HOST || 'localhost',
        user: process.env.DB_USER || 'root',
        password: process.env.DB_PASSWORD || '',
        database: process.env.DB_NAME || 'shulpad',
        waitForConnections: true,
        connectionLimit: 10,
        queueLimit: 0,
    });
    return connection;
}
