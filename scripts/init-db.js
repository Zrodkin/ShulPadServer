const { Pool } = require("pg")

async function initializeDatabase() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === "production" ? { rejectUnauthorized: false } : false,
  })

  const client = await pool.connect()

  try {
    console.log("Initializing database schema...")

    // Create the square_connections table
    await client.query(`
      CREATE TABLE IF NOT EXISTS square_connections (
        id SERIAL PRIMARY KEY,
        organization_id TEXT UNIQUE NOT NULL,
        merchant_id TEXT NOT NULL,
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

    console.log("Database schema initialized successfully!")
  } catch (error) {
    console.error("Error initializing database schema:", error)
  } finally {
    client.release()
    await pool.end()
  }
}

initializeDatabase()
