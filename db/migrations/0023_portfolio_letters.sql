BEGIN;

DO $$
DECLARE
  schema_owner TEXT;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'lavega_runtime') THEN
    SELECT pg_get_userbyid(nspowner) INTO schema_owner FROM pg_namespace WHERE nspname = 'investing';
    IF NOT pg_has_role(current_user, schema_owner, 'MEMBER') THEN
      RAISE EXCEPTION 'apply this migration connected as %, the owner of schema % (you are %)',
        schema_owner, 'investing', current_user;
    END IF;
  END IF;
END $$;

/*
 * Portfolio letters (Munger-03, docs/investing/agents/ROADMAP.md). One letter
 * per broker-sync snapshot: UNIQUE (user_id, snapshot_hash) lets two racing
 * cron calls insert once. The hashes stay plain so the generation gate needs
 * no decryption; verdict and observations are one AES-GCM blob, like agent
 * memory (0020).
 */
CREATE TABLE IF NOT EXISTS investing.portfolio_letters (
  user_id TEXT NOT NULL,
  id UUID NOT NULL,
  snapshot_hash TEXT NOT NULL,
  holdings_hash TEXT NOT NULL,
  body_blob BYTEA NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, id),
  CONSTRAINT portfolio_letters_user_snapshot_unique UNIQUE (user_id, snapshot_hash),
  CONSTRAINT portfolio_letters_user_id_not_blank CHECK (btrim(user_id) <> '')
);

CREATE INDEX IF NOT EXISTS portfolio_letters_user_created_idx
  ON investing.portfolio_letters (user_id, created_at DESC);

ALTER TABLE investing.portfolio_letters ENABLE ROW LEVEL SECURITY;
ALTER TABLE investing.portfolio_letters FORCE ROW LEVEL SECURITY;

DO $policies$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'investing' AND tablename = 'portfolio_letters'
      AND policyname = 'portfolio_letters_user_access'
  ) THEN
    CREATE POLICY portfolio_letters_user_access ON investing.portfolio_letters
      FOR ALL TO PUBLIC
      USING (user_id = NULLIF(current_setting('app.user_id', true), ''))
      WITH CHECK (user_id = NULLIF(current_setting('app.user_id', true), ''));
  END IF;
END $policies$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'lavega_runtime') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON investing.portfolio_letters TO lavega_runtime;
  END IF;
END $$;

COMMIT;
