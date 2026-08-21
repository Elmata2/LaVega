import { expect, test } from "vitest";
import { buildInvestingDashboard, emptyInvestingDashboard } from "./dashboard.js";
import { BENCHMARK_BARS, FX_RATES, POSITIONS, PRICE_BARS, TRADES } from "./__fixtures__/portfolio.js";

test("empty dashboard has every range and no invented records", () => {
  expect(emptyInvestingDashboard()).toEqual({
    dataVersion: 0,
    presentationCurrency: "EUR",
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
    { kind: "buy", eventDate: "2026-01-03", label: "Koop 2" },
    { kind: "dividend", eventDate: "2026-01-05", label: "Dividend 1.5 USD", amount: 1.5, currency: "USD" },
  ]);
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
