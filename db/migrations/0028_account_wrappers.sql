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
 * Account tax-treatment labels (plan §3 WS4.4, #296).
 *
 * A wrapper is account metadata: `(broker, account)` -> a label such as ISA,
 * PEA, Pillar 3a or a plain brokerage account. The label decides which
 * treatment bucket the realised/income report groups a row under and nothing
 * else; no tax amount is computed from it and the report copy makes no
 * tax-filing claim.
 *
 * An ARRAY of `{broker, account, wrapper}` objects, not an object keyed by a
 * joined string: no broker or account name can be spelled to collide with
 * another pair, and an unknown label can be dropped on read without losing the
 * rest of the map. The column lives on investing.preferences, which already
 * carries RLS keyed on `app.user_id`, so a label is as tenant-scoped as the
 * layout next to it.
 */
ALTER TABLE investing.preferences
  ADD COLUMN IF NOT EXISTS account_wrappers JSONB NOT NULL DEFAULT '[]'::JSONB;

ALTER TABLE investing.preferences
  DROP CONSTRAINT IF EXISTS preferences_account_wrappers_array;
ALTER TABLE investing.preferences
  ADD CONSTRAINT preferences_account_wrappers_array
    CHECK (jsonb_typeof(account_wrappers) = 'array');

COMMIT;
