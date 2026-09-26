BEGIN;

-- Ownership check FIRST: a non-owner run would otherwise fail with Postgres's
-- own "must be owner of table" error, not this one.
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
 * The dates the price provider has answered for one symbol, and the listing
 * and currency it quoted them in.
 *
 * Bars alone cannot tell a market holiday from a day never fetched, so a sync
 * reading only price_bars asked for the same empty days again. A symbol with
 * no row here was cached before this table existed; the sync reads its
 * coverage off the bars once and writes the row.
 */
CREATE TABLE IF NOT EXISTS investing.price_coverage (
  user_id TEXT NOT NULL,
  symbol TEXT NOT NULL,
  from_date DATE NOT NULL,
  to_date DATE NOT NULL,
  listing TEXT,
  currency TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, symbol),
  CONSTRAINT price_coverage_user_id_not_blank CHECK (btrim(user_id) <> ''),
  CONSTRAINT price_coverage_symbol_not_blank CHECK (btrim(symbol) <> ''),
  CONSTRAINT price_coverage_currency_not_blank CHECK (btrim(currency) <> ''),
  CONSTRAINT price_coverage_window_ordered CHECK (from_date <= to_date)
);

ALTER TABLE investing.price_coverage ENABLE ROW LEVEL SECURITY;
ALTER TABLE investing.price_coverage FORCE ROW LEVEL SECURITY;

DO $policies$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'investing' AND tablename = 'price_coverage'
      AND policyname = 'price_coverage_user_access'
  ) THEN
    EXECUTE $sql$
      CREATE POLICY price_coverage_user_access ON investing.price_coverage
        FOR ALL TO PUBLIC
        USING (user_id = NULLIF(current_setting('app.user_id', true), ''))
        WITH CHECK (user_id = NULLIF(current_setting('app.user_id', true), ''))
    $sql$;
  END IF;
END $policies$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'lavega_runtime') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON investing.price_coverage TO lavega_runtime;
  END IF;
END $$;

COMMIT;
