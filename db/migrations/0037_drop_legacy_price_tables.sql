BEGIN;

-- Ownership check FIRST, before the DROPs: a non-owner run otherwise fails
-- with Postgres's own "must be owner of table" instead of this message.
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
 * Drop the per-user price tables (issue #310, follow-up to #307).
 *
 * The shared instrument-keyed store landed and served one release: no code
 * reads or writes these two tables, and `dashboard_snapshots.price_keys`
 * replaced the only signal the version trigger gave the dashboard. Dropping a
 * table drops its own triggers, so `price_bars_raise_dashboard_version` goes
 * with `investing.price_bars`.
 *
 * `IF EXISTS` keeps the file rerunnable: a second run is a no-op.
 */
DROP TABLE IF EXISTS investing.price_bars;
DROP TABLE IF EXISTS investing.price_coverage;

COMMIT;
