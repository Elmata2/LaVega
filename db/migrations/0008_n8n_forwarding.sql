BEGIN;

/*
 * Where each user's invoice-forwarding address lives, server-side.
 *
 * n8n partitions its invoice queue by `queueKey` — the local part of the
 * address a mail was forwarded to (packages/core/src/n8n/queue.js). The
 * browser used to send that key itself; now the server derives it from the
 * caller's session, and this table is where it looks it up. See
 * docs/adr/0006-invoice-queue-server-proxy.md.
 *
 * At most one address per user (user_id is the primary key). The unique
 * index on local_part is the tenant boundary: two users pointed at the same
 * local part would each drain the other's queue. The CHECK against "@" makes
 * a collision with queue.js's OWNER_KEY ("owner@lavega.internal") structurally
 * impossible — an email local part can never contain "@".
 */

-- Ownership check FIRST, same convention as 0007_migration_ledger_grants.sql:
-- run as a non-owner and the statements below fail with Postgres's own
-- `permission denied for schema personal`, which says nothing about which
-- role to reconnect as.
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

CREATE TABLE IF NOT EXISTS personal.n8n_forwarding (
  user_id TEXT NOT NULL PRIMARY KEY,
  local_part TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT n8n_forwarding_user_id_not_blank CHECK (btrim(user_id) <> ''),
  /* ONE CANONICAL FORM, ENFORCED HERE, BECAUSE THE TWO ENDS DISAGREE.
   *
   * The queue key is normalised twice and differently. The email worker writes
   * mail into a bucket named `address.slice(0, at).trim().toLowerCase()`; n8n
   * reads a bucket named `v.trim().slice(0, 120)`, which does NOT lowercase.
   * A byte-exact UNIQUE index therefore does not stop two users sharing one
   * n8n partition, and sharing it means one of them drains the other's
   * invoices — and `drainQueue` DELETES what it returns, so the victim sees an
   * empty queue and never learns why.
   *
   * Review demonstrated it against the real modules, not on paper:
   *   `alice-7f3a` and `Alice-7f3a`  -> two rows, one bucket (worker lowercases)
   *   `alice-7f3a` and `alice-7f3a ` -> two rows, one bucket (n8n trims)
   * and `btrim(x) <> ''` rejects only an all-blank value, never padding, while
   * its default trim set is the space character alone — so a single tab passed
   * every constraint here and then normalised to "" at n8n, which returns
   * OWNER_KEY and drains the owner's own queue.
   *
   * This single pattern closes all of it: lowercase only, no whitespace
   * anywhere, no "@", and the 120-character cap both ends already apply. It is
   * the exact character set an email local part can contain, so a value that
   * passes is already in the form both ends will agree on. */
  CONSTRAINT n8n_forwarding_local_part_canonical
    CHECK (local_part ~ '^[a-z0-9._%+-]{1,120}$')
);

CREATE UNIQUE INDEX IF NOT EXISTS n8n_forwarding_local_part_idx
  ON personal.n8n_forwarding (local_part);

ALTER TABLE personal.n8n_forwarding ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'personal'
      AND tablename = 'n8n_forwarding'
      AND policyname = 'n8n_forwarding_user_access'
  ) THEN
    EXECUTE $sql$
      CREATE POLICY n8n_forwarding_user_access ON personal.n8n_forwarding
        FOR ALL TO PUBLIC
        USING (user_id = NULLIF(current_setting('app.user_id', true), ''))
        WITH CHECK (user_id = NULLIF(current_setting('app.user_id', true), ''))
    $sql$;
  END IF;
END
$$;

ALTER TABLE personal.n8n_forwarding FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'lavega_runtime') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON personal.n8n_forwarding TO lavega_runtime;
  END IF;
END $$;

COMMIT;
