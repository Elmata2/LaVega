BEGIN;

-- Ownership check FIRST, before the CREATE statements below (same convention
-- as 0024 and 0039): a non-owner re-run would otherwise fail with Postgres's
-- own "must be owner of table" error, not this one.
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
 * Shared daily Enable Banking read counter per user account (#368).
 *
 * Banks enforce ~4 unattended AIS reads per day. Previously only the Instinct
 * agent counted reads (in personal.agent_state.fetches_today, gated on
 * agent_settings.enabled). Web refreshes were uncounted. This table is the
 * single shared counter across web refresh, nightly cron, and WhatsApp.
 *
 * personal.agent_state.fetches_today / fetches_day are intentionally kept in
 * place so existing deployments can roll forward without downtime.
 */
CREATE TABLE IF NOT EXISTS personal.eb_daily_reads (
  user_id TEXT PRIMARY KEY,
  fetches_today SMALLINT NOT NULL DEFAULT 0,
  fetches_day DATE NOT NULL,
  CONSTRAINT eb_daily_reads_user_id_not_blank CHECK (btrim(user_id) <> ''),
  CONSTRAINT eb_daily_reads_non_negative CHECK (fetches_today >= 0)
);

ALTER TABLE personal.eb_daily_reads ENABLE ROW LEVEL SECURITY;
ALTER TABLE personal.eb_daily_reads FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'personal'
      AND tablename = 'eb_daily_reads'
      AND policyname = 'eb_daily_reads_user_access'
  ) THEN
    EXECUTE $sql$
      CREATE POLICY eb_daily_reads_user_access ON personal.eb_daily_reads
        FOR ALL TO PUBLIC
        USING (user_id = NULLIF(current_setting('app.user_id', true), ''))
        WITH CHECK (user_id = NULLIF(current_setting('app.user_id', true), ''))
    $sql$;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'lavega_runtime') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON personal.eb_daily_reads TO lavega_runtime;
  END IF;
END $$;

COMMIT;
