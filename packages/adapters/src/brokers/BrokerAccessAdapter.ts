import type { Position, Trade } from "@lavega/core";

export type BrokerResult = {
  positions: Position[];
  trades: Omit<Trade, "id">[];
  source: string;
  problems: string[];
};

export interface BrokerAccessAdapter {
  sync(input: { entity: string }): Promise<BrokerResult>;
}
