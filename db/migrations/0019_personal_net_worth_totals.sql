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
 * One number per day: the owner's Personal "Totale positie" (packages/core's
 * consolidate()), opted into LaVega Investing's net worth. Lives in `personal`
 * because it is Personal's own figure and Personal's routes own the write —
 * Investing only ever reads it, the same cross-schema read every other join
 * between these two apps already relies on (same database, same `app.user_id`).
 *
 * No transaction, account or entity ever reaches this table: consolidate()
 * runs in the browser and only its EUR total crosses the network. A day
 * where any balance was unknown is never written at all (see apps/web's
 * netWorthShare.ts), so a row here is always a real, complete total.
 */
CREATE TABLE IF NOT EXISTS personal.net_worth_totals (
  user_id TEXT NOT NULL,
  date DATE NOT NULL,
  total_cents BIGINT NOT NULL,
  currency TEXT NOT NULL DEFAULT 'EUR',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, date),
  CONSTRAINT net_worth_totals_user_id_not_blank CHECK (btrim(user_id) <> ''),
  CONSTRAINT net_worth_totals_currency_eur CHECK (currency = 'EUR'),
  -- A generous bound (±10 billion euro), only wide enough to catch a garbage
  -- or overflowed value before it reaches Investing's net worth chart.
  CONSTRAINT net_worth_totals_cents_bounded
    CHECK (total_cents BETWEEN -1000000000000 AND 1000000000000)
);

ALTER TABLE personal.net_worth_totals ENABLE ROW LEVEL SECURITY;
ALTER TABLE personal.net_worth_totals FORCE ROW LEVEL SECURITY;

DO $policies$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'personal' AND tablename = 'net_worth_totals'
      AND policyname = 'net_worth_totals_user_access'
  ) THEN
    EXECUTE $sql$
      CREATE POLICY net_worth_totals_user_access ON personal.net_worth_totals
        FOR ALL TO PUBLIC
        USING (user_id = NULLIF(current_setting('app.user_id', true), ''))
        WITH CHECK (user_id = NULLIF(current_setting('app.user_id', true), ''))
    $sql$;
  END IF;
END $policies$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'lavega_runtime') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON personal.net_worth_totals TO lavega_runtime;
  END IF;
END $$;

COMMIT;
