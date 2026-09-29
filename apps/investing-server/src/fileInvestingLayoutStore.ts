import {
  validateInvestingLayout,
  type InvestingLayoutSelection,
  type InvestingLayoutStore,
} from "@lavega/core";
import { createJsonFileStore, runtimeDataFile } from "./jsonFileStore.js";

export function runtimeInvestingLayoutFile(): string {
  return runtimeDataFile("INVESTING_LAYOUT_STORE_FILE", "layout.json");
}

export function createFileInvestingLayoutStore(filePath: string): InvestingLayoutStore {
  const store = createJsonFileStore<InvestingLayoutSelection[]>(filePath, {
    empty: [],
    validate: (contents) => {
      const parsed: unknown = JSON.parse(contents);
      if (!Array.isArray(parsed)) throw new Error("Invalid investing layout store");
      return parsed.map((row) => {
        if (
          !row ||
          typeof row !== "object" ||
          typeof (row as { tenantId?: unknown }).tenantId !== "string"
        )
          throw new Error("Invalid investing layout row");
        const selection = row as InvestingLayoutSelection;
        return { tenantId: selection.tenantId, ...validateInvestingLayout(selection) };
      });
    },
  });
  return {
    async get(tenantId) {
      const row = (await store.read()).find((selection) => selection.tenantId === tenantId);
      return row ? { modules: row.modules, widgets: row.widgets } : { modules: {}, widgets: {} };
    },
    async set(selection) {
      const normalized: InvestingLayoutSelection = {
        tenantId: selection.tenantId,
        ...validateInvestingLayout(selection),
      };
      await store.update((rows) => [
        ...rows.filter((row) => row.tenantId !== selection.tenantId),
        normalized,
      ]);
    },
  };
}
