-- Add location_id to square_connections table
ALTER TABLE square_connections 
ADD COLUMN IF NOT EXISTS location_id TEXT;

-- Create preset_donations table to store catalog-linked donation amounts
CREATE TABLE IF NOT EXISTS preset_donations (
  id SERIAL PRIMARY KEY,
  organization_id INTEGER REFERENCES organizations(id),
  amount DECIMAL(10, 2) NOT NULL,
  catalog_item_id TEXT,           -- ID of the parent "Donations" item
  catalog_variation_id TEXT,       -- ID of the specific variation for this amount
  is_active BOOLEAN DEFAULT TRUE,
  display_order INTEGER,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  UNIQUE(organization_id, amount)
);

-- Create index for faster lookups
CREATE INDEX IF NOT EXISTS idx_preset_donations_organization_id 
ON preset_donations(organization_id);

CREATE INDEX IF NOT EXISTS idx_preset_donations_catalog_ids
ON preset_donations(catalog_variation_id);

-- Create order_transactions table to track orders and payments
CREATE TABLE IF NOT EXISTS order_transactions (
  id SERIAL PRIMARY KEY,
  organization_id INTEGER REFERENCES organizations(id),
  donation_id INTEGER REFERENCES donations(id),
  square_order_id TEXT UNIQUE NOT NULL,
  square_payment_id TEXT,
  order_status TEXT NOT NULL DEFAULT 'PENDING',
  payment_status TEXT,
  amount DECIMAL(10, 2) NOT NULL,
  currency TEXT NOT NULL DEFAULT 'USD',
  is_custom_amount BOOLEAN DEFAULT FALSE,
  catalog_item_used TEXT,          -- If a preset amount was used, store the catalog ID
  order_data JSONB,                -- Full order data from Square
  payment_data JSONB,              -- Full payment data from Square
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_order_transactions_square_ids
ON order_transactions(square_order_id, square_payment_id);

CREATE INDEX IF NOT EXISTS idx_order_transactions_organization_id
ON order_transactions(organization_id);

-- Modify kiosk_settings table to support catalog item references
ALTER TABLE kiosk_settings
DROP COLUMN IF EXISTS preset_amounts;

ALTER TABLE kiosk_settings
ADD COLUMN IF NOT EXISTS allow_custom_amount BOOLEAN DEFAULT TRUE,
ADD COLUMN IF NOT EXISTS min_custom_amount DECIMAL(10, 2) DEFAULT 1.00,
ADD COLUMN IF NOT EXISTS max_custom_amount DECIMAL(10, 2) DEFAULT 1000.00,
ADD COLUMN IF NOT EXISTS catalog_parent_id TEXT,
ADD COLUMN IF NOT EXISTS last_catalog_sync TIMESTAMP;

-- Update donations table to include order information
ALTER TABLE donations
ADD COLUMN IF NOT EXISTS square_order_id TEXT,
ADD COLUMN IF NOT EXISTS is_custom_amount BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS catalog_item_id TEXT,
ADD COLUMN IF NOT EXISTS donation_type TEXT DEFAULT 'one_time';

-- Add migration version tracking table (useful for future migrations)
CREATE TABLE IF NOT EXISTS schema_migrations (
  version TEXT PRIMARY KEY,
  applied_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Insert current migration version
INSERT INTO schema_migrations (version) 
VALUES ('20240521_catalog_integration') 
ON CONFLICT (version) DO NOTHING;