/** A broker-reported dividend event. Dividends are not trades: they have no side or execution quantity. */
export type Dividend = {
  id: string;
  tenantId: string;
  entity: string;
  date: string;
  symbol: string;
  isin?: string;
  description?: string;
  amount: number;
  currency: string;
  brokerDividendId?: string;
};
