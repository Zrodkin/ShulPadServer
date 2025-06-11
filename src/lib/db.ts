import { Pool } from "pg"

// Database connection pool - safer typing
let pool: Pool | undefined

// Make sure to export the function
export function createClient(): Pool {
  if (!pool) {
    // Validate environment variable
    if (!process.env.DATABASE_URL) {
      throw new Error('DATABASE_URL environment variable is required')
    }

    try {
      pool = new Pool({
        connectionString: process.env.DATABASE_URL,
        ssl: process.env.NODE_ENV === "production" ? { rejectUnauthorized: false } : false,
        
        // ✅ ADD: Basic serverless optimizations (minimal changes)
        max: 5,  // Reduced from default 10 for serverless
        connectionTimeoutMillis: 5000,  // 5 second timeout for new connections
        idleTimeoutMillis: 30000,  // Keep default 30 seconds
      })
      
      pool.on('error', (err) => {
        console.error('Database pool error:', err)
        // Don't set pool to undefined - would break subsequent requests
      })
      
      console.log('Database pool created successfully')
    } catch (error) {
      console.error('Failed to create database pool:', error)
      throw new Error(`Database connection failed: ${error instanceof Error ? error.message : 'Unknown error'}`)
    }
  }

  return pool
}

// Updated src/lib/db.ts - initializeDatabase function
export async function initializeDatabase() {
  const client = await createClient().connect()

  try {
    // Create the square_connections table if it doesn't exist
    await client.query(`
      CREATE TABLE IF NOT EXISTS square_connections (
        id SERIAL PRIMARY KEY,
        organization_id TEXT UNIQUE NOT NULL,  -- ✅ ADDED UNIQUE constraint here
        merchant_id TEXT NOT NULL,
        location_id TEXT NOT NULL,
        access_token TEXT NOT NULL,
        refresh_token TEXT NOT NULL,
        expires_at TIMESTAMP NOT NULL,
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP NOT NULL DEFAULT NOW()
      );
      
      -- Create index for faster lookups (this is still useful for performance)
      CREATE INDEX IF NOT EXISTS idx_square_connections_organization_id 
      ON square_connections(organization_id);
    `)

    // Create square_pending_tokens table if it doesn't exist
    await client.query(`
      CREATE TABLE IF NOT EXISTS square_pending_tokens (
        id SERIAL PRIMARY KEY,
        state TEXT UNIQUE NOT NULL,
        access_token TEXT,
        refresh_token TEXT,
        merchant_id TEXT,
        location_id TEXT,
        expires_at TIMESTAMP,
        obtained BOOLEAN DEFAULT FALSE,
        device_id TEXT,  -- ✅ Added device_id field
        created_at TIMESTAMP NOT NULL DEFAULT NOW()
      );
      
      -- Create index for faster lookups
      CREATE INDEX IF NOT EXISTS idx_square_pending_tokens_state
      ON square_pending_tokens(state);
    `)

    console.log("Database schema initialized successfully")
  } catch (error) {
    console.error("Error initializing database schema:", error)
    throw error
  } finally {
    client.release()
  }
}

// ✅ ADD: Simple health check (optional but useful for debugging)
export async function isHealthy(): Promise<boolean> {
  try {
    const db = createClient()
    const result = await db.query('SELECT 1 as health')
    return result.rows.length > 0
  } catch (error) {
    console.error('Database health check failed:', error)
    return false
  }
}