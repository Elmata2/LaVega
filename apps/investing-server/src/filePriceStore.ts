import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { PriceStore } from "@lavega/adapters";
import type { PriceBar } from "@lavega/core";

type StoredPriceBar = PriceBar;

function isPriceBar(value: unknown): value is StoredPriceBar {
  if (!value || typeof value !== "object") return false;
  const bar = value as Partial<StoredPriceBar>;
  return typeof bar.tenantId === "string"
    && typeof bar.symbol === "string"
    && typeof bar.date === "string"
    && Number.isFinite(bar.close)
    && typeof bar.currency === "string";
}

async function readRows(filePath: string): Promise<StoredPriceBar[]> {
  try {
    const contents = await readFile(filePath, "utf8");
    const parsed: unknown = JSON.parse(contents);
    if (!Array.isArray(parsed) || !parsed.every(isPriceBar)) throw new Error(`Invalid price cache file: ${filePath}`);
    return parsed;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return [];
    throw error;
  }
}

/** Persistent local PriceStore for the Docker runtime. The browser tier uses IndexedDB. */
export function createFilePriceStore(filePath: string): PriceStore {
  let writeQueue = Promise.resolve();
  const key = (bar: Pick<PriceBar, "tenantId" | "symbol" | "date">) => `${bar.tenantId}\u0000${bar.symbol}\u0000${bar.date}`;

  const writeRows = async (rows: StoredPriceBar[]) => {
    await mkdir(dirname(filePath), { recursive: true });
    const temporaryPath = `${filePath}.tmp`;
    await writeFile(temporaryPath, JSON.stringify(rows), "utf8");
    await rename(temporaryPath, filePath);
  };

  const queueWrite = <T>(operation: () => Promise<T>): Promise<T> => {
    const result = writeQueue.then(operation);
    writeQueue = result.then(() => undefined, () => undefined);
    return result;
  };

  return {
    async getRange(symbol, from, to) {
      return (await readRows(filePath))
        .filter((bar) => bar.symbol === symbol && bar.date >= from && bar.date <= to)
        .sort((left, right) => left.date.localeCompare(right.date));
    },
    async lastDate(symbol) {
      const rows = (await readRows(filePath)).filter((bar) => bar.symbol === symbol).sort((left, right) => left.date.localeCompare(right.date));
      return rows.at(-1)?.date ?? null;
    },
    async upsert(bars) {
      if (bars.length === 0) return;
      await queueWrite(async () => {
        const rows = await readRows(filePath);
        const byKey = new Map(rows.map((bar) => [key(bar), bar]));
        for (const bar of bars) byKey.set(key(bar), bar);
        await writeRows([...byKey.values()].sort((left, right) => `${left.symbol}\u0000${left.date}`.localeCompare(`${right.symbol}\u0000${right.date}`)));
      });
    },
    async purgeAll() {
      await queueWrite(() => writeRows([]));
    },
  };
}
