/** A broker-reported holding at statement time. Monetary values use the
 * instrument currency and quantities use broker units. */
export type Position = {
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

export type TradeSide = "buy" | "sell" | "other";

/** A broker-reported execution. `amount` and `commission` use currency. */
export type Trade = {
  id: string;
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
