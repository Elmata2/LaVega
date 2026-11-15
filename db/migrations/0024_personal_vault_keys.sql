BEGIN;

-- Ownership check FIRST, before the CREATE statement below: on a second,
-- non-owner run that already-idempotent statement would otherwise fail with
-- Postgres's own "must be owner of table" error, not this one.
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
 * One personal-vault key per account (docs/adr/0009-account-held-vault-key.md).
 *
 * The browser encrypts the personal vault with this key instead of one derived
 * from a separate vault password. The key is created on the first signed-in
 * request that asks for it, and stored here sealed with LAVEGA_ENCRYPTION_KEY
 * (`encryptBlob` in packages/database), which never enters PostgreSQL.
 *
 * Deleting the row makes every copy of that vault unreadable, in the browser
 * and in `personal.vaults`. Account erasure relies on that.
 */
CREATE TABLE IF NOT EXISTS personal.vault_keys (
  user_id TEXT PRIMARY KEY,
  wrapped_key BYTEA NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT vault_keys_user_id_not_blank CHECK (btrim(user_id) <> ''),
  CONSTRAINT vault_keys_wrapped_key_not_empty CHECK (octet_length(wrapped_key) > 0)
);

ALTER TABLE personal.vault_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE personal.vault_keys FORCE ROW LEVEL SECURITY;

DO $policies$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'personal' AND tablename = 'vault_keys'
      AND policyname = 'vault_keys_user_access'
  ) THEN
    EXECUTE $sql$
      CREATE POLICY vault_keys_user_access ON personal.vault_keys
        FOR ALL TO PUBLIC
        USING (user_id = NULLIF(current_setting('app.user_id', true), ''))
        WITH CHECK (user_id = NULLIF(current_setting('app.user_id', true), ''))
    $sql$;
  END IF;
END $policies$;

-- No UPDATE: a key is never replaced in place. Replacing it would make the
-- vault sealed under the old one unreadable without anyone deciding that.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'lavega_runtime') THEN
    GRANT SELECT, INSERT, DELETE ON personal.vault_keys TO lavega_runtime;
  END IF;
END $$;

COMMIT;
