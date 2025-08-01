// src/lib/stripe-subscription-schema.ts
// Run this script to create the necessary tables for Stripe subscriptions

import { createClient } from "@/lib/db"

export async function initializeStripeSchema() {
  const db = createClient()
  
  try {
    // Stripe subscriptions table
    await db.execute(`
      CREATE TABLE IF NOT EXISTS stripe_subscriptions (
        id INT AUTO_INCREMENT PRIMARY KEY,
        organization_id VARCHAR(255) NOT NULL UNIQUE,
        stripe_customer_id VARCHAR(255) UNIQUE,
        stripe_subscription_id VARCHAR(255) UNIQUE,
        status VARCHAR(50) NOT NULL DEFAULT 'inactive',
        current_period_start DATETIME,
        current_period_end DATETIME,
        trial_end DATETIME,
        cancel_at_period_end BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP NOT NULL DEFAULT NOW() ON UPDATE NOW(),
        INDEX idx_org_id (organization_id),
        INDEX idx_customer_id (stripe_customer_id),
        INDEX idx_subscription_id (stripe_subscription_id),
        INDEX idx_status (status)
      )
    `)

    // Stripe webhook events table (for idempotency)
    await db.execute(`
      CREATE TABLE IF NOT EXISTS stripe_webhook_events (
        id INT AUTO_INCREMENT PRIMARY KEY,
        stripe_event_id VARCHAR(255) NOT NULL UNIQUE,
        event_type VARCHAR(100) NOT NULL,
        processed_at TIMESTAMP NOT NULL DEFAULT NOW(),
        INDEX idx_event_id (stripe_event_id)
      )
    `)

    console.log('✅ Stripe subscription database schema initialized successfully')
  } catch (error) {
    console.error('❌ Error initializing Stripe schema:', error)
    throw error
  }
}

// Helper function to run this migration
if (require.main === module) {
  initializeStripeSchema()
    .then(() => process.exit(0))
    .catch(() => process.exit(1))
}