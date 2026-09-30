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

/* See PriceCoverage.delistedSince (packages/adapters). Null: never checked, or still alive. */
ALTER TABLE investing.price_coverage
  ADD COLUMN IF NOT EXISTS delisted_since DATE;

/* See PriceCoverage.listingMissingSince (packages/adapters). Null: the locked
 * listing last answered; set on its first confirmed-not-found sync, cleared
 * on its next successful one. */
ALTER TABLE investing.price_coverage
  ADD COLUMN IF NOT EXISTS listing_missing_since DATE;

COMMIT;
