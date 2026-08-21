import { expect, test } from "vitest";
import { buildInvestingDashboard, emptyInvestingDashboard } from "./dashboard.js";
import { BENCHMARK_BARS, FX_RATES, POSITIONS, PRICE_BARS, TRADES } from "./__fixtures__/portfolio.js";

test("empty dashboard has every range and no invented records", () => {
  expect(emptyInvestingDashboard()).toEqual({
    dataVersion: 0,
    presentationCurrency: "EUR",
    benchmarks: [],
    portfolio: { "1M": [], "6M": [], "1Y": [], YTD: [], All: [] },
    externalCashFlows: [],
    allocation: { instrument: { buckets: [], unpriced: [] }, entity: { buckets: [], unpriced: [] } },
    positions: [],
    position: null,
    problems: [],
  });
});

test("dashboard builder returns finished chart series and selected position markers", () => {
  const dashboard = buildInvestingDashboard({
    positions: POSITIONS,
    trades: TRADES,
    dividends: [{ id: "dividend", tenantId: "local", entity: "personal", broker: "ibkr", date: "2026-01-05", symbol: "AAPL", amount: 1.5, currency: "USD" }],
    priceBars: PRICE_BARS,
    benchmarkBars: BENCHMARK_BARS,
    presentationCurrency: "EUR",
    fxRates: FX_RATES,
    selectedSymbol: "aapl",
    today: "2026-02-02",
  });

  expect(dashboard.portfolio.All[0]).toMatchObject({ date: "2026-01-02", positionsValue: 2200, cashValue: null, value: 2200 });
  expect(dashboard.allocation.instrument.buckets).toHaveLength(2);
  expect(dashboard.positions.map((position) => position.symbol)).toEqual(["AAPL", "MSFT"]);
  expect(dashboard.position?.symbol).toBe("AAPL");
  expect(dashboard.position?.points[1]?.markers).toEqual([
    { kind: "buy", eventDate: "2026-01-03", label: "Koop 2", quantity: 2, executionPrice: 100, amount: 200, commission: 0, currency: "USD" },
    { kind: "dividend", eventDate: "2026-01-05", label: "Dividend 1.5 USD", amount: 1.5, dividendAmount: 1.5, currency: "USD" },
  ]);
  expect(dashboard.position).toMatchObject({ status: "open", quantity: 10, averageCost: 100, firstBuyDate: "2026-01-02" });
  expect(dashboard.position?.currentValue).toBeCloseTo(1200 / 1.1);
});

test("dashboard resolves a closed historical symbol with return and stable activity", () => {
  const dashboard = buildInvestingDashboard({
    positions: [],
    trades: [
      { id: "buy", tenantId: "local", entity: "personal", date: "2026-01-02", symbol: "CLOSED", description: "Closed Co", side: "buy", quantity: 2, price: 10, amount: 20, currency: "EUR", commission: 1 },
      { id: "sell-1", tenantId: "local", entity: "personal", date: "2026-01-05", symbol: "CLOSED", side: "sell", quantity: 1, price: 14, amount: 14, currency: "EUR", commission: 1 },
      { id: "sell-2", tenantId: "local", entity: "personal", date: "2026-01-05", symbol: "CLOSED", side: "sell", quantity: 1, price: 15, amount: 15, currency: "EUR", commission: 1 },
    ],
    dividends: [{ id: "div", tenantId: "local", entity: "personal", broker: "ibkr", date: "2026-01-05", symbol: "CLOSED", amount: 2, currency: "EUR" }],
    priceBars: [
      { tenantId: "local", symbol: "CLOSED", date: "2026-01-02", close: 10, currency: "EUR" },
      { tenantId: "local", symbol: "CLOSED", date: "2026-01-05", close: 15, currency: "EUR" },
    ],
    benchmarkBars: [], presentationCurrency: "EUR", fxRates: [], selectedSymbol: "closed", today: "2026-01-06",
  });
  expect(dashboard.position).toMatchObject({
    symbol: "CLOSED", description: "Closed Co", status: "closed", quantity: 0, currentValue: null, currentPrice: null,
    returns: { status: "available", unrealizedGain: 0, realizedGain: 6, dividendsReceived: 2, totalReturn: 8, totalReturnPercentage: 8 / 21 },
    quantityHistory: [
      { date: "2026-01-02", quantity: 2, delta: 2, reason: "buy", sourceOrder: 0 },
      { date: "2026-01-05", quantity: 1, delta: -1, reason: "sell", sourceOrder: 1 },
      { date: "2026-01-05", quantity: 0, delta: -1, reason: "sell", sourceOrder: 2 },
    ],
  });
  expect(dashboard.position?.activity.map((item) => `${item.date}:${item.kind}:${item.sourceOrder}`)).toEqual([
    "2026-01-05:sell:1", "2026-01-05:sell:2", "2026-01-05:dividend:3", "2026-01-02:buy:0",
  ]);
});

test("position detail does not estimate incomplete return history", () => {
  const dashboard = buildInvestingDashboard({
    positions: [{ tenantId: "local", entity: "personal", symbol: "PARTIAL", quantity: 2, averagePrice: null, marketPrice: 10, marketValue: 20, currency: "EUR", asOf: "2026-01-05" }],
    trades: [{ id: "partial", tenantId: "local", entity: "personal", date: "2026-01-02", symbol: "PARTIAL", side: "buy", quantity: 1, price: null, amount: null, currency: "EUR", commission: null }],
    dividends: [], priceBars: [{ tenantId: "local", symbol: "PARTIAL", date: "2026-01-05", close: 10, currency: "EUR" }], benchmarkBars: [], presentationCurrency: "EUR", fxRates: [], selectedSymbol: "PARTIAL", today: "2026-01-05",
  });
  expect(dashboard.position).toMatchObject({ returnStatus: "missing-cost", returns: { totalReturn: null, realizedGain: null }, averageCost: null });
});

test("dashboard exposes cash-aware value fields and netted external TWR inputs", () => {
  const dashboard = buildInvestingDashboard({
    positions: POSITIONS,
    trades: TRADES,
    dividends: [],
    cashBalances: [{ tenantId: "local", entity: "personal", broker: "ibkr", currency: "EUR", amount: 300, asOf: "2026-02-02" }],
    cashFlows: [
      { id: "deposit", tenantId: "local", entity: "personal", broker: "ibkr", date: "2026-01-05", currency: "EUR", amount: 250, kind: "deposit" },
      { id: "withdrawal", tenantId: "local", entity: "personal", broker: "ibkr", date: "2026-01-05", currency: "EUR", amount: -50, kind: "withdrawal" },
      { id: "fee", tenantId: "local", entity: "personal", broker: "ibkr", date: "2026-01-05", currency: "EUR", amount: -5, kind: "fee" },
    ],
    priceBars: PRICE_BARS,
    benchmarkBars: [],
    presentationCurrency: "EUR",
    fxRates: FX_RATES,
    today: "2026-02-02",
    dataVersion: 4,
  });

  expect(dashboard.dataVersion).toBe(4);
  expect(dashboard.externalCashFlows).toEqual([{ date: "2026-01-05", amount: 200 }]);
  expect(dashboard.portfolio.All.at(-1)).toMatchObject({ positionsValue: 2090.909090909091, cashValue: 300, value: 2390.909090909091, cashUnknown: [] });
});
