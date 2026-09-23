BEGIN;

-- Ownership check FIRST: a non-owner run would otherwise fail with Postgres's
-- own "must be owner of table" error, not this one.
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
 * Stock splits, recorded on the bar of the session they take effect.
 *
 * Closes are split-adjusted, but brokers report trades in the share units of
 * their own day, so valuing a pre-split trade at today's close is off by the
 * split ratio. `split` is shares after per share before (1 when none).
 *
 * Rows written before this column existed stay NULL. The price sync treats a
 * NULL as stale and re-reads that symbol's history once, which fills it in.
 * Existing table grants to lavega_runtime cover the new column.
 */
ALTER TABLE investing.price_bars ADD COLUMN IF NOT EXISTS split NUMERIC;

ALTER TABLE investing.price_bars DROP CONSTRAINT IF EXISTS price_bars_split_positive;
ALTER TABLE investing.price_bars
  ADD CONSTRAINT price_bars_split_positive CHECK (split IS NULL OR split > 0);

COMMIT;
