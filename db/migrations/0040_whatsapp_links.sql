BEGIN;

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

  /* The two lookup functions below run as their owner and must see every
   * user's rows past FORCE ROW LEVEL SECURITY (same rule as 0039). */
  IF NOT EXISTS (
    SELECT 1 FROM pg_roles WHERE rolname = current_user AND (rolsuper OR rolbypassrls)
  ) THEN
    RAISE EXCEPTION 'apply this migration as a role with BYPASSRLS (% has none); the WhatsApp lookups run as their owner', current_user;
  END IF;
END $$;

/*
 * WhatsApp link for the Instinct agent (ADR 0014).
 *
 * The phone number is personal data. phone_blob holds it sealed with
 * encryptBlob (ADR 0007). phone_hash is an HMAC (AGENT_PHONE_HMAC_KEY) and is
 * the only lookup key: an inbound webhook knows a number, not a user.
 * agent_link_codes holds the HMAC of a one-time code, never the code.
 */
CREATE TABLE IF NOT EXISTS personal.agent_whatsapp (
  user_id TEXT PRIMARY KEY,
  phone_hash TEXT NOT NULL,
  phone_blob BYTEA,
  linked_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_inbound_at TIMESTAMPTZ,
  /* When the user agreed that WhatsApp questions go to the AI provider. The
   * answer path refuses to call a model while this is NULL. */
  ai_consent_at TIMESTAMPTZ,
  CONSTRAINT agent_whatsapp_user_id_not_blank CHECK (btrim(user_id) <> ''),
  CONSTRAINT agent_whatsapp_phone_hash_unique UNIQUE (phone_hash)
);

CREATE TABLE IF NOT EXISTS personal.agent_link_codes (
  user_id TEXT PRIMARY KEY,
  code_hash TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  /* Set when the code is created, which requires the AI consent; copied to the link. */
  ai_consent_at TIMESTAMPTZ NOT NULL,
  CONSTRAINT agent_link_codes_user_id_not_blank CHECK (btrim(user_id) <> ''),
  /* One code maps to one user, so consuming a code can never link two. */
  CONSTRAINT agent_link_codes_code_hash_unique UNIQUE (code_hash)
);

/*
 * This file was edited in place while it was still unapplied, and
 * CREATE TABLE IF NOT EXISTS adds no column to a table an earlier draft made.
 * ai_consent_at came after the first draft: add it where it is missing.
 * Link codes live 15 minutes, so clearing them before the NOT NULL column goes
 * on costs a user at most one new code.
 */
ALTER TABLE personal.agent_whatsapp ADD COLUMN IF NOT EXISTS ai_consent_at TIMESTAMPTZ;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_attribute
    WHERE attrelid = 'personal.agent_link_codes'::regclass
      AND attname = 'ai_consent_at' AND NOT attisdropped
  ) THEN
    DELETE FROM personal.agent_link_codes;
    ALTER TABLE personal.agent_link_codes ADD COLUMN ai_consent_at TIMESTAMPTZ NOT NULL;
  END IF;
END $$;

DO $policies$
DECLARE
  t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['agent_whatsapp', 'agent_link_codes'] LOOP
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

/*
 * Inbound message -> user. The webhook has no session, so the runtime role
 * cannot read agent_whatsapp across users and must not be able to. This
 * returns one user id for one hash and nothing else.
 */
CREATE OR REPLACE FUNCTION personal.agent_user_for_phone(phone_hash TEXT)
RETURNS TEXT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
  SELECT w.user_id FROM personal.agent_whatsapp AS w WHERE w.phone_hash = $1
$$;

/*
 * Durable brute-force throttle for link codes. A failed attempt is one row; the
 * count lives here, not in a process, so a cold start cannot reset it. No user
 * id (the sender is unknown), no policy and no grant for lavega_runtime: only
 * agent_consume_link_code, which runs as its owner, reads or writes it. Constant
 * (mirrored in packages/database/src/agent.ts): 5 failures per phone_hash within
 * 15 minutes. There is no global cap: many numbers could use it to block all
 * linking. Guessing is made infeasible by the code length instead (LV- plus 8
 * characters from a 31 character alphabet, about 8.5e11 codes).
 */
CREATE TABLE IF NOT EXISTS personal.agent_link_attempts (
  phone_hash TEXT NOT NULL,
  at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS agent_link_attempts_at_idx ON personal.agent_link_attempts (at);
CREATE INDEX IF NOT EXISTS agent_link_attempts_phone_idx
  ON personal.agent_link_attempts (phone_hash, at);
ALTER TABLE personal.agent_link_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE personal.agent_link_attempts FORCE ROW LEVEL SECURITY;
REVOKE ALL ON personal.agent_link_attempts FROM PUBLIC;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'lavega_runtime') THEN
    REVOKE ALL ON personal.agent_link_attempts FROM lavega_runtime;
  END IF;
