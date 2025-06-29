// ==========================================
// COMPLETE SUBSCRIPTION SETUP SCRIPT
// scripts/setup-subscriptions-complete.ts
// ==========================================

import { createClient } from "@/lib/db"
import axios from "axios"
import dotenv from 'dotenv'
import path from 'path'
import { promises as fs } from 'fs'

// Load environment variables
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })

const REQUIRED_ENV_VARS = [
  'SQUARE_ACCESS_TOKEN',
  'SQUARE_APP_ID',
  'SHULPAD_SQUARE_LOCATION_ID', 
  'SQUARE_WEBHOOK_SIGNATURE_KEY',
  'DATABASE_URL',
  'SQUARE_ENVIRONMENT'
]

async function main() {
  console.log("🚀 ShulPad Subscription System Setup\n")
  
  try {
    // 1. Validate environment
    validateEnvironment()
    
    // 2. Run database migrations
    await setupDatabase()
    
    // 3. Configure Square webhooks
    await configureWebhooks()
    
    // 4. Create test data (optional)
    if (process.argv.includes('--with-test-data')) {
      await createTestData()
    }
    
    // 5. Verify setup
    await verifySetup()
    
    console.log("\n✅ Setup completed successfully!")
    console.log("\n📋 Next steps:")
    console.log("1. Test subscription creation at /subscription/checkout")
    console.log("2. Verify webhook endpoint at /api/subscriptions/webhook")
    console.log("3. Test management features at /subscription/manage")
    console.log("4. Monitor logs for webhook events")
    
  } catch (error) {
    console.error("\n❌ Setup failed:", error)
    process.exit(1)
  }
}

function validateEnvironment() {
  console.log("📋 Validating environment configuration...")
  
  const missing = REQUIRED_ENV_VARS.filter(key => !process.env[key])
  
  if (missing.length > 0) {
    console.error("\n❌ Missing required environment variables:")
    missing.forEach(key => {
      console.error(`   - ${key}`)
    })
    
    console.log("\n💡 Add these to your .env.local file:")
    console.log("```")
    missing.forEach(key => {
      console.log(`${key}=your_${key.toLowerCase().replace(/_/g, '_')}`)
    })
    console.log("```")
    
    throw new Error("Missing required environment variables")
  }
  
  // Validate Square environment
  const squareEnv = process.env.SQUARE_ENVIRONMENT
  if (squareEnv !== 'production' && squareEnv !== 'sandbox') {
    throw new Error("SQUARE_ENVIRONMENT must be 'production' or 'sandbox'")
  }
  
  console.log("✅ Environment configuration valid")
  console.log(`   - Square Environment: ${squareEnv}`)
}

async function setupDatabase() {
  console.log("\n📊 Setting up database...")
  
  const db = createClient()
  
  try {
    // Run all migrations from the schema file
    const schemaPath = path.join(process.cwd(), 'scripts', 'subscription-schema.sql')
    let schema
    
    try {
      schema = await fs.readFile(schemaPath, 'utf8')
    } catch {
      // If file doesn't exist, use inline schema
      schema = getInlineSchema()
    }
    
    // Split by semicolon and execute each statement
    const statements = schema
      .split(';')
      .map(s => s.trim())
      .filter(s => s.length > 0 && !s.startsWith('--'))
    
    for (const statement of statements) {
      try {
        await db.execute(statement)
        console.log("   ✓ Executed migration")
      } catch (error: any) {
        // Ignore "already exists" errors
        if (!error.message.includes('already exists')) {
          console.error("   ✗ Migration failed:", error.message)
          throw error
        }
      }
    }
    
    console.log("✅ Database setup complete")
    
  } catch (error) {
    throw new Error(`Database setup failed: ${error.message}`)
  }
}

