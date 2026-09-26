export type BrokerCost =
  | { status: "known"; amount: number; currency: string }
  | { status: "unknown"; reason: "not-reported" | "legacy-denomination" };

/** A broker-reported holding at statement time. `averagePrice`, market values,
 * and quantities use instrument units. `brokerCost` carries its own currency. */
export type Position = {
  entity: string;
  /** Which broker reported this holding. Optional because snapshots persisted
   *  before provenance existed carry none; see `ownershipKey`. */
  broker?: string;
  /** Which account at that broker, when the broker distinguishes several. */
  account?: string;
  symbol: string;
  isin?: string;
  description?: string;
  quantity: number;
  brokerCost?: BrokerCost;
  averagePrice: number | null;
  marketPrice: number | null;
  marketValue: number | null;
  currency: string;
  asOf: string;
};

/** Daily closing price used by investing-side portfolio calculations. Closes
 *  are split-adjusted: every bar is in today's share units. */
export type PriceBar = {
  symbol: string;
  date: string;
  close: number;
  currency: string;
  /** Shares after per share before for a split taking effect at this
   *  session's open; 1 when none. Absent on bars stored before splits were
   *  recorded, which makes them stale. */
  split?: number;
};

/** Broker-reported cash anchor. Amount uses the recorded currency. */
export type CashBalance = {
  entity: string;
  broker: string;
  currency: string;
  amount: number;
  asOf: string;
};

export type CashFlowKind = "deposit" | "withdrawal" | "interest" | "fee" | "other";

/** Signed broker cash movement. Positive means cash in; negative means cash
 *  out. Null means the movement happened but its size or direction is not
 *  known; callers must treat the period as unmeasurable, never guess a sign. */
export type CashFlow = {
  id: string;
  entity: string;
  broker: string;
  date: string;
  currency: string;
  amount: number | null;
  kind: CashFlowKind;
  description?: string;
  brokerFlowId?: string;
};

/** What a broker proved about one account's cash history.
 *
 *  Complete means every cash movement from `from` through `to` is in the
 *  reported events, and `tradeCash` names the one stream that records what a
 *  trade moved: the trade's own settlement, or ledger rows among the cash
 *  flows. Counting both would double a purchase. Unknown means only a dated
 *  broker balance says what cash was; the first retained event proves nothing
 *  about movements before or between. */
export type CashHistoryCoverage = { entity: string; broker: string } & (
  | {
      status: "complete";
      from: string;
      to: string;
      tradeCash: "trade-settlement" | "cash-flows";
    }
  | { status: "unknown"; reason: string }
);

export type TradeSide = "buy" | "sell" | "other";

/** A broker-reported execution. `quantity` is a positive magnitude; `side`
 *  carries direction. `amount` and `commission` use currency. */
export type Trade = {
  id: string;
  entity: string;
  /** Which broker executed this trade. Optional for the same reason as on
   *  `Position`: persisted trades predate provenance and keep their `id`. */
  broker?: string;
  /** Which account at that broker, when the broker distinguishes several. */
  account?: string;
  date: string;
  executionAt?: string;
  symbol: string;
  isin?: string;
  description?: string;
  side: TradeSide;
  quantity: number;
  price: number | null;
  amount: number | null;
  currency: string;
  commission: number | null;
  /** Signed cash the trade moved in the account wallet, when the broker
   *  reports it (negative for a buy). Absent means it settled in `currency`
   *  as amount plus commission. */
  settlement?: { currency: string; amount: number };
  brokerTradeId?: string;
};
