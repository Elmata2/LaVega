import type { QueryResultRow } from "@neondatabase/serverless";
import type { Database } from "./connection.js";

/* Investing tables. Every repository is bound to one user and runs inside
 * withTenant or withTenantStatement, so `app.user_id` is set and the RLS policy in 0001_lavega.sql
 * decides what the statement can see. Rows never name a tenant of their own, so
 * there is no wrong-user value for a caller to pass. */

export const isoDate = (value: unknown): string | null =>
  value == null ? null : value instanceof Date ? value.toISOString() : String(value);

/* ---------- shared market data (issue #307) ---------- */

/** One stored bar of a shared series: keyed by instrument, no symbol. */
export type SharedPriceBarRow = {
  instrumentKey: string;
  date: string;
  close: number;
  currency: string;
  split?: number;
};

/** One shared coverage row. `provider` is always known (the write path
 *  requires it); the rest mirror the per-user coverage shape. */
export type SharedPriceCoverageRow = {
  instrumentKey: string;
  from: string;
  to: string;
  listing: string | null;
  currency: string;
  provider: string;
  delistedSince?: string;
  listingMissingSince?: string;
  listingStart?: string;
  provisionalThrough?: string;
};

/** A read address: the instrument key plus the `sym:` alias to fall back to. */
export type SharedPriceKey = { key: string; alias?: string };

const SHARED_PRICE_BAR_COLUMNS =
  "instrument_key AS \"instrumentKey\", to_char(date, 'YYYY-MM-DD') AS date, close, currency, split";

const SHARED_PRICE_COVERAGE_COLUMNS = `instrument_key AS "instrumentKey",
  to_char(from_date, 'YYYY-MM-DD') AS "from",
  to_char(to_date, 'YYYY-MM-DD') AS "to",
  listing, currency, provider,
  to_char(delisted_since, 'YYYY-MM-DD') AS "delistedSince",
  to_char(listing_missing_since AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS "listingMissingSince",
  to_char(listing_start, 'YYYY-MM-DD') AS "listingStart",
  to_char(provisional_through, 'YYYY-MM-DD') AS "provisionalThrough"`;

function sharedPriceBarRow(row: QueryResultRow): SharedPriceBarRow {
  return {
    instrumentKey: row.instrumentKey as string,
    date: row.date as string,
    close: Number(row.close),
    currency: row.currency as string,
    ...(row.split == null ? {} : { split: Number(row.split) }),
  };
}

function sharedPriceCoverageRow(row: QueryResultRow): SharedPriceCoverageRow {
  const coverage = row as QueryResultRow & {
    delistedSince: string | null;
    listingMissingSince: string | null;
    listingStart: string | null;
    provisionalThrough: string | null;
  };
  return {
    instrumentKey: coverage.instrumentKey as string,
    from: coverage.from as string,
    to: coverage.to as string,
    listing: (coverage.listing as string | null) ?? null,
    currency: coverage.currency as string,
    provider: coverage.provider as string,
    ...(coverage.delistedSince == null ? {} : { delistedSince: coverage.delistedSince }),
    ...(coverage.listingMissingSince == null
      ? {}
      : { listingMissingSince: coverage.listingMissingSince }),
    ...(coverage.listingStart == null ? {} : { listingStart: coverage.listingStart }),
    ...(coverage.provisionalThrough == null
      ? {}
      : { provisionalThrough: coverage.provisionalThrough }),
  };
}

const UPSERT_SHARED_PRICE_BARS = `INSERT INTO investing.instrument_price_bars
  (instrument_key, date, close, currency, provider, split)
  SELECT $1, d, c, cur, COALESCE(
    (SELECT provider FROM investing.instrument_price_coverage WHERE instrument_key = $1),
    'unknown'
  ), sp
  FROM unnest($2::date[], $3::numeric[], $4::text[], $5::numeric[]) AS rows(d, c, cur, sp)
  ON CONFLICT (instrument_key, date) DO UPDATE SET
    close = EXCLUDED.close, currency = EXCLUDED.currency,
    provider = EXCLUDED.provider, split = EXCLUDED.split, updated_at = CURRENT_TIMESTAMP`;

function sharedPriceBarParams(
  instrumentKey: string,
  bars: readonly { date: string; close: number; currency: string; split?: number }[],
): unknown[] {
  return [
    instrumentKey,
    bars.map((bar) => bar.date),
    bars.map((bar) => bar.close),
    bars.map((bar) => bar.currency),
    bars.map((bar) => bar.split ?? null),
  ];
}

