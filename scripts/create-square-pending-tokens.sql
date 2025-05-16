CREATE TABLE IF NOT EXISTS square_pending_tokens (
  id SERIAL PRIMARY KEY,
  state VARCHAR(255) NOT NULL,
  access_token TEXT,
  refresh_token TEXT,
  merchant_id VARCHAR(255),
  expires_at TIMESTAMP,
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
