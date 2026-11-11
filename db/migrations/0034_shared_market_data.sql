BEGIN;

-- Ownership check FIRST, before the CREATE statements below: on a second,
-- non-owner run those already-idempotent statements would otherwise fail
-- with Postgres's own "must be owner of table" error, not this one.
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
 * Shared market data (issue #307).
 *
 * Daily close bars and provider coverage are public reference data. They were
 * stored per user: everyone who holds an instrument fetched and kept a private
 * copy. These three tables hold ONE series per instrument for the whole
 * installation. Like investing.fx_rates they belong to no user, so they have
 * no user_id and no row-level security. The key is computed only by
 * packages/core/src/investing/instrumentKey.ts: `isin:<ISIN>:<CUR>` when the
 * instrument has a valid ISIN, else `sym:<symbol>:<CUR>`.
 *
 * `instrument_price_claims` is the per-key fetch claim the price sync takes
 * before asking the partner; a claim must exist before the first coverage row,
 * which is why it is not a column on the coverage table.
 */
CREATE TABLE IF NOT EXISTS investing.instrument_price_bars (
  instrument_key TEXT NOT NULL,
  date DATE NOT NULL,
  close NUMERIC(20, 8) NOT NULL,
  currency CHAR(3) NOT NULL,
  provider TEXT NOT NULL,
  split NUMERIC,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (instrument_key, date),
  CONSTRAINT instrument_price_bars_key_not_blank CHECK (btrim(instrument_key) <> ''),
  CONSTRAINT instrument_price_bars_close_non_negative CHECK (close >= 0),
  CONSTRAINT instrument_price_bars_currency_uppercase CHECK (currency ~ '^[A-Z]{3}$'),
  CONSTRAINT instrument_price_bars_provider_not_blank CHECK (btrim(provider) <> ''),
  CONSTRAINT instrument_price_bars_split_positive CHECK (split IS NULL OR split > 0)
);

CREATE INDEX IF NOT EXISTS instrument_price_bars_date_idx
  ON investing.instrument_price_bars (date DESC);

CREATE TABLE IF NOT EXISTS investing.instrument_price_coverage (
  instrument_key TEXT PRIMARY KEY,
  from_date DATE NOT NULL,
  to_date DATE NOT NULL,
  listing TEXT,
  currency TEXT NOT NULL,
  provider TEXT NOT NULL,
  delisted_since DATE,
  listing_missing_since TIMESTAMPTZ,
  listing_start DATE,
  provisional_through DATE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT instrument_price_coverage_key_not_blank CHECK (btrim(instrument_key) <> ''),
  CONSTRAINT instrument_price_coverage_currency_not_blank CHECK (btrim(currency) <> ''),
  CONSTRAINT instrument_price_coverage_provider_not_blank CHECK (btrim(provider) <> ''),
  CONSTRAINT instrument_price_coverage_window_ordered CHECK (from_date <= to_date)
);

CREATE TABLE IF NOT EXISTS investing.instrument_price_claims (
  instrument_key TEXT PRIMARY KEY,
  owner TEXT NOT NULL,
  claimed_until TIMESTAMPTZ NOT NULL,
  CONSTRAINT instrument_price_claims_key_not_blank CHECK (btrim(instrument_key) <> ''),
  CONSTRAINT instrument_price_claims_owner_not_blank CHECK (btrim(owner) <> '')
);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'lavega_runtime') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE
      ON investing.instrument_price_bars, investing.instrument_price_coverage,
         investing.instrument_price_claims TO lavega_runtime;
  END IF;
END $$;

/* The per-user version trigger on price_bars cannot see a shared write, so a
 * stored dashboard also records the instrument keys it read (issue #307). It is
 * the same exposure the per-user price rows had. */
ALTER TABLE investing.dashboard_snapshots
  ADD COLUMN IF NOT EXISTS price_keys TEXT[] NOT NULL DEFAULT '{}';

/*
 * Data copy. Old rows have no ISIN, so only the keys that can be derived
 * without one are copied: Trading 212 `_EQ` tickers (globally unique) and
 * `^` indices (benchmarks). Everything else is fetched once by the first sync
 * after deploy, under its ISIN key.
 *
 * A symbol is copied only when every user's coverage row for it agrees on
 * (listing, currency). Among those users the widest window wins; on a tie the
 * latest updated_at, then the lowest user_id. All bars of that one winner are
 * copied; no other user's bars are merged in.
 *
 * Every statement is INSERT ... ON CONFLICT DO NOTHING, so a second run changes
 * no row and the copy never updates or deletes a destination row.
 */
CREATE TEMP TABLE shared_price_winners ON COMMIT DROP AS
WITH candidate_symbols AS (
  SELECT symbol
  FROM investing.price_coverage
  WHERE (symbol LIKE '%\_EQ' ESCAPE '\' OR symbol LIKE '^%')
  GROUP BY symbol
  HAVING count(DISTINCT (coalesce(listing, ''), currency)) = 1
)
SELECT DISTINCT ON (c.symbol)
  c.symbol,
  c.user_id,
  c.currency,
  c.from_date,
  c.to_date,
  c.listing,
  c.delisted_since,
  c.listing_missing_since,
  coalesce(c.provider, 'legacy') AS provider,
  c.listing_start,
  c.provisional_through,
  c.updated_at
FROM investing.price_coverage c
JOIN candidate_symbols s ON s.symbol = c.symbol
ORDER BY c.symbol,
  (c.to_date - c.from_date) DESC,
  c.updated_at DESC,
  c.user_id ASC;

INSERT INTO investing.instrument_price_coverage (
  instrument_key, from_date, to_date, listing, currency, provider,
  delisted_since, listing_missing_since, listing_start, provisional_through, updated_at
)
SELECT
  'sym:' || symbol || ':' || currency,
  from_date, to_date, listing, currency, provider,
  delisted_since, listing_missing_since, listing_start, provisional_through, updated_at
FROM shared_price_winners
ON CONFLICT (instrument_key) DO NOTHING;

INSERT INTO investing.instrument_price_bars (
  instrument_key, date, close, currency, provider, split, updated_at
)
SELECT
  'sym:' || b.symbol || ':' || w.currency,
  b.date,
  b.close,
  b.currency,
  coalesce(b.provider, 'legacy'),
  coalesce(b.split, 1),
  coalesce(b.updated_at, CURRENT_TIMESTAMP)
FROM investing.price_bars b
JOIN shared_price_winners w ON w.symbol = b.symbol AND w.user_id = b.user_id
ON CONFLICT (instrument_key, date) DO NOTHING;

COMMIT;
