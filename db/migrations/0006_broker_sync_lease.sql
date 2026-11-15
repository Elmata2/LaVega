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
 * Broker synchronization is one durable operation per tenant and broker.
 *
 * The lease and the pagination cursor both live in investing.sync_state.state,
 * so they commit together. What that JSON cannot carry is which credentials a
 * run started with: reconnecting a broker mid-sync has to stop the worker that
 * is still talking to the old account from writing its holdings back. The
 * generation is therefore a column of the vault the credentials live in,
 * raised by every credential write and compared by every snapshot commit.
 */
ALTER TABLE investing.broker_vaults
  ADD COLUMN IF NOT EXISTS credential_generation BIGINT NOT NULL DEFAULT 1;

COMMIT;
