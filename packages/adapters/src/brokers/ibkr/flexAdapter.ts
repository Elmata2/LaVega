import { loadFlexStatement } from "./flexStatementClient.js";
import type { FlexQueryConfig } from "./flexStatementClient.js";
import { allSections, type BrokerAccessAdapter } from "../BrokerAccessAdapter.js";
import { parseFlexStatement } from "./flexParser.js";

export function createIbkrFlexAdapter(config: FlexQueryConfig): BrokerAccessAdapter {
  return {
    async sync({ entity, deadlineMs }) {
      try {
        const xml = await loadFlexStatement({ ...config, deadlineMs });
        const parsed = parseFlexStatement(xml, entity);
        return { ...parsed, source: "ibkr-flex" };
      } catch (error) {
        return {
          sections: allSections("unavailable"),
          source: "ibkr-flex",
          problems: [error instanceof Error ? error.message : "IBKR Flex sync failed"],
        };
      }
    },
  };
}
