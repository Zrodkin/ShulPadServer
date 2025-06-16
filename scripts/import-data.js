// Step 6: Fixed Data Migration - Import your actual data to PlanetScale
// This version handles existing tables and creates them properly

require('dotenv').config({ path: '.env.local' });
const { connect } = require('@planetscale/database');

async function importActualData() {
  console.log('🚀 Step 6: Importing actual data to PlanetScale (Fixed Version)...');
  
  // Connect to PlanetScale with your new DATABASE_URL
  const db = connect({
    url: process.env.DATABASE_URL // Should be your PlanetScale connection string
  });

  try {
    console.log('🔍 Checking existing tables...');
    
    // Check what tables exist
    const existingTables = await db.execute('SHOW TABLES');
    const tableNames = existingTables.rows.map(row => Object.values(row)[0]);
    console.log('   Existing tables:', tableNames);

    console.log('📋 Creating/updating database schema...');
    
    // Drop and recreate tables to ensure they have the right structure
    await dropAndCreateTables(db);
    
    console.log('📊 Importing your actual data...');
    
    // 1. Import organizations
    console.log('  → Importing organizations...');
    await db.execute(`
      INSERT INTO organizations (
        id, name, logo_url, contact_email, contact_phone, 
        square_merchant_id, active, created_at, updated_at, 
        receipt_message, website, receipt_enabled, tax_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      1, 
      'Your Organization', 
      null, 
      null, 
      null, 
      null, 
      true, 
      '2025-06-05 20:10:03', 
      '2025-06-05 20:10:03',
      'Thank you for your generous donation!',
      null,
      true,
      '12-3456789'
    ]);

    // 2. Import your Square connection (THE CRITICAL ONE)
    console.log('  → Importing Square connection...');
    await db.execute(`
      INSERT INTO square_connections (
        id, organization_id, merchant_id, access_token, refresh_token, 
        expires_at, created_at, updated_at, location_id, is_active, 
        revoked_at, last_catalog_sync, api_version, device_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      193,
      'default',
      'MLE0CT8RWF16F',
      'EAAAlodCGG8PT9X176lR3z8xA0IltUZxXprYYQpkLoNhVJRFNMzSciwsL2Kc-699',
      'EQAAltggAthaLMt0JE3oNKUCSnWhQAJefQT1QvKMhOrPM6QFDpo02QyhWI16H0ud',
      '2025-07-16 02:34:42',
      '2025-06-11 23:56:37',
      '2025-06-16 02:34:46',
      'L96TE51REN2VG',
      true,
      null,
      null,
      '2025-05-21',
      null
    ]);

    // 3. Import your 6 pending tokens with device_id
    console.log('  → Importing 6 pending tokens...');
    
    const pendingTokens = [
      {
        id: 352,
        state: 'e87ce2e9-9e92-48c2-987b-62388aa37294',
        access_token: null,
        refresh_token: null,
        merchant_id: null,
        expires_at: null,
        created_at: '2025-06-16 02:23:21',
        obtained: false,
        location_id: null,
        location_data: null,
        device_id: '1E1FC5E6-7D73-4449-B9C0-46A48178BCC7'
      },
      {
        id: 349,
        state: '051623dc-ffb7-4c3c-beca-53e4e50e57e7',
        access_token: null,
        refresh_token: null,
        merchant_id: null,
        expires_at: null,
        created_at: '2025-06-16 02:13:12',
        obtained: false,
        location_id: null,
        location_data: null,
        device_id: '1E1FC5E6-7D73-4449-B9C0-46A48178BCC7'
      },
      {
        id: 350,
        state: '9b1ac093-fabc-484a-b652-69bcd8d32708',
        access_token: null,
        refresh_token: null,
        merchant_id: null,
        expires_at: null,
        created_at: '2025-06-16 02:13:36',
        obtained: false,
        location_id: null,
        location_data: null,
        device_id: '1E1FC5E6-7D73-4449-B9C0-46A48178BCC7'
      },
      {
        id: 351,
        state: '5acd666d-ffd6-4f4e-a90b-82b6b6ccc9bd',
        access_token: null,
        refresh_token: null,
        merchant_id: null,
        expires_at: null,
        created_at: '2025-06-16 02:22:30',
        obtained: false,
        location_id: null,
        location_data: null,
        device_id: '1E1FC5E6-7D73-4449-B9C0-46A48178BCC7'
      },
      {
        id: 353,
        state: '7bd506bf-dc41-455e-a33b-c9e33fd4532e',
        access_token: null,
        refresh_token: null,
        merchant_id: null,
        expires_at: null,
        created_at: '2025-06-16 02:30:29',
        obtained: false,
        location_id: null,
        location_data: null,
        device_id: '1E1FC5E6-7D73-4449-B9C0-46A48178BCC7'
      },
      {
        id: 354,
        state: 'c136b498-0fc4-42e1-b4b9-a0bbabe5f17a',
        access_token: 'EAAAlodCGG8PT9X176lR3z8xA0IltUZxXprYYQpkLoNhVJRFNMzSciwsL2Kc-699',
        refresh_token: 'EQAAltggAthaLMt0JE3oNKUCSnWhQAJefQT1QvKMhOrPM6QFDpo02QyhWI16H0ud',
        merchant_id: 'MLE0CT8RWF16F',
        expires_at: '2025-07-16 02:34:42',
        created_at: '2025-06-16 02:34:25',
        obtained: false,
        location_id: 'L96TE51REN2VG',
        location_data: null,
        device_id: '1E1FC5E6-7D73-4449-B9C0-46A48178BCC7'
      }
    ];

    for (const token of pendingTokens) {
      await db.execute(`
        INSERT INTO square_pending_tokens (
          id, state, access_token, refresh_token, merchant_id, 
          expires_at, created_at, obtained, location_id, 
          location_data, device_id
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, [
        token.id,
        token.state,
        token.access_token,
        token.refresh_token,
        token.merchant_id,
        token.expires_at,
        token.created_at,
        token.obtained ? 1 : 0, // MySQL uses 1/0 for boolean
        token.location_id,
        token.location_data,
        token.device_id
      ]);
    }

    // 4. Import schema migrations
    console.log('  → Importing schema migrations...');
    await db.execute(`
      INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)
    `, ['20240521_catalog_integration', '2025-05-21 14:57:53']);
    
    await db.execute(`
      INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)
    `, ['20250526_backend_essentials_only', '2025-05-26 06:15:31']);

    // 5. Import some recent receipt logs (last 5 entries)
    console.log('  → Importing recent receipt logs...');
    const recentReceipts = [
      [22, 'default', 'zalmanrodkin@gmail.com', 1.00, '7JeO3fqRWbJyrcamq16H3kfNymKZY', 'vGXweiUCmTxvprkg3ZPLxBArZnIZY', 'sent', 'pVOtbMtMSGqmd-m8VJvA_w', null, 0, '2025-06-08 01:59:54', '2025-06-08 01:59:54', null, '2025-06-08 01:59:54'],
      [23, 'default', 'zalmanrodkin@gmail.com', 1.00, '1QFvJm8hHWYD8p6syzfAdlz8ZaAZY', 'vi7xvZU1zJYLTThvK6iS3HIcnx5YY', 'sent', 'Mb9IUDnYTE6mJXEuIQm38w', null, 0, '2025-06-08 02:04:21', '2025-06-08 02:04:22', null, '2025-06-08 02:04:22'],
      [24, 'default', 'info@larkla.com', 18.00, 'hipAedBNK3KxqIIBRJVAEwtpIbAZY', 'KGj0V3p8UK1Vp7m32ykE8ShnW4MZY', 'sent', 'RsuAWSjIQyq4la9XxkTU-g', null, 0, '2025-06-08 21:24:33', '2025-06-08 21:24:34', null, '2025-06-08 21:24:34'],
      [25, 'default', 'mendyfaygen@gmail.com', 100.00, 'nT2jSfXPjh0dUajshG8BCF4JyOCZY', 'mgTTE8JhCNYSltamJ2gsXiUbjvJZY', 'sent', 'YoC7QgK5Sj2rgnrE_kKSzQ', null, 0, '2025-06-09 01:48:35', '2025-06-09 01:48:35', null, '2025-06-09 01:48:35'],
      [26, 'default', 'zalmanrodkin@gmail.com', 1.00, 'n7QYN4dWAWqRilIbKMXEL7mFhIAZY', 'cBaLTip37LCMbq5m4B5ZN5ffJ2SZY', 'sent', 'GxN9d7jDQ7yDYfy-87zr0g', null, 0, '2025-06-09 01:54:52', '2025-06-09 01:54:52', null, '2025-06-09 01:54:52']
    ];

    for (const receipt of recentReceipts) {
      await db.execute(`
        INSERT INTO receipt_log (
          id, organization_id, donor_email, amount, transaction_id, 
          order_id, delivery_status, sendgrid_message_id, delivery_error, 
          retry_count, requested_at, sent_at, last_retry_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, receipt);
    }

    console.log('🔍 Verifying import...');
    
    // Verify the import
    const orgCount = await db.execute('SELECT COUNT(*) as count FROM organizations');
    const connectionCount = await db.execute('SELECT COUNT(*) as count FROM square_connections');
    const tokenCount = await db.execute('SELECT COUNT(*) as count FROM square_pending_tokens');
    const receiptCount = await db.execute('SELECT COUNT(*) as count FROM receipt_log');
    const migrationCount = await db.execute('SELECT COUNT(*) as count FROM schema_migrations');
    
    console.log('');
    console.log('✅ IMPORT VERIFICATION:');
    console.log('========================');
    console.log(`   Organizations: ${orgCount.rows[0].count}`);
    console.log(`   Square Connections: ${connectionCount.rows[0].count}`);
    console.log(`   Pending Tokens: ${tokenCount.rows[0].count}`);
    console.log(`   Receipt Logs: ${receiptCount.rows[0].count}`);
    console.log(`   Schema Migrations: ${migrationCount.rows[0].count}`);
    
    // Test critical data
    console.log('');
    console.log('🔑 CRITICAL DATA CHECK:');
    console.log('========================');
    
    const connection = await db.execute(`
      SELECT organization_id, merchant_id, location_id, 
             LEFT(access_token, 20) as token_preview,
             expires_at, is_active
      FROM square_connections 
      WHERE organization_id = 'default'
    `);
    
    if (connection.rows.length > 0) {
      const conn = connection.rows[0];
      console.log(`   ✅ Square Connection Found:`);
      console.log(`      Organization: ${conn.organization_id}`);
      console.log(`      Merchant: ${conn.merchant_id}`);
      console.log(`      Location: ${conn.location_id}`);
      console.log(`      Token Preview: ${conn.token_preview}...`);
      console.log(`      Expires: ${conn.expires_at}`);
      console.log(`      Active: ${conn.is_active}`);
    } else {
      console.log('   ❌ Square Connection NOT FOUND!');
    }
    
    const deviceTokens = await db.execute(`
      SELECT COUNT(*) as count 
      FROM square_pending_tokens 
      WHERE device_id = '1E1FC5E6-7D73-4449-B9C0-46A48178BCC7'
    `);
    console.log(`   ✅ Device Tokens: ${deviceTokens.rows[0].count} for device 1E1FC5E6...`);

    console.log('');
    console.log('🎉 DATA MIGRATION COMPLETE!');
    console.log('');
    console.log('📋 NEXT STEPS:');
    console.log('  1. ✅ Database schema created');
    console.log('  2. ✅ Critical data imported'); 
    console.log('  3. → Test API endpoint: curl "https://api.shulpad.com/api/square/status?organization_id=default"');
    console.log('  4. → Update your .env.local DATABASE_URL for local testing');
    console.log('  5. → Deploy to production when ready');
    console.log('');

  } catch (error) {
    console.error('❌ Data import failed:', error);
    console.error('Error details:', error.message);
    throw error;
  }
}

