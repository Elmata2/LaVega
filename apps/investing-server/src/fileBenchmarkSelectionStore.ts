import { validateBenchmarkSymbols, type BenchmarkSelection, type BenchmarkSelectionStore } from "@lavega/core";
import { createJsonFileStore, runtimeDataFile } from "./jsonFileStore.js";

export function runtimeBenchmarkSelectionFile(): string {
  return runtimeDataFile("INVESTING_BENCHMARK_STORE_FILE", "benchmarks.json");
}

export function createFileBenchmarkSelectionStore(filePath: string): BenchmarkSelectionStore {
  const store = createJsonFileStore<BenchmarkSelection[]>(filePath, {
    empty: [],
    validate: (contents) => {
      const parsed: unknown = JSON.parse(contents);
      if (!Array.isArray(parsed)) throw new Error("Invalid benchmark selection store");
      return parsed.map((row) => {
        if (!row || typeof row !== "object" || typeof (row as BenchmarkSelection).tenantId !== "string" || !Array.isArray((row as BenchmarkSelection).symbols)) throw new Error("Invalid benchmark selection row");
        const selection = row as BenchmarkSelection;
        return { tenantId: selection.tenantId, symbols: validateBenchmarkSymbols(selection.symbols) };
      });
    },
  });
  return {
    async get(tenantId) {
      return (await store.read()).find((row) => row.tenantId === tenantId) ?? { tenantId, symbols: [] };
    },
    async set(selection) {
      const normalized = { tenantId: selection.tenantId, symbols: validateBenchmarkSymbols(selection.symbols) };
      await store.update((rows) => [...rows.filter((row) => row.tenantId !== selection.tenantId), normalized]);
    },
  };
}