export type SharedPriceRepository = {
  getRange(key: SharedPriceKey, from?: string, to?: string): Promise<SharedPriceBarRow[]>;
  getRanges(keys: readonly SharedPriceKey[]): Promise<Map<string, SharedPriceBarRow[]>>;
  lastDate(key: SharedPriceKey): Promise<string | null>;
  upsert(instrumentKey: string, bars: readonly SharedPriceBarRow[]): Promise<void>;
  replaceRange(
    instrumentKey: string,
    bars: readonly SharedPriceBarRow[],
    from?: string,
    to?: string,
  ): Promise<void>;
  getCoverage(key: SharedPriceKey): Promise<SharedPriceCoverageRow | null>;
  putCoverage(instrumentKey: string, coverage: SharedPriceCoverageRow): Promise<void>;
  latestChange(instrumentKeys: readonly string[]): Promise<string | null>;
  adoptAlias(key: string, alias: string): Promise<void>;
  claim(key: string, owner: string, ttlMs: number): Promise<boolean>;
  release(key: string, owner: string): Promise<void>;
};

/**
 * The shared, instrument-keyed price data (issue #307). These tables belong to
 * no user and have no row-level security, so no `app.user_id` is set: exactly
 * like `createFxRateRepository`. Rows are keyed by the `PriceKey` from
 * `packages/core/src/investing/instrumentKey.ts`.
 */
