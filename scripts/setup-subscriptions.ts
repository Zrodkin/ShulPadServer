// ==========================================
// FIXED SUBSCRIPTION SETUP SCRIPT
// scripts/setup-subscriptions.ts
// ==========================================

import { createClient } from "@/lib/db"
import axios from "axios"
import dotenv from 'dotenv'
import path from 'path'

// Load environment variables
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })

async function setupSubscriptions() {
  console.log("🚀 Setting up Square Subscriptions...")

  try {
    // 1. Run database migrations
    await runDatabaseMigrations()
    
    // 2. SKIP Square plan creation - we'll use custom phases
    console.log("✅ Using custom phases approach - no plans needed")
    
    // 3. Configure webhook endpoints
    await configureWebhooks()
    
    console.log("✅ Subscription setup completed successfully!")
    
  } catch (error) {
    console.error("❌ Setup failed:", error)
    process.exit(1)
  }
}

async function runDatabaseMigrations() {
  console.log("📊 Running database migrations...")
  
  const db = createClient()
  
  // Enhanced subscriptions table
  await db.execute(`
    CREATE TABLE IF NOT EXISTS subscriptions (
      id INT AUTO_INCREMENT PRIMARY KEY,
      organization_id VARCHAR(255) NOT NULL,
      square_subscription_id VARCHAR(255) UNIQUE,
      plan_type ENUM('monthly', 'yearly') NOT NULL,
      device_count INT DEFAULT 1,
      base_price_cents INT NOT NULL,
      total_price_cents INT NOT NULL,
      status ENUM('pending', 'active', 'paused', 'canceled', 'deactivated') DEFAULT 'pending',
      trial_end_date TIMESTAMP NULL,
      current_period_start TIMESTAMP NULL,
      current_period_end TIMESTAMP NULL,
      canceled_at TIMESTAMP NULL,
      promo_code VARCHAR(50) NULL,
      promo_discount_cents INT DEFAULT 0,
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP NOT NULL DEFAULT NOW() ON UPDATE NOW(),
      INDEX idx_org_id (organization_id),
      INDEX idx_square_sub_id (square_subscription_id),
      INDEX idx_status (status),
      INDEX idx_plan_type (plan_type)
    )
  `)

  // Subscription events table for audit trail
  await db.execute(`
    CREATE TABLE IF NOT EXISTS subscription_events (
      id INT AUTO_INCREMENT PRIMARY KEY,
      subscription_id INT NOT NULL,
      event_type ENUM('created', 'activated', 'deactivated', 'canceled', 'paused', 'resumed', 'updated', 'payment_made', 'payment_failed', 'plan_changed') NOT NULL,
      metadata JSON,
      created_at TIMESTAMP DEFAULT NOW(),
      INDEX idx_subscription_id (subscription_id),
      INDEX idx_event_type (event_type),
      INDEX idx_created_at (created_at)
    )
  `)

  // Device registrations table
  await db.execute(`
    CREATE TABLE IF NOT EXISTS device_registrations (
      id INT AUTO_INCREMENT PRIMARY KEY,
      organization_id VARCHAR(255) NOT NULL,
      device_id VARCHAR(255) NOT NULL,
      device_name VARCHAR(255),
      last_active TIMESTAMP DEFAULT NOW(),
      status ENUM('active', 'inactive') DEFAULT 'active',
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP NOT NULL DEFAULT NOW() ON UPDATE NOW(),
      UNIQUE KEY unique_org_device (organization_id, device_id),
      INDEX idx_org_id (organization_id),
      INDEX idx_status (status)
    )
  `)

  // Promo codes table
  await db.execute(`
    CREATE TABLE IF NOT EXISTS promo_codes (
      id INT AUTO_INCREMENT PRIMARY KEY,
      code VARCHAR(50) UNIQUE NOT NULL,
      discount_type ENUM('percentage', 'fixed_amount') NOT NULL,
      discount_value INT NOT NULL,
      max_uses INT DEFAULT NULL,
      used_count INT DEFAULT 0,
      valid_until TIMESTAMP NULL,
      created_for_existing_users BOOLEAN DEFAULT FALSE,
      active BOOLEAN DEFAULT TRUE,
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      INDEX idx_code (code),
      INDEX idx_active (active),
      INDEX idx_valid_until (valid_until)
    )
  `)

  // Webhook events table for idempotency
  await db.execute(`
    CREATE TABLE IF NOT EXISTS webhook_events (
      id VARCHAR(255) PRIMARY KEY,
      event_type VARCHAR(100) NOT NULL,
      processed_at TIMESTAMP DEFAULT NOW(),
      processing_result JSON,
      INDEX idx_event_type (event_type),
      INDEX idx_processed_at (processed_at)
    )
  `)

  console.log("✅ Database migrations completed")
}

