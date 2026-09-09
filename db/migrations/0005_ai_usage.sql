BEGIN;

-- Ownership check FIRST, before the CREATE TABLE/INDEX below: on a second,
-- non-owner run those already-idempotent statements would otherwise fail
-- with Postgres's own "must be owner of table" error, not this one.
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
 * The internal AI-spend ledger: one row per agent call that reached Mistral,
 * used to enforce the daily/monthly budget caps in apps/server. Deliberately
 * WITHOUT row-level security — this is the OWNER's own aggregate AI spend
 * (single-tenant deployment, one Mistral key), not per-user data, so there is
 * nothing to scope RLS to. Same reasoning as `personal.eb_pending_auth` in
 * 0003_eb_flow.sql.
 */
CREATE TABLE IF NOT EXISTS personal.ai_usage (
  id BIGSERIAL PRIMARY KEY,
  day DATE NOT NULL,
  route TEXT NOT NULL,
  model TEXT NOT NULL,
  input_tokens INT NOT NULL DEFAULT 0,
  output_tokens INT NOT NULL DEFAULT 0,
  pages INT NOT NULL DEFAULT 0,
  searches INT NOT NULL DEFAULT 0,
  cost_cents INT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT ai_usage_route_not_blank CHECK (btrim(route) <> ''),
  CONSTRAINT ai_usage_model_not_blank CHECK (btrim(model) <> ''),
  CONSTRAINT ai_usage_cost_non_negative CHECK (cost_cents >= 0)
);

CREATE INDEX IF NOT EXISTS ai_usage_day_idx ON personal.ai_usage (day);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'lavega_runtime') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON personal.ai_usage TO lavega_runtime;
  END IF;
END $$;

COMMIT;
