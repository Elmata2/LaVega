import { join } from "node:path";
import type { PriceStore } from "@lavega/adapters";
import type { PriceBar } from "@lavega/core";
import { createJsonFileStore, runtimeDataFile } from "./jsonFileStore.js";

type StoredPriceBar = PriceBar;

export function runtimePriceStoreFile(): string {
  return runtimeDataFile("INVESTING_PRICE_STORE_FILE", "prices.json");
}

function isPriceBar(value: unknown): value is StoredPriceBar {
  if (!value || typeof value !== "object") return false;
  const bar = value as Partial<StoredPriceBar>;
  return typeof bar.tenantId === "string"
    && typeof bar.symbol === "string"
    && typeof bar.date === "string"
    && Number.isFinite(bar.close)
    && typeof bar.currency === "string";
}

/** Persistent local PriceStore for the Docker runtime. The browser tier uses IndexedDB. */
export function createFilePriceStore(filePath: string): PriceStore {
  const store = createJsonFileStore<StoredPriceBar[]>(filePath, {
    empty: [],
    validate: (contents) => {
      const parsed: unknown = JSON.parse(contents);
      if (!Array.isArray(parsed) || !parsed.every(isPriceBar)) throw new Error(`Invalid price cache file: ${filePath}`);
      return parsed;
    },
  });
  const key = (bar: Pick<PriceBar, "tenantId" | "symbol" | "date">) => `${bar.tenantId}\u0000${bar.symbol}\u0000${bar.date}`;

  // ponytail: tenant+symbol index over the parse-cached array; rebuilds on update.
  let index: Map<string, StoredPriceBar[]> | null = null;
  const symbolIndex = async (): Promise<Map<string, StoredPriceBar[]>> => {
    if (index) return index;
    const map = new Map<string, StoredPriceBar[]>();
    for (const bar of await store.read()) {
      const listKey = `${bar.tenantId}\u0000${bar.symbol}`;
      const list = map.get(listKey);
      if (list) list.push(bar);
      else map.set(listKey, [bar]);
    }
    for (const list of map.values()) list.sort((left, right) => left.date.localeCompare(right.date));
    index = map;
    return map;
  };

  return {
    async getRange(tenantId, symbol, from, to) {
      return (await symbolIndex()).get(`${tenantId}\u0000${symbol}`)?.filter((bar) => bar.date >= from && bar.date <= to) ?? [];
    },
    async lastDate(tenantId, symbol) {
      return (await symbolIndex()).get(`${tenantId}\u0000${symbol}`)?.at(-1)?.date ?? null;
    },
    async upsert(bars) {
      if (bars.length === 0) return;
      await store.update((rows) => {
        const byKey = new Map(rows.map((bar) => [key(bar), bar]));
        for (const bar of bars) byKey.set(key(bar), bar);
        index = null;
        return [...byKey.values()].sort((left, right) => `${left.symbol}\u0000${left.date}`.localeCompare(`${right.symbol}\u0000${right.date}`));
      });
    },
    async purgeAll() {
      index = null;
      await store.update(() => []);
    },
  };
}
