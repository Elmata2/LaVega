/** The owner's own override for one symbol's sector, tenant-scoped. Outranks
 *  a provider profile and a classifier inference alike (sectorResolution.ts).
 *  Stocks only — a fund's sector is its look-through weight vector, not a
 *  single label, so app.ts's PUT route rejects a fund symbol before this
 *  store ever sees it. */
export type SectorCorrectionStore = {
  get(tenantId: string, symbol: string): Promise<string | null>;
  set(tenantId: string, symbol: string, sector: string): Promise<void>;
  clear(tenantId: string, symbol: string): Promise<void>;
};

export function createInMemorySectorCorrectionStore(): SectorCorrectionStore {
  const corrections = new Map<string, Record<string, string>>();
  const key = (symbol: string) => symbol.toUpperCase();
  return {
    async get(tenantId, symbol) {
      return corrections.get(tenantId)?.[key(symbol)] ?? null;
    },
    async set(tenantId, symbol, sector) {
      corrections.set(tenantId, { ...(corrections.get(tenantId) ?? {}), [key(symbol)]: sector });
    },
    async clear(tenantId, symbol) {
      const current = { ...(corrections.get(tenantId) ?? {}) };
      delete current[key(symbol)];
      corrections.set(tenantId, current);
    },
  };
}
