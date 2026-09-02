import { expect, test } from "vitest";
import type { CashBalance, CashFlow, PriceBar, Trade } from "./model.js";
import { computePortfolioValueSeries, filterPortfolioValueRange, type PortfolioValuePoint } from "./portfolio.js";
import { FX_RATES, POSITIONS, PRICE_BARS, TRADES } from "./__fixtures__/portfolio.js";

const point = (date: string, value: number, unpriced: string[] = []): PortfolioValuePoint => ({
  date,
  positionsValue: value,
  cashValue: null,
  value,
  unpriced,
  forwardFilled: [],
  cashUnknown: [],
});

test("reconstructs holdings from signed trades instead of current positions", () => {
  const result = computePortfolioValueSeries(POSITIONS, TRADES, PRICE_BARS, "EUR", FX_RATES, { today: "2026-02-02" });

  expect(result.find(({ date }) => date === "2026-01-02")).toEqual(point("2026-01-02", 2200));
  expect(result.find(({ date }) => date === "2026-01-05")).toEqual(point("2026-01-05", 1952.3809523809523));
  expect(result.at(-1)).toEqual(point("2026-02-02", 2090.909090909091));
});

test("includes closed positions only while trade history says they were held", () => {
  const trades: Trade[] = [
    { id: "buy", entity: "personal", date: "2026-01-02", symbol: "CLOSED", side: "buy", quantity: 2, price: 10, amount: 20, currency: "EUR", commission: 0 },
    { id: "sell", entity: "personal", date: "2026-01-06", symbol: "CLOSED", side: "sell", quantity: 2, price: 12, amount: 24, currency: "EUR", commission: 0 },
  ];
  const bars: PriceBar[] = ["2026-01-02", "2026-01-05", "2026-01-06"].map((date) => ({ tenantId: "local", symbol: "CLOSED", date, close: 10, currency: "EUR" }));

  const result = computePortfolioValueSeries([], trades, bars, "EUR", FX_RATES, { today: "2026-01-06" });
  expect(result.map(({ date, positionsValue }) => ({ date, positionsValue }))).toEqual([
    { date: "2026-01-02", positionsValue: 20 },
    { date: "2026-01-05", positionsValue: 20 },
    { date: "2026-01-06", positionsValue: 0 },
  ]);
});

test("forward-fills five business days then marks held symbol unpriced", () => {
  const trades = TRADES.filter((trade) => trade.symbol === "AAPL");
  const bars = PRICE_BARS.filter((bar) => bar.symbol === "AAPL" && bar.date === "2026-01-05");
  const result = computePortfolioValueSeries([], trades, bars, "EUR", FX_RATES, { today: "2026-01-13" });

  expect(result.find(({ date }) => date === "2026-01-12")?.forwardFilled).toEqual(["AAPL"]);
  expect(result.find(({ date }) => date === "2026-01-13")).toMatchObject({ positionsValue: null, value: null, unpriced: ["AAPL"], forwardFilled: [] });
});

test("with no FX rate at all, foreign holdings go unpriced but EUR cash still values", () => {
  const trades = TRADES.filter((trade) => trade.symbol === "AAPL");
  const bars = PRICE_BARS.filter((bar) => bar.symbol === "AAPL");
  const cashBalances: CashBalance[] = [{ entity: "personal", broker: "ibkr", currency: "EUR", amount: 150, asOf: "2026-01-02" }];
  const result = computePortfolioValueSeries([], trades, bars, "EUR", undefined, { cashBalances, today: "2026-01-02" });

  expect(result.find(({ date }) => date === "2026-01-02")).toMatchObject({ positionsValue: null, cashValue: 150, value: 150, unpriced: ["AAPL"] });
});

test("walks cash anchors with deduplicated flows and dividends", () => {
  const cashBalances: CashBalance[] = [{ entity: "personal", broker: "ibkr", currency: "EUR", amount: 150, asOf: "2026-01-06" }];
  const cashFlows: CashFlow[] = [
    { id: "deposit-1", brokerFlowId: "same", entity: "personal", broker: "ibkr", date: "2026-01-02", currency: "EUR", amount: 100, kind: "deposit" },
    { id: "deposit-copy", brokerFlowId: "same", entity: "personal", broker: "ibkr", date: "2026-01-02", currency: "EUR", amount: 100, kind: "deposit" },
  ];
  const dividends = [{ id: "dividend", tenantId: "local", entity: "personal", broker: "ibkr", date: "2026-01-05", symbol: "AAPL", amount: 50, currency: "EUR" }];
  const result = computePortfolioValueSeries([], TRADES, PRICE_BARS, "EUR", FX_RATES, { cashBalances, cashFlows, dividends, today: "2026-01-06" });

  expect(result.find(({ date }) => date === "2026-01-02")?.cashValue).toBe(100);
  expect(result.find(({ date }) => date === "2026-01-05")?.cashValue).toBe(150);
  expect(result.find(({ date }) => date === "2026-01-06")?.cashValue).toBe(150);
});

test("keeps unreachable and unconvertible cash legs unknown", () => {
  const cashBalances: CashBalance[] = [
    { entity: "personal", broker: "ibkr", currency: "EUR", amount: 100, asOf: "2026-01-06" },
    { entity: "personal", broker: "trading212", currency: "GBP", amount: 50, asOf: "2026-01-02" },
  ];
  const cashFlows: CashFlow[] = [{ id: "late", entity: "personal", broker: "ibkr", date: "2026-01-05", currency: "EUR", amount: 100, kind: "deposit" }];
  const result = computePortfolioValueSeries([], TRADES, PRICE_BARS, "EUR", FX_RATES, { cashBalances, cashFlows, today: "2026-01-02" });

  expect(result[0]).toMatchObject({ cashValue: null, cashUnknown: ["ibkr:EUR", "trading212:GBP"] });
});

test.each([
  ["1M", "2026-01-02"],
  ["6M", "2025-08-02"],
  ["1Y", "2025-02-02"],
  ["YTD", "2026-01-01"],
  ["All", "0000-01-01"],
] as const)("filters %s from latest data date", (range, start) => {
  const points = [point("2025-01-01", 1), point("2026-01-01", 2), point("2026-02-02", 3)];
  expect(filterPortfolioValueRange(points, range).map(({ date }) => date)).toEqual(points.filter(({ date }) => date >= start).map(({ date }) => date));
});
