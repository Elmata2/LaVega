BEGIN;

-- Ownership check FIRST, before the ALTER statements below (same convention
-- as 0024, 0039, and 0042): a non-owner re-run would otherwise fail with
-- Postgres's own "must be owner of table" error, not this one.
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

ALTER TABLE investing.preferences
  ADD COLUMN IF NOT EXISTS disposal_labels JSONB NOT NULL DEFAULT '[]'::JSONB;

ALTER TABLE investing.preferences
  DROP CONSTRAINT IF EXISTS preferences_disposal_labels_array;

ALTER TABLE investing.preferences
  ADD CONSTRAINT preferences_disposal_labels_array
    CHECK (jsonb_typeof(disposal_labels) = 'array');

COMMIT;
