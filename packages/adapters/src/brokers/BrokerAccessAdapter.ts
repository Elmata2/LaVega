import type {
  CashBalance,
  CashFlow,
  CashHistoryCoverage,
  Dividend,
  Position,
  Trade,
} from "@lavega/core";

/** Cursor so a later invocation can continue a history that did not finish. */
export type BrokerSyncResume = {
  ordersNextPagePath?: string | null;
  transactionsNextPagePath?: string | null;
  dividendsNextPagePath?: string | null;
  ordersComplete?: boolean;
  transactionsComplete?: boolean;
  dividendsComplete?: boolean;
};

export type BrokerSyncRequest = {
  entity: string;
  resume?: BrokerSyncResume;
  /** Absolute Unix time. Undefined keeps local sync unlimited. */
  deadlineMs?: number;
};

/** Leave time for snapshot and cursor persistence before the host stops the request. */
export const BROKER_SYNC_PERSISTENCE_MARGIN_MS = 5_000;

export function hasBrokerSyncTime(
  deadlineMs: number | undefined,
  workMs = 0,
  now = Date.now(),
): boolean {
  return deadlineMs === undefined || deadlineMs - now - BROKER_SYNC_PERSISTENCE_MARGIN_MS > workMs;
}

export type BrokerSectionStatus = "complete" | "partial" | "unavailable";

export type BrokerSection<T> = {
  status: BrokerSectionStatus;
  rows: T[];
};

export type BrokerSections = {
  positions: BrokerSection<Position>;
  trades: BrokerSection<Omit<Trade, "id">>;
  dividends: BrokerSection<Dividend>;
  cashBalances: BrokerSection<CashBalance>;
  cashFlows: BrokerSection<CashFlow>;
};

export type BrokerResult = {
  sections: BrokerSections;
  /** What these sections prove about past cash. Absent means unknown. */
  cashHistory?: CashHistoryCoverage;
  historyMode?: "snapshot" | "incremental";
  source: string;
  problems: string[];
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
  sync(input: BrokerSyncRequest): Promise<BrokerResult>;
}

/** True when some history still has pages left to read. */
export function historyPending(resume: BrokerSyncResume | null | undefined): boolean {
  if (!resume) return false;
  if (resume.ordersNextPagePath || resume.transactionsNextPagePath || resume.dividendsNextPagePath)
    return true;
  return (
    resume.ordersComplete !== true ||
    resume.transactionsComplete !== true ||
    resume.dividendsComplete !== true
  );
}

export function allSections(status: BrokerSectionStatus): BrokerSections {
  return {
    positions: { status, rows: [] },
    trades: { status, rows: [] },
    dividends: { status, rows: [] },
    cashBalances: { status, rows: [] },
    cashFlows: { status, rows: [] },
  };
}
