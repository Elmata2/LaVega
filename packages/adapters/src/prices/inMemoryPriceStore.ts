import type { PriceBar } from "@lavega/core";
import type { PriceCoverage, PriceStore } from "./PriceStore.js";

/** Local fake for tests. Nested maps so a symbol containing the separator
 *  character cannot collide with another tenant or symbol. */
export function createInMemoryPriceStore(): PriceStore {
  const tenants = new Map<string, Map<string, Map<string, PriceBar>>>();
  const coverages = new Map<string, Map<string, PriceCoverage>>();
  const rowsFor = (tenantId: string, symbol: string) => [
    ...(tenants.get(tenantId)?.get(symbol)?.values() ?? []),
  ];

  const store: PriceStore = {
    async getRange(tenantId, symbol, from, to) {
      return rowsFor(tenantId, symbol)
        .filter(
          (row) => (from === undefined || row.date >= from) && (to === undefined || row.date <= to),
        )
        .sort((a, b) => a.date.localeCompare(b.date));
    },
    async lastDate(tenantId, symbol) {
      const dates = rowsFor(tenantId, symbol)
        .map((row) => row.date)
        .sort();
      return dates.at(-1) ?? null;
    },
    async upsert(tenantId, bars) {
      let symbols = tenants.get(tenantId);
      if (!symbols) {
        symbols = new Map();
        tenants.set(tenantId, symbols);
      }
      for (const bar of bars) {
        let dates = symbols.get(bar.symbol);
        if (!dates) {
          dates = new Map();
          symbols.set(bar.symbol, dates);
        }
        dates.set(bar.date, bar);
      }
    },
    async replaceRange(tenantId, symbol, bars, from, to) {
      const dates = tenants.get(tenantId)?.get(symbol);
      if (dates)
        for (const date of dates.keys())
          if ((from === undefined || date >= from) && (to === undefined || date <= to))
            dates.delete(date);
      await store.upsert(tenantId, bars);
    },
    async getCoverage(tenantId, symbol) {
      return coverages.get(tenantId)?.get(symbol) ?? null;
    },
    async putCoverage(tenantId, coverage) {
      let symbols = coverages.get(tenantId);
      if (!symbols) {
        symbols = new Map();
        coverages.set(tenantId, symbols);
      }
      symbols.set(coverage.symbol, coverage);
    },
    async purgeAll() {
      tenants.clear();
      coverages.clear();
    },
  };
  return store;
}
