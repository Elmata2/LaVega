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
 * An owner's correction to a symbol's sector, keyed by upper-cased symbol,
 * scoped to this account like every other column on this table. Unlike
 * investing.sector_profiles (0017), this genuinely is per-user: it's this
 * owner's judgment about a holding, not a fact about the instrument, and it
 * must outrank both the provider and any inference for their portfolio only.
 */
ALTER TABLE investing.preferences
  ADD COLUMN IF NOT EXISTS sector_corrections JSONB NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE investing.preferences
  DROP CONSTRAINT IF EXISTS preferences_sector_corrections_object;
ALTER TABLE investing.preferences
  ADD CONSTRAINT preferences_sector_corrections_object
  CHECK (jsonb_typeof(sector_corrections) = 'object');

/*
 * Sector inference (#135) is an owner-facing switch, not a server env flag:
 * it calls an external model with an instrument's name and description, so
 * it stays opt-in per account, default off, like market_data_consent.
 */
ALTER TABLE investing.preferences
  ADD COLUMN IF NOT EXISTS sector_inference_enabled BOOLEAN NOT NULL DEFAULT false;

COMMIT;
