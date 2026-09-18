BEGIN;

/*
 * The deploy checks its own schema, so it has to be able to read the ledger.
 *
 * `scripts/migrate.ts` writes public.schema_migrations as the schema owner, and
 * the Vercel build runs `db:migrate:check` with the only connection string a
 * build has: DATABASE_URL, the `lavega_runtime` role. Without this grant the
 * check fails with `permission denied` on every deploy, which reads exactly
 * like a missing migration and would train us to ignore it.
 *
 * SELECT only. A deploy answers "is this database current"; changing the answer
 * stays with the owner running a migration.
 */

-- Ownership check FIRST: run as a non-owner, the statements below fail with
-- Postgres's own `permission denied for schema public`, which says nothing
-- about which role to reconnect as. One role owns every schema here, so the
-- owner of `investing` is the role this migration needs.
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

CREATE TABLE IF NOT EXISTS public.schema_migrations (
  name TEXT PRIMARY KEY,
  checksum TEXT NOT NULL,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'lavega_runtime') THEN
    GRANT USAGE ON SCHEMA public TO lavega_runtime;
    GRANT SELECT ON public.schema_migrations TO lavega_runtime;
  END IF;
END $$;

COMMIT;
