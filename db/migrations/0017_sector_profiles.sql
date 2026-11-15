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
 * A symbol's sector classification is not tenant data — AAPL's sector is the
 * same fact regardless of which account holds it. Every other table in this
 * schema (price_bars, price_coverage, preferences) is deliberately per-user
 * with row-level security, because market data is cached per tenant there
 * today; this table is the one place that convention would be actively
 * wrong, so it has neither a user_id column nor RLS, on the same documented
 * basis as personal.ai_usage ("aggregate ... not per-user data") — see
 * packages/database/src/migrations.test.ts.
 */
CREATE TABLE IF NOT EXISTS investing.sector_profiles (
  symbol TEXT NOT NULL PRIMARY KEY,
  profile JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT sector_profiles_symbol_not_blank CHECK (btrim(symbol) <> ''),
  CONSTRAINT sector_profiles_kind_valid
    CHECK (profile ->> 'kind' IN ('stock', 'fund'))
);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'lavega_runtime') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON investing.sector_profiles TO lavega_runtime;
  END IF;
END $$;

COMMIT;