async function configureWebhooks() {
  console.log("🔗 Configuring webhooks...")

  const accessToken = process.env.SQUARE_ACCESS_TOKEN
  const webhookUrl = process.env.SQUARE_WEBHOOK_URL || `${process.env.VERCEL_URL || 'https://your-domain.com'}/api/subscriptions/webhook`
  const SQUARE_ENVIRONMENT = process.env.SQUARE_ENVIRONMENT || "production"
  const SQUARE_DOMAIN = SQUARE_ENVIRONMENT === "production" ? "squareup.com" : "squareupsandbox.com"

  if (!accessToken) {
    console.warn("⚠️ SQUARE_ACCESS_TOKEN not configured, skipping webhook setup")
    return
  }

  try {
    const response = await axios.post(
      `https://connect.${SQUARE_DOMAIN}/v2/webhooks`,
      {
        subscription: {
          name: "ShulPad Subscription Webhooks",
          notification_url: webhookUrl,
          event_types: [
            "subscription.created",
            "subscription.updated", 
            "invoice.payment_made",
            "invoice.payment_failed",
            "payment.updated"
          ]
        }
      },
      {
        headers: {
          "Square-Version": "2025-06-18",
          "Authorization": `Bearer ${accessToken}`,
          "Content-Type": "application/json"
        }
      }
    )

    console.log("✅ Webhook configured:", {
      webhook_id: response.data.subscription.id,
      url: webhookUrl
    })

  } catch (error: any) {
    if (error.response?.status === 409) {
      console.log("ℹ️ Webhook already exists")
    } else {
      console.error("❌ Failed to configure webhook:", error.response?.data || error.message)
    }
  }
}

// ==========================================
// ENVIRONMENT CONFIGURATION
// ==========================================

function validateEnvironment() {
  const required = [
    'SQUARE_ACCESS_TOKEN',
    'SQUARE_APP_ID', 
    'SHULPAD_SQUARE_LOCATION_ID',
    'SQUARE_WEBHOOK_SIGNATURE_KEY',
    'DATABASE_URL'
  ]

  const missing = required.filter(key => !process.env[key])
  
  if (missing.length > 0) {
    console.error("❌ Missing required environment variables:", missing)
    console.log("\n📋 Add these to your .env.local file:")
    missing.forEach(key => {
      console.log(`${key}=your_${key.toLowerCase()}`)
    })
    process.exit(1)
  }

  console.log("✅ Environment configuration validated")
}

// ==========================================
// MAIN SETUP FUNCTION
// ==========================================

async function main() {
  console.log("🚀 Starting ShulPad Subscription Setup\n")
  
  validateEnvironment()
  await setupSubscriptions()
  
  console.log("\n🎉 Setup completed successfully!")
  console.log("\n📋 Next steps:")
  console.log("1. Test subscription creation via /api/subscriptions/create")
  console.log("2. Verify webhook events are being received")
  console.log("3. Test subscription management features")
  console.log("4. Configure your iOS app to use the new endpoints")
  console.log("\n💡 Using custom phases approach - no subscription plans needed!")
  
  process.exit(0)
}

// Run setup if this file is executed directly
if (require.main === module) {
  main().catch(error => {
    console.error("❌ Setup failed:", error)
    process.exit(1)
  })
}

export { validateEnvironment }