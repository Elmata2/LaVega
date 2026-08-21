import { existsSync } from "node:fs";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { validateBenchmarkSymbols, type BenchmarkSelection, type BenchmarkSelectionStore } from "@lavega/core";

export function runtimeBenchmarkSelectionFile(): string {
  const configured = process.env.INVESTING_BENCHMARK_STORE_FILE?.trim();
  if (configured) return configured;
  return existsSync("/data") ? "/data/benchmarks.json" : join(process.cwd(), ".lavega", "benchmarks.json");
}

export function createFileBenchmarkSelectionStore(filePath: string): BenchmarkSelectionStore {
  let writeQueue = Promise.resolve();
  const readRows = async (): Promise<BenchmarkSelection[]> => {
    try {
      const parsed: unknown = JSON.parse(await readFile(filePath, "utf8"));
      if (!Array.isArray(parsed)) throw new Error("Invalid benchmark selection store");
      return parsed.map((row) => {
        if (!row || typeof row !== "object" || typeof (row as BenchmarkSelection).tenantId !== "string" || !Array.isArray((row as BenchmarkSelection).symbols)) throw new Error("Invalid benchmark selection row");
        const selection = row as BenchmarkSelection;
        return { tenantId: selection.tenantId, symbols: validateBenchmarkSymbols(selection.symbols) };
      });
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") return [];
      throw error;
    }
  };
  return {
    async get(tenantId) {
      return (await readRows()).find((row) => row.tenantId === tenantId) ?? { tenantId, symbols: [] };
    },
    async set(selection) {
      const normalized = { tenantId: selection.tenantId, symbols: validateBenchmarkSymbols(selection.symbols) };
      const operation = async () => {
        const rows = (await readRows()).filter((row) => row.tenantId !== selection.tenantId);
        rows.push(normalized);
        await mkdir(dirname(filePath), { recursive: true });
        const temporary = `${filePath}.tmp`;
        await writeFile(temporary, JSON.stringify(rows), "utf8");
        await rename(temporary, filePath);
      };
      const result = writeQueue.then(operation);
      writeQueue = result.then(() => undefined, () => undefined);
      await result;
    },
  };
}
