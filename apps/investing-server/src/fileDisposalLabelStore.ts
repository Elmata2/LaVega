import {
  validateDisposalLabels,
  type DisposalLabelEntry,
  type DisposalLabelStore,
} from "@lavega/core";
import { createJsonFileStore, runtimeDataFile } from "./jsonFileStore.js";

export function runtimeDisposalLabelFile(): string {
  return runtimeDataFile("INVESTING_DISPOSAL_LABELS_FILE", "disposal-labels.json");
}

type DisposalLabelRow = { tenantId: string; entries: DisposalLabelEntry[] };

function isDisposalLabelRow(row: unknown): row is DisposalLabelRow {
  return (
    !!row &&
    typeof row === "object" &&
    typeof (row as DisposalLabelRow).tenantId === "string" &&
    Array.isArray((row as DisposalLabelRow).entries)
  );
}

/** File-backed disposal labels for a local or self-hosted run. The list is
 *  validated on read and on write, so a hand-edited file can only drop
 *  invalid entries, never invent a category. */
export function createFileDisposalLabelStore(
  filePath = runtimeDisposalLabelFile(),
): DisposalLabelStore {
  const store = createJsonFileStore<DisposalLabelRow[]>(filePath, {
    empty: [],
    validate: (contents) => {
      const parsed: unknown = JSON.parse(contents);
      if (!Array.isArray(parsed)) throw new Error("Invalid disposal-label store");
      return parsed.map((row) => {
        if (!isDisposalLabelRow(row)) throw new Error("Invalid disposal-label row");
        return { tenantId: row.tenantId, entries: validateDisposalLabels(row.entries) };
      });
    },
  });
  return {
    async get(tenantId) {
      const row = (await store.read()).find((entry) => entry.tenantId === tenantId);
      return row ? validateDisposalLabels(row.entries) : [];
    },
    async set(selection) {
      const normalized: DisposalLabelRow = {
        tenantId: selection.tenantId,
        entries: validateDisposalLabels(selection.entries),
      };
      await store.update((rows) => [
        ...rows.filter((row) => row.tenantId !== selection.tenantId),
        normalized,
      ]);
    },
  };
}
