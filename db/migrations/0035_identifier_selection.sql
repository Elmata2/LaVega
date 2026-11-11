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
 * Identifier candidate selection (Jev-03, issue #136).
 *
 * `identifier_selection_enabled` is the owner's per-account switch for letting
 * Jev pick among OpenFIGI's candidates. Off by default, exactly like the
 * sector-inference switch: a configured TYPESAFE_API_KEY must never turn on
 * sending an instrument's identity to a model by itself.
 *
 * `identifier_overrides` is the owner's own symbol choice per ISIN, the most
 * trusted tier of the resolution ladder. A JSONB object keyed by ISIN
 * (`{"NL0010273215": {"ticker": "ASML", "exchange": "AMS"}}`) so an override
 * survives a sync and outranks any stored model selection.
 *
 * Both columns share the existing per-tenant preferences row, which already
 * has RLS keyed on `app.user_id`.
 */
ALTER TABLE investing.preferences
  ADD COLUMN IF NOT EXISTS identifier_selection_enabled BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE investing.preferences
  ADD COLUMN IF NOT EXISTS identifier_overrides JSONB NOT NULL DEFAULT '{}'::JSONB;

ALTER TABLE investing.preferences
  DROP CONSTRAINT IF EXISTS preferences_identifier_overrides_object;
ALTER TABLE investing.preferences
  ADD CONSTRAINT preferences_identifier_overrides_object
    CHECK (jsonb_typeof(identifier_overrides) = 'object');

COMMIT;
