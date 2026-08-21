import { expect, test } from "vitest";
import { buildInvestingDashboard, emptyInvestingDashboard } from "./dashboard.js";
import { BENCHMARK_BARS, FX_RATES, POSITIONS, PRICE_BARS, TRADES } from "./__fixtures__/portfolio.js";

test("empty dashboard has every range and no invented records", () => {
  expect(emptyInvestingDashboard()).toEqual({
    presentationCurrency: "EUR",
    portfolio: { "1M": [], "6M": [], "1Y": [], YTD: [], All: [] },
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
    dividends: [{ id: "dividend", tenantId: "local", entity: "personal", date: "2026-01-05", symbol: "AAPL", amount: 1.5, currency: "USD" }],
    priceBars: PRICE_BARS,
    benchmarkBars: BENCHMARK_BARS,
    presentationCurrency: "EUR",
    fxRates: FX_RATES,
    selectedSymbol: "aapl",
  });

  expect(dashboard.portfolio.All).toHaveLength(3);
  expect(dashboard.allocation.instrument.buckets).toHaveLength(2);
  expect(dashboard.positions.map((position) => position.symbol)).toEqual(["AAPL", "MSFT"]);
  expect(dashboard.position?.symbol).toBe("AAPL");
  expect(dashboard.position?.points[1]?.markers).toEqual([
    { kind: "buy", eventDate: "2026-01-03", label: "Koop 2" },
    { kind: "dividend", eventDate: "2026-01-05", label: "Dividend 1.5 USD", amount: 1.5, currency: "USD" },
  ]);
});
