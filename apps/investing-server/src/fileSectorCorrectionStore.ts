import type { SectorCorrectionStore } from "./sectorCorrectionStore.js";
import { createJsonFileStore, runtimeDataFile } from "./jsonFileStore.js";

export function runtimeSectorCorrectionFile(): string {
  return runtimeDataFile("INVESTING_SECTOR_CORRECTIONS_FILE", "sector-corrections.json");
}

type CorrectionRow = { tenantId: string; symbol: string; sector: string };

function isCorrectionRow(row: unknown): row is CorrectionRow {
  return (
    !!row &&
    typeof row === "object" &&
    typeof (row as CorrectionRow).tenantId === "string" &&
    typeof (row as CorrectionRow).symbol === "string" &&
    typeof (row as CorrectionRow).sector === "string"
  );
}

export function createFileSectorCorrectionStore(
  filePath = runtimeSectorCorrectionFile(),
): SectorCorrectionStore {
  const store = createJsonFileStore<CorrectionRow[]>(filePath, {
    empty: [],
    validate: (contents) => {
      const parsed: unknown = JSON.parse(contents);
      if (!Array.isArray(parsed)) throw new Error("Invalid sector-correction store");
      return parsed.map((row) => {
        if (!isCorrectionRow(row)) throw new Error("Invalid sector-correction row");
        return row;
      });
    },
  });
  const key = (symbol: string) => symbol.toUpperCase();
  return {
    async get(tenantId, symbol) {
      const rows = await store.read();
      return (
        rows.find((row) => row.tenantId === tenantId && row.symbol === key(symbol))?.sector ??
        null
      );
    },
    async set(tenantId, symbol, sector) {
      await store.update((rows) => [
        ...rows.filter((row) => !(row.tenantId === tenantId && row.symbol === key(symbol))),
        { tenantId, symbol: key(symbol), sector },
      ]);
    },
    async clear(tenantId, symbol) {
      await store.update((rows) =>
        rows.filter((row) => !(row.tenantId === tenantId && row.symbol === key(symbol))),
      );
    },
  };
}
