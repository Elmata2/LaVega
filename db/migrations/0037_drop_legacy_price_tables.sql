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
 * The shared instrument-keyed store served one release before this file. The
 * only thing the version trigger still gave the dashboard,
 * `dashboard_snapshots.price_keys`, replaced it, and a table drop removes its
 * own triggers.
 */
DROP TABLE IF EXISTS investing.price_bars;
DROP TABLE IF EXISTS investing.price_coverage;

COMMIT;
