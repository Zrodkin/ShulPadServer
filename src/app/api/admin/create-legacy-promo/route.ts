import { NextResponse } from "next/server"
import { createClient } from "@/lib/db"

export async function POST() {
  try {
    const db = createClient()

    const promoCode = "LEGACY30FREE"
    
    await db.execute(
      `INSERT INTO promo_codes (
        code, discount_type, discount_value, max_uses, 
        valid_until, created_for_existing_users, active
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE active = TRUE`,
      [
        promoCode,
        'percentage',
        50, // 50% off
        1000, // Limit to 1000 uses
        new Date(Date.now() + 90 * 24 * 60 * 60 * 1000), // Valid for 90 days
        true,
        true
      ]
    )

    return NextResponse.json({
      success: true,
      promo_code: promoCode,
      message: "Legacy promo code created for existing users"
    })

  } catch (error: any) {
    console.error("Error creating legacy promo code", error)
    return NextResponse.json({ error: "Failed to create promo code" }, { status: 500 })
  }
}