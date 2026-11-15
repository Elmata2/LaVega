/** The owner's own override for one symbol's sector, tenant-scoped. Outranks
 *  a provider profile and a classifier inference alike (sectorResolution.ts).
 *  Stocks only — a fund's sector is its look-through weight vector, not a
 *  single label, so app.ts's PUT route rejects a fund symbol before this
 *  store ever sees it. */
export type SectorCorrectionStore = {
  get(tenantId: string, symbol: string): Promise<string | null>;
  /** Every correction for the tenant in one read. Callers resolving many
   *  symbols in one request (the summary route, /sectors/infer) fetch this
   *  once and index into it locally instead of calling `get` per symbol —
   *  each `get` on the Neon store re-reads the whole preferences row. */
  getAll(tenantId: string): Promise<Record<string, string>>;
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
    async getAll(tenantId) {
      return { ...corrections.get(tenantId) };
    },
    async set(tenantId, symbol, sector) {
      corrections.set(tenantId, { ...corrections.get(tenantId), [key(symbol)]: sector });
    },
    async clear(tenantId, symbol) {
      const current = { ...corrections.get(tenantId) };
      delete current[key(symbol)];
      corrections.set(tenantId, current);
    },
  };
}
