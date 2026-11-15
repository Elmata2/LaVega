BEGIN;

-- Ownership check FIRST, before the ALTERs: a non-owner run otherwise fails
-- with Postgres's own "must be owner of table" instead of this message.
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
 * Owner data for cash-flow vocabulary (issue #137, Jev-04).
 *
 * Broker transaction types the adapters' hand-written switches do not know fall
 * through to `other` with a problem. A suggestion proposes a kind; only the
 * OWNER's confirmation turns one into a rule, and the rule is applied at the
 * same point as the switch on later imports.
 *
 * Both arrays are owner data, so they live in the tenant's own preferences row
 * (which is already row-level-secured). `cash_flow_rules` is exportable as-is:
 * an array of {broker, typeKey, kind, confirmedAt}, keyed by broker plus the
 * normalised type string, never by a transaction reference. Suggestions are
 * stored separately and have no effect on any computed figure until a
 * confirmation creates a rule.
 */
ALTER TABLE investing.preferences
  ADD COLUMN IF NOT EXISTS cash_flow_rules JSONB NOT NULL DEFAULT '[]'::JSONB;

ALTER TABLE investing.preferences
  ADD COLUMN IF NOT EXISTS cash_flow_suggestions JSONB NOT NULL DEFAULT '[]'::JSONB;

ALTER TABLE investing.preferences
  ADD COLUMN IF NOT EXISTS cash_flow_suggestions_enabled BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE investing.preferences
  DROP CONSTRAINT IF EXISTS preferences_cash_flow_rules_array;
ALTER TABLE investing.preferences
  ADD CONSTRAINT preferences_cash_flow_rules_array
  CHECK (jsonb_typeof(cash_flow_rules) = 'array');

ALTER TABLE investing.preferences
  DROP CONSTRAINT IF EXISTS preferences_cash_flow_suggestions_array;
ALTER TABLE investing.preferences
  ADD CONSTRAINT preferences_cash_flow_suggestions_array
  CHECK (jsonb_typeof(cash_flow_suggestions) = 'array');

COMMIT;