export function createSharedPriceRepository(db: Database): SharedPriceRepository {
  /** The key a read must use: the requested key when it has any rows, else its
   *  `sym:` alias. "Any rows" means a bar or a coverage row. */
  const resolveReadKey = async (key: SharedPriceKey): Promise<string> => {
    const exists = async (candidate: string): Promise<boolean> => {
      const result = await db.http.query(
        `SELECT EXISTS (
           SELECT 1 FROM investing.instrument_price_bars WHERE instrument_key = $1
           UNION ALL
           SELECT 1 FROM investing.instrument_price_coverage WHERE instrument_key = $1
         ) AS present`,
        [candidate],
      );
      return Boolean(result.rows[0]?.present);
    };
    if (key.alias === undefined || (await exists(key.key))) return key.key;
    return (await exists(key.alias)) ? key.alias : key.key;
  };

  const touchCoverage = (instrumentKey: string) =>
    db.http.query(
      "UPDATE investing.instrument_price_coverage SET updated_at = CURRENT_TIMESTAMP WHERE instrument_key = $1",
      [instrumentKey],
    );

  return {
    async getRange(key, from, to) {
      const resolved = await resolveReadKey(key);
      const values: unknown[] = [resolved];
      const conditions = ["instrument_key = $1"];
      if (from !== undefined) conditions.push(`date >= $${values.push(from)}`);
      if (to !== undefined) conditions.push(`date <= $${values.push(to)}`);
      const result = await db.http.query(
        `SELECT ${SHARED_PRICE_BAR_COLUMNS} FROM investing.instrument_price_bars
         WHERE ${conditions.join(" AND ")} ORDER BY date`,
        values,
      );
      return result.rows.map(sharedPriceBarRow);
    },
    async getRanges(keys) {
      const resolved = await Promise.all(
        keys.map(async (key) => ({ requested: key.key, actual: await resolveReadKey(key) })),
      );
      const out = new Map<string, SharedPriceBarRow[]>();
      for (const key of keys) out.set(key.key, []);
      if (resolved.length === 0) return out;
      const result = await db.http.query(
        `SELECT ${SHARED_PRICE_BAR_COLUMNS} FROM investing.instrument_price_bars
         WHERE instrument_key = ANY($1::text[]) ORDER BY date`,
        [[...new Set(resolved.map((entry) => entry.actual))]],
      );
      const byActual = new Map<string, SharedPriceBarRow[]>();
      for (const row of result.rows.map(sharedPriceBarRow)) {
        const list = byActual.get(row.instrumentKey) ?? [];
        list.push(row);
        byActual.set(row.instrumentKey, list);
      }
      for (const entry of resolved) out.set(entry.requested, byActual.get(entry.actual) ?? []);
      return out;
    },
    async lastDate(key) {
      const resolved = await resolveReadKey(key);
      const result = await db.http.query(
        "SELECT to_char(max(date), 'YYYY-MM-DD') AS date FROM investing.instrument_price_bars WHERE instrument_key = $1",
        [resolved],
      );
      return (result.rows[0]?.date as string | null) ?? null;
    },
    async upsert(instrumentKey, bars) {
      if (bars.length === 0) return;
      await db.http.transaction([
        db.http.query(UPSERT_SHARED_PRICE_BARS, sharedPriceBarParams(instrumentKey, bars)),
        touchCoverage(instrumentKey),
      ]);
    },
    async replaceRange(instrumentKey, bars, from, to) {
      const conditions = ["instrument_key = $1", "date <> ALL($2::date[])"];
      const params: unknown[] = [instrumentKey, bars.map((bar) => bar.date)];
      if (from !== undefined) conditions.push(`date >= $${params.push(from)}`);
      if (to !== undefined) conditions.push(`date <= $${params.push(to)}`);
      const statements = [
        db.http.query(
          `DELETE FROM investing.instrument_price_bars WHERE ${conditions.join(" AND ")}`,
          params,
        ),
      ];
      if (bars.length > 0)
        statements.push(
          db.http.query(UPSERT_SHARED_PRICE_BARS, sharedPriceBarParams(instrumentKey, bars)),
        );
      statements.push(touchCoverage(instrumentKey));
      await db.http.transaction(statements);
    },
    async getCoverage(key) {
      const resolved = await resolveReadKey(key);
      const result = await db.http.query(
        `SELECT ${SHARED_PRICE_COVERAGE_COLUMNS} FROM investing.instrument_price_coverage WHERE instrument_key = $1`,
        [resolved],
      );
      const row = result.rows[0];
      return row ? sharedPriceCoverageRow(row) : null;
    },
    async putCoverage(instrumentKey, coverage) {
      await db.http.query(
        `INSERT INTO investing.instrument_price_coverage
           (instrument_key, from_date, to_date, listing, currency, provider,
            delisted_since, listing_missing_since, listing_start, provisional_through)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         ON CONFLICT (instrument_key) DO UPDATE SET
           from_date = EXCLUDED.from_date, to_date = EXCLUDED.to_date,
           listing = EXCLUDED.listing, currency = EXCLUDED.currency,
           provider = EXCLUDED.provider, delisted_since = EXCLUDED.delisted_since,
           listing_missing_since = EXCLUDED.listing_missing_since,
           listing_start = EXCLUDED.listing_start,
           provisional_through = EXCLUDED.provisional_through,
           updated_at = CURRENT_TIMESTAMP`,
        [
          instrumentKey,
          coverage.from,
          coverage.to,
          coverage.listing,
          coverage.currency,
          coverage.provider,
          coverage.delistedSince ?? null,
          coverage.listingMissingSince ?? null,
          coverage.listingStart ?? null,
          coverage.provisionalThrough ?? null,
        ],
      );
    },
    async latestChange(instrumentKeys) {
      if (instrumentKeys.length === 0) return null;
      const result = await db.http.query(
        `SELECT to_char(max(updated_at) AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS at
         FROM investing.instrument_price_coverage WHERE instrument_key = ANY($1::text[])`,
        [[...new Set(instrumentKeys)]],
      );
      return (result.rows[0]?.at as string | null) ?? null;
    },
    async adoptAlias(key, alias) {
      const present = await db.http.query(
        `SELECT EXISTS (SELECT 1 FROM investing.instrument_price_bars WHERE instrument_key = $1)
             OR EXISTS (SELECT 1 FROM investing.instrument_price_coverage WHERE instrument_key = $1) AS present`,
        [alias],
      );
      if (!present.rows[0]?.present) return;
      await db.http.transaction([
        db.http.query(
          `INSERT INTO investing.instrument_price_bars
             (instrument_key, date, close, currency, provider, split, updated_at)
           SELECT $1, date, close, currency, provider, split, updated_at
           FROM investing.instrument_price_bars WHERE instrument_key = $2
           ON CONFLICT (instrument_key, date) DO NOTHING`,
          [key, alias],
        ),
        db.http.query("DELETE FROM investing.instrument_price_bars WHERE instrument_key = $1", [
          alias,
        ]),
        db.http.query(
          `INSERT INTO investing.instrument_price_coverage
             (instrument_key, from_date, to_date, listing, currency, provider,
              delisted_since, listing_missing_since, listing_start, provisional_through, updated_at)
           SELECT $1, from_date, to_date, listing, currency, provider,
              delisted_since, listing_missing_since, listing_start, provisional_through, updated_at
           FROM investing.instrument_price_coverage WHERE instrument_key = $2
           ON CONFLICT (instrument_key) DO UPDATE SET
             from_date = LEAST(investing.instrument_price_coverage.from_date, EXCLUDED.from_date),
             to_date = GREATEST(investing.instrument_price_coverage.to_date, EXCLUDED.to_date),
             updated_at = CURRENT_TIMESTAMP`,
          [key, alias],
        ),
        db.http.query("DELETE FROM investing.instrument_price_coverage WHERE instrument_key = $1", [
          alias,
        ]),
        touchCoverage(key),
      ]);
    },
    async claim(key, owner, ttlMs) {
      const result = await db.http.query(
        `INSERT INTO investing.instrument_price_claims (instrument_key, owner, claimed_until)
         VALUES ($1, $2, now() + ($3::double precision * INTERVAL '1 millisecond'))
         ON CONFLICT (instrument_key) DO UPDATE
           SET owner = EXCLUDED.owner, claimed_until = EXCLUDED.claimed_until
           WHERE investing.instrument_price_claims.claimed_until < now()
         RETURNING instrument_key`,
        [key, owner, ttlMs],
      );
      return result.rows.length > 0;
    },
    async release(key, owner) {
      await db.http.query(
        "DELETE FROM investing.instrument_price_claims WHERE instrument_key = $1 AND owner = $2",
        [key, owner],
      );
    },
  };
}
