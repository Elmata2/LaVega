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
 * Partner request budgets (#305), one row per partner, endpoint and scope.
 *
 * Partners such as Yahoo, OpenFIGI and Trading 212 count requests per account
 * and per source IP, across every user and every serverless invocation. The
 * investing runtime is built again for each request, so a guard held in memory
 * starts empty each time. This table is the one place every invocation asks
 * for its next request slot.
 *
 *   next_at        the earliest instant the next request may be sent
 *   blocked_until  no request before this instant (a 429, or a spent window)
 *   interval_ms    spacing seen from the partner's own headers; overrides the
 *                  table default in the application when set
 *
 * scope_id is 16 hex characters (a truncated SHA-256 of a broker credential)
 * or the literal 'shared'. No column can hold a credential.
 *
 * The rows hold timing only and the shared keys must be visible to every
 * tenant, so the table has no user_id and no row-level security, like
 * investing.fx_rates.
 */
CREATE TABLE IF NOT EXISTS investing.partner_budgets (
  partner TEXT NOT NULL,
  endpoint TEXT NOT NULL,
  scope_id TEXT NOT NULL,
  next_at TIMESTAMPTZ NOT NULL,
  blocked_until TIMESTAMPTZ,
  interval_ms INTEGER,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (partner, endpoint, scope_id),
  CONSTRAINT partner_budgets_interval_positive CHECK (interval_ms IS NULL OR interval_ms > 0)
);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'lavega_runtime') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON investing.partner_budgets TO lavega_runtime;
  END IF;
END $$;

COMMIT;
