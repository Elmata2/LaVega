import {
  createMemorySharedBackend,
  emptySharedPrices,
  type PriceCoverage,
  type PriceKey,
  type SerializedSharedPrices,
  type SharedPriceCoverage,
  type SharedPriceStore,
} from "@lavega/adapters";
import type { PriceBar } from "@lavega/core";
import { createJsonFileStore, runtimeDataFile } from "./jsonFileStore.js";

/** On disk a bar records the tenant whose cache it belongs to. In the domain a
 *  bar is just market data, so the field lives here and nowhere else. */
type StoredPriceBar = PriceBar & { tenantId: string };
type StoredPriceCoverage = PriceCoverage & { tenantId: string };

export function runtimePriceStoreFile(): string {
  return runtimeDataFile("INVESTING_PRICE_STORE_FILE", "prices.json");
}

function isPriceBar(value: unknown): value is StoredPriceBar {
  if (!value || typeof value !== "object") return false;
  const bar = value as Partial<StoredPriceBar>;
  return (
    typeof bar.tenantId === "string" &&
    typeof bar.symbol === "string" &&
    typeof bar.date === "string" &&
    Number.isFinite(bar.close) &&
    typeof bar.currency === "string"
  );
}

function isPriceCoverage(value: unknown): value is StoredPriceCoverage {
  if (!value || typeof value !== "object") return false;
  const coverage = value as Partial<StoredPriceCoverage>;
  return (
    typeof coverage.tenantId === "string" &&
    typeof coverage.symbol === "string" &&
    typeof coverage.from === "string" &&
    typeof coverage.to === "string" &&
    (coverage.listing === null || typeof coverage.listing === "string") &&
    typeof coverage.currency === "string"
  );
}

/** Coverage sits beside the bars in its own file, so a bar file written
 *  before coverage existed still reads as it is. */
function coverageFile(filePath: string): string {
  return `${filePath.replace(/\.json$/, "")}.coverage.json`;
}

/* ---------- the shared, instrument-keyed store (issue #307) ---------- */

/** The shared series file. Kept beside the old `prices.json`; the old file is
 *  read once for conversion and then never touched again. */
function sharedPriceFile(filePath: string): string {
  return `${filePath.replace(/\.json$/, "")}.shared.json`;
}

function isSharedBarRow(value: unknown): value is SerializedSharedPrices["bars"][number] {
  if (!value || typeof value !== "object") return false;
  const row = value as Partial<SerializedSharedPrices["bars"][number]>;
  return (
    typeof row.instrumentKey === "string" &&
    row.instrumentKey.length > 0 &&
    typeof row.date === "string" &&
    Number.isFinite(row.close) &&
    typeof row.currency === "string"
  );
}

/** The old rows have no ISIN, so only the keys derivable without one convert:
 *  Trading 212 `_EQ` tickers and `^` indices (issue #307). Everything else is
 *  dropped and fetched again under its ISIN key. */
const derivableKeySymbol = (symbol: string): boolean =>
  symbol.endsWith("_EQ") || symbol.startsWith("^");

function convertLegacyPriceFiles(
  bars: readonly StoredPriceBar[],
  coverage: readonly StoredPriceCoverage[],
): SerializedSharedPrices {
  const converted = emptySharedPrices();
  for (const row of coverage) {
    if (!derivableKeySymbol(row.symbol)) continue;
    const { tenantId: _tenantId, symbol: _symbol, ...rest } = row;
    converted.coverage.push({
      ...rest,
      instrumentKey: `sym:${row.symbol}:${row.currency}`,
      provider: row.provider ?? "legacy",
      updatedAt: new Date().toISOString(),
    });
  }
  const currencyOf = (symbol: string): string | null =>
    converted.coverage.find((row) => row.instrumentKey === `sym:${symbol}:${row.currency}`)
      ?.currency ?? null;
  for (const row of bars) {
    if (!derivableKeySymbol(row.symbol)) continue;
    const currency = currencyOf(row.symbol) ?? row.currency;
    if (currency !== row.currency) continue;
    const { tenantId: _tenantId, symbol, ...rest } = row;
    converted.bars.push({ ...rest, instrumentKey: `sym:${symbol}:${row.currency}` });
  }
  return converted;
}

