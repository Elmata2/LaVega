import type { PriceBar } from "@lavega/core";
import type { PriceStore } from "./PriceStore.js";

/** Local fake for tests. Nested maps so a symbol containing the separator
 *  character cannot collide with another tenant or symbol. */
export function createInMemoryPriceStore(): PriceStore {
  const tenants = new Map<string, Map<string, Map<string, PriceBar>>>();
  const rowsFor = (tenantId: string, symbol: string) => [
    ...(tenants.get(tenantId)?.get(symbol)?.values() ?? []),
  ];

  return {
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
    async purgeAll() {
      tenants.clear();
    },
  };
}
