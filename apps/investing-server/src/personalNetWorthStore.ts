/** One day's opted-in Personal total. It IS @lavega/core's read model (which now
 *  carries an optional provenance citation, #300 WS5.5), imported rather than
 *  restated so the store cannot drift from the schema the route encodes with. */
import type { PersonalNetWorthTotal } from "@lavega/core";

export type { PersonalNetWorthTotal };

/**
 * Investing's read side of Personal's opt-in net worth share. Personal owns
 * every write (apps/server/src/net-worth-routes.ts); this store only ever
 * lists what is there, for `mergeInPersonalNetWorth` (@lavega/core) to fold
 * into the net worth chart.
 */
export type PersonalNetWorthStore = {
  list(tenantId: string): Promise<PersonalNetWorthTotal[]>;
};

/** For tests and local/self-hosted runs without a database — an owner who has
 *  never shared a total gets an empty list, same as a real one would answer,
 *  which is exactly what keeps the net worth chart "unchanged when absent". */
export function createInMemoryPersonalNetWorthStore(
  seed: Record<string, PersonalNetWorthTotal[]> = {},
): PersonalNetWorthStore {
  const totalsByTenant = new Map(Object.entries(seed));
  return {
    async list(tenantId) {
      return totalsByTenant.get(tenantId) ?? [];
    },
  };
}
