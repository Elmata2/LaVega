import { LOCAL_TENANT_ID, type PriceBar } from "@lavega/core";
import type { PriceStore } from "./PriceStore.js";

type StoredPriceBar = PriceBar;

/** Local fake for tests; mirrors local tenant stamping used by IndexedDB. */
export function createInMemoryPriceStore(): PriceStore {
  const rows = new Map<string, StoredPriceBar>();
  const key = (bar: Pick<PriceBar, "symbol" | "date">) => `${LOCAL_TENANT_ID}\u0000${bar.symbol}\u0000${bar.date}`;
  const localRows = (symbol: string) => [...rows.values()].filter((row) => row.tenantId === LOCAL_TENANT_ID && row.symbol === symbol);

  return {
    async getRange(symbol, from, to) {
      return localRows(symbol)
        .filter((row) => row.date >= from && row.date <= to)
        .sort((a, b) => a.date.localeCompare(b.date))
        .map((bar) => bar);
    },
    async lastDate(symbol) {
      const dates = localRows(symbol).map((row) => row.date).sort();
      return dates.at(-1) ?? null;
    },
    async upsert(bars) {
      for (const bar of bars) rows.set(key(bar), { ...bar, tenantId: LOCAL_TENANT_ID });
    },
    async purgeAll() {
      rows.clear();
    },
  };
}
