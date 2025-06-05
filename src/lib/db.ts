// src/lib/db.ts - PRODUCTION VERSION

import { neon } from '@neondatabase/serverless'

// Create serverless SQL function
export const sql = neon(process.env.DATABASE_URL!)

// Initialize database schema
export async function initializeDatabase() {
  try {
    await sql`
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
      )
    `

    await sql`
      CREATE INDEX IF NOT EXISTS idx_square_connections_organization_id 
      ON square_connections(organization_id)
    `

    await sql`
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
      )
    `

    await sql`
      CREATE INDEX IF NOT EXISTS idx_square_pending_tokens_state
      ON square_pending_tokens(state)
    `

    console.log("Database schema initialized")
  } catch (error) {
    console.error("Error initializing database schema:", error)
    throw error
  }
}