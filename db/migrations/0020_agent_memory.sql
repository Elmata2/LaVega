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
END $$;

/*
 * Portfolio agent memory (ADR 0007). Terms follow the investing glossary in
 * docs/CONTEXT.md. Every free-text column is an AES-GCM blob sealed with
 * LAVEGA_ENCRYPTION_KEY before it reaches Neon, like broker snapshots.
 *
 * Keys lead with user_id, and every foreign key is composite on
 * (user_id, thread): a foreign-key check bypasses row-level security, so a
 * key on the thread id alone would let one user attach rows to, or probe for,
 * another user's thread.
 */
CREATE TABLE IF NOT EXISTS investing.agent_threads (
  user_id TEXT NOT NULL,
  id UUID NOT NULL,
  agent_id TEXT NOT NULL,
  title_blob BYTEA NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, id),
  CONSTRAINT agent_threads_user_id_not_blank CHECK (btrim(user_id) <> ''),
  CONSTRAINT agent_threads_agent_id_not_blank CHECK (btrim(agent_id) <> '')
);

CREATE TABLE IF NOT EXISTS investing.agent_messages (
  user_id TEXT NOT NULL,
  thread_id UUID NOT NULL,
  seq INTEGER NOT NULL,
  message_blob BYTEA NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, thread_id, seq),
  FOREIGN KEY (user_id, thread_id)
    REFERENCES investing.agent_threads (user_id, id) ON DELETE CASCADE,
  CONSTRAINT agent_messages_seq_positive CHECK (seq > 0)
);

/* One thesis per instrument for all brokers and agents. A thread delete
 * never reaches it; only erase-all-data does. */
CREATE TABLE IF NOT EXISTS investing.theses (
  user_id TEXT NOT NULL,
  symbol TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  body_blob BYTEA NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, symbol),
  CONSTRAINT theses_user_id_not_blank CHECK (btrim(user_id) <> ''),
  CONSTRAINT theses_symbol_normalized CHECK (symbol <> '' AND symbol = upper(btrim(symbol))),
  CONSTRAINT theses_status_valid CHECK (status IN ('active', 'dormant'))
);

/* A goal outlives the thread it was agreed in: deleting that thread only
 * forgets where the goal came from. */
CREATE TABLE IF NOT EXISTS investing.goals (
  user_id TEXT NOT NULL,
  id UUID NOT NULL DEFAULT gen_random_uuid(),
  symbol TEXT,
  body_blob BYTEA NOT NULL,
  source_thread_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, id),
  FOREIGN KEY (user_id, source_thread_id)
    REFERENCES investing.agent_threads (user_id, id) ON DELETE SET NULL (source_thread_id),
  CONSTRAINT goals_user_id_not_blank CHECK (btrim(user_id) <> ''),
  CONSTRAINT goals_symbol_normalized
    CHECK (symbol IS NULL OR (symbol <> '' AND symbol = upper(btrim(symbol))))
);

CREATE TABLE IF NOT EXISTS investing.agent_observations (
  user_id TEXT NOT NULL,
  id UUID NOT NULL DEFAULT gen_random_uuid(),
  agent_id TEXT NOT NULL,
  thread_id UUID NOT NULL,
  symbol TEXT,
  body_blob BYTEA NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, id),
  FOREIGN KEY (user_id, thread_id)
    REFERENCES investing.agent_threads (user_id, id) ON DELETE CASCADE,
  CONSTRAINT agent_observations_agent_id_not_blank CHECK (btrim(agent_id) <> ''),
  CONSTRAINT agent_observations_symbol_normalized
    CHECK (symbol IS NULL OR (symbol <> '' AND symbol = upper(btrim(symbol))))
);

CREATE INDEX IF NOT EXISTS agent_threads_user_agent_updated_idx
  ON investing.agent_threads (user_id, agent_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS goals_user_updated_idx
  ON investing.goals (user_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS agent_observations_user_agent_created_idx
  ON investing.agent_observations (user_id, agent_id, created_at DESC);
CREATE INDEX IF NOT EXISTS agent_observations_thread_idx
  ON investing.agent_observations (user_id, thread_id);
CREATE INDEX IF NOT EXISTS goals_source_thread_idx
  ON investing.goals (user_id, source_thread_id) WHERE source_thread_id IS NOT NULL;

/* Null until the owner answers; the agent asks once and saves the answer. */
ALTER TABLE investing.preferences
  ADD COLUMN IF NOT EXISTS risk_tolerance TEXT;
ALTER TABLE investing.preferences
  DROP CONSTRAINT IF EXISTS preferences_risk_tolerance_valid;
ALTER TABLE investing.preferences
  ADD CONSTRAINT preferences_risk_tolerance_valid
  CHECK (risk_tolerance IS NULL OR risk_tolerance IN ('conservative', 'balanced', 'aggressive'));

ALTER TABLE investing.agent_threads ENABLE ROW LEVEL SECURITY;
ALTER TABLE investing.agent_threads FORCE ROW LEVEL SECURITY;
ALTER TABLE investing.agent_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE investing.agent_messages FORCE ROW LEVEL SECURITY;
ALTER TABLE investing.theses ENABLE ROW LEVEL SECURITY;
ALTER TABLE investing.theses FORCE ROW LEVEL SECURITY;
ALTER TABLE investing.goals ENABLE ROW LEVEL SECURITY;
ALTER TABLE investing.goals FORCE ROW LEVEL SECURITY;
ALTER TABLE investing.agent_observations ENABLE ROW LEVEL SECURITY;
ALTER TABLE investing.agent_observations FORCE ROW LEVEL SECURITY;

DO $policies$
DECLARE
  memory_table TEXT;
BEGIN
  FOREACH memory_table IN ARRAY ARRAY['agent_threads', 'agent_messages', 'theses', 'goals', 'agent_observations']
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_policies
      WHERE schemaname = 'investing' AND tablename = memory_table
        AND policyname = memory_table || '_user_access'
    ) THEN
      EXECUTE format(
        $sql$
          CREATE POLICY %I ON investing.%I
            FOR ALL TO PUBLIC
            USING (user_id = NULLIF(current_setting('app.user_id', true), ''))
            WITH CHECK (user_id = NULLIF(current_setting('app.user_id', true), ''))
        $sql$,
        memory_table || '_user_access',
        memory_table
      );
    END IF;
  END LOOP;
END $policies$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'lavega_runtime') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE
      ON investing.agent_threads, investing.agent_messages, investing.theses,
         investing.goals, investing.agent_observations
      TO lavega_runtime;
  END IF;
END $$;

COMMIT;
