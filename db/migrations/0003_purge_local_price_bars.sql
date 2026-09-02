BEGIN;

-- Before commit 4cea140, createYahooPriceProvider stamped every price bar
-- with tenantId "local" regardless of who synced it, so bars landed in the
-- `local` partition of investing.price_bars while the dashboard read bars for
-- the signed-in Better Auth user. On lavega.dev those `local` rows are
-- unreachable: no verified session ever resolves to that tenant, and the next
-- price sync refills the correct partition. Only price_bars was affected —
-- broker_vaults, preferences, sync_state and agent_runs are always written
-- under whatever tenant the caller names, never a hardcoded one.
--
-- A self-hosted deployment can point DATABASE_URL at Neon without setting
-- BETTER_AUTH_SECRET (getAuth() then returns null). In that configuration
-- investingTenantId() legitimately resolves every request to "local" and the
-- rows in that partition are real, current data, not debris. There is no way
-- to tell the two situations apart from inside SQL, so this migration only
-- deletes when the database already holds at least one Better Auth user: that
-- is only possible once authentication has actually been configured and used,
-- which the local-tenant-without-auth setup above never does. Without a
-- public.user row, this migration is a no-op — safe to run unconditionally,
-- including against a self-hosted database.
DO $purge$
BEGIN
  IF to_regclass('public.user') IS NOT NULL
      AND EXISTS (SELECT 1 FROM public."user")
  THEN
    DELETE FROM investing.price_bars WHERE user_id = 'local';
  END IF;
END
$purge$;

COMMIT;
