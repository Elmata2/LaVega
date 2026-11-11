BEGIN;

-- Ownership check FIRST, same convention as every migration since 0007: run as
-- a non-owner and the CREATE below would fail with Postgres's own "must be
-- owner" error, not this one.
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
 * External read-only MCP tokens (#285, ADR 0012).
 *
 * A token is stored as a SHA-256 digest; the raw token is shown once at
 * creation and never kept. The row names the account the token acts for, so the
 * endpoint resolves token -> tenant and NEVER falls back to the local tenant.
 *
 * Deliberately WITHOUT row-level security, the same reasoned exception as
 * personal.rate_limit_buckets: the lookup runs BEFORE a tenant exists — the
 * token itself is what names the tenant, so a policy keyed on `app.user_id`
 * could not be used to find the row. The table therefore holds a one-way digest
 * and an opaque account id, nothing a token holder does not already have.
 *
 * `scopes` is a small allowlist. WS5.2 ships `read` only; `write` is a separate
 * decision (ADR 0012 §4) and needs its own migration review, not a value change.
 */
CREATE TABLE IF NOT EXISTS investing.api_tokens (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  -- The account this token acts for. This value is the tenant id every tool runs
  -- under; it is never read from a header, a query parameter or a tool argument.
  user_id TEXT NOT NULL,
  token_hash TEXT NOT NULL,
  -- Human label for the settings list ("laptop cursor"), not a credential.
  label TEXT,
  scopes TEXT[] NOT NULL DEFAULT ARRAY['read']::TEXT[],
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_used_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  CONSTRAINT api_tokens_hash_hex CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT api_tokens_hash_unique UNIQUE (token_hash),
  CONSTRAINT api_tokens_scope_allowlist
    CHECK (array_length(scopes, 1) >= 1 AND scopes <@ ARRAY['read', 'write']::TEXT[])
);

CREATE INDEX IF NOT EXISTS api_tokens_user_id_idx ON investing.api_tokens (user_id);

/*
 * One row per JSON-RPC call that reached the endpoint (#285, ADR 0012 §6).
 * Append-only in code: nothing updates or deletes an audit row, and the raw
 * bearer token is never stored — `token_id` points at the token row, or is the
 * literal 'env' for the no-database single-user fallback.
 *
 * Also without RLS for the same reason as api_tokens: the row is written while
 * the request is being authenticated, before any tenant transaction exists.
 * `tool` is nullable because initialize/tools/list have no tool.
 */
CREATE TABLE IF NOT EXISTS investing.mcp_audit (
  id BIGSERIAL PRIMARY KEY,
  token_id TEXT NOT NULL,
  method TEXT NOT NULL,
  tool TEXT,
  duration_ms INTEGER NOT NULL,
  -- 'ok' | 'refused' | 'error'. Text, not an enum: a new safe outcome must not
  -- need a migration, and the value is never shown across the trust boundary.
  outcome TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT mcp_audit_duration_non_negative CHECK (duration_ms >= 0)
);

CREATE INDEX IF NOT EXISTS mcp_audit_created_at_idx ON investing.mcp_audit (created_at);

-- 0004's default privileges already cover new tables in this schema. Repeated
-- here so the migration is self-sufficient on a database whose defaults were
-- lost, and idempotent like every statement above. The uniform four-privilege
-- grant is also the invariant `migrations.test.ts` checks for every table; the
-- audit table is append-only in code, not by grant.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'lavega_runtime') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON investing.api_tokens TO lavega_runtime;
    GRANT SELECT, INSERT, UPDATE, DELETE ON investing.mcp_audit TO lavega_runtime;
    GRANT USAGE, SELECT ON SEQUENCE investing.mcp_audit_id_seq TO lavega_runtime;
  END IF;
END $$;

COMMIT;
