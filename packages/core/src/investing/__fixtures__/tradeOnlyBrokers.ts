import type { FxRate } from "../../fx.js";
import type { Position, PriceBar, Trade } from "../model.js";
import type { Dividend } from "../dividend.js";

/* A trade-only broker book, frozen before WS4.1 changed anything. The
 * regression gate for #295 replays these rows through the dashboard and
 * compares the whole returns payload with `dashboard-returns.golden.json`,
 * captured from the base commit. Every row here is reconstructible from
 * trades alone, so a lot-book rewrite must not move a single digit.
 *
 * Hand-checked by the fixture author:
 *  - ACME: 10 @ 100 + 2 fee at 2 USD/EUR, 2 @ 120 + 1 fee at 2.5, then a
 *    sell of 6 with a 3 fee at 2, plus a 20 USD dividend. Remaining basis
 *    298.7 EUR, realised 149.8 EUR.
 *  - BETA: 5 @ 40 EUR, no fee.
 *  - GAMMA: no trade history, the broker reports the whole basis.
 *  - DELTA: no trade history and no broker basis.
 *  - EPSILON: its only trade predates every supplied FX rate.
 */

export const FX_RATES: FxRate[] = [
  { base: "EUR", date: "2025-12-31", rates: { USD: 2 } },
  { base: "EUR", date: "2026-01-02", rates: { USD: 2 } },
  { base: "EUR", date: "2026-01-03", rates: { USD: 2.5 } },
  { base: "EUR", date: "2026-01-04", rates: { USD: 2 } },
  { base: "EUR", date: "2026-06-01", rates: { USD: 2 } },
  { base: "EUR", date: "2026-09-17", rates: { USD: 2 } },
];

export const POSITIONS: Position[] = [
  {
    entity: "personal",
    broker: "trading212",
    account: "main",
    symbol: "ACME",
    quantity: 6,
    averagePrice: 160,
    marketPrice: 160,
    marketValue: 960,
    currency: "USD",
    asOf: "2026-09-17",
  },
  {
    entity: "holding-bv",
    broker: "ibkr",
    account: "U1",
    symbol: "BETA",
    quantity: 5,
    averagePrice: 40,
    marketPrice: 50,
    marketValue: 250,
    currency: "EUR",
    asOf: "2026-09-17",
  },
  {
    entity: "personal",
    broker: "ibkr",
    account: "U1",
    symbol: "GAMMA",
    quantity: 3,
    averagePrice: 30,
    marketPrice: 40,
    marketValue: 120,
    currency: "EUR",
    asOf: "2026-09-17",
    brokerCost: { status: "known", amount: 90, currency: "EUR" },
  },
  {
    entity: "personal",
    broker: "trading212",
    account: "main",
    symbol: "DELTA",
    quantity: 4,
    averagePrice: 10,
    marketPrice: 10,
    marketValue: 40,
    currency: "EUR",
    asOf: "2026-09-17",
    brokerCost: { status: "unknown", reason: "not-reported" },
  },
  {
    entity: "personal",
    broker: "trading212",
    account: "main",
    symbol: "EPSILON",
    quantity: 2,
    averagePrice: 50,
    marketPrice: 60,
    marketValue: 120,
    currency: "USD",
    asOf: "2026-09-17",
  },
];

export const TRADES: Trade[] = [
  {
    id: "acme-buy-1",
    entity: "personal",
    broker: "trading212",
    account: "main",
    date: "2026-01-02",
    symbol: "ACME",
    side: "buy",
    quantity: 10,
    price: 100,
    amount: 1000,
    currency: "USD",
    commission: 2,
    brokerTradeId: "acme-buy-1",
  },
  {
    id: "acme-buy-2",
    entity: "personal",
    broker: "trading212",
    account: "main",
    date: "2026-01-03",
    symbol: "ACME",
    side: "buy",
    quantity: 2,
    price: 120,
    amount: 240,
    currency: "USD",
    commission: 1,
    brokerTradeId: "acme-buy-2",
  },
  {
    id: "acme-sell-1",
    entity: "personal",
    broker: "trading212",
    account: "main",
    date: "2026-01-04",
    symbol: "ACME",
    side: "sell",
    quantity: 6,
    price: 150,
    amount: 900,
    currency: "USD",
    commission: 3,
    brokerTradeId: "acme-sell-1",
  },
  {
    id: "beta-buy-1",
    entity: "holding-bv",
    broker: "ibkr",
    account: "U1",
    date: "2026-01-02",
    symbol: "BETA",
    side: "buy",
    quantity: 5,
    price: 40,
    amount: 200,
    currency: "EUR",
    commission: 0,
    brokerTradeId: "beta-buy-1",
  },
  {
    // No supplied FX rate reaches this date, so its basis stays unknown.
    id: "epsilon-buy-1",
    entity: "personal",
    broker: "trading212",
    account: "main",
    date: "2025-01-02",
    symbol: "EPSILON",
    side: "buy",
    quantity: 2,
    price: 50,
    amount: 100,
    currency: "USD",
    commission: 0,
    brokerTradeId: "epsilon-buy-1",
  },
];

export const DIVIDENDS: Dividend[] = [
  {
    id: "acme-dividend-1",
    entity: "personal",
    broker: "trading212",
    account: "main",
    date: "2026-06-01",
    symbol: "ACME",
    amount: 20,
    currency: "USD",
  },
];

export const PRICE_BARS: PriceBar[] = [
  { symbol: "ACME", date: "2026-01-05", close: 150, currency: "USD" },
  { symbol: "ACME", date: "2026-06-01", close: 155, currency: "USD" },
  { symbol: "ACME", date: "2026-09-17", close: 160, currency: "USD" },
  { symbol: "BETA", date: "2026-01-05", close: 41, currency: "EUR" },
  { symbol: "BETA", date: "2026-09-17", close: 50, currency: "EUR" },
  { symbol: "GAMMA", date: "2026-09-17", close: 40, currency: "EUR" },
  { symbol: "DELTA", date: "2026-09-17", close: 10, currency: "EUR" },
  { symbol: "EPSILON", date: "2026-09-17", close: 60, currency: "USD" },
];
