import type { SectorInferenceSettingStore } from "./sectorInferenceSetting.js";
import { createJsonFileStore, runtimeDataFile } from "./jsonFileStore.js";

export function runtimeSectorInferenceSettingFile(): string {
  return runtimeDataFile(
    "INVESTING_SECTOR_INFERENCE_SETTING_FILE",
    "sector-inference-setting.json",
  );
}

type SettingRow = { tenantId: string; enabled: boolean };

function isSettingRow(row: unknown): row is SettingRow {
  return (
    !!row &&
    typeof row === "object" &&
    typeof (row as SettingRow).tenantId === "string" &&
    typeof (row as SettingRow).enabled === "boolean"
  );
}

export function createFileSectorInferenceSettingStore(
  filePath = runtimeSectorInferenceSettingFile(),
): SectorInferenceSettingStore {
  const store = createJsonFileStore<SettingRow[]>(filePath, {
    empty: [],
    validate: (contents) => {
      const parsed: unknown = JSON.parse(contents);
      if (!Array.isArray(parsed)) throw new Error("Invalid sector-inference-setting store");
      return parsed.map((row) => {
        if (!isSettingRow(row)) throw new Error("Invalid sector-inference-setting row");
        return row;
      });
    },
  });
  return {
    async get(tenantId) {
      return (await store.read()).find((row) => row.tenantId === tenantId)?.enabled ?? false;
    },
    async set(tenantId, enabled) {
      await store.update((rows) => [
        ...rows.filter((row) => row.tenantId !== tenantId),
        { tenantId, enabled },
      ]);
    },
  };
}
