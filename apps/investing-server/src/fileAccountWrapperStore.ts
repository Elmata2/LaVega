import {
  validateAccountWrapperMap,
  type AccountWrapperEntry,
  type AccountWrapperStore,
} from "@lavega/core";
import { createJsonFileStore, runtimeDataFile } from "./jsonFileStore.js";

export function runtimeAccountWrapperFile(): string {
  return runtimeDataFile("INVESTING_ACCOUNT_WRAPPERS_FILE", "account-wrappers.json");
}

type WrapperRow = { tenantId: string; entries: AccountWrapperEntry[] };

function isWrapperRow(row: unknown): row is WrapperRow {
  return (
    !!row &&
    typeof row === "object" &&
    typeof (row as WrapperRow).tenantId === "string" &&
    Array.isArray((row as WrapperRow).entries)
  );
}

/** File-backed account tax-treatment labels for a local or self-hosted run,
 *  the same shape as the layout store. The map is validated on read and on
 *  write, so a hand-edited file can only drop labels, never invent one. */
export function createFileAccountWrapperStore(
  filePath = runtimeAccountWrapperFile(),
): AccountWrapperStore {
  const store = createJsonFileStore<WrapperRow[]>(filePath, {
    empty: [],
    validate: (contents) => {
      const parsed: unknown = JSON.parse(contents);
      if (!Array.isArray(parsed)) throw new Error("Invalid account-wrapper store");
      return parsed.map((row) => {
        if (!isWrapperRow(row)) throw new Error("Invalid account-wrapper row");
        return { tenantId: row.tenantId, entries: validateAccountWrapperMap(row.entries) };
      });
    },
  });
  return {
    async get(tenantId) {
      const row = (await store.read()).find((entry) => entry.tenantId === tenantId);
      return row ? validateAccountWrapperMap(row.entries) : [];
    },
    async set(selection) {
      const normalized: WrapperRow = {
        tenantId: selection.tenantId,
        entries: validateAccountWrapperMap(selection.entries),
      };
      await store.update((rows) => [
        ...rows.filter((row) => row.tenantId !== selection.tenantId),
        normalized,
      ]);
    },
  };
}