/**
 * Shared PriceStore for the Docker runtime: one series per instrument, keyed by
 * `sym:`/`isin:`, in `prices.shared.json`. On first use the old per-tenant file
 * is converted once with the derivable-key rule above.
 *
 * Claims are process-local: this store serves one installation with one
 * process, so a claim never has to coordinate two machines.
 */
export function createFileSharedPriceStore(
  filePath: string,
): SharedPriceStore & { clear: () => Promise<void> } {
  const backend = createMemorySharedBackend();
  const shared = createJsonFileStore<SerializedSharedPrices>(sharedPriceFile(filePath), {
    empty: emptySharedPrices(),
    validate: (contents) => {
      const parsed: unknown = JSON.parse(contents);
      if (!parsed || typeof parsed !== "object") throw new Error("Invalid shared prices");
      const state = parsed as Partial<SerializedSharedPrices>;
      if (
        state.version !== 2 ||
        !Array.isArray(state.bars) ||
        !state.bars.every(isSharedBarRow) ||
        !Array.isArray(state.coverage)
      )
        throw new Error(`Invalid shared price file: ${sharedPriceFile(filePath)}`);
      return state as SerializedSharedPrices;
    },
  });
  const legacyBars = createJsonFileStore<StoredPriceBar[]>(filePath, {
    empty: [],
    validate: (contents) => {
      const parsed: unknown = JSON.parse(contents);
      if (!Array.isArray(parsed) || !parsed.every(isPriceBar))
        throw new Error(`Invalid price cache file: ${filePath}`);
      return parsed;
    },
  });
  const legacyCoverage = createJsonFileStore<StoredPriceCoverage[]>(coverageFile(filePath), {
    empty: [],
    validate: (contents) => {
      const parsed: unknown = JSON.parse(contents);
      if (!Array.isArray(parsed) || !parsed.every(isPriceCoverage))
        throw new Error(`Invalid price coverage file: ${coverageFile(filePath)}`);
      return parsed;
    },
  });

  let ready: Promise<void> | null = null;
  const load = (): Promise<void> => {
    ready ??= (async () => {
      const stored = await shared.read();
      if (stored.bars.length > 0 || stored.coverage.length > 0) {
        backend.hydrate(stored);
        return;
      }
      const converted = convertLegacyPriceFiles(
        await legacyBars.read(),
        await legacyCoverage.read(),
      );
      backend.hydrate(converted);
      if (converted.bars.length > 0 || converted.coverage.length > 0)
        await shared.update(() => converted);
    })();
    return ready;
  };
  const write = async <R>(operation: () => Promise<R>): Promise<R> => {
    await load();
    const result = await operation();
    await shared.update(() => backend.snapshot());
    return result;
  };

  return {
    /** Clears every series (the local, single-installation "clear price cache"):
     *  the database store has no such operation, because its rows serve every
     *  user (issue #307 acceptance 9). */
    clear: () =>
      write(async () => {
        backend.hydrate(emptySharedPrices());
      }),
    async getRange(key: PriceKey, from?: string, to?: string) {
      await load();
      return backend.store.getRange(key, from, to);
    },
    async getRanges(keys) {
      await load();
      return backend.store.getRanges(keys);
    },
    async lastDate(key) {
      await load();
      return backend.store.lastDate(key);
    },
    upsert: (instrumentKey, bars) => write(() => backend.store.upsert(instrumentKey, bars)),
    replaceRange: (instrumentKey, bars, from, to) =>
      write(() => backend.store.replaceRange(instrumentKey, bars, from, to)),
    async getCoverage(key: PriceKey): Promise<SharedPriceCoverage | null> {
      await load();
      return backend.store.getCoverage(key);
    },
    putCoverage: (instrumentKey, coverage) =>
      write(() => backend.store.putCoverage(instrumentKey, coverage)),
    latestChange: (keys) => backend.store.latestChange(keys),
    adoptAlias: (key, alias) => write(() => backend.store.adoptAlias(key, alias)),
    claim: (key, owner, ttlMs) => backend.store.claim(key, owner, ttlMs),
    release: (key, owner) => backend.store.release(key, owner),
  };
}
