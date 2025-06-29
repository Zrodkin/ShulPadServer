import { createClient } from "./db"

export async function initializeSubscriptionSchema() {
  const db = createClient()
  
  try {
    // Subscriptions table - UPDATED with missing columns
    await db.execute(`
      CREATE TABLE IF NOT EXISTS subscriptions (
        id INT AUTO_INCREMENT PRIMARY KEY,
        organization_id VARCHAR(255) NOT NULL,
        square_subscription_id VARCHAR(255) UNIQUE,
        square_customer_id VARCHAR(255) NULL,
        square_card_id VARCHAR(255) NULL,
        square_version INT DEFAULT 0,
        plan_type ENUM('monthly', 'yearly') NOT NULL,
        device_count INT DEFAULT 1,
        promo_code VARCHAR(50) NULL,
        promo_discount_cents INT DEFAULT 0,
        base_price_cents INT NOT NULL,
        total_price_cents INT NOT NULL,
        status ENUM('pending', 'active', 'paused', 'canceled', 'deactivated') DEFAULT 'pending',
        trial_end_date TIMESTAMP NULL,
        current_period_start TIMESTAMP NULL,
        current_period_end TIMESTAMP NULL,
        canceled_at TIMESTAMP NULL,
        grace_period_start TIMESTAMP NULL,
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP NOT NULL DEFAULT NOW() ON UPDATE NOW(),
        INDEX idx_org_id (organization_id),
        INDEX idx_square_sub_id (square_subscription_id),
        INDEX idx_status (status),
        INDEX idx_promo_code (promo_code)
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
        INDEX idx_org_id (organization_id)
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
        INDEX idx_active (active)
      )
    `)

    // Subscription plans table
    await db.execute(`
      CREATE TABLE IF NOT EXISTS subscription_plans (
        id INT AUTO_INCREMENT PRIMARY KEY,
        plan_type ENUM('monthly', 'yearly') UNIQUE NOT NULL,
        square_plan_id VARCHAR(255) NOT NULL,
        square_variation_id VARCHAR(255) NOT NULL,
        base_price_cents INT NOT NULL,
        extra_device_price_cents INT NOT NULL,
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP NOT NULL DEFAULT NOW() ON UPDATE NOW()
      )
    `)

    // Subscription events table (for audit trail)
    await db.execute(`
      CREATE TABLE IF NOT EXISTS subscription_events (
        id INT AUTO_INCREMENT PRIMARY KEY,
        subscription_id INT NOT NULL,
        event_type VARCHAR(50) NOT NULL,
        event_data JSON,
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        INDEX idx_subscription_id (subscription_id)
      )
    `)

    console.log('✅ Subscription database schema initialized successfully')
  } catch (error) {
    console.error('❌ Error initializing subscription schema:', error)
    throw error
  }
}