/* JSON-file implementation of the cash-flow rule/suggestion store for the
 * Docker/local tier (no database). The request-path module stays free of Node
 * builtins; only the runtime entry point imports this file. */
import type { CashFlowRule, CashFlowSuggestion } from "@lavega/core";
import { createJsonFileStore, runtimeDataFile } from "./jsonFileStore.js";
import type { CashFlowStore } from "./cashFlowSuggestions.js";

export function runtimeCashFlowStoreFile(): string {
  return runtimeDataFile("INVESTING_CASH_FLOW_STORE_FILE", "cash-flow.json");
}

type CashFlowFile = {
  rules: CashFlowRule[];
  suggestions: CashFlowSuggestion[];
  enabled: boolean;
};

const empty: CashFlowFile = { rules: [], suggestions: [], enabled: false };

export function createFileCashFlowStore(filePath: string): CashFlowStore {
  const store = createJsonFileStore<CashFlowFile>(filePath, {
    empty,
    validate: (contents) => {
      try {
        const parsed = JSON.parse(contents) as Partial<CashFlowFile>;
        return {
          rules: Array.isArray(parsed.rules) ? parsed.rules : [],
          suggestions: Array.isArray(parsed.suggestions) ? parsed.suggestions : [],
          enabled: parsed.enabled === true,
        };
      } catch {
        return structuredClone(empty);
      }
    },
  });
  return {
    async listSuggestions() {
      return (await store.read()).suggestions;
    },
    saveSuggestions: (suggestions) =>
      store.update((current) => ({ ...current, suggestions: [...suggestions] })),
    async listRules() {
      return (await store.read()).rules;
    },
    saveRules: (rules) => store.update((current) => ({ ...current, rules: [...rules] })),
    async suggestionsEnabled() {
      return (await store.read()).enabled;
    },
    setSuggestionsEnabled: (enabled) => store.update((current) => ({ ...current, enabled })),
  };
}
