import {
  validateInvestingLayout,
  type InvestingLayout,
  type InvestingLayoutSelection,
  type InvestingLayoutStore,
} from "@lavega/core";

export function createInMemoryInvestingLayoutStore(
  initial: InvestingLayoutSelection[] = [],
): InvestingLayoutStore {
  const rows = new Map<string, InvestingLayout>(
    initial.map((selection) => [
      selection.tenantId,
      validateInvestingLayout(selection),
    ]),
  );
  return {
    async get(tenantId) {
      const layout = rows.get(tenantId);
      return layout ? structuredClone(layout) : { modules: {}, widgets: {} };
    },
    async set(selection) {
      rows.set(selection.tenantId, validateInvestingLayout(selection));
    },
  };
}
