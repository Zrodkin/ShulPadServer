-- Create the square_connections table to store OAuth tokens
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

-- Create organizations table to track different organizations using the app
CREATE TABLE IF NOT EXISTS organizations (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  logo_url TEXT,
  contact_email TEXT,
  contact_phone TEXT,
  square_merchant_id TEXT UNIQUE,
  active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Create donations table to track donations processed
CREATE TABLE IF NOT EXISTS donations (
  id SERIAL PRIMARY KEY,
  organization_id INTEGER REFERENCES organizations(id),
  amount DECIMAL(10, 2) NOT NULL,
  currency TEXT NOT NULL DEFAULT 'USD',
  donor_name TEXT,
  donor_email TEXT,
  payment_id TEXT,
  payment_status TEXT NOT NULL,
  receipt_sent BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Create kiosk_settings table to store kiosk configuration
CREATE TABLE IF NOT EXISTS kiosk_settings (
  id SERIAL PRIMARY KEY,
  organization_id INTEGER REFERENCES organizations(id),
  preset_amounts TEXT[], -- Stored as JSON array
  timeout_seconds INTEGER DEFAULT 60,
  welcome_message TEXT,
  thank_you_message TEXT,
  logo_url TEXT,
  background_image_url TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  UNIQUE(organization_id)
);

-- Create webhook_events table to track Square webhook events
CREATE TABLE IF NOT EXISTS webhook_events (
  id SERIAL PRIMARY KEY,
  event_id TEXT UNIQUE NOT NULL,
  event_type TEXT NOT NULL,
  merchant_id TEXT NOT NULL,
  data JSONB NOT NULL,
  processed BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);