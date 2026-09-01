import type { PriceBar } from "@lavega/core";
import type { PriceStore } from "./PriceStore.js";

type StoredPriceBar = PriceBar;

/** Local fake for tests; keys and filters on the tenant carried by each bar. */
export function createInMemoryPriceStore(): PriceStore {
  const rows = new Map<string, StoredPriceBar>();
  const key = (bar: Pick<PriceBar, "tenantId" | "symbol" | "date">) => `${bar.tenantId}\u0000${bar.symbol}\u0000${bar.date}`;
  const rowsFor = (tenantId: string, symbol: string) => [...rows.values()].filter((row) => row.tenantId === tenantId && row.symbol === symbol);

  return {
    async getRange(tenantId, symbol, from, to) {
      return rowsFor(tenantId, symbol)
        .filter((row) => (from === undefined || row.date >= from) && (to === undefined || row.date <= to))
        .sort((a, b) => a.date.localeCompare(b.date));
    },
    async lastDate(tenantId, symbol) {
      const dates = rowsFor(tenantId, symbol).map((row) => row.date).sort();
      return dates.at(-1) ?? null;
    },
    async upsert(bars) {
      for (const bar of bars) rows.set(key(bar), bar);
    },
    async purgeAll() {
      rows.clear();
    },
  };
}
