import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { Pool } from 'pg';
import dotenv from 'dotenv';

// Get the directory name using ES module approach
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

// Load environment variables from both .env and .env.local
function loadEnv() {
  // Try loading .env.local first (higher priority)
  const localEnvPath = path.join(rootDir, '.env.local');
  const defaultEnvPath = path.join(rootDir, '.env');
  
  console.log(`Checking for .env.local at: ${localEnvPath}`);
  console.log(`Checking for .env at: ${defaultEnvPath}`);
  
  if (fs.existsSync(localEnvPath)) {
    console.log('.env.local file found, loading...');
    dotenv.config({ path: localEnvPath });
  }
  
  if (fs.existsSync(defaultEnvPath)) {
    console.log('.env file found, loading...');
    dotenv.config({ path: defaultEnvPath });
  }
  
  // Print environment variables for debugging (without sensitive values)
  console.log('Environment variables loaded:');
  console.log('DATABASE_URL:', process.env.DATABASE_URL ? '[SET]' : '[NOT SET]');
  console.log('REDIRECT_URI:', process.env.REDIRECT_URI ? '[SET]' : '[NOT SET]');
}

// Create a database client directly
function createClient() {
  const connectionString = process.env.DATABASE_URL;
  
  if (!connectionString) {
    console.error('ERROR: DATABASE_URL environment variable is not set');
    console.error('Please create a .env or .env.local file with DATABASE_URL');
    process.exit(1);
  }
  
  return new Pool({
    connectionString,
    ssl: { rejectUnauthorized: false }
  });
}

async function initializeDatabase() {
  console.log('Initializing database...');
  
  // Load environment variables
  loadEnv();
  
  // If DATABASE_URL is still not set, let's create a temporary one for testing
  if (!process.env.DATABASE_URL) {
    console.log('Creating a temporary DATABASE_URL for this session only');
    process.env.DATABASE_URL = 'postgresql://neondb_owner:npg_p9owPbx2RXTH@ep-dark-glade-a4ak240h-pooler.us-east-1.aws.neon.tech/neondb?sslmode=require';
  }
  
  const db = createClient();

  try {
    // Create the square_connections table if it doesn't exist
    await db.query(`
      CREATE TABLE IF NOT EXISTS square_connections (
        id SERIAL PRIMARY KEY,
        organization_id VARCHAR(255) NOT NULL UNIQUE,
        merchant_id VARCHAR(255) NOT NULL,
        access_token TEXT NOT NULL,
        refresh_token TEXT NOT NULL,
        expires_at TIMESTAMP NOT NULL,
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP
      );
    `);

    console.log('Created square_connections table');

    // Read and execute the pending tokens SQL file
    const pendingTokensSqlPath = path.join(__dirname, 'create-square-pending-tokens.sql');
    console.log(`Reading SQL file from: ${pendingTokensSqlPath}`);
    
    const pendingTokensSql = fs.readFileSync(pendingTokensSqlPath, 'utf8');
    await db.query(pendingTokensSql);

    console.log('Created square_pending_tokens table');
    console.log('Database initialized successfully');
  } catch (error) {
    console.error('Error initializing database:', error);
    console.error(error.stack);
  } finally {
    // Close the client
    await db.end();
  }
}

initializeDatabase().catch(error => {
  console.error('Unhandled error during database initialization:', error);
  process.exit(1);
});
