import { openDB } from "idb";
import { validateBenchmarkSymbols, type BenchmarkSelectionStore } from "@lavega/core";

const STORE_NAME = "selection";

/** Browser-local selection store. Exactly one row per tenant. */
export function createIndexedDbBenchmarkSelectionStore(
  dbName = "lavega-investing-benchmarks",
): BenchmarkSelectionStore {
  const open = () =>
    openDB(dbName, 1, {
      upgrade(db) {
        if (!db.objectStoreNames.contains(STORE_NAME))
          db.createObjectStore(STORE_NAME, { keyPath: "tenantId" });
      },
    });
  return {
    async get(tenantId) {
      const db = await open();
      const row = (await db.get(STORE_NAME, tenantId)) as
        | { tenantId: string; symbols: string[] }
        | undefined;
      db.close();
      return row ?? { tenantId, symbols: [] };
    },
    async set(selection) {
      const db = await open();
      await db.put(STORE_NAME, {
        tenantId: selection.tenantId,
        symbols: validateBenchmarkSymbols(selection.symbols),
      });
      db.close();
    },
  };
}
