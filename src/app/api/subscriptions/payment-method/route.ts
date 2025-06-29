// ==========================================
// 8. UPDATE PAYMENT METHOD
// app/api/subscriptions/payment-method/route.ts
// ==========================================
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
    const result = await db.execute(
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

    if (result.rows.length === 0) {
      return NextResponse.json({ error: "No active subscription found" }, { status: 404 })
    }

    const subscription = result.rows[0]

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

    } catch (squareError: any) {
      console.error("Square API Error:", squareError.response?.data)
      return NextResponse.json({ 
        error: "Failed to update payment method",
        details: squareError.response?.data?.errors || squareError.message
      }, { status: 500 })
    }

  } catch (error: any) {
    console.error("Error updating payment method:", error)
    return NextResponse.json({ 
      error: "Failed to update payment method",
      details: error.message 
    }, { status: 500 })
  }
}