END $$;

/*
 * Link a phone with a one-time code. In order: purge attempts older than 15
 * minutes; if this phone_hash has >= 5 failures in the window, return NULL
 * without looking at any code (the caller cannot tell throttled from invalid);
 * a live code whose user no longer has the agent switched on is deleted and
 * refused (NULL, no attempt recorded); otherwise consume in ONE statement: the
 * code is deleted only if it exists, has not expired and its user still has an
 * enabled settings row (locked FOR SHARE, so a concurrent turn-off waits), and the link is
 * written from the row that delete returned, so a second use finds no code. A
 * phone already linked to another user raises a unique violation, which aborts
 * the call and so keeps the code. On a miss one attempt row is recorded; a
 * success records nothing. Returns the user id, or NULL.
 */
CREATE OR REPLACE FUNCTION personal.agent_consume_link_code(
  code_hash TEXT, phone_hash TEXT, phone_blob BYTEA
)
RETURNS TEXT
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
#variable_conflict use_column
DECLARE
  linked_user TEXT;
  stale_code BOOLEAN;
BEGIN
  DELETE FROM personal.agent_link_attempts AS a
  WHERE a.at < CURRENT_TIMESTAMP - INTERVAL '15 minutes';

  IF (SELECT count(*) FROM personal.agent_link_attempts AS a WHERE a.phone_hash = $2) >= 5 THEN
    RETURN NULL;
  END IF;

  /* The user turned the agent off after asking for a code: the code is dead. */
  WITH dead AS (
    DELETE FROM personal.agent_link_codes AS c
    WHERE c.code_hash = $1 AND c.expires_at > CURRENT_TIMESTAMP
      AND NOT EXISTS (
        SELECT 1 FROM personal.agent_settings AS s WHERE s.user_id = c.user_id AND s.enabled
      )
    RETURNING 1
  )
  SELECT EXISTS (SELECT 1 FROM dead) INTO stale_code;
  IF stale_code THEN
    RETURN NULL;
  END IF;

  WITH used AS (
    DELETE FROM personal.agent_link_codes AS c
    WHERE c.code_hash = $1 AND c.expires_at > CURRENT_TIMESTAMP
      AND EXISTS (
        SELECT 1 FROM personal.agent_settings AS s
        WHERE s.user_id = c.user_id AND s.enabled FOR SHARE
      )
    RETURNING c.user_id, c.ai_consent_at
  ), linked AS (
    INSERT INTO personal.agent_whatsapp AS w (user_id, phone_hash, phone_blob, ai_consent_at)
    SELECT used.user_id, $2, $3, used.ai_consent_at FROM used
    ON CONFLICT (user_id) DO UPDATE SET
      phone_hash = EXCLUDED.phone_hash, phone_blob = EXCLUDED.phone_blob,
      ai_consent_at = EXCLUDED.ai_consent_at,
      linked_at = CURRENT_TIMESTAMP, last_inbound_at = NULL
    RETURNING w.user_id
  )
  SELECT linked.user_id INTO linked_user FROM linked;

  IF linked_user IS NULL THEN
    INSERT INTO personal.agent_link_attempts (phone_hash) VALUES ($2);
  END IF;
  RETURN linked_user;
END
$$;

/*
 * Housekeeping for the throttle table. agent_consume_link_code purges old rows,
 * but only when a later attempt runs; the nightly cron calls this once so rows
 * (a hash of a phone number each) never outlive the 15 minute window. Returns
 * the number of rows deleted.
 */
CREATE OR REPLACE FUNCTION personal.agent_purge_link_attempts()
RETURNS INTEGER
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  deleted INTEGER;
BEGIN
  WITH gone AS (
    DELETE FROM personal.agent_link_attempts AS a
    WHERE a.at < CURRENT_TIMESTAMP - INTERVAL '15 minutes'
    RETURNING 1
  )
  SELECT count(*)::int INTO deleted FROM gone;
  RETURN deleted;
END
$$;

REVOKE ALL ON FUNCTION personal.agent_user_for_phone(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION personal.agent_purge_link_attempts() FROM PUBLIC;
REVOKE ALL ON FUNCTION personal.agent_consume_link_code(TEXT, TEXT, BYTEA) FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'lavega_runtime') THEN
    GRANT EXECUTE ON FUNCTION personal.agent_user_for_phone(TEXT) TO lavega_runtime;
    GRANT EXECUTE ON FUNCTION personal.agent_consume_link_code(TEXT, TEXT, BYTEA) TO lavega_runtime;
    GRANT EXECUTE ON FUNCTION personal.agent_purge_link_attempts() TO lavega_runtime;
  END IF;
END $$;

COMMIT;
