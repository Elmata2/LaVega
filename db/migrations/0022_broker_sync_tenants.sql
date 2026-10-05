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

  /* FORCE ROW LEVEL SECURITY applies to the table owner too, so a definer
   * function only sees every user's vault if its owner bypasses RLS. Say so
   * here, at apply time, instead of letting the nightly cron list nobody. */
  IF NOT EXISTS (
    SELECT 1 FROM pg_roles WHERE rolname = current_user AND (rolsuper OR rolbypassrls)
  ) THEN
    RAISE EXCEPTION 'apply this migration as a role with BYPASSRLS (% has none); the nightly sync listing runs as its owner', current_user;
  END IF;
END $$;

/*
 * The nightly investing cron has to find every user with a connected broker.
 * broker_vaults is FORCE ROW LEVEL SECURITY keyed on app.user_id, so the runtime
 * role cannot list across users, and must not be able to.
 *
 * This is the one deliberate hole: a function that returns user ids and nothing
 * else (no credentials, no snapshots, no broker names). It runs as its owner,
 * who bypasses RLS; the policy on the table is unchanged.
 *
 * Order is the fairness rule for a cron that may run out of time: users whose
 * broker sync started longest ago go first, never-synced users before all of
 * them. Only the broker's own sync_state row counts (the price run keeps its
 * own row under broker 'prices'), and a started time rather than a succeeded
 * one, so a user whose sync keeps failing still rotates instead of starving
 * everyone behind them.
 */
CREATE OR REPLACE FUNCTION investing.list_broker_sync_tenants()
RETURNS TABLE (tenant_id TEXT)
LANGUAGE sql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
  SELECT bv.user_id
  FROM investing.broker_vaults AS bv
  LEFT JOIN investing.sync_state AS ss
    ON ss.user_id = bv.user_id AND ss.broker = bv.broker
  GROUP BY bv.user_id
  ORDER BY MAX(ss.last_started_at) ASC NULLS FIRST, bv.user_id ASC
$$;

REVOKE ALL ON FUNCTION investing.list_broker_sync_tenants() FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'lavega_runtime') THEN
    GRANT EXECUTE ON FUNCTION investing.list_broker_sync_tenants() TO lavega_runtime;
  END IF;
END $$;

COMMIT;
