import type { CashBalance, CashFlow, Dividend, Position, Trade } from "@lavega/core";

/** Cursor so a later invocation can continue a history that did not finish. */
export type BrokerSyncResume = {
  ordersNextPagePath?: string | null;
  transactionsNextPagePath?: string | null;
  dividendsNextPagePath?: string | null;
  ordersComplete?: boolean;
  transactionsComplete?: boolean;
  dividendsComplete?: boolean;
};

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
   * False when the holdings endpoint failed. Callers must then keep last-good
   * positions instead of replacing them with an empty array. Defaults to true.
   */
  positionsComplete?: boolean;
  /**
   * False when the account-summary endpoint failed. Callers must then keep
   * last-good cash instead of replacing it with empty. Defaults to true.
   */
  cashBalancesComplete?: boolean;
  /**
   * ISO timestamp before which the broker refused further requests. Set only
   * when the provider rate-limited the sync, so the scheduler can hold off
   * instead of re-running the same rejected requests on the next app open.
   */
  retryAfter?: string;
  /** Present when at least one history is unfinished and the next run should continue it. */
  resume?: BrokerSyncResume;
};

export interface BrokerAccessAdapter {
  sync(input: { entity: string; resume?: BrokerSyncResume }): Promise<BrokerResult>;
}

export function tradesComplete(result: BrokerResult): boolean {
  return result.tradesComplete ?? true;
}

export function positionsComplete(result: BrokerResult): boolean {
  return result.positionsComplete ?? true;
}

export function cashBalancesComplete(result: BrokerResult): boolean {
  return result.cashBalancesComplete ?? true;
}

/** True when some history still has pages left to read. */
export function historyPending(resume: BrokerSyncResume | null | undefined): boolean {
  if (!resume) return false;
  if (resume.ordersNextPagePath || resume.transactionsNextPagePath || resume.dividendsNextPagePath) return true;
  return resume.ordersComplete !== true || resume.transactionsComplete !== true || resume.dividendsComplete !== true;
}
