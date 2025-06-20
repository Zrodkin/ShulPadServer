import { NextResponse, type NextRequest } from "next/server"
import { createClient } from "@/lib/db"

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const organization_id = searchParams.get('organization_id')
    const device_id = searchParams.get('device_id')

    if (!organization_id) {
      return NextResponse.json({ error: "Organization ID required" }, { status: 400 })
    }

    const db = createClient()

    // Get current subscription
    const result = await db.execute(
      `SELECT s.*, p.extra_device_price_cents 
       FROM subscriptions s 
       LEFT JOIN subscription_plans p ON s.plan_type = p.plan_type 
       WHERE s.organization_id = ? AND s.status IN ('active', 'pending') 
       ORDER BY s.created_at DESC LIMIT 1`,
      [organization_id]
    )

    if (result.rows.length === 0) {
      return NextResponse.json({
        has_subscription: false,
        can_launch_kiosk: false,
        message: "No active subscription found"
      })
    }

    const subscription = result.rows[0]
    const now = new Date()
    const trialEndDate = new Date(subscription.trial_end_date)

    // Check if still in trial period
    const inTrialPeriod = now < trialEndDate

    // If device_id provided, register/update device
    if (device_id) {
      await db.execute(
        `INSERT INTO device_registrations (organization_id, device_id, last_active) 
         VALUES (?, ?, NOW()) 
         ON DUPLICATE KEY UPDATE last_active = NOW(), status = 'active'`,
        [organization_id, device_id]
      )

      // Count active devices
      const deviceCountResult = await db.execute(
        "SELECT COUNT(*) as device_count FROM device_registrations WHERE organization_id = ? AND status = 'active'",
        [organization_id]
      )

      const currentDeviceCount = deviceCountResult.rows[0].device_count

      // Check if exceeding device limit
      if (currentDeviceCount > subscription.device_count) {
        return NextResponse.json({
          has_subscription: true,
          can_launch_kiosk: false,
          message: `Device limit exceeded. Current plan allows ${subscription.device_count} device(s), but ${currentDeviceCount} are active.`,
          upgrade_needed: true,
          current_device_count: currentDeviceCount,
          allowed_device_count: subscription.device_count,
          additional_cost: subscription.extra_device_price_cents / 100
        })
      }
    }

    // Check subscription status
    const canLaunchKiosk = subscription.status === 'active'

    return NextResponse.json({
      has_subscription: true,
      can_launch_kiosk: canLaunchKiosk,
      subscription: {
        id: subscription.id,
        plan_type: subscription.plan_type,
        device_count: subscription.device_count,
        status: subscription.status,
        trial_end_date: subscription.trial_end_date,
        in_trial_period: inTrialPeriod,
        total_price: subscription.total_price_cents / 100
      },
      message: canLaunchKiosk ? "Subscription active" : "Subscription inactive"
    })

  } catch (error: any) {
    console.error("Error checking subscription status", error)
    return NextResponse.json({ error: "Failed to check subscription status" }, { status: 500 })
  }
}