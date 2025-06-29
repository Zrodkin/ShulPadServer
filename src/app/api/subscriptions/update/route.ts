// ==========================================
// 6. UPDATE SUBSCRIPTION (Change Plan/Devices)
// app/api/subscriptions/update/route.ts
// ==========================================
export async function POST(request: Request) {
  try {
    const body = await request.json()
    const { merchant_id, new_plan_type, new_device_count } = body

    if (!merchant_id) {
      return NextResponse.json({ error: "Missing merchant_id" }, { status: 400 })
    }

    const db = createClient()

    // Get current subscription
    const result = await db.execute(
      `SELECT s.*, sc.access_token 
       FROM subscriptions s
       JOIN square_connections sc ON s.merchant_id = sc.merchant_id
       WHERE s.merchant_id = ? AND s.status = 'active'
       ORDER BY s.created_at DESC 
       LIMIT 1`,
      [merchant_id]
    )

    if (result.rows.length === 0) {
      return NextResponse.json({ error: "No active subscription found" }, { status: 404 })
    }

    const subscription = result.rows[0]
    const planChanged = new_plan_type && new_plan_type !== subscription.plan_type
    const devicesChanged = new_device_count && new_device_count !== subscription.device_count

    if (!planChanged && !devicesChanged) {
      return NextResponse.json({ error: "No changes requested" }, { status: 400 })
    }

    // Calculate new pricing
    const finalPlanType = new_plan_type || subscription.plan_type
    const finalDeviceCount = new_device_count || subscription.device_count
    
    const basePrices = {
      monthly: 9900,
      yearly: 99900
    }
    
    const extraDevicePrice = finalPlanType === 'monthly' ? 1000 : 10000
    const newBasePrice = basePrices[finalPlanType]
    const newTotalPrice = newBasePrice + ((finalDeviceCount - 1) * extraDevicePrice)

    // Handle free subscriptions
    if (subscription.square_subscription_id.startsWith('free_')) {
      await db.execute(
        `UPDATE subscriptions 
         SET plan_type = ?,
             device_count = ?,
             base_price_cents = ?,
             total_price_cents = ?,
             updated_at = NOW()
         WHERE id = ?`,
        [finalPlanType, finalDeviceCount, newBasePrice, newTotalPrice, subscription.id]
      )

      return NextResponse.json({
        success: true,
        subscription: {
          id: subscription.square_subscription_id,
          plan_type: finalPlanType,
          device_count: finalDeviceCount,
          total_price: newTotalPrice / 100
        }
      })
    }

    // For paid subscriptions, update in Square
    const SQUARE_ENVIRONMENT = process.env.SQUARE_ENVIRONMENT || "production"
    const SQUARE_DOMAIN = SQUARE_ENVIRONMENT === "production" ? "squareup.com" : "squareupsandbox.com"

    try {
      // Cancel current subscription
      await axios.post(
        `https://connect.${SQUARE_DOMAIN}/v2/subscriptions/${subscription.square_subscription_id}/cancel`,
        {},
        {
          headers: {
            "Square-Version": "2025-06-18",
            "Authorization": `Bearer ${subscription.access_token}`
          }
        }
      )

      // Create new subscription with updated terms
      const newPhases = [{
        ordinal: 0,
        plan_phase_pricing: {
          pricing: {
            price_money: { 
              amount: newTotalPrice, 
              currency: "USD" 
            }
          }
        }
      }]

      const newSubResponse = await axios.post(
        `https://connect.${SQUARE_DOMAIN}/v2/subscriptions`,
        {
          idempotency_key: `sub_update_${merchant_id}_${Date.now()}`,
          location_id: subscription.location_id,
          customer_id: subscription.square_customer_id,
          card_id: subscription.square_card_id,
          start_date: new Date().toISOString().split('T')[0],
          phases: newPhases,
          source: { name: "ShulPad" }
        },
        {
          headers: {
            "Square-Version": "2025-06-18",
            "Authorization": `Bearer ${subscription.access_token}`,
            "Content-Type": "application/json"
          }
        }
      )

      const newSubscription = newSubResponse.data.subscription

      // Update database
      await db.execute(
        `UPDATE subscriptions 
         SET square_subscription_id = ?,
             plan_type = ?,
             device_count = ?,
             base_price_cents = ?,
             total_price_cents = ?,
             updated_at = NOW()
         WHERE id = ?`,
        [
          subscription.id,
          JSON.stringify({
            old_plan: subscription.plan_type,
            new_plan: finalPlanType,
            old_devices: subscription.device_count,
            new_devices: finalDeviceCount
          })
        ]
      )

      return NextResponse.json({
        success: true,
        subscription: {
          id: newSubscription.id,
          plan_type: finalPlanType,
          device_count: finalDeviceCount,
          total_price: newTotalPrice / 100
        }
      })

    } catch (squareError: any) {
      console.error("Square API Error:", squareError.response?.data)
      return NextResponse.json({ 
        error: "Failed to update subscription",
        details: squareError.response?.data?.errors || squareError.message
      }, { status: 500 })
    }

  } catch (error: any) {
    console.error("Error updating subscription:", error)
    return NextResponse.json({ 
      error: "Failed to update subscription",
      details: error.message 
    }, { status: 500 })
  }
}