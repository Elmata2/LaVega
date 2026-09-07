BEGIN;

-- 0003_eb_flow.sql shipped without a `lavega_runtime` grant and without
-- `FORCE ROW LEVEL SECURITY` on eb_sessions. Production already has 0003
-- applied by hand (Neon SQL editor, owner role), so it cannot be edited.
-- This migration closes both gaps and locks the default privilege so a
-- future personal/investing table cannot repeat the omission.
--
-- Run it as the schema owner, in one go. If the Neon SQL editor answers
-- "Failed transaction: ROLLBACK required", run `ROLLBACK;` on its own first,
-- then this file again: an earlier failed statement left that session's
-- transaction aborted, and nothing runs until it is rolled back.

DO $$
DECLARE
  schema_name TEXT;
  schema_owner TEXT;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'lavega_runtime') THEN
    -- Bound to each schema's OWNER, not to whoever runs this file: a default
    -- privilege without FOR ROLE only covers tables created by the executing
    -- role, and future migrations are applied by hand from the Neon SQL editor.
    FOR schema_name IN SELECT unnest(ARRAY['personal', 'investing']) LOOP
      SELECT pg_get_userbyid(nspowner) INTO schema_owner FROM pg_namespace WHERE nspname = schema_name;
      IF NOT pg_has_role(current_user, schema_owner, 'MEMBER') THEN
        RAISE EXCEPTION 'apply this migration connected as %, the owner of schema % (you are %)',
          schema_owner, schema_name, current_user;
      END IF;
      EXECUTE format(
        'ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA %I GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO lavega_runtime',
        schema_owner,
        schema_name
      );
    END LOOP;
    GRANT USAGE ON SCHEMA personal, investing TO lavega_runtime;
    GRANT SELECT, INSERT, UPDATE, DELETE ON personal.eb_pending_auth, personal.eb_sessions TO lavega_runtime;
  END IF;
END $$;

ALTER TABLE personal.eb_sessions FORCE ROW LEVEL SECURITY;

COMMIT;
