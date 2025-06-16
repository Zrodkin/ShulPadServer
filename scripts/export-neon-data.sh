#!/bin/bash
# scripts/export-neon-data.sh
# This script exports all data from your Neon database

echo "🗄️  Starting Neon database export..."
echo ""

# Create backups directory if it doesn't exist
mkdir -p backups
cd backups

# Get current timestamp for backup files
TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
echo "📅 Backup timestamp: $TIMESTAMP"
echo ""

# Load DATABASE_URL from .env.local
if [ -f "../.env.local" ]; then
    export $(grep -v '^#' ../.env.local | xargs)
    echo "✅ Loaded environment variables from .env.local"
else
    echo "❌ Error: .env.local file not found!"
    echo "   Make sure you're running this from your project root directory"
    exit 1
fi

if [ -z "$DATABASE_URL" ]; then
    echo "❌ Error: DATABASE_URL not found in environment variables"
    echo "   Check your .env.local file"
    exit 1
fi

echo "🔍 Using database: $(echo $DATABASE_URL | sed 's/:\/\/.*@/:\/\/***@/')"
echo ""

# 1. Export schema only (structure of tables)
echo "1️⃣  Exporting database schema..."
pg_dump "$DATABASE_URL" \
    --schema-only \
    --no-owner \
    --no-privileges \
    --verbose \
    --file="charity_pad_schema_${TIMESTAMP}.sql"

if [ $? -eq 0 ]; then
    echo "✅ Schema export successful: charity_pad_schema_${TIMESTAMP}.sql"
else
    echo "❌ Schema export failed!"
    exit 1
fi
echo ""

# 2. Export data only (contents of tables)
echo "2️⃣  Exporting database data..."
pg_dump "$DATABASE_URL" \
    --data-only \
    --no-owner \
    --no-privileges \
    --verbose \
    --disable-triggers \
    --file="charity_pad_data_${TIMESTAMP}.sql"

if [ $? -eq 0 ]; then
    echo "✅ Data export successful: charity_pad_data_${TIMESTAMP}.sql"
else
    echo "❌ Data export failed!"
    exit 1
fi
echo ""

# 3. Export complete backup (schema + data together)
echo "3️⃣  Creating complete backup..."
pg_dump "$DATABASE_URL" \
    --no-owner \
    --no-privileges \
    --verbose \
    --file="charity_pad_complete_${TIMESTAMP}.sql"

if [ $? -eq 0 ]; then
    echo "✅ Complete backup successful: charity_pad_complete_${TIMESTAMP}.sql"
else
    echo "❌ Complete backup failed!"
    exit 1
fi
echo ""

# 4. Show what we created
echo "📋 Backup files created:"
ls -lh charity_pad_*_${TIMESTAMP}.sql
echo ""

# 5. Show file sizes to verify they contain data
echo "📊 Backup file sizes:"
for file in charity_pad_*_${TIMESTAMP}.sql; do
    size=$(wc -l < "$file")
    echo "   $file: $size lines"
done
echo ""

# 6. Create a summary file
echo "📝 Creating backup summary..."
cat > "backup_summary_${TIMESTAMP}.txt" << EOF
Charity Pad Database Backup Summary
===================================
Date: $(date)
Source: Neon Database
Tables Exported: 13 tables
- device_coordination_events
- donations  
- kiosk_settings
- order_transactions
- organizations
- payment_events
- preset_donations
- receipt_log
- schema_migrations
- square_connections (1 connection)
- square_device_connections
- square_pending_tokens (6 pending tokens)
- webhook_events

Files Created:
- charity_pad_schema_${TIMESTAMP}.sql (database structure)
- charity_pad_data_${TIMESTAMP}.sql (table data)
- charity_pad_complete_${TIMESTAMP}.sql (complete backup)

Critical Data:
- Square Connection: Organization 'default'
- Merchant ID: MLE0CT8RWF16F
- Location ID: L96TE51REN2VG
- Token Expires: July 16, 2025

Next Steps:
1. Verify backups are complete
2. Set up PlanetScale database
3. Convert data format for MySQL
4. Import to PlanetScale
EOF

echo "✅ Summary created: backup_summary_${TIMESTAMP}.txt"
echo ""

echo "🎉 Export complete!"
echo ""
echo "📁 All backup files are in the 'backups' directory:"
echo "   $(pwd)"
echo ""
echo "🔍 To verify your backup worked, you can check:"
echo "   cat backup_summary_${TIMESTAMP}.txt"
echo ""
echo "✅ Ready for next step: Setting up PlanetScale!"