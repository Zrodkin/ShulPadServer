// src/lib/db.ts - PlanetScale Version
import { connect } from '@planetscale/database'

let globalDb: any = null

export function createClient() {
  if (!globalDb) {
    const connectionString = process.env.DATABASE_URL
    
    if (!connectionString) {
      throw new Error('DATABASE_URL environment variable is required')
    }
    
    // Validate it's a PlanetScale URL
    if (!connectionString.includes('psdb.cloud')) {
      throw new Error('DATABASE_URL must be a valid PlanetScale connection string')
    }
    
    try {
      globalDb = connect({
        url: connectionString
      })
      
      console.log('✅ PlanetScale connection established')
    } catch (error) {
      console.error('❌ Failed to connect to PlanetScale:', error)
      throw new Error(`Database connection failed: ${error}`)
    }
  }
  
  return globalDb
}

// Health check utility
export async function healthCheck(): Promise<boolean> {
  try {
    const db = createClient()
    const result = await db.execute('SELECT 1 as health')
    return result.rows.length > 0
  } catch (error) {
    console.error('Database health check failed:', error)
    return false
  }
}

// Initialize database schema
export async function initializeDatabase() {
  const db = createClient()
  
  try {
    // Create square_connections table (MySQL syntax)
    await db.execute(`
      CREATE TABLE IF NOT EXISTS square_connections (
        id INT AUTO_INCREMENT PRIMARY KEY,
        organization_id VARCHAR(255) NOT NULL,
        merchant_id TEXT NOT NULL,
        location_id TEXT NOT NULL,
        access_token TEXT NOT NULL,
        refresh_token TEXT NOT NULL,
        expires_at TIMESTAMP NOT NULL,
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP NOT NULL DEFAULT NOW() ON UPDATE NOW(),
        UNIQUE INDEX unique_org_settings (organization_id)
      )
    `)
    
    // Create square_pending_tokens table (MySQL syntax)  
    await db.execute(`
      CREATE TABLE IF NOT EXISTS square_pending_tokens (
        id INT AUTO_INCREMENT PRIMARY KEY,
        state TEXT NOT NULL,
        access_token TEXT,
        refresh_token TEXT,
        merchant_id TEXT,
        location_id TEXT,
        expires_at TIMESTAMP,
        obtained TINYINT(1) DEFAULT 0,
        device_id TEXT,
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        UNIQUE KEY unique_state (state(255))
      )
    `)
    
    // Add other tables you need
    await db.execute(`
      CREATE TABLE IF NOT EXISTS organizations (
        id INT AUTO_INCREMENT PRIMARY KEY,
        name TEXT NOT NULL,
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP NOT NULL DEFAULT NOW() ON UPDATE NOW()
      )
    `)
    
    await db.execute(`
      CREATE TABLE IF NOT EXISTS donations (
        id INT AUTO_INCREMENT PRIMARY KEY,
        organization_id VARCHAR(255) NOT NULL,
        amount DECIMAL(10,2) NOT NULL,
        currency VARCHAR(3) DEFAULT 'USD',
        donor_name TEXT,
        donor_email TEXT,
        square_order_id TEXT,
        square_payment_id TEXT,
        status TEXT DEFAULT 'pending',
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP NOT NULL DEFAULT NOW() ON UPDATE NOW()
      )
    `)
    
    await db.execute(`
      CREATE TABLE IF NOT EXISTS kiosk_settings (
        id INT AUTO_INCREMENT PRIMARY KEY,
        organization_id VARCHAR(255) NOT NULL,
        preset_amounts JSON,
        custom_message TEXT,
        theme_color VARCHAR(7) DEFAULT '#007AFF',
        timeout_duration INT DEFAULT 15,
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP NOT NULL DEFAULT NOW() ON UPDATE NOW(),
        UNIQUE KEY unique_org_settings (organization_id(255))
      )
    `)
    
    // Add indexes for performance
    await db.execute('CREATE INDEX IF NOT EXISTS idx_square_connections_org ON square_connections(organization_id)')
    await db.execute('CREATE INDEX IF NOT EXISTS idx_square_pending_tokens_state ON square_pending_tokens(state(255))')
    await db.execute('CREATE INDEX IF NOT EXISTS idx_donations_org ON donations(organization_id)')
    await db.execute('CREATE INDEX IF NOT EXISTS idx_kiosk_settings_org ON kiosk_settings(organization_id)')
    
    console.log('✅ Database schema initialized successfully')
  } catch (error) {
    console.error('❌ Error initializing database schema:', error)
    throw error
  }
}
