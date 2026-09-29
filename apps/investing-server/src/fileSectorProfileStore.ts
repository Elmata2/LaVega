import type { SectorProfile } from "@lavega/adapters";
import { createJsonFileStore, runtimeDataFile } from "./jsonFileStore.js";
import { sanitizeSectorProfile, type SectorProfileStore } from "./inMemorySectorProfileStore.js";

export type { SectorProfileStore } from "./inMemorySectorProfileStore.js";

export function runtimeSectorStoreFile(): string {
  return runtimeDataFile("INVESTING_SECTOR_STORE_FILE", "sectors.json");
}

type StockShape = { kind: "stock"; sector: string; industry: string };
type FundShape = { kind: "fund"; weights: { sector: string; weight: number }[] };

/** Structural shape only — whether each fund weight actually satisfies the
 *  taxonomy invariant (GICS sector, weight in [0, 1]) is sanitizeSectorProfile's
 *  job, applied after this returns true, so one bad weight drops itself
 *  instead of the whole record. */
function isSectorProfile(value: unknown): value is SectorProfile {
  if (!value || typeof value !== "object") return false;
  const profile = value as Partial<StockShape> & Partial<FundShape>;
  if (profile.kind === "stock")
    return typeof profile.sector === "string" && typeof profile.industry === "string";
  if (profile.kind === "fund") return Array.isArray(profile.weights);
  return false;
}

/** A record written before the fund/source split (Phase 1) had no `kind` or
 *  `source` field at all — just `{sector, industry}`. Every symbol classified
 *  before this shipped is one of these on disk. Reading it as `null` would
 *  silently revert every previously-classified stock to Unknown on deploy. */
function normalizeLegacyRecord(value: unknown): SectorProfile | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  if (record.kind === "stock" || record.kind === "fund")
    return isSectorProfile(record) ? sanitizeSectorProfile(record as SectorProfile) : null;
  if (typeof record.sector === "string" && typeof record.industry === "string")
    return { kind: "stock", sector: record.sector, industry: record.industry, source: "provider" };
  return null;
}

/** Persistent per-symbol sector metadata cache for the Docker runtime. */
export function createFileSectorProfileStore(filePath: string): SectorProfileStore {
  const store = createJsonFileStore<Record<string, SectorProfile>>(filePath, {
    empty: {},
    validate: (contents) => {
      const parsed: unknown = JSON.parse(contents);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
        throw new Error(`Invalid sector cache file: ${filePath}`);
      const entries = Object.entries(parsed as Record<string, unknown>).flatMap(([key, value]) => {
        const normalized = normalizeLegacyRecord(value);
        return normalized ? [[key, normalized] as const] : [];
      });
      return Object.fromEntries(entries);
    },
  });
  const key = (symbol: string) => symbol.toUpperCase();
  return {
    async get(symbol) {
      return (await store.read())[key(symbol)] ?? null;
    },
    async set(symbol, profile) {
      await store.update((current) => ({
        ...current,
        [key(symbol)]: sanitizeSectorProfile(profile),
      }));
    },
  };
}
