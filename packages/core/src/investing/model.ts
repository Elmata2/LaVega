/** A broker-reported holding at statement time. Monetary values use the
 * instrument currency and quantities use broker units. */
export type Position = {
  tenantId: string;
  entity: string;
  symbol: string;
  isin?: string;
  description?: string;
  quantity: number;
  averagePrice: number | null;
  marketPrice: number | null;
  marketValue: number | null;
  currency: string;
  asOf: string;
};

/** Daily closing price used by investing-side portfolio calculations. */
export type PriceBar = {
  tenantId: string;
  symbol: string;
  date: string;
  close: number;
  currency: string;
};

/** Broker-reported cash anchor. Amount uses the recorded currency. */
export type CashBalance = {
  tenantId: string;
  entity: string;
  broker: string;
  currency: string;
  amount: number;
  asOf: string;
};

export type CashFlowKind = "deposit" | "withdrawal" | "interest" | "fee" | "other";

/** Signed broker cash movement. Positive means cash in; negative means cash out. */
export type CashFlow = {
  id: string;
  tenantId: string;
  entity: string;
  broker: string;
  date: string;
  currency: string;
  amount: number;
  kind: CashFlowKind;
  description?: string;
  brokerFlowId?: string;
};

export type TradeSide = "buy" | "sell" | "other";

/** A broker-reported execution. `amount` and `commission` use currency. */
export type Trade = {
  id: string;
  tenantId: string;
  entity: string;
  date: string;
  symbol: string;
  isin?: string;
  description?: string;
  side: TradeSide;
  quantity: number;
  price: number | null;
  amount: number | null;
  currency: string;
  commission: number | null;
  brokerTradeId?: string;
};
