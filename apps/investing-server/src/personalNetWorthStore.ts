/** One day's opted-in Personal total, mirroring @lavega/database's
 *  PersonalNetWorthTotal — restated here rather than imported from
 *  @lavega/core's PersonalNetWorthTotal so this store's contract does not
 *  depend on which of the two packages happens to define the read model. */
export type PersonalNetWorthTotal = { date: string; totalCents: number };

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
