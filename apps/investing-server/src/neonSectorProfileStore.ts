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
        /* A provider row is never displaced by an inferred one written after
         * it — the provider fetch may simply have lost a race with an
         * in-flight classification for the same symbol. An inferred row, or
         * a provider row replacing an existing provider row (a re-fetch),
         * still writes normally. */
        await client.query(
          `INSERT INTO investing.sector_profiles (symbol, profile, updated_at)
           VALUES ($1, $2::jsonb, CURRENT_TIMESTAMP)
           ON CONFLICT (symbol) DO UPDATE SET profile = EXCLUDED.profile, updated_at = CURRENT_TIMESTAMP
           WHERE sector_profiles.profile->>'source' IS DISTINCT FROM 'provider'
              OR EXCLUDED.profile->>'source' = 'provider'`,
          [symbol.toUpperCase(), JSON.stringify(sanitized)],
        );
      } finally {
        client.release();
      }
    },
  };
}
