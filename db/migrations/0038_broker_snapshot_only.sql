BEGIN;

-- Ownership check FIRST, before the ALTER below: on a second, non-owner run
-- the idempotent statement would otherwise fail with Postgres's own
-- "must be owner of table" error, not this one.
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
 * A file-import broker has a snapshot and no credentials.
 *
 * DeGiro never logs in (issue #323): the user exports files and LaVega stores
 * the parsed rows. Its vault row therefore needs a NULL credentials_blob, which
 * the original NOT NULL and non-empty constraints refused. The replacement
 * keeps every row material: credentials or a snapshot, never neither.
 */
ALTER TABLE investing.broker_vaults
  ALTER COLUMN credentials_blob DROP NOT NULL;

ALTER TABLE investing.broker_vaults
  DROP CONSTRAINT IF EXISTS broker_vaults_credentials_not_empty;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'broker_vaults_material_not_empty'
      AND conrelid = 'investing.broker_vaults'::regclass
  ) THEN
    ALTER TABLE investing.broker_vaults
      ADD CONSTRAINT broker_vaults_material_not_empty
      CHECK (credentials_blob IS NOT NULL OR snapshot_blob IS NOT NULL);
  END IF;
END $$;

COMMIT;
