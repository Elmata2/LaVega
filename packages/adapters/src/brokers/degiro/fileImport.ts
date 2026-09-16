import { parseBrokerFile, type Position, type TradeWithoutId } from "@lavega/core";
import { type BrokerResult } from "../BrokerAccessAdapter.js";

export type DeGiroFileImport = {
  load(input: { filename: string; text: string; entity: string }): Promise<BrokerResult>;
};

export function createDeGiroFileImport(): DeGiroFileImport {
  return {
    async load({ filename, text, entity }) {
      const parsed = parseBrokerFile(filename, text);
<<<<<<< HEAD
      // A DeGiro file is one account's export, so every row it carries shares
      // an ownership identity with the rest of that broker's data.
      const trades: TradeWithoutId[] = parsed.trades.map((trade) => ({
        ...trade,
        entity,
        broker: "degiro",
      }));
      const positions: Position[] = parsed.positions.map((position) => ({
        ...position,
        entity,
        broker: "degiro",
      }));
      return { positions, trades, source: parsed.source, problems: parsed.problems };
=======
      const trades: TradeWithoutId[] = parsed.trades.map((trade) => ({ ...trade, entity }));
      const positions: Position[] = parsed.positions.map((position) => ({ ...position, entity }));
      const status = parsed.problems.length > 0 ? "partial" : "complete";
      return {
        sections: {
          positions: { status, rows: positions },
          trades: { status, rows: trades },
          dividends: { status: "complete", rows: [] },
          cashBalances: { status: "complete", rows: [] },
          cashFlows: { status: "complete", rows: [] },
        },
        source: parsed.source,
        problems: parsed.problems,
      };
>>>>>>> 918cf78 (fix(brokers): preserve last-good snapshots)
    },
  };
}
