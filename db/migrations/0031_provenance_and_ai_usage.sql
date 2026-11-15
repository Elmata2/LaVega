BEGIN;

-- Ownership check FIRST, same convention as every migration since 0007: run as
-- a non-owner and an ALTER below would fail with Postgres's own "must be owner"
-- error, not this one.
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
 * AI-ops ledger, per operation (#300, WS5.7 leftover; Sure source
 * `app/models/llm_usage.rb` and `db/schema.rb:1573` @ 562fe09).
 *
 * 0005 defined one row per agent call that REACHED the model. Two gaps: a
 * failed provider call deleted its reservation row and left no trace at all,
 * and prompt-cache token counts were never stored even when the provider
 * reported them. Both are additive columns here; no existing row changes
 * meaning:
 *
 *   cache_write_tokens / cache_read_tokens  provider-reported cache usage, 0
 *                                           when the provider reports none;
 *   outcome                                 'ok' or 'failed';
 *   error_code                              the route's own machine code for a
 *                                           failed call (never a message);
 *   http_status                             the upstream HTTP status when there
 *                                           was one, 0 for timeout/transport.
 *
 * A failed row keeps cost_cents = 0 (nothing was billed with certainty) and
 * carries `reconciled_at`, so the budget sums keep ignoring it while an operator
 * can still see it. RLS/FORCE and grants are already in place from 0005/0025.
 */
ALTER TABLE personal.ai_usage ADD COLUMN IF NOT EXISTS cache_write_tokens INT NOT NULL DEFAULT 0;
ALTER TABLE personal.ai_usage ADD COLUMN IF NOT EXISTS cache_read_tokens INT NOT NULL DEFAULT 0;
ALTER TABLE personal.ai_usage ADD COLUMN IF NOT EXISTS outcome TEXT NOT NULL DEFAULT 'ok';
ALTER TABLE personal.ai_usage ADD COLUMN IF NOT EXISTS error_code TEXT;
ALTER TABLE personal.ai_usage ADD COLUMN IF NOT EXISTS http_status INT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'personal.ai_usage'::regclass
      AND conname = 'ai_usage_cache_tokens_non_negative'
  ) THEN
    ALTER TABLE personal.ai_usage ADD CONSTRAINT ai_usage_cache_tokens_non_negative
      CHECK (cache_write_tokens >= 0 AND cache_read_tokens >= 0);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'personal.ai_usage'::regclass
      AND conname = 'ai_usage_outcome_allowlist'
  ) THEN
    ALTER TABLE personal.ai_usage ADD CONSTRAINT ai_usage_outcome_allowlist
      CHECK (outcome IN ('ok', 'failed'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'personal.ai_usage'::regclass
      AND conname = 'ai_usage_http_status_range'
  ) THEN
    ALTER TABLE personal.ai_usage ADD CONSTRAINT ai_usage_http_status_range
      CHECK (http_status IS NULL OR http_status BETWEEN 0 AND 599);
  END IF;
END $$;

/*
 * Provenance on the owner's opted-in Personal total (#300, WS5.5).
 *
 * The total is a VALUATION, so the agent path that records one must say where
 * the number came from: `{source, grade, date, documentId?, estimated?}` as
 * structured JSON, never prose (packages/core/src/provenance.ts). Nullable
 * because every row written before this column existed was recorded by the
 * browser's own share flow, which shows the owner their own number and has no
 * document to cite; the agent write path refuses a missing citation.
 *
 * Not indexed and not filtered: it is one small JSON object read with the row.
 * RLS/FORCE and grants are already in place from 0019.
 */
ALTER TABLE personal.net_worth_totals ADD COLUMN IF NOT EXISTS provenance JSONB;

COMMIT;
