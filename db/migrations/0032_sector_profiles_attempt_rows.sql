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
 * #309: a provider fetch that returns no profile is remembered as a row with
 * profile = {"kind": "none", "providerAttemptedAt": <ISO time>}. Such a row
 * carries no sector data and the stores read it as "no profile". The kind
 * check from 0017 must allow it.
 */
ALTER TABLE investing.sector_profiles DROP CONSTRAINT IF EXISTS sector_profiles_kind_valid;
ALTER TABLE investing.sector_profiles
  ADD CONSTRAINT sector_profiles_kind_valid
  CHECK (profile ->> 'kind' IN ('stock', 'fund', 'none'));

COMMIT;
