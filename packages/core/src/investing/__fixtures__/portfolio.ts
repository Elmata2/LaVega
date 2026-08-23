import type { FxRate } from "../../fx.js";
import type { Position, PriceBar, Trade } from "../model.js";

export const POSITIONS: Position[] = [
  { tenantId: "local", entity: "personal", symbol: "AAPL", quantity: 10, averagePrice: 100, marketPrice: 110, marketValue: 1100, currency: "USD", asOf: "2026-02-02" },
  { tenantId: "local", entity: "personal", symbol: "MSFT", quantity: 5, averagePrice: 200, marketPrice: 210, marketValue: 1050, currency: "USD", asOf: "2026-02-02" },
];

export const TRADES: Trade[] = [
  { id: "0", tenantId: "local", entity: "personal", date: "2026-01-02", symbol: "AAPL", side: "buy", quantity: 8, price: 100, amount: 800, currency: "USD", commission: 0 },
  { id: "00", tenantId: "local", entity: "personal", date: "2026-01-02", symbol: "MSFT", side: "buy", quantity: 7, price: 200, amount: 1400, currency: "USD", commission: 0 },
  { id: "a", tenantId: "local", entity: "personal", date: "2026-01-03", symbol: "AAPL", side: "buy", quantity: 2, price: 100, amount: 200, currency: "USD", commission: 0 },
  { id: "b", tenantId: "local", entity: "personal", date: "2026-01-04", symbol: "MSFT", side: "sell", quantity: 2, price: 200, amount: 400, currency: "USD", commission: 0 },
];

export const PRICE_BARS: PriceBar[] = [
  { tenantId: "local", symbol: "AAPL", date: "2026-01-02", close: 100, currency: "USD" },
  { tenantId: "local", symbol: "AAPL", date: "2026-01-05", close: 100, currency: "USD" },
  { tenantId: "local", symbol: "AAPL", date: "2026-02-02", close: 120, currency: "USD" },
  { tenantId: "local", symbol: "MSFT", date: "2026-01-02", close: 200, currency: "USD" },
  { tenantId: "local", symbol: "MSFT", date: "2026-01-05", close: 210, currency: "USD" },
  { tenantId: "local", symbol: "MSFT", date: "2026-02-02", close: 220, currency: "USD" },
];

export const FX_RATES: FxRate[] = [
  { base: "EUR", date: "2026-01-02", rates: { USD: 1 } },
  { base: "EUR", date: "2026-01-05", rates: { USD: 1.05 } },
  { base: "EUR", date: "2026-02-02", rates: { USD: 1.1 } },
];

export const BENCHMARK_BARS: PriceBar[] = [
  { tenantId: "local", symbol: "SP500", date: "2026-01-02", close: 100, currency: "EUR" },
  { tenantId: "local", symbol: "SP500", date: "2026-01-05", close: 105, currency: "EUR" },
];
