BEGIN;

-- Ownership check FIRST, same convention as every migration since
-- 0007_migration_ledger_grants.sql: run as a non-owner and the ALTER below
-- fails with Postgres's own "must be owner of table" error, not this one.
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
 * Turns personal.ai_usage from a write-once ledger into a reserve-then-
 * reconcile one, closing the race in agent/budget.ts: checkBudget()'s read
 * and recordUsage()'s write used to be two separate statements, so two
 * concurrent requests could both read "under cap" before either had written
 * anything.
 *
 * checkBudget() now INSERTs a row up front, priced at that route's own
 * WORST_CASE_CENTS, before the call is allowed to happen at all — `reserved_at`
 * marks it as that kind of row. recordUsage() then UPDATEs the SAME row to the
 * real cost once it is known, and stamps `reconciled_at`. A row with
 * `reserved_at` set and `reconciled_at` still NULL is a call in flight; the
 * budget queries in index.ts count it at its reserved price for 10 minutes
 * (comfortably past Mistral's own 240s search-call ceiling in mistral.ts) and
 * then stop counting it, so a reservation orphaned by a crash — the request
 * throwing between the check and the record — frees the cap back up on its
 * own instead of squatting on it for the rest of the day. The explicit
 * release path in agent-routes.ts's catch blocks handles the ordinary case
 * (the failure is caught, not a hard crash) immediately rather than waiting
 * out that window.
 *
 * A row from BEFORE this migration, or written by a caller that never
 * reserves (recordUsage's own standalone-insert path, kept for callers with
 * nothing to reconcile against), has `reserved_at` NULL — it was never a
 * placeholder, so it always counts, unconditionally, at whatever `cost_cents`
 * it already carries.
 */
ALTER TABLE personal.ai_usage ADD COLUMN IF NOT EXISTS reserved_at TIMESTAMPTZ;
ALTER TABLE personal.ai_usage ADD COLUMN IF NOT EXISTS reconciled_at TIMESTAMPTZ;

/*
 * PRE-EXISTING GAP, closed here because this migration is what surfaces it.
 *
 * 0005_ai_usage.sql granted INSERT on the table to lavega_runtime but never
 * USAGE on the BIGSERIAL id column's own sequence — a table-level INSERT
 * grant does not carry it. Every INSERT into this table under lavega_runtime
 * (recordUsage()'s standalone path, and now reserve()) has therefore been
 * failing with "permission denied for sequence ai_usage_id_seq" since that
 * migration shipped, swallowed by recordUsage()'s own must-never-reject
 * catch into a log line — so the ledger has likely been silently empty in
 * production this whole time, and the cap toothless. reserve() does NOT
 * swallow its own errors (requireBudget()'s caller needs to tell "over cap"
 * apart from "the budget system itself is down"), so shipping the
 * reservation step without this grant would turn that silent gap into a
 * loud one: every AI route 503ing on its very first request.
 */
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'lavega_runtime') THEN
    GRANT USAGE, SELECT ON SEQUENCE personal.ai_usage_id_seq TO lavega_runtime;
  END IF;
END $$;

COMMIT;
