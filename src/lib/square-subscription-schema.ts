// src/lib/square-subscription-schema.ts
// Run this script to create the necessary tables for Square subscriptions

import { createClient } from "@/lib/db"

// Load environment variables if running directly
if (require.main === module) {
  require('dotenv').config()
}


export async function initializeSquareSubscriptionSchema() {
  console.log('📦 Connecting to database...')
  const db = createClient()
  
  try {
    console.log('📋 Creating subscription_plan_mappings table...')
    // 1. Subscription plan mappings table
    // Caches the relationship between amounts and Square plan/variation IDs
    await db.execute(`
      CREATE TABLE IF NOT EXISTS subscription_plan_mappings (
        id INT AUTO_INCREMENT PRIMARY KEY,
        organization_id VARCHAR(255) NOT NULL,
        amount_cents INT NOT NULL,
        plan_id VARCHAR(255) NOT NULL,
        variation_id VARCHAR(255) NOT NULL,
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP NOT NULL DEFAULT NOW() ON UPDATE NOW(),
        UNIQUE KEY unique_org_amount (organization_id, amount_cents),
        INDEX idx_org_id (organization_id),
        INDEX idx_plan_id (plan_id),
        INDEX idx_variation_id (variation_id)
      )
    `)
    console.log('✅ subscription_plan_mappings table ready')

    console.log('📋 Creating donor_subscriptions table...')
    // 2. Donor subscriptions table
    // Tracks all active and historical subscriptions
    await db.execute(`
      CREATE TABLE IF NOT EXISTS donor_subscriptions (
        id INT AUTO_INCREMENT PRIMARY KEY,
        organization_id VARCHAR(255) NOT NULL,
        square_subscription_id VARCHAR(255) UNIQUE,
        square_customer_id VARCHAR(255) NOT NULL,
        square_card_id VARCHAR(255),
        plan_variation_id VARCHAR(255) NOT NULL,
        payment_id VARCHAR(255),
        donor_name VARCHAR(255),
        donor_email VARCHAR(255),
        donor_phone VARCHAR(50),
        amount_cents INT NOT NULL,
        currency VARCHAR(3) DEFAULT 'USD',
        status VARCHAR(50) NOT NULL DEFAULT 'PENDING',
        start_date DATE,
        canceled_at TIMESTAMP NULL,
        cancel_reason TEXT,
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP NOT NULL DEFAULT NOW() ON UPDATE NOW(),
        INDEX idx_org_id (organization_id),
        INDEX idx_customer_id (square_customer_id),
        INDEX idx_subscription_id (square_subscription_id),
        INDEX idx_status (status),
        INDEX idx_email (donor_email)
      )
    `)
    console.log('✅ donor_subscriptions table ready')

    console.log('📋 Creating subscription_events table...')
    // 3. Subscription events table
    // Logs all subscription-related events from webhooks
    await db.execute(`
      CREATE TABLE IF NOT EXISTS subscription_events (
        id INT AUTO_INCREMENT PRIMARY KEY,
        organization_id VARCHAR(255),
        square_subscription_id VARCHAR(255),
        event_type VARCHAR(100) NOT NULL,
        event_data JSON,
        webhook_event_id VARCHAR(255) UNIQUE,
        processed_at TIMESTAMP NOT NULL DEFAULT NOW(),
        INDEX idx_subscription_id (square_subscription_id),
        INDEX idx_event_type (event_type),
        INDEX idx_webhook_event (webhook_event_id)
      )
    `)
    console.log('✅ subscription_events table ready')

    console.log('📋 Creating subscription_invoices table...')
    // 4. Subscription invoices table
    // Tracks invoice history for subscriptions
    await db.execute(`
      CREATE TABLE IF NOT EXISTS subscription_invoices (
        id INT AUTO_INCREMENT PRIMARY KEY,
        organization_id VARCHAR(255) NOT NULL,
        square_subscription_id VARCHAR(255),
        square_invoice_id VARCHAR(255) UNIQUE,
        square_payment_id VARCHAR(255),
        amount_cents INT NOT NULL,
        currency VARCHAR(3) DEFAULT 'USD',
        status VARCHAR(50) NOT NULL,
        scheduled_at TIMESTAMP,
        paid_at TIMESTAMP NULL,
        failed_at TIMESTAMP NULL,
        failure_reason TEXT,
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP NOT NULL DEFAULT NOW() ON UPDATE NOW(),
        INDEX idx_org_id (organization_id),
        INDEX idx_subscription_id (square_subscription_id),
        INDEX idx_invoice_id (square_invoice_id),
        INDEX idx_status (status)
      )
    `)
    console.log('✅ subscription_invoices table ready')

    console.log('📋 Creating/updating webhook_events table...')
    // 5. Webhook events table (if not already exists)
    // Generic webhook event logging
    await db.execute(`
      CREATE TABLE IF NOT EXISTS webhook_events (
        id INT AUTO_INCREMENT PRIMARY KEY,
        event_id VARCHAR(255) UNIQUE,
        event_type VARCHAR(100) NOT NULL,
        merchant_id VARCHAR(255),
        location_id VARCHAR(255),
        payload JSON,
        created_at TIMESTAMP,
        processed_at TIMESTAMP NOT NULL DEFAULT NOW(),
        INDEX idx_event_id (event_id),
        INDEX idx_event_type (event_type),
        INDEX idx_merchant_id (merchant_id)
      )
    `)
    console.log('✅ webhook_events table ready')

    console.log('📋 Updating square_connections table...')
    // 6. Update square_connections table to add subscription-related fields
    // PlanetScale/MySQL doesn't support multiple ADD COLUMN IF NOT EXISTS in one statement
    // We need to do them one by one
    
    try {
      await db.execute(`ALTER TABLE square_connections ADD COLUMN subscription_plan_id VARCHAR(255)`)
    } catch (e: any) {
      if (!e.message.includes('Duplicate column')) throw e
    }
    
    try {
      await db.execute(`ALTER TABLE square_connections ADD COLUMN subscriptions_enabled BOOLEAN DEFAULT FALSE`)
    } catch (e: any) {
      if (!e.message.includes('Duplicate column')) throw e
    }
    
    try {
      await db.execute(`ALTER TABLE square_connections ADD COLUMN subscription_terms TEXT`)
    } catch (e: any) {
      if (!e.message.includes('Duplicate column')) throw e
    }
    
    try {
      await db.execute(`ALTER TABLE square_connections ADD COLUMN monthly_donations_enabled BOOLEAN DEFAULT TRUE`)
    } catch (e: any) {
      if (!e.message.includes('Duplicate column')) throw e
    }
    
    try {
      await db.execute(`ALTER TABLE square_connections ADD COLUMN require_donor_info BOOLEAN DEFAULT TRUE`)
    } catch (e: any) {
      if (!e.message.includes('Duplicate column')) throw e
    }
    
    try {
      await db.execute(`ALTER TABLE square_connections ADD INDEX idx_subscription_plan (subscription_plan_id)`)
    } catch (e: any) {
      if (!e.message.includes('Duplicate key')) throw e
    }
    console.log('✅ square_connections table updated')

    console.log('📋 Updating kiosk_settings table...')
    // 7. Add subscription settings to kiosk_settings table
    // Same approach - one column at a time
    
    try {
      await db.execute(`ALTER TABLE kiosk_settings ADD COLUMN monthly_donation_enabled BOOLEAN DEFAULT FALSE`)
    } catch (e: any) {
      if (!e.message.includes('Duplicate column')) throw e
    }
    
    try {
      await db.execute(`ALTER TABLE kiosk_settings ADD COLUMN subscription_terms_text TEXT`)
    } catch (e: any) {
      if (!e.message.includes('Duplicate column')) throw e
    }
    
    try {
      await db.execute(`ALTER TABLE kiosk_settings ADD COLUMN require_donor_email BOOLEAN DEFAULT TRUE`)
    } catch (e: any) {
      if (!e.message.includes('Duplicate column')) throw e
    }
    
    try {
      await db.execute(`ALTER TABLE kiosk_settings ADD COLUMN require_donor_name BOOLEAN DEFAULT TRUE`)
    } catch (e: any) {
      if (!e.message.includes('Duplicate column')) throw e
    }
    
    try {
      await db.execute(`ALTER TABLE kiosk_settings ADD COLUMN require_donor_phone BOOLEAN DEFAULT FALSE`)
    } catch (e: any) {
      if (!e.message.includes('Duplicate column')) throw e
    }
    
    try {
      await db.execute(`ALTER TABLE kiosk_settings ADD COLUMN monthly_preset_amounts JSON`)
    } catch (e: any) {
      if (!e.message.includes('Duplicate column')) throw e
    }
    console.log('✅ kiosk_settings table updated')

    console.log('📋 Adding is_recurring column to donations table...')
    // 8. Add is_recurring flag to donations table
    try {
      await db.execute(`ALTER TABLE donations ADD COLUMN is_recurring BOOLEAN DEFAULT FALSE`)
    } catch (e: any) {
      if (!e.message.includes('Duplicate column')) throw e
    }
    
    try {
      await db.execute(`ALTER TABLE donations ADD INDEX idx_recurring (is_recurring)`)
    } catch (e: any) {
      if (!e.message.includes('Duplicate key')) throw e
    }
    console.log('✅ donations table updated')

    console.log('🎉 Square subscription database schema initialized successfully!')
  } catch (error) {
    console.error('❌ Error initializing Square subscription schema:', error)
    throw error
  }
}

// Helper function to run this migration
if (require.main === module) {
  console.log('🚀 Starting Square subscription schema initialization...')
  initializeSquareSubscriptionSchema()
    .then(() => {
      console.log('✨ Schema initialization completed successfully!')
      process.exit(0)
    })
    .catch((error) => {
      console.error('💥 Schema initialization failed:', error)
      process.exit(1)
    })
}

export default initializeSquareSubscriptionSchema