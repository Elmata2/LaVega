BEGIN;

-- Ownership check FIRST, same convention as every migration since 0007: run as
-- a non-owner and the CREATE below would fail with Postgres's own "must be
-- owner" error, not this one.
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
 * Shared rate-limit counters (#246, security review 2026-10-17 M8).
 *
 * The agent routes kept their counters in a module-scope Map. That is one
 * ceiling per PROCESS, so on Vercel the real ceiling was 20/min times the
 * number of warm instances, and a cold start reset it. This table is the one
 * store every instance reads and writes, so the ceiling is real.
 *
 * Deliberately WITHOUT row-level security. The limiter runs before a session
 * exists: an anonymous caller is exactly who it has to count. The row is keyed
 * by a SHA-256 digest of the bucket (route plus user id or address), so the
 * table holds no address and no user id in the clear. A digest of an address is
 * a pseudonym, not anonymisation, which is why nothing else is stored here.
 *
 * One row per (key, window). `window_start` is the fixed window's start, so the
 * upsert in createRateLimitRepository is a single indexed statement. The
 * cleanup in that same statement drops every row whose window has passed; the
 * index below is what keeps that delete cheap.
 */
CREATE TABLE IF NOT EXISTS personal.rate_limit_buckets (
  key_hash TEXT NOT NULL,
  window_start TIMESTAMPTZ NOT NULL,
  hits INTEGER NOT NULL,
  CONSTRAINT rate_limit_buckets_pkey PRIMARY KEY (key_hash, window_start),
  CONSTRAINT rate_limit_buckets_key_hash_hex
    CHECK (key_hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT rate_limit_buckets_hits_positive CHECK (hits > 0)
);

CREATE INDEX IF NOT EXISTS rate_limit_buckets_window_start_idx
  ON personal.rate_limit_buckets (window_start);

-- 0004's default privileges already cover a new table in this schema. This is
-- repeated here so the migration is self-sufficient on a database whose
-- defaults were lost, and it is idempotent like every statement above.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'lavega_runtime') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON personal.rate_limit_buckets TO lavega_runtime;
  END IF;
END $$;

COMMIT;
