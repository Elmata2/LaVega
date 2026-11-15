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
 * The dashboard is derived from broker snapshots, price bars and benchmark
 * preferences, and building it reads all of them. It is stored here, encrypted
 * like the snapshots it comes from, so a request can serve it in one read.
 *
 * Whether a stored dashboard is still current is decided in the database, not
 * by whichever instance wrote it. Every write to a source table raises the
 * user's dashboard_sources.version in the same transaction, and a dashboard
 * counts only while the version it was built at is the current one. One built
 * from data that a sync replaced mid-build is therefore never served. The day
 * is part of it too: the dashboard's history ends at the day it was built.
 */
CREATE TABLE IF NOT EXISTS investing.dashboard_sources (
  user_id TEXT PRIMARY KEY,
  version BIGINT NOT NULL DEFAULT 0,
  CONSTRAINT dashboard_sources_user_id_not_blank CHECK (btrim(user_id) <> '')
);

CREATE TABLE IF NOT EXISTS investing.dashboard_snapshots (
  user_id TEXT NOT NULL,
  cache_key TEXT NOT NULL,
  version BIGINT NOT NULL,
  as_of DATE NOT NULL,
  blob BYTEA NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, cache_key),
  CONSTRAINT dashboard_snapshots_user_id_not_blank CHECK (btrim(user_id) <> ''),
  CONSTRAINT dashboard_snapshots_blob_not_empty CHECK (octet_length(blob) > 0)
);

ALTER TABLE investing.dashboard_sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE investing.dashboard_sources FORCE ROW LEVEL SECURITY;
ALTER TABLE investing.dashboard_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE investing.dashboard_snapshots FORCE ROW LEVEL SECURITY;

DO $policies$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'investing' AND tablename = 'dashboard_sources'
      AND policyname = 'dashboard_sources_user_access'
  ) THEN
    EXECUTE $sql$
      CREATE POLICY dashboard_sources_user_access ON investing.dashboard_sources
        FOR ALL TO PUBLIC
        USING (user_id = NULLIF(current_setting('app.user_id', true), ''))
        WITH CHECK (user_id = NULLIF(current_setting('app.user_id', true), ''))
    $sql$;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'investing' AND tablename = 'dashboard_snapshots'
      AND policyname = 'dashboard_snapshots_user_access'
  ) THEN
    EXECUTE $sql$
      CREATE POLICY dashboard_snapshots_user_access ON investing.dashboard_snapshots
        FOR ALL TO PUBLIC
        USING (user_id = NULLIF(current_setting('app.user_id', true), ''))
        WITH CHECK (user_id = NULLIF(current_setting('app.user_id', true), ''))
    $sql$;
  END IF;
END $policies$;

-- A write made without a tenant (owner maintenance) raises nothing; the day
-- bound on a stored dashboard still retires it.
CREATE OR REPLACE FUNCTION investing.raise_dashboard_version() RETURNS trigger
LANGUAGE plpgsql AS $fn$
DECLARE
  tenant TEXT := NULLIF(current_setting('app.user_id', true), '');
BEGIN
  IF tenant IS NOT NULL THEN
    INSERT INTO investing.dashboard_sources (user_id, version) VALUES (tenant, 1)
    ON CONFLICT (user_id) DO UPDATE SET version = investing.dashboard_sources.version + 1;
  END IF;
  RETURN NULL;
END
$fn$;

CREATE OR REPLACE TRIGGER broker_vaults_raise_dashboard_version
  AFTER INSERT OR UPDATE OR DELETE ON investing.broker_vaults
  FOR EACH STATEMENT EXECUTE FUNCTION investing.raise_dashboard_version();
CREATE OR REPLACE TRIGGER price_bars_raise_dashboard_version
  AFTER INSERT OR UPDATE OR DELETE ON investing.price_bars
  FOR EACH STATEMENT EXECUTE FUNCTION investing.raise_dashboard_version();
CREATE OR REPLACE TRIGGER preferences_raise_dashboard_version
  AFTER INSERT OR UPDATE OR DELETE ON investing.preferences
  FOR EACH STATEMENT EXECUTE FUNCTION investing.raise_dashboard_version();

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'lavega_runtime') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE
      ON investing.dashboard_sources, investing.dashboard_snapshots TO lavega_runtime;
  END IF;
END $$;

COMMIT;
