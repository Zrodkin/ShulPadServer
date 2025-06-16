// scripts/create-schema.js
require('dotenv').config({ path: '.env.local' });
const { connect } = require('@planetscale/database');

async function createSchema() {
  console.log('🏗️ Creating PlanetScale schema...');
  
  const db = connect({
    url: process.env.DATABASE_URL
  });

  try {
    // Create square_connections table
    await db.execute(`
      CREATE TABLE IF NOT EXISTS square_connections (
        id INT AUTO_INCREMENT PRIMARY KEY,
        organization_id VARCHAR(255) NOT NULL,
        merchant_id VARCHAR(255) NOT NULL,
        location_id VARCHAR(255) NOT NULL,
        access_token TEXT NOT NULL,
        refresh_token TEXT NOT NULL,
        expires_at TIMESTAMP NOT NULL,
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP NOT NULL DEFAULT NOW() ON UPDATE NOW(),
        UNIQUE KEY unique_org (organization_id)
      )
    `);
    console.log('✅ Created square_connections table');
    
    // Create square_pending_tokens table
    await db.execute(`
      CREATE TABLE IF NOT EXISTS square_pending_tokens (
        id INT AUTO_INCREMENT PRIMARY KEY,
        state VARCHAR(255) NOT NULL,
        access_token TEXT,
        refresh_token TEXT,
        merchant_id VARCHAR(255),
        location_id VARCHAR(255),
        expires_at TIMESTAMP,
        obtained TINYINT(1) DEFAULT 0,
        device_id TEXT,
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        UNIQUE KEY unique_state (state)
      )
    `);
    console.log('✅ Created square_pending_tokens table');
    
    // Create organizations table
    await db.execute(`
      CREATE TABLE IF NOT EXISTS organizations (
        id INT AUTO_INCREMENT PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP NOT NULL DEFAULT NOW() ON UPDATE NOW()
      )
    `);
    console.log('✅ Created organizations table');
    
    // Create donations table
    await db.execute(`
      CREATE TABLE IF NOT EXISTS donations (
        id INT AUTO_INCREMENT PRIMARY KEY,
        organization_id VARCHAR(255) NOT NULL,
        amount INT NOT NULL,
        currency VARCHAR(3) DEFAULT 'USD',
        donor_name VARCHAR(255),
        donor_email VARCHAR(255),
        square_order_id VARCHAR(255),
        square_payment_id VARCHAR(255),
        status VARCHAR(50) DEFAULT 'pending',
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP NOT NULL DEFAULT NOW() ON UPDATE NOW()
      )
    `);
    console.log('✅ Created donations table');
    
    // Create kiosk_settings table
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
        UNIQUE KEY unique_org_settings (organization_id)
      )
    `);
    console.log('✅ Created kiosk_settings table');
    
    // Create indexes with proper key lengths
    console.log('🚀 Creating performance indexes...');
    
    try {
      await db.execute('CREATE INDEX idx_square_connections_org ON square_connections(organization_id(255))');
      console.log('✅ Created index: idx_square_connections_org');
    } catch (err) {
      if (err.message.includes('Duplicate key name')) {
        console.log('⚠️ Index idx_square_connections_org already exists');
      } else {
        throw err;
      }
    }
    
    try {
      await db.execute('CREATE INDEX idx_square_pending_tokens_state ON square_pending_tokens(state(255))');
      console.log('✅ Created index: idx_square_pending_tokens_state');
    } catch (err) {
      if (err.message.includes('Duplicate key name')) {
        console.log('⚠️ Index idx_square_pending_tokens_state already exists');
      } else {
        throw err;
      }
    }
    
    try {
      await db.execute('CREATE INDEX idx_donations_org ON donations(organization_id(255))');
      console.log('✅ Created index: idx_donations_org');
    } catch (err) {
      if (err.message.includes('Duplicate key name')) {
        console.log('⚠️ Index idx_donations_org already exists');
      } else {
        throw err;
      }
    }
    
    try {
      await db.execute('CREATE INDEX idx_kiosk_settings_org ON kiosk_settings(organization_id(255))');
      console.log('✅ Created index: idx_kiosk_settings_org');
    } catch (err) {
      if (err.message.includes('Duplicate key name')) {
        console.log('⚠️ Index idx_kiosk_settings_org already exists');
      } else {
        throw err;
      }
    }
    
    console.log('🎉 Schema created successfully!');
    
  } catch (error) {
    console.error('❌ Error creating schema:', error);
    throw error;
  }
}

createSchema().catch(console.error);