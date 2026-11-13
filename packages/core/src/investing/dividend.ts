/** A broker-reported dividend event. Dividends are not trades: they have no side or execution quantity. */
export type Dividend = {
  id: string;
  entity: string;
  broker: string;
  /** Which account at that broker, when the broker distinguishes several. */
  account?: string;
  date: string;
  symbol: string;
  isin?: string;
  description?: string;
  amount: number;
  currency: string;
  /** Tax the broker withheld on this dividend, in `currency` and already netted out of `amount`.
   *  Positive means tax was taken, negative means it was refunded. Gross = amount + withholdingTax.
   *  Absent when the broker reported no tax line: zero and absent are different facts. */
  withholdingTax?: number;
  brokerDividendId?: string;
};
