CREATE TABLE IF NOT EXISTS square_pending_tokens (
  id SERIAL PRIMARY KEY,
  state VARCHAR(255) NOT NULL,
  access_token TEXT NULL, -- Explicitly set to NULL for initial phase of OAuth
  refresh_token TEXT NULL, -- Explicitly set to NULL for initial phase of OAuth
  merchant_id VARCHAR(255) NULL, -- Explicitly set to NULL for initial phase of OAuth
  expires_at TIMESTAMP NULL, -- Explicitly set to NULL for initial phase of OAuth
  created_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(state)
);

-- Add an index for faster lookups
CREATE INDEX IF NOT EXISTS idx_square_pending_tokens_state ON square_pending_tokens(state);

-- Add an automatic cleanup for old tokens (optional)
CREATE OR REPLACE FUNCTION cleanup_old_pending_tokens() RETURNS TRIGGER AS $$
BEGIN
  DELETE FROM square_pending_tokens WHERE created_at < NOW() - INTERVAL '1 day';
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_cleanup_old_pending_tokens ON square_pending_tokens;

CREATE TRIGGER trigger_cleanup_old_pending_tokens
AFTER INSERT ON square_pending_tokens
EXECUTE PROCEDURE cleanup_old_pending_tokens();

-- If your production database already has NOT NULL constraints,
-- run these commands to remove them:
ALTER TABLE IF EXISTS square_pending_tokens ALTER COLUMN access_token DROP NOT NULL;
ALTER TABLE IF EXISTS square_pending_tokens ALTER COLUMN refresh_token DROP NOT NULL;
ALTER TABLE IF EXISTS square_pending_tokens ALTER COLUMN merchant_id DROP NOT NULL;
ALTER TABLE IF EXISTS square_pending_tokens ALTER COLUMN expires_at DROP NOT NULL;