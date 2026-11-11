BEGIN;

-- Ownership check FIRST, before the CREATE statements below (same convention
-- as 0024): a non-owner re-run would otherwise fail with Postgres's own
-- "must be owner of table" error, not this one.
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
 * Instinct agent tables (docs/adr/0010-server-reads-transactions-at-night.md).
 *
 * Stored: settings, minimal send state, a mirror of rules and due dates, push
 * subscriptions and conversation events. Never stored: transactions, balances
 * or IBANs. Every *_blob column is sealed with encryptBlob (ADR 0007) before it
 * reaches Neon. All tables are keyed by user_id with forced row-level security.
 */
CREATE TABLE IF NOT EXISTS personal.agent_settings (
  user_id TEXT PRIMARY KEY,
  enabled BOOLEAN NOT NULL DEFAULT false,
  channels_blob BYTEA,
  send_hour SMALLINT NOT NULL DEFAULT 8,
  locale TEXT NOT NULL DEFAULT 'nl',
  consent_text_version TEXT,
  consented_at TIMESTAMPTZ,
  email_blob BYTEA,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT agent_settings_user_id_not_blank CHECK (btrim(user_id) <> ''),
  CONSTRAINT agent_settings_send_hour_range CHECK (send_hour BETWEEN 0 AND 23),
  CONSTRAINT agent_settings_locale_known CHECK (locale IN ('nl', 'en'))
);

CREATE TABLE IF NOT EXISTS personal.agent_state (
  user_id TEXT PRIMARY KEY,
  last_sent_date DATE,
  sent_keys_blob BYTEA,
  last_tip_date DATE,
  expiry_reminded_for DATE,
  expiry_paused_noted BOOLEAN NOT NULL DEFAULT false,
  fetches_today SMALLINT NOT NULL DEFAULT 0,
  fetches_day DATE,
  CONSTRAINT agent_state_user_id_not_blank CHECK (btrim(user_id) <> '')
);

-- Rules, due dates and the card offer; no amounts besides the card gain.
CREATE TABLE IF NOT EXISTS personal.agent_mirror (
  user_id TEXT PRIMARY KEY,
  payload_blob BYTEA,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT agent_mirror_user_id_not_blank CHECK (btrim(user_id) <> '')
);

CREATE TABLE IF NOT EXISTS personal.agent_push_subscriptions (
  user_id TEXT NOT NULL,
  endpoint_hash TEXT NOT NULL,
  subscription_blob BYTEA NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, endpoint_hash),
  CONSTRAINT agent_push_subscriptions_user_id_not_blank CHECK (btrim(user_id) <> '')
);

CREATE TABLE IF NOT EXISTS personal.agent_events (
  user_id TEXT NOT NULL,
  id UUID NOT NULL,
  channel TEXT NOT NULL,
  type TEXT NOT NULL,
  body_blob BYTEA NOT NULL,
  dedupe_key TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, id),
  CONSTRAINT agent_events_user_id_not_blank CHECK (btrim(user_id) <> ''),
  CONSTRAINT agent_events_channel_known CHECK (channel IN ('feed', 'push', 'email', 'whatsapp')),
  CONSTRAINT agent_events_type_known CHECK (
    type IN ('message', 'approval_request', 'approval_response', 'action', 'action_result', 'error')
  ),
  /* dedupe_key is stored in the clear, so it must not hold a merchant name or
   * an amount: writers store an HMAC of the key parts (hex), never the parts
   * themselves. NULLs stay distinct, so events without a key never collide. */
  CONSTRAINT agent_events_dedupe_key_unique UNIQUE (user_id, dedupe_key)
);

CREATE INDEX IF NOT EXISTS agent_events_user_created_idx
  ON personal.agent_events (user_id, created_at);

-- The nightly job finds due users by hour among the opted-in.
CREATE INDEX IF NOT EXISTS agent_settings_due_idx
  ON personal.agent_settings (send_hour) WHERE enabled;

DO $policies$
DECLARE
  t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'agent_settings', 'agent_state', 'agent_mirror', 'agent_push_subscriptions', 'agent_events'
  ] LOOP
    EXECUTE format('ALTER TABLE personal.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE personal.%I FORCE ROW LEVEL SECURITY', t);
    IF NOT EXISTS (
      SELECT 1 FROM pg_policies
      WHERE schemaname = 'personal' AND tablename = t AND policyname = t || '_user_access'
    ) THEN
      EXECUTE format(
        $sql$CREATE POLICY %I ON personal.%I
          FOR ALL TO PUBLIC
          USING (user_id = NULLIF(current_setting('app.user_id', true), ''))
          WITH CHECK (user_id = NULLIF(current_setting('app.user_id', true), ''))$sql$,
        t || '_user_access', t);
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'lavega_runtime') THEN
      EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON personal.%I TO lavega_runtime', t);
    END IF;
  END LOOP;
END $policies$;

-- Events and push subscriptions are written once and deleted, never edited.
-- Default privileges in this schema grant UPDATE, so take it away explicitly.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'lavega_runtime') THEN
    REVOKE UPDATE ON personal.agent_events, personal.agent_push_subscriptions FROM lavega_runtime;
  END IF;
END $$;

COMMIT;
