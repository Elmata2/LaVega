import type { Database } from "./index.js";

/**
 * The durable half of the partner request budget (#305).
 *
 * One row per partner, endpoint and scope in `investing.partner_budgets`. The
 * rows hold timing only and belong to no user, so there is no tenant here, like
 * `createFxRateRepository`. All time is the database's own `now()`: callers in
 * different processes then agree on one clock.
 */
export type PartnerBudgetKey = { partner: string; endpoint: string; scopeId: string };

export type PartnerBudgetRepository = {
  /** Takes the next slot for the key and returns its instant. One statement,
   *  one round trip. Concurrent callers get distinct, increasing slots because
   *  Postgres serializes the update of one row. `intervalMs` is the table
   *  interval for the key; a stored interval overrides it. */
  reserve(key: PartnerBudgetKey, intervalMs: number): Promise<Date>;
  /** Records what a response said. Sets `blocked_until` (never earlier) and
   *  `interval_ms` when given; does not change `next_at`. */
  observe(
    key: PartnerBudgetKey,
    seen: { blockedUntilMs: number | null; intervalMs: number | null },
  ): Promise<void>;
  /** No slot before `until`. Never moves an existing block earlier. */
  reject(key: PartnerBudgetKey, until: Date): Promise<void>;
};

/* The slot is returned as whole epoch milliseconds, not a timestamp: the
 * intervals are whole milliseconds, so flooring keeps every difference between
 * two slots exact, and a number needs no driver-specific date parsing. */
const RESERVE = `
  INSERT INTO investing.partner_budgets AS b (partner, endpoint, scope_id, next_at)
  VALUES ($1, $2, $3, now() + make_interval(secs => $4::integer / 1000.0))
  ON CONFLICT (partner, endpoint, scope_id) DO UPDATE
    SET next_at = GREATEST(now(), b.next_at, COALESCE(b.blocked_until, now()))
                  + make_interval(secs => COALESCE(b.interval_ms, $4::integer) / 1000.0),
        updated_at = now()
  RETURNING floor(extract(epoch FROM
    next_at - make_interval(secs => COALESCE(interval_ms, $4::integer) / 1000.0)
  ) * 1000)::bigint AS slot_ms`;

/* A row made by a header or a rejection starts with next_at = now(): that
 * changes nothing for the next reserve. GREATEST ignores NULL, so an absent
 * block or interval leaves the stored value alone. */
const RECORD = `
  INSERT INTO investing.partner_budgets AS b
    (partner, endpoint, scope_id, next_at, blocked_until, interval_ms)
  VALUES ($1, $2, $3, now(), $4::timestamptz, $5::integer)
  ON CONFLICT (partner, endpoint, scope_id) DO UPDATE
    SET blocked_until = GREATEST(b.blocked_until, EXCLUDED.blocked_until),
        interval_ms = COALESCE(EXCLUDED.interval_ms, b.interval_ms),
        updated_at = now()`;

const iso = (ms: number | null) => (ms === null ? null : new Date(ms).toISOString());

export function createPartnerBudgetRepository(db: Database): PartnerBudgetRepository {
  return {
    async reserve(key, intervalMs) {
      const result = await db.http.query(RESERVE, [
        key.partner,
        key.endpoint,
        key.scopeId,
        intervalMs,
      ]);
      const row = (result.rows as Array<{ slot_ms: string | number }>)[0];
      if (row === undefined) throw new Error("partner_budgets reserve returned no row");
      return new Date(Number(row.slot_ms));
    },
    async observe(key, seen) {
      await db.http.query(RECORD, [
        key.partner,
        key.endpoint,
        key.scopeId,
        iso(seen.blockedUntilMs),
        seen.intervalMs,
      ]);
    },
    async reject(key, until) {
      await db.http.query(RECORD, [
        key.partner,
        key.endpoint,
        key.scopeId,
        until.toISOString(),
        null,
      ]);
    },
  };
}
