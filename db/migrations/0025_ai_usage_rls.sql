BEGIN;

-- Ownership check FIRST, before the ALTER statements below: on a second,
-- non-owner run ALTER TABLE would otherwise fail with Postgres's own "must be
-- owner of table" error, not this one.
DO $$
DECLARE
  schema_owner TEXT;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'lavega_runtime') THEN
    SELECT pg_get_userbyid(nspowner) INTO schema_owner FROM pg_namespace WHERE nspname = 'personal';
    IF NOT pg_has_role(current_user, schema_owner, 'MEMBER') THEN
      RAISE EXCEPTION 'apply this migration connected as %, the owner of schema % (you are %)',
        schema_owner, 'personal', current_user;
    END IF;
  END IF;
END $$;

/*
 * `personal.ai_usage` is per-account data, not the owner's aggregate.
 *
 * 0005 declared it "the OWNER's own aggregate AI spend ... not per-user data"
 * and deliberately left it without row-level security on that basis. 0013
 * changed the premise: it added `user_id`, because open signup means each
 * account has to hit its own day and month cap rather than share one bucket.
 * The policy text of 0005 was never revisited, so a table that is now keyed by
 * account was the one per-person table in `personal` with no RLS backstop, and
 * the GDPR erasure path had to be hand-carried for it (`USER_DATA_TABLES` in
 * packages/database). This restores the invariant every other table in this
 * schema already holds: ENABLE and FORCE row security, scoped to `app.user_id`.
 *
 * Rows written before 0013 carry a NULL `user_id`. They belong to no account,
 * count toward no account's cap (`spentCents` always filters on `user_id`), and
 * are therefore invisible under this policy and undelatable through the tenant
 * path — the correct reading of a row nobody owns, not a regression.
 *
 * FORCE, not just ENABLE: ENABLE alone exempts the table's owner, and the
 * runtime role is deliberately not that owner (0004_eb_grants.sql).
 */
ALTER TABLE personal.ai_usage ENABLE ROW LEVEL SECURITY;
ALTER TABLE personal.ai_usage FORCE ROW LEVEL SECURITY;

DO $policies$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'personal' AND tablename = 'ai_usage'
      AND policyname = 'ai_usage_user_access'
  ) THEN
    EXECUTE $sql$
      CREATE POLICY ai_usage_user_access ON personal.ai_usage
        FOR ALL TO PUBLIC
        USING (user_id = NULLIF(current_setting('app.user_id', true), ''))
        WITH CHECK (user_id = NULLIF(current_setting('app.user_id', true), ''))
    $sql$;
  END IF;
END $policies$;

-- No new grants: 0005 already gave lavega_runtime SELECT, INSERT, UPDATE and
-- DELETE on this table, and this migration changes only what those grants see.
-- The budget guard's own statements (reserve/reconcile/release/record/spentCents
-- in packages/database) now run inside a tenant transaction that sets
-- `app.user_id`, so this policy applies to them exactly as it does to a
-- repository method written on `withTenant`.

COMMIT;
