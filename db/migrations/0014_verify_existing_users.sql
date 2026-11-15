BEGIN;

DO $$
DECLARE
  schema_owner TEXT;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'lavega_runtime') THEN
    SELECT pg_get_userbyid(nspowner) INTO schema_owner FROM pg_namespace WHERE nspname = 'public';
    IF NOT pg_has_role(current_user, schema_owner, 'MEMBER') THEN
      RAISE EXCEPTION 'apply this migration connected as %, the owner of schema % (you are %)',
        schema_owner, 'public', current_user;
    END IF;
  END IF;
END $$;

/*
 * Email confirmation turns on with open signup. Accounts created before that
 * have "emailVerified" = false and would be locked out of sign-in. Mark the
 * rows that already exist. Accounts created after this migration keep the
 * column default (false) until they open the confirmation link.
 */
UPDATE public."user" SET "emailVerified" = TRUE WHERE "emailVerified" = FALSE;

COMMIT;