async function dropAndCreateTables(db) {
  console.log('   → Dropping existing tables if they exist...');
  
  // Drop tables in reverse dependency order
  const tablesToDrop = [
    'receipt_log',
    'square_pending_tokens', 
    'square_connections',
    'order_transactions',
    'preset_donations',
    'kiosk_settings',
    'donations',
    'payment_events',
    'webhook_events',
    'schema_migrations',
    'organizations'
  ];

  for (const table of tablesToDrop) {
    try {
      await db.execute(`DROP TABLE IF EXISTS ${table}`);
      console.log(`      Dropped ${table}`);
    } catch (error) {
      console.log(`      Failed to drop ${table}: ${error.message}`);
    }
  }

  console.log('   → Creating fresh tables...');
  
  // Organizations table (CRITICAL)
  await db.execute(`
    CREATE TABLE organizations (
      id INT AUTO_INCREMENT PRIMARY KEY,
      name VARCHAR(500) NOT NULL,
      logo_url VARCHAR(500),
      contact_email VARCHAR(255),
      contact_phone VARCHAR(50),
      square_merchant_id VARCHAR(255),
      active BOOLEAN DEFAULT TRUE,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      receipt_message VARCHAR(1000),
      website VARCHAR(500),
      receipt_enabled BOOLEAN DEFAULT TRUE,
      tax_id VARCHAR(255),
      UNIQUE KEY unique_square_merchant_id (square_merchant_id)
    )
  `);

  // Square connections table (MOST CRITICAL)
  await db.execute(`
    CREATE TABLE square_connections (
      id INT AUTO_INCREMENT PRIMARY KEY,
      organization_id VARCHAR(255) NOT NULL,
      merchant_id VARCHAR(255) NOT NULL,
      access_token TEXT NOT NULL,
      refresh_token TEXT NOT NULL,
      expires_at TIMESTAMP NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      location_id VARCHAR(255) NOT NULL,
      is_active BOOLEAN DEFAULT TRUE,
      revoked_at TIMESTAMP NULL,
      last_catalog_sync TIMESTAMP NULL,
      api_version VARCHAR(20) DEFAULT '2025-05-21',
      device_id VARCHAR(255),
      UNIQUE KEY unique_organization_id (organization_id),
      INDEX idx_square_connections_org_device (organization_id, device_id)
    )
  `);

  // Square pending tokens table (CRITICAL)
  await db.execute(`
    CREATE TABLE square_pending_tokens (
      id INT AUTO_INCREMENT PRIMARY KEY,
      state VARCHAR(255) NOT NULL,
      access_token TEXT,
      refresh_token TEXT,
      merchant_id VARCHAR(255),
      expires_at TIMESTAMP NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      obtained BOOLEAN DEFAULT FALSE,
      location_id VARCHAR(255),
      location_data TEXT,
      device_id VARCHAR(255),
      UNIQUE KEY unique_state_device (state, device_id),
      INDEX idx_square_pending_tokens_state (state),
      INDEX idx_square_pending_tokens_merchant (merchant_id)
    )
  `);

  // Receipt log table
  await db.execute(`
    CREATE TABLE receipt_log (
      id INT AUTO_INCREMENT PRIMARY KEY,
      organization_id VARCHAR(50) NOT NULL,
      donor_email VARCHAR(255) NOT NULL,
      amount DECIMAL(10,2) NOT NULL,
      transaction_id VARCHAR(100),
      order_id VARCHAR(100),
      delivery_status VARCHAR(20) DEFAULT 'pending',
      sendgrid_message_id VARCHAR(100),
      delivery_error TEXT,
      retry_count INT DEFAULT 0,
      requested_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      sent_at TIMESTAMP NULL,
      last_retry_at TIMESTAMP NULL,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_receipt_log_org_id (organization_id),
      INDEX idx_receipt_log_status (delivery_status),
      INDEX idx_receipt_log_requested_at (requested_at)
    )
  `);

  // Schema migrations table
  await db.execute(`
    CREATE TABLE schema_migrations (
      version VARCHAR(255) PRIMARY KEY,
      applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Additional tables (can be empty for now)
  await db.execute(`
    CREATE TABLE donations (
      id INT AUTO_INCREMENT PRIMARY KEY,
      organization_id INT,
      amount DECIMAL(10,2) NOT NULL,
      currency VARCHAR(10) DEFAULT 'USD',
      donor_name VARCHAR(255),
      donor_email VARCHAR(255),
      payment_id VARCHAR(255),
      payment_status VARCHAR(50) NOT NULL,
      receipt_sent BOOLEAN DEFAULT FALSE,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      square_order_id VARCHAR(255),
      is_custom_amount BOOLEAN DEFAULT FALSE,
      catalog_item_id VARCHAR(255),
      donation_type VARCHAR(50) DEFAULT 'one_time'
    )
  `);

  await db.execute(`
    CREATE TABLE kiosk_settings (
      id INT AUTO_INCREMENT PRIMARY KEY,
      organization_id INT,
      timeout_seconds INT DEFAULT 60,
      welcome_message TEXT,
      thank_you_message TEXT,
      logo_url VARCHAR(500),
      background_image_url VARCHAR(500),
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      allow_custom_amount BOOLEAN DEFAULT TRUE,
      min_custom_amount DECIMAL(10,2) DEFAULT 1.00,
      max_custom_amount DECIMAL(10,2) DEFAULT 1000.00,
      catalog_parent_id VARCHAR(255),
      last_catalog_sync TIMESTAMP NULL,
      UNIQUE KEY unique_organization_id (organization_id)
    )
  `);

  await db.execute(`
    CREATE TABLE preset_donations (
      id INT AUTO_INCREMENT PRIMARY KEY,
      organization_id INT,
      amount DECIMAL(10,2) NOT NULL,
      catalog_item_id VARCHAR(255),
      catalog_variation_id VARCHAR(255),
      is_active BOOLEAN DEFAULT TRUE,
      display_order INT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY unique_org_amount (organization_id, amount),
      INDEX idx_preset_donations_organization_id (organization_id),
      INDEX idx_preset_donations_catalog_ids (catalog_variation_id)
    )
  `);

  await db.execute(`
    CREATE TABLE order_transactions (
      id INT AUTO_INCREMENT PRIMARY KEY,
      organization_id INT,
      donation_id INT,
      square_order_id VARCHAR(255) UNIQUE NOT NULL,
      square_payment_id VARCHAR(255),
      order_status VARCHAR(50) DEFAULT 'PENDING',
      payment_status VARCHAR(50),
      amount DECIMAL(10,2) NOT NULL,
      currency VARCHAR(10) DEFAULT 'USD',
      is_custom_amount BOOLEAN DEFAULT FALSE,
      catalog_item_used VARCHAR(255),
      order_data JSON,
      payment_data JSON,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_order_transactions_square_ids (square_order_id, square_payment_id),
      INDEX idx_order_transactions_organization_id (organization_id)
    )
  `);

  await db.execute(`
    CREATE TABLE payment_events (
      id INT AUTO_INCREMENT PRIMARY KEY,
      payment_id VARCHAR(255) NOT NULL,
      event_type VARCHAR(100) NOT NULL,
      merchant_id VARCHAR(255),
      order_id VARCHAR(255),
      amount DECIMAL(10,2),
      created_at TIMESTAMP NOT NULL,
      UNIQUE KEY unique_payment_event (payment_id, event_type),
      INDEX idx_payment_events_payment_id (payment_id)
    )
  `);

  await db.execute(`
    CREATE TABLE webhook_events (
      id INT AUTO_INCREMENT PRIMARY KEY,
      event_id VARCHAR(255) UNIQUE NOT NULL,
      event_type VARCHAR(100) NOT NULL,
      merchant_id VARCHAR(255) NOT NULL,
      data JSON NOT NULL,
      processed BOOLEAN DEFAULT FALSE,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_webhook_events_event_type (event_type),
      INDEX idx_webhook_events_merchant_id (merchant_id)
    )
  `);

  console.log('   ✅ All tables created successfully');
}

// Run the import
importActualData().catch(error => {
  console.error('Migration failed:', error);
  process.exit(1);
});