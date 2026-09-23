BEGIN;

-- Ownership check FIRST, before the CREATE statements below: on a second,
-- non-owner run those already-idempotent statements would otherwise fail
-- with Postgres's own "must be owner of table" error, not this one.
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
 * Published daily exchange rates, one row per base currency and date.
 *
 * Building a dashboard converts every trade and dividend at the rate of its
 * day, which used to mean fetching years of rates from Frankfurter on every
 * build. A published rate does not change, so it is fetched once and read from
 * here after that.
 *
 * These are public reference rates and belong to no user, so the table has no
 * user_id and no row-level security, like personal.ai_usage.
 */
CREATE TABLE IF NOT EXISTS investing.fx_rates (
  base TEXT NOT NULL,
  date DATE NOT NULL,
  rates JSONB NOT NULL,
  PRIMARY KEY (base, date),
  CONSTRAINT fx_rates_rates_is_object CHECK (jsonb_typeof(rates) = 'object')
);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'lavega_runtime') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON investing.fx_rates TO lavega_runtime;
  END IF;
END $$;

COMMIT;
