import { Pool } from "pg"

// Database connection pool
let pool: Pool

// Make sure to export the function
export function createClient() {
  if (!pool) {
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.NODE_ENV === "production" ? { rejectUnauthorized: false } : false,
    })
  }

  return pool
}

// Initialize database schema
export async function initializeDatabase() {
  const client = await createClient().connect()

  try {
    // Create the square_connections table if it doesn't exist
    await client.query(`
      CREATE TABLE IF NOT EXISTS square_connections (
        id SERIAL PRIMARY KEY,
        organization_id TEXT UNIQUE NOT NULL,
        merchant_id TEXT NOT NULL,
        location_id TEXT NOT NULL,
        access_token TEXT NOT NULL,
        refresh_token TEXT NOT NULL,
        expires_at TIMESTAMP NOT NULL,
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP NOT NULL DEFAULT NOW()
      );
      
      -- Create index for faster lookups
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
        created_at TIMESTAMP NOT NULL DEFAULT NOW()
      );
      
      -- Create index for faster lookups
      CREATE INDEX IF NOT EXISTS idx_square_pending_tokens_state
      ON square_pending_tokens(state);
    `)

    console.log("Database schema initialized")
  } catch (error) {
    console.error("Error initializing database schema:", error)
  } finally {
    client.release()
  }
}