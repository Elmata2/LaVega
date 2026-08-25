import type { SectorProfile } from "@lavega/adapters";

/** The contract both the Node file-backed store (fileSectorProfileStore.ts)
 *  and this in-memory one implement. Lives here, not there, so app.ts can
 *  depend on the type without dragging in that file's node:path/jsonFileStore
 *  imports. */
export type SectorProfileStore = {
  get(symbol: string): Promise<SectorProfile | null>;
  set(symbol: string, profile: SectorProfile): Promise<void>;
};

/** Non-persistent store for tests and the dev tier. Deliberately its own
 *  file: no Node import at all, so app.ts's default (`dependencies.sectorStore
 *  ?? createInMemorySectorProfileStore()`) stays Workers-portable even though
 *  index.ts wires in the Node-backed one for the real Docker runtime. */
export function createInMemorySectorProfileStore(): SectorProfileStore {
  const profiles = new Map<string, SectorProfile>();
  return {
    async get(symbol) {
      return profiles.get(symbol.toUpperCase()) ?? null;
    },
    async set(symbol, profile) {
      profiles.set(symbol.toUpperCase(), profile);
    },
  };
}
