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
 * The investing app shell's per-tab and per-widget on/off choices, one row
 * per tenant sharing investing.preferences with benchmark_symbols and
 * market_data_consent. A JSONB object rather than a fourth top-level column
 * per module/widget: the id list is expected to grow (new modules, new
 * Overview cards), and each new id would otherwise be its own migration.
 */
ALTER TABLE investing.preferences
  ADD COLUMN IF NOT EXISTS layout JSONB NOT NULL DEFAULT '{}'::JSONB;

ALTER TABLE investing.preferences
  DROP CONSTRAINT IF EXISTS preferences_layout_object;
ALTER TABLE investing.preferences
  ADD CONSTRAINT preferences_layout_object CHECK (jsonb_typeof(layout) = 'object');

COMMIT;
