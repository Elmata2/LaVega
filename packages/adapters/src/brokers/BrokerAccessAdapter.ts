import type { Dividend, Position, Trade } from "@lavega/core";

export type BrokerResult = {
  positions: Position[];
  trades: Omit<Trade, "id">[];
  /** Optional until each broker adapter maps its dividend records. */
  dividends?: Dividend[];
  source: string;
  problems: string[];
};

export interface BrokerAccessAdapter {
  sync(input: { entity: string }): Promise<BrokerResult>;
}