async function configureWebhooks() {
  console.log("\n🔗 Configuring Square webhooks...")
  
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://api.shulpad.com'
  const webhookUrl = `${baseUrl}/api/subscriptions/webhook`
  
  const SQUARE_ENVIRONMENT = process.env.SQUARE_ENVIRONMENT || "production"
  const SQUARE_DOMAIN = SQUARE_ENVIRONMENT === "production" ? "squareup.com" : "squareupsandbox.com"
  const accessToken = process.env.SQUARE_ACCESS_TOKEN
  
  try {
    // First, list existing webhooks
    const listResponse = await axios.get(
      `https://connect.${SQUARE_DOMAIN}/v2/webhooks/subscriptions`,
      {
        headers: {
          "Square-Version": "2025-06-18",
          "Authorization": `Bearer ${accessToken}`,
          "Content-Type": "application/json"
        }
      }
    )
    
    // Check if webhook already exists
    const existingWebhook = listResponse.data.subscriptions?.find(
      (sub: any) => sub.notification_url === webhookUrl
    )
    
    if (existingWebhook) {
      console.log("   ℹ️  Webhook already configured")
      console.log(`   - ID: ${existingWebhook.id}`)
      console.log(`   - URL: ${webhookUrl}`)
      return
    }
    
    // Create new webhook subscription
    const response = await axios.post(
      `https://connect.${SQUARE_DOMAIN}/v2/webhooks/subscriptions`,
      {
        subscription: {
          name: "ShulPad Subscription Events",
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
    
    console.log("✅ Webhook configured successfully")
    console.log(`   - ID: ${response.data.subscription.id}`)
    console.log(`   - URL: ${webhookUrl}`)
    console.log(`   - Events: ${response.data.subscription.event_types.join(', ')}`)
    
  } catch (error: any) {
    if (error.response?.status === 409) {
      console.log("   ℹ️  Webhook already exists")
    } else {
      console.error("   ❌ Webhook configuration failed:", error.response?.data || error.message)
      throw error
    }
  }
}

async function createTestData() {
  console.log("\n🧪 Creating test data...")
  
  const db = createClient()
  
  try {
    // Insert test promo codes
    await db.execute(`
      INSERT IGNORE INTO promo_codes (code, description, discount_type, discount_value, active)
      VALUES 
        ('TESTLAUNCH', 'Test launch promo - 50% off', 'percentage', 50, true),
        ('TEST100OFF', 'Test $100 off', 'fixed_amount', 10000, true)
    `)
    
    console.log("✅ Test data created")
    
  } catch (error) {
    console.error("   ⚠️  Test data creation failed:", error.message)
  }
}

async function verifySetup() {
  console.log("\n🔍 Verifying setup...")
  
  const db = createClient()
  
  try {
    // Check database tables
    const tables = ['subscriptions', 'subscription_events', 'promo_codes', 'webhook_events']
    for (const table of tables) {
      const result = await db.execute(`SELECT COUNT(*) as count FROM ${table}`)
      console.log(`   ✓ Table '${table}' exists`)
    }
    
    // Check API endpoints
    const endpoints = [
      '/api/subscriptions/create',
      '/api/subscriptions/status',
      '/api/subscriptions/cancel',
      '/api/subscriptions/pause',
      '/api/subscriptions/resume',
      '/api/subscriptions/webhook'
    ]
    
    console.log("\n   📍 API Endpoints to implement:")
    endpoints.forEach(endpoint => {
      console.log(`      - ${endpoint}`)
    })
    
    console.log("\n✅ Setup verification complete")
    
  } catch (error) {
    console.error("   ❌ Verification failed:", error.message)
    throw error
  }
}

function getInlineSchema(): string {
  return `
    -- Main subscriptions table
    CREATE TABLE IF NOT EXISTS subscriptions (
      id INT AUTO_INCREMENT PRIMARY KEY,
      merchant_id VARCHAR(255) NOT NULL,
      square_subscription_id VARCHAR(255) UNIQUE NOT NULL,
      square_customer_id VARCHAR(255),
      square_card_id VARCHAR(255),
      square_version INT DEFAULT 0,
      plan_type ENUM('monthly', 'yearly') NOT NULL,
      device_count INT DEFAULT 1,
      base_price_cents INT NOT NULL,
      total_price_cents INT NOT NULL,
      promo_code VARCHAR(50),
      promo_discount_cents INT DEFAULT 0,
      status ENUM('pending', 'active', 'paused', 'canceled', 'deactivated', 'grace_period') DEFAULT 'pending',
      trial_end_date TIMESTAMP NULL,
      current_period_start TIMESTAMP NULL,
      current_period_end TIMESTAMP NULL,
      canceled_at TIMESTAMP NULL,
      grace_period_start TIMESTAMP NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_merchant_id (merchant_id),
      INDEX idx_square_sub_id (square_subscription_id),
      INDEX idx_status (status)
    );

    -- Subscription events table
    CREATE TABLE IF NOT EXISTS subscription_events (
      id INT AUTO_INCREMENT PRIMARY KEY,
      subscription_id INT NOT NULL,
      event_type VARCHAR(50) NOT NULL,
      event_data JSON,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_subscription_id (subscription_id)
    );

    -- Promo codes table  
    CREATE TABLE IF NOT EXISTS promo_codes (
      id INT AUTO_INCREMENT PRIMARY KEY,
      code VARCHAR(50) UNIQUE NOT NULL,
      description TEXT,
      discount_type ENUM('percentage', 'fixed_amount') NOT NULL,
      discount_value INT NOT NULL,
      max_uses INT DEFAULT NULL,
      used_count INT DEFAULT 0,
      valid_from TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      valid_until TIMESTAMP NULL,
      active BOOLEAN DEFAULT TRUE,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_code (code),
      INDEX idx_active (active)
    );

    -- Webhook events tracking
    CREATE TABLE IF NOT EXISTS webhook_events (
      id VARCHAR(255) PRIMARY KEY,
      event_type VARCHAR(100) NOT NULL,
      merchant_id VARCHAR(255),
      payload JSON,
      processed_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      processing_result VARCHAR(50),
      INDEX idx_event_type (event_type),
      INDEX idx_merchant_id (merchant_id)
    );

    -- Initial promo codes
    INSERT IGNORE INTO promo_codes (code, description, discount_type, discount_value) VALUES
      ('LAUNCH50', 'Launch promotion - 50% off first month', 'percentage', 50),
      ('TRIAL30', '30-day free trial', 'fixed_amount', 9900),
      ('YEARLYSPECIAL', '$100 off yearly plan', 'fixed_amount', 10000);
  `
}

// Run the setup
if (require.main === module) {
  main().catch(error => {
    console.error("Fatal error:", error)
    process.exit(1)
  })
}

export { validateEnvironment, setupDatabase, configureWebhooks }