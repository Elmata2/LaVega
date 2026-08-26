BEGIN;

-- Application data is split by domain. Better Auth tables are intentionally
-- not created here; authentication remains a later runtime change.
CREATE SCHEMA IF NOT EXISTS personal;
CREATE SCHEMA IF NOT EXISTS investing;

CREATE TABLE IF NOT EXISTS personal.vaults (
  user_id TEXT NOT NULL PRIMARY KEY,
  vault_blob BYTEA NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT vaults_user_id_not_blank CHECK (btrim(user_id) <> ''),
  CONSTRAINT vaults_blob_not_empty CHECK (octet_length(vault_blob) > 0)
);

CREATE TABLE IF NOT EXISTS investing.broker_vaults (
  user_id TEXT NOT NULL,
  broker TEXT NOT NULL,
  credentials_blob BYTEA NOT NULL,
  snapshot_blob BYTEA,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, broker),
  CONSTRAINT broker_vaults_user_id_not_blank CHECK (btrim(user_id) <> ''),
  CONSTRAINT broker_vaults_broker_not_blank CHECK (btrim(broker) <> ''),
  CONSTRAINT broker_vaults_credentials_not_empty
    CHECK (octet_length(credentials_blob) > 0),
  CONSTRAINT broker_vaults_snapshot_not_empty
    CHECK (snapshot_blob IS NULL OR octet_length(snapshot_blob) > 0)
);

CREATE TABLE IF NOT EXISTS investing.price_bars (
  user_id TEXT NOT NULL,
  symbol TEXT NOT NULL,
  date DATE NOT NULL,
  open NUMERIC(20, 8),
  high NUMERIC(20, 8),
  low NUMERIC(20, 8),
  close NUMERIC(20, 8) NOT NULL,
  volume BIGINT,
  currency CHAR(3) NOT NULL,
  provider TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, symbol, date),
  CONSTRAINT price_bars_user_id_not_blank CHECK (btrim(user_id) <> ''),
  CONSTRAINT price_bars_symbol_not_blank CHECK (btrim(symbol) <> ''),
  CONSTRAINT price_bars_currency_uppercase
    CHECK (currency = upper(currency) AND currency ~ '^[A-Z]{3}$'),
  CONSTRAINT price_bars_provider_not_blank CHECK (btrim(provider) <> ''),
  CONSTRAINT price_bars_open_non_negative CHECK (open IS NULL OR open >= 0),
  CONSTRAINT price_bars_high_non_negative CHECK (high IS NULL OR high >= 0),
  CONSTRAINT price_bars_low_non_negative CHECK (low IS NULL OR low >= 0),
  CONSTRAINT price_bars_close_non_negative CHECK (close >= 0),
  CONSTRAINT price_bars_volume_non_negative CHECK (volume IS NULL OR volume >= 0),
  CONSTRAINT price_bars_high_not_below_low
    CHECK (high IS NULL OR low IS NULL OR high >= low)
);

CREATE TABLE IF NOT EXISTS investing.preferences (
  user_id TEXT NOT NULL PRIMARY KEY,
  benchmark_symbols JSONB NOT NULL DEFAULT '[]'::JSONB,
  market_data_consent JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT preferences_user_id_not_blank CHECK (btrim(user_id) <> ''),
  CONSTRAINT preferences_benchmarks_array
    CHECK (jsonb_typeof(benchmark_symbols) = 'array'),
  CONSTRAINT preferences_benchmarks_max_three
    CHECK (jsonb_array_length(benchmark_symbols) <= 3),
  CONSTRAINT preferences_consent_object
    CHECK (jsonb_typeof(market_data_consent) = 'object')
);

CREATE TABLE IF NOT EXISTS investing.sync_state (
  user_id TEXT NOT NULL,
  broker TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'idle',
  state JSONB NOT NULL DEFAULT '{}'::JSONB,
  last_started_at TIMESTAMPTZ,
  last_succeeded_at TIMESTAMPTZ,
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, broker),
  CONSTRAINT sync_state_user_id_not_blank CHECK (btrim(user_id) <> ''),
  CONSTRAINT sync_state_broker_not_blank CHECK (btrim(broker) <> ''),
  CONSTRAINT sync_state_status_valid
    CHECK (status IN ('idle', 'running', 'succeeded', 'failed', 'partial')),
  CONSTRAINT sync_state_object CHECK (jsonb_typeof(state) = 'object')
);

