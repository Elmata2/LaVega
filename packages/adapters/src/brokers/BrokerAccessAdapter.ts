import type { CashBalance, CashFlow, Dividend, Position, Trade } from "@lavega/core";

export type BrokerResult = {
  positions: Position[];
  trades: Omit<Trade, "id">[];
  /** Optional until each broker adapter maps its dividend records. */
  dividends?: Dividend[];
  cashBalances?: CashBalance[];
  cashFlows?: CashFlow[];
  source: string;
  problems: string[];
  /**
   * False when the trade history could not be fully read (pagination failed
   * mid-chain). Callers must then keep their existing trades instead of
   * overwriting them with a truncated set. Defaults to true (complete).
   */
  tradesComplete?: boolean;
  /**
   * ISO timestamp before which the broker refused further requests. Set only
   * when the provider rate-limited the sync, so the scheduler can hold off
   * instead of re-running the same rejected requests on the next app open.
   */
  retryAfter?: string;
};

export interface BrokerAccessAdapter {
  sync(input: { entity: string }): Promise<BrokerResult>;
}

export function tradesComplete(result: BrokerResult): boolean {
  return result.tradesComplete ?? true;
}
