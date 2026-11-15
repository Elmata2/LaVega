BEGIN;

DO $$
DECLARE
  schema_owner TEXT;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'lavega_runtime') THEN
    SELECT pg_get_userbyid(nspowner) INTO schema_owner FROM pg_namespace WHERE nspname = 'personal';
    IF NOT pg_has_role(current_user, schema_owner, 'MEMBER') THEN
      RAISE EXCEPTION 'apply this migration connected as %, the owner of schema % (you are %)',
        schema_owner, 'personal', current_user;
    END IF;
  END IF;
END $$;

/*
 * AI spend used to be one total for the whole deployment (0005). Open signup
 * means each account has to hit its own day and month cap, or one new account
 * can spend the shared model key until the global cap is gone.
 *
 * Rows written before this column existed stay NULL. They count toward nobody's
 * cap. New rows always carry the session user id.
 */
ALTER TABLE personal.ai_usage ADD COLUMN IF NOT EXISTS user_id TEXT;

CREATE INDEX IF NOT EXISTS ai_usage_user_day_idx ON personal.ai_usage (user_id, day);

COMMIT;