CREATE TABLE IF NOT EXISTS investing.agent_runs (
  user_id TEXT NOT NULL PRIMARY KEY,
  run_id TEXT NOT NULL,
  status TEXT NOT NULL,
  run_result JSONB NOT NULL DEFAULT '{}'::JSONB,
  started_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT agent_runs_user_id_not_blank CHECK (btrim(user_id) <> ''),
  CONSTRAINT agent_runs_run_id_not_blank CHECK (btrim(run_id) <> ''),
  CONSTRAINT agent_runs_status_valid
    CHECK (status IN ('queued', 'running', 'succeeded', 'failed', 'cancelled')),
  CONSTRAINT agent_runs_result_object CHECK (jsonb_typeof(run_result) = 'object'),
  CONSTRAINT agent_runs_finished_after_started
    CHECK (finished_at IS NULL OR started_at IS NULL OR finished_at >= started_at)
);

-- Primary-key indexes cover ownership lookups. These indexes cover common
-- user-scoped time-range and broker-list queries.
CREATE INDEX IF NOT EXISTS price_bars_user_date_idx
  ON investing.price_bars (user_id, date DESC);
CREATE INDEX IF NOT EXISTS price_bars_user_symbol_date_desc_idx
  ON investing.price_bars (user_id, symbol, date DESC);
CREATE INDEX IF NOT EXISTS broker_vaults_user_updated_idx
  ON investing.broker_vaults (user_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS sync_state_user_updated_idx
  ON investing.sync_state (user_id, updated_at DESC);

ALTER TABLE personal.vaults ENABLE ROW LEVEL SECURITY;
ALTER TABLE personal.vaults FORCE ROW LEVEL SECURITY;
ALTER TABLE investing.broker_vaults ENABLE ROW LEVEL SECURITY;
ALTER TABLE investing.broker_vaults FORCE ROW LEVEL SECURITY;
ALTER TABLE investing.price_bars ENABLE ROW LEVEL SECURITY;
ALTER TABLE investing.price_bars FORCE ROW LEVEL SECURITY;
ALTER TABLE investing.preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE investing.preferences FORCE ROW LEVEL SECURITY;
ALTER TABLE investing.sync_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE investing.sync_state FORCE ROW LEVEL SECURITY;
ALTER TABLE investing.agent_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE investing.agent_runs FORCE ROW LEVEL SECURITY;

-- Auth middleware must set this transaction-locally after verifying the
-- Better Auth session. Missing or empty context matches no user_id.
DO $policies$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'personal'
      AND tablename = 'vaults'
      AND policyname = 'vaults_user_access'
  ) THEN
    EXECUTE $sql$
      CREATE POLICY vaults_user_access ON personal.vaults
        FOR ALL TO PUBLIC
        USING (user_id = NULLIF(current_setting('app.user_id', true), ''))
        WITH CHECK (user_id = NULLIF(current_setting('app.user_id', true), ''))
    $sql$;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'investing'
      AND tablename = 'broker_vaults'
      AND policyname = 'broker_vaults_user_access'
  ) THEN
    EXECUTE $sql$
      CREATE POLICY broker_vaults_user_access ON investing.broker_vaults
        FOR ALL TO PUBLIC
        USING (user_id = NULLIF(current_setting('app.user_id', true), ''))
        WITH CHECK (user_id = NULLIF(current_setting('app.user_id', true), ''))
    $sql$;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'investing'
      AND tablename = 'price_bars'
      AND policyname = 'price_bars_user_access'
  ) THEN
    EXECUTE $sql$
      CREATE POLICY price_bars_user_access ON investing.price_bars
        FOR ALL TO PUBLIC
        USING (user_id = NULLIF(current_setting('app.user_id', true), ''))
        WITH CHECK (user_id = NULLIF(current_setting('app.user_id', true), ''))
    $sql$;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'investing'
      AND tablename = 'preferences'
      AND policyname = 'preferences_user_access'
  ) THEN
    EXECUTE $sql$
      CREATE POLICY preferences_user_access ON investing.preferences
        FOR ALL TO PUBLIC
        USING (user_id = NULLIF(current_setting('app.user_id', true), ''))
        WITH CHECK (user_id = NULLIF(current_setting('app.user_id', true), ''))
    $sql$;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'investing'
      AND tablename = 'sync_state'
      AND policyname = 'sync_state_user_access'
  ) THEN
    EXECUTE $sql$
      CREATE POLICY sync_state_user_access ON investing.sync_state
        FOR ALL TO PUBLIC
        USING (user_id = NULLIF(current_setting('app.user_id', true), ''))
        WITH CHECK (user_id = NULLIF(current_setting('app.user_id', true), ''))
    $sql$;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'investing'
      AND tablename = 'agent_runs'
      AND policyname = 'agent_runs_user_access'
  ) THEN
    EXECUTE $sql$
      CREATE POLICY agent_runs_user_access ON investing.agent_runs
        FOR ALL TO PUBLIC
        USING (user_id = NULLIF(current_setting('app.user_id', true), ''))
        WITH CHECK (user_id = NULLIF(current_setting('app.user_id', true), ''))
    $sql$;
  END IF;
END
$policies$;

COMMIT;
