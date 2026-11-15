/** A monotonic counter per tenant, raised whenever the sector correction store
 *  or the inference setting is written. The sector read keys its resolution
 *  cache on it, so the owner's correction or setting change appears on the next
 *  read without waiting for a broker or price write to move `dataVersion` — the
 *  two invalidation sources stay independent (see #223). */
export type SectorRevisionStore = {
  get(tenantId: string): Promise<number>;
  raise(tenantId: string): Promise<void>;
};

export function createInMemorySectorRevisionStore(): SectorRevisionStore {
  const revisions = new Map<string, number>();
  return {
    async get(tenantId) {
      return revisions.get(tenantId) ?? 0;
    },
    async raise(tenantId) {
      revisions.set(tenantId, (revisions.get(tenantId) ?? 0) + 1);
    },
  };
}
