import {
  validateIdentifierOverrides,
  type IdentifierOverrideMap,
  type IdentifierOverrideStore,
  type IdentifierSelectionSettingStore,
} from "./identifierSelectionStore.js";
import { createJsonFileStore, runtimeDataFile } from "./jsonFileStore.js";

export function runtimeIdentifierSelectionSettingFile(): string {
  return runtimeDataFile(
    "INVESTING_IDENTIFIER_SELECTION_SETTING_FILE",
    "identifier-selection-setting.json",
  );
}

export function runtimeIdentifierOverrideFile(): string {
  return runtimeDataFile("INVESTING_IDENTIFIER_OVERRIDE_FILE", "identifier-overrides.json");
}

type SettingRow = { tenantId: string; enabled: boolean };
type OverrideRow = { tenantId: string; overrides: IdentifierOverrideMap };

const isSettingRow = (row: unknown): row is SettingRow =>
  !!row &&
  typeof row === "object" &&
  typeof (row as SettingRow).tenantId === "string" &&
  typeof (row as SettingRow).enabled === "boolean";

const isOverrideRow = (row: unknown): row is OverrideRow =>
  !!row && typeof row === "object" && typeof (row as OverrideRow).tenantId === "string";

export function createFileIdentifierSelectionSettingStore(
  filePath = runtimeIdentifierSelectionSettingFile(),
): IdentifierSelectionSettingStore {
  const store = createJsonFileStore<SettingRow[]>(filePath, {
    empty: [],
    validate: (contents) => {
      const parsed: unknown = JSON.parse(contents);
      if (!Array.isArray(parsed)) throw new Error("Invalid identifier-selection-setting store");
      return parsed.map((row) => {
        if (!isSettingRow(row)) throw new Error("Invalid identifier-selection-setting row");
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

export function createFileIdentifierOverrideStore(
  filePath = runtimeIdentifierOverrideFile(),
): IdentifierOverrideStore {
  const store = createJsonFileStore<OverrideRow[]>(filePath, {
    empty: [],
    validate: (contents) => {
      const parsed: unknown = JSON.parse(contents);
      if (!Array.isArray(parsed)) throw new Error("Invalid identifier-override store");
      return parsed.map((row) => {
        if (!isOverrideRow(row)) throw new Error("Invalid identifier-override row");
        return { tenantId: row.tenantId, overrides: validateIdentifierOverrides(row.overrides) };
      });
    },
  });
  return {
    async get(tenantId) {
      const row = (await store.read()).find((entry) => entry.tenantId === tenantId);
      return validateIdentifierOverrides(row?.overrides);
    },
    async set(tenantId, map) {
      const normalized: OverrideRow = {
        tenantId,
        overrides: validateIdentifierOverrides(map),
      };
      await store.update((rows) => [
        ...rows.filter((row) => row.tenantId !== tenantId),
        normalized,
      ]);
    },
  };
}
