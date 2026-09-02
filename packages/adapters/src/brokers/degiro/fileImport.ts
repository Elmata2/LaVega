import { parseBrokerFile, type Position, type TradeWithoutId } from "@lavega/core";
import type { BrokerResult } from "../BrokerAccessAdapter.js";

export type DeGiroFileImport = {
  load(input: { filename: string; text: string; entity: string }): Promise<BrokerResult>;
};

export function createDeGiroFileImport(): DeGiroFileImport {
  return {
    async load({ filename, text, entity }) {
      const parsed = parseBrokerFile(filename, text);
      const trades: TradeWithoutId[] = parsed.trades.map((trade) => ({ ...trade, entity }));
      const positions: Position[] = parsed.positions.map((position) => ({ ...position, entity }));
      return { positions, trades, source: parsed.source, problems: parsed.problems };
    },
  };
}
