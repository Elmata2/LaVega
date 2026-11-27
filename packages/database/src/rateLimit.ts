import type { Database } from "./index.js";

/*
 * Shared fixed-window rate-limit counters (#246, security review 2026-10-17
 * M8). One row per (key digest, window start); see 0026_rate_limit_buckets.sql
 * for why the table carries no address in the clear.
 *
 * Fixed window, not the sliding window the in-process guard uses. A caller can
 * send up to 2x `max` across a window boundary. That is accepted: the real
 * spend ceiling is the reservation in agent/budget.ts, and the point of this
 * counter is to stop a burst SPREAD ACROSS INSTANCES, which a per-process
 * window cannot do at all. Two windows' worth of rows is also what makes the
 * cleanup a single indexed DELETE.
 */

export type RateLimitWindow = { max: number; windowMs: number };

export type RateLimitRepository = {
  /** Consume one unit for `keyHash` at `at` (ms since epoch). `true` = within
   *  the window's limit. One statement, one round trip. */
  consume(keyHash: string, at: number): Promise<boolean>;
};

const GLOBAL_CLEANUP_FLOOR_MS = 24 * 60 * 60_000;

export function createRateLimitRepository(
  db: Database,
  window: RateLimitWindow,
): RateLimitRepository {
  return {
    async consume(keyHash, at) {
      const windowStart = Math.floor(at / window.windowMs) * window.windowMs;
      const globalSweepBefore = at - Math.max(window.windowMs * 2, GLOBAL_CLEANUP_FLOOR_MS);
      /* Scope the per-window DELETE to this key_hash so a shorter-window repo
       * (e.g. 1 min) never deletes active buckets of a longer-window repo
       * (e.g. 1 hour), while still sweeping abandoned rows older than 24h. */
      const result = await db.http.query(
        `WITH expired AS (
           DELETE FROM personal.rate_limit_buckets
           WHERE (key_hash = $1 AND window_start < $4::timestamptz)
              OR window_start < $5::timestamptz
         )
         INSERT INTO personal.rate_limit_buckets AS bucket (key_hash, window_start, hits)
         VALUES ($1, $2::timestamptz, 1)
         ON CONFLICT (key_hash, window_start)
         DO UPDATE SET hits = bucket.hits + 1
         RETURNING bucket.hits <= $3::integer AS allowed`,
        [
          keyHash,
          new Date(windowStart).toISOString(),
          window.max,
          new Date(windowStart - window.windowMs).toISOString(),
          new Date(globalSweepBefore).toISOString(),
        ],
      );
      return result.rows[0]?.allowed === true;
    },
  };
}
