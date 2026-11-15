import type { Database } from "@lavega/database";
import {
  sanitizeSectorProfile,
  type SectorProfileStore,
  type StoredSectorProfile,
} from "./inMemorySectorProfileStore.js";

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
        const result = await client.query<{ profile: StoredSectorProfile }>(
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
         * still writes normally. A non-provider write keeps the row's
         * providerAttemptedAt, so an inference does not reopen the fetch. */
        await client.query(
          `INSERT INTO investing.sector_profiles (symbol, profile, updated_at)
           VALUES ($1, $2::jsonb, CURRENT_TIMESTAMP)
           ON CONFLICT (symbol) DO UPDATE SET
             profile = EXCLUDED.profile || CASE
               WHEN EXCLUDED.profile->>'source' = 'provider' THEN '{}'::jsonb
               ELSE jsonb_strip_nulls(jsonb_build_object('providerAttemptedAt', sector_profiles.profile->'providerAttemptedAt'))
             END,
             updated_at = CURRENT_TIMESTAMP
           WHERE sector_profiles.profile->>'source' IS DISTINCT FROM 'provider'
              OR EXCLUDED.profile->>'source' = 'provider'`,
          [symbol.toUpperCase(), JSON.stringify(sanitized)],
        );
      } finally {
        client.release();
      }
    },
    async lastProviderAttempt(symbol) {
      const client = await db.connect();
      try {
        const result = await client.query<{ attempted_at: string | null }>(
          "SELECT profile->>'providerAttemptedAt' AS attempted_at FROM investing.sector_profiles WHERE symbol = $1",
          [symbol.toUpperCase()],
        );
        return result.rows[0]?.attempted_at ?? null;
      } finally {
        client.release();
      }
    },
    async recordProviderAttempt(symbol, at) {
      const client = await db.connect();
      try {
        /* One statement. A symbol with no row gets a `kind: "none"` row that
         * get() reads as null; an existing profile only gains the key. */
        await client.query(
          `INSERT INTO investing.sector_profiles (symbol, profile, updated_at)
           VALUES ($1, jsonb_build_object('kind', 'none', 'providerAttemptedAt', $2::text), CURRENT_TIMESTAMP)
           ON CONFLICT (symbol) DO UPDATE SET
             profile = sector_profiles.profile || jsonb_build_object('providerAttemptedAt', $2::text)`,
          [symbol.toUpperCase(), at],
        );
      } finally {
        client.release();
      }
    },
  };
}
