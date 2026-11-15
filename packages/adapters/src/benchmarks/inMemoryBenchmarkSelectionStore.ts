import {
  validateBenchmarkSymbols,
  type BenchmarkSelection,
  type BenchmarkSelectionStore,
} from "@lavega/core";

export function createInMemoryBenchmarkSelectionStore(
  initial: BenchmarkSelection[] = [],
): BenchmarkSelectionStore {
  const rows = new Map(
    initial.map((selection) => [
      selection.tenantId,
      { ...selection, symbols: validateBenchmarkSymbols(selection.symbols) },
    ]),
  );
  return {
    async get(tenantId) {
      const selection = rows.get(tenantId);
      return selection ? structuredClone(selection) : { tenantId, symbols: [] };
    },
    async set(selection) {
      rows.set(selection.tenantId, {
        tenantId: selection.tenantId,
        symbols: validateBenchmarkSymbols(selection.symbols),
      });
    },
  };
}
