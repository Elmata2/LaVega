import type { QueryResultRow } from "@neondatabase/serverless";
import { withTenantStatement, type Database } from "./connection.js";
import { encryptBlob, tryDecryptBlob } from "./crypto.js";

export type DashboardSnapshotRepository = {
  /** The stored dashboard for a query while it is still current, and the
   *  source version a dashboard built now has to be stored under. `priceKeys`
   *  are the instrument keys the stored build read (issue #307), so a shared
   *  price write can invalidate it; `updatedAt` is its build time. */
  get(cacheKey: string): Promise<{
    version: number;
    dashboard: unknown | null;
    priceKeys: string[];
    updatedAt: string | null;
  }>;
  put(
    cacheKey: string,
    version: number,
    dashboard: unknown,
    priceKeys?: readonly string[],
  ): Promise<void>;
};

/**
 * Built dashboards, one per query, current while their source version is
 * (see 0010_dashboard_snapshots.sql). The tenant is also named in each
 * statement: a connection that bypasses RLS must still see one user's row.
 */
export function createDashboardSnapshotRepository(
  db: Database,
  userId: string | undefined | null,
): DashboardSnapshotRepository {
  return {
    async get(cacheKey) {
      return withTenantStatement(db, userId, async (client) => {
        const result = await client.query<QueryResultRow>(
          `SELECT current.version, stored.blob, stored.price_keys,
                  to_char(stored.updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS updated_at
           FROM (
             SELECT COALESCE(
               (SELECT version FROM investing.dashboard_sources
                WHERE user_id = current_setting('app.user_id')),
               0
             ) AS version
           ) AS current
           LEFT JOIN investing.dashboard_snapshots AS stored
             ON stored.user_id = current_setting('app.user_id')
            AND stored.cache_key = $1
            AND stored.version = current.version
            AND stored.as_of = CURRENT_DATE`,
          [cacheKey],
        );
        const row = result.rows[0];
        const stored = row?.blob ? tryDecryptBlob(row.blob as Buffer) : null;
        return {
          version: Number(row?.version ?? 0),
          dashboard: stored?.readable ? stored.value : null,
          priceKeys: Array.isArray(row?.price_keys) ? (row.price_keys as string[]) : [],
          updatedAt: (row?.updated_at as string | null) ?? null,
        };
      });
    },
    async put(cacheKey, version, dashboard, priceKeys = []) {
      const blob = encryptBlob(dashboard);
      await withTenantStatement(db, userId, async (client) => {
        await client.query(
          `INSERT INTO investing.dashboard_snapshots
             (user_id, cache_key, version, as_of, blob, price_keys)
           VALUES (current_setting('app.user_id'), $1, $2, CURRENT_DATE, $3, $4::text[])
           ON CONFLICT (user_id, cache_key) DO UPDATE
             SET version = EXCLUDED.version, as_of = EXCLUDED.as_of, blob = EXCLUDED.blob,
                 price_keys = EXCLUDED.price_keys, updated_at = CURRENT_TIMESTAMP
             WHERE investing.dashboard_snapshots.version <= EXCLUDED.version`,
          [cacheKey, version, blob, [...priceKeys]],
        );
      });
    },
  };
}
