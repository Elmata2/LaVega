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
 * Price-coverage hardening for the security master (plan §3 WS4.5, #297).
 *
 * `provider` is the provider sourceKey that earned the coverage. Once set, only
 * that provider may answer: an unavailable provider is skipped, never silently
 * replaced by another one that happens to quote the symbol.
 *
 * `listing_start` is the first date the provider priced the listing. A backfill
 * is clamped to it, so an IPO-era trade cannot make every sync ask for years of
 * nothing.
 *
 * `provisional_through` is the newest close that is still provisional. It is
 * re-fetched until its window closes, then accepted as final.
 *
 * All three are nullable: a coverage row written before this slice has no
 * affinity, no known listing start and nothing provisional, which is exactly
 * the behaviour it had.
 */
ALTER TABLE investing.price_coverage
  ADD COLUMN IF NOT EXISTS provider TEXT;

ALTER TABLE investing.price_coverage
  ADD COLUMN IF NOT EXISTS listing_start DATE;

ALTER TABLE investing.price_coverage
  ADD COLUMN IF NOT EXISTS provisional_through DATE;

COMMIT;
