// scripts/check-current-data.mjs
// Simple script to check what data we have in Neon

import { Pool } from 'pg'
import dotenv from 'dotenv'

// Load environment variables
dotenv.config({ path: '.env.local' })

async function checkCurrentData() {
  console.log('🔍 Checking current data in Neon database...\n')
  
  // Create a simple database connection (like your existing code)
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
  })
  
  try {
    // Test connection first
    console.log('1. Testing database connection...')
    const healthCheck = await pool.query('SELECT 1 as health')
    console.log('✅ Connection successful!\n')
    
    // Check what tables exist
    console.log('2. Checking what tables exist...')
    const tablesResult = await pool.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public'
      ORDER BY table_name
    `)
    
    console.log('📋 Tables found:')
    tablesResult.rows.forEach(row => {
      console.log(`   - ${row.table_name}`)
    })
    console.log('')
    
    // Check square_connections table
    console.log('3. Checking square_connections data...')
    try {
      const connectionsResult = await pool.query(`
        SELECT 
          COUNT(*) as total_connections,
          MIN(created_at) as first_connection,
          MAX(created_at) as latest_connection
        FROM square_connections
      `)
      
      const connectionCount = connectionsResult.rows[0]
      console.log(`   📊 Total connections: ${connectionCount.total_connections}`)
      console.log(`   📅 First connection: ${connectionCount.first_connection || 'None'}`)
      console.log(`   📅 Latest connection: ${connectionCount.latest_connection || 'None'}`)
      
      // Show actual connection data (without sensitive tokens)
      if (connectionCount.total_connections > 0) {
        const sampleConnections = await pool.query(`
          SELECT 
            organization_id,
            merchant_id,
            location_id,
            created_at,
            expires_at
          FROM square_connections
          ORDER BY created_at DESC
          LIMIT 5
        `)
        
        console.log('\n   🔍 Sample connections (tokens hidden for security):')
        sampleConnections.rows.forEach((conn, index) => {
          console.log(`   ${index + 1}. Org: ${conn.organization_id}`)
          console.log(`      Merchant: ${conn.merchant_id}`)
          console.log(`      Location: ${conn.location_id}`)
          console.log(`      Created: ${conn.created_at}`)
          console.log(`      Expires: ${conn.expires_at}`)
          console.log('')
        })
      }
    } catch (error) {
      console.log('   ⚠️  square_connections table not found or error:', error.message)
    }
    
    // Check square_pending_tokens table
    console.log('4. Checking square_pending_tokens data...')
    try {
      const pendingResult = await pool.query(`
        SELECT 
          COUNT(*) as total_pending,
          COUNT(CASE WHEN obtained = true THEN 1 END) as obtained_tokens,
          COUNT(CASE WHEN obtained = false OR obtained IS NULL THEN 1 END) as pending_tokens
        FROM square_pending_tokens
      `)
      
      const pendingCount = pendingResult.rows[0]
      console.log(`   📊 Total pending tokens: ${pendingCount.total_pending}`)
      console.log(`   ✅ Obtained tokens: ${pendingCount.obtained_tokens}`)
      console.log(`   ⏳ Still pending: ${pendingCount.pending_tokens}`)
      
      // Show recent pending tokens (without sensitive data)
      if (pendingCount.total_pending > 0) {
        const samplePending = await pool.query(`
          SELECT 
            state,
            device_id,
            created_at,
            obtained
          FROM square_pending_tokens
          WHERE created_at > NOW() - INTERVAL '7 days'
          ORDER BY created_at DESC
          LIMIT 5
        `)
        
        console.log('\n   🔍 Recent pending tokens (sensitive data hidden):')
        samplePending.rows.forEach((token, index) => {
          console.log(`   ${index + 1}. State: ${token.state}`)
          console.log(`      Device: ${token.device_id || 'No device ID'}`)
          console.log(`      Created: ${token.created_at}`)
          console.log(`      Status: ${token.obtained ? 'Obtained' : 'Pending'}`)
          console.log('')
        })
      }
    } catch (error) {
      console.log('   ⚠️  square_pending_tokens table not found or error:', error.message)
    }
    
    console.log('\n🎉 Data check complete!')
    console.log('\n📝 Summary:')
    console.log('   - This shows us what data we need to migrate')
    console.log('   - Main data is in square_connections (your kiosk auth)')
    console.log('   - Pending tokens are temporary and can be recreated')
    console.log('   - Ready for export step!')
    
  } catch (error) {
    console.error('❌ Error checking database:', error)
    console.log('\n🔧 Troubleshooting:')
    console.log('   1. Check your DATABASE_URL in .env.local file')
    console.log('   2. Make sure your Neon database is still accessible')
    console.log('   3. Verify your .env.local file has the correct DATABASE_URL')
  } finally {
    await pool.end()
  }
}

checkCurrentData()