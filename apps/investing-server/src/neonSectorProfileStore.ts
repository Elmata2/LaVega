import type { Database } from "@lavega/database";
import type { SectorProfile } from "@lavega/adapters";
import { sanitizeSectorProfile, type SectorProfileStore } from "./inMemorySectorProfileStore.js";

/** Global cache — no tenantId, on purpose. See db/migrations/0017's comment:
 *  a symbol's sector is a market-data fact, not something one account owns.
 *  This table has no RLS, so it uses `db.connect()` directly rather than
 *  `withTenantStatement` — matching the pattern `createAiUsageRepository`
 *  already uses for its non-tenant methods. */
export function createNeonSectorProfileStore(db: Database): SectorProfileStore {
  return {
    async get(symbol) {
      const client = await db.connect();
      try {
        const result = await client.query<{ profile: SectorProfile }>(
          "SELECT profile FROM investing.sector_profiles WHERE symbol = $1",
          [symbol.toUpperCase()],
        );
        const profile = result.rows[0]?.profile;
        return profile ? sanitizeSectorProfile(profile) : null;
      } finally {
        client.release();
      }
    },
    async set(symbol, profile) {
      const sanitized = sanitizeSectorProfile(profile);
      const client = await db.connect();
      try {
        await client.query(
          `INSERT INTO investing.sector_profiles (symbol, profile, updated_at)
           VALUES ($1, $2::jsonb, CURRENT_TIMESTAMP)
           ON CONFLICT (symbol) DO UPDATE SET profile = EXCLUDED.profile, updated_at = CURRENT_TIMESTAMP`,
          [symbol.toUpperCase(), JSON.stringify(sanitized)],
        );
      } finally {
        client.release();
      }
    },
  };
}
