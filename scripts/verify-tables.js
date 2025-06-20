// scripts/verify-tables.js
const path = require('path');
require('dotenv').config({ path: path.resolve(process.cwd(), '.env.local') });

async function verifyTables() {
  try {
    const { connect } = require('@planetscale/database');
    const db = connect({
      url: process.env.DATABASE_URL
    });
    
    const tables = ['subscriptions', 'device_registrations', 'promo_codes', 'subscription_plans'];
    
    console.log('🔍 Verifying subscription tables...');
    
    for (const table of tables) {
      const result = await db.execute(`SHOW TABLES LIKE '${table}'`);
      if (result.rows.length > 0) {
        console.log(`✅ Table '${table}' exists`);
      } else {
        console.log(`❌ Table '${table}' missing`);
      }
    }
    
    console.log('🎉 Table verification complete!');
  } catch (error) {
    console.error('❌ Verification failed:', error);
  }
}

verifyTables();