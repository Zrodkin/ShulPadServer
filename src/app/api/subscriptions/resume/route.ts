// ==========================================
// 5. RESUME SUBSCRIPTION
// app/api/subscriptions/resume/route.ts
// ==========================================
export async function POST(request: Request) {
  try {
    const body = await request.json()
    const { merchant_id } = body

    if (!merchant_id) {
      return NextResponse.json({ error: "Missing merchant_id" }, { status: 400 })
    }

    const db = createClient()

    // Get paused subscription
    const result = await db.execute(
      `SELECT s.*, sc.access_token 
       FROM subscriptions s
       JOIN square_connections sc ON s.merchant_id = sc.merchant_id
       WHERE s.merchant_id = ? AND s.status = 'paused'
       ORDER BY s.created_at DESC 
       LIMIT 1`,
      [merchant_id]
    )

    if (result.rows.length === 0) {
      return NextResponse.json({ error: "No paused subscription found" }, { status: 404 })
    }

    const subscription = result.rows[0]

    // Handle free subscriptions
    if (subscription.square_subscription_id.startsWith('free_')) {
      await db.execute(
        `UPDATE subscriptions 
         SET status = 'active', updated_at = NOW()
         WHERE id = ?`,
        [subscription.id]
      )

      return NextResponse.json({
        success: true,
        subscription: {
          id: subscription.square_subscription_id,
          status: 'active'
        }
      })
    }

    // Resume in Square
    const SQUARE_ENVIRONMENT = process.env.SQUARE_ENVIRONMENT || "production"
    const SQUARE_DOMAIN = SQUARE_ENVIRONMENT === "production" ? "squareup.com" : "squareupsandbox.com"

    try {
      const resumeResponse = await axios.post(
        `https://connect.${SQUARE_DOMAIN}/v2/subscriptions/${subscription.square_subscription_id}/resume`,
        {},
        {
          headers: {
            "Square-Version": "2025-06-18",
            "Authorization": `Bearer ${subscription.access_token}`
          }
        }
      )

      // Update local database
      await db.execute(
        `UPDATE subscriptions 
         SET status = 'active', updated_at = NOW()
         WHERE id = ?`,
        [subscription.id]
      )

      // Log resume event
      await db.execute(
        `INSERT INTO subscription_events 
         (subscription_id, event_type, event_data, created_at)
         VALUES (?, 'resumed', ?, NOW())`,
        [subscription.id, JSON.stringify({})]
      )

      return NextResponse.json({
        success: true,
        subscription: resumeResponse.data.subscription
      })

    } catch (squareError: any) {
      console.error("Square API Error:", squareError.response?.data)
      return NextResponse.json({ 
        error: "Failed to resume subscription",
        details: squareError.response?.data?.errors || squareError.message
      }, { status: 500 })
    }

  } catch (error: any) {
    console.error("Error resuming subscription:", error)
    return NextResponse.json({ 
      error: "Failed to resume subscription",
      details: error.message 
    }, { status: 500 })
  }
}