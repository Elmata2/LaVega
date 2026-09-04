import type { SectorProfile } from "@lavega/adapters";
import { createJsonFileStore, runtimeDataFile } from "./jsonFileStore.js";
import type { SectorProfileStore } from "./inMemorySectorProfileStore.js";

export type { SectorProfileStore } from "./inMemorySectorProfileStore.js";

export function runtimeSectorStoreFile(): string {
  return runtimeDataFile("INVESTING_SECTOR_STORE_FILE", "sectors.json");
}

function isSectorProfile(value: unknown): value is SectorProfile {
  if (!value || typeof value !== "object") return false;
  const profile = value as Partial<SectorProfile>;
  return typeof profile.sector === "string" && typeof profile.industry === "string";
}

/** Persistent per-symbol sector metadata cache for the Docker runtime. */
export function createFileSectorProfileStore(filePath: string): SectorProfileStore {
  const store = createJsonFileStore<Record<string, SectorProfile>>(filePath, {
    empty: {},
    validate: (contents) => {
      const parsed: unknown = JSON.parse(contents);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
        throw new Error(`Invalid sector cache file: ${filePath}`);
      const entries = Object.entries(parsed).filter(([, value]) => isSectorProfile(value));
      return Object.fromEntries(entries) as Record<string, SectorProfile>;
    },
  });
  const key = (symbol: string) => symbol.toUpperCase();
  return {
    async get(symbol) {
      return (await store.read())[key(symbol)] ?? null;
    },
    async set(symbol, profile) {
      await store.update((current) => ({ ...current, [key(symbol)]: profile }));
    },
  };
}
