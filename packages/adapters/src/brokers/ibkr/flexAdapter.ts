import { loadFlexStatement } from "./flexStatementClient.js";
import type { FlexQueryConfig } from "./flexStatementClient.js";
import type { BrokerAccessAdapter } from "../BrokerAccessAdapter.js";
import { parseFlexStatement } from "./flexParser.js";

export function createIbkrFlexAdapter(config: FlexQueryConfig): BrokerAccessAdapter {
  return {
    async sync({ entity }) {
      try {
        const xml = await loadFlexStatement(config);
        const parsed = parseFlexStatement(xml, entity);
        return { ...parsed, source: "ibkr-flex" };
      } catch (error) {
        return {
          positions: [],
          trades: [],
          source: "ibkr-flex",
          problems: [error instanceof Error ? error.message : "IBKR Flex sync failed"],
        };
      }
    },
  };
}
