BEGIN;

ALTER TABLE personal.eb_sessions
  ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS eb_sessions_expires_at_idx
  ON personal.eb_sessions (expires_at)
  WHERE expires_at IS NOT NULL;

COMMIT;
