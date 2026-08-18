import { expect, test } from "vitest";
import {
  computePortfolioValueSeries,
  filterPortfolioValueRange,
  normalizeBenchmarkSeries,
  type PortfolioValuePoint,
} from "./portfolio.js";
import { FX_RATES, POSITIONS, PRICE_BARS, TRADES, BENCHMARK_BARS } from "./__fixtures__/portfolio.js";

test("computes EUR portfolio value from holdings, trades, prices, and FX", () => {
  expect(computePortfolioValueSeries(POSITIONS, TRADES, PRICE_BARS, "EUR", FX_RATES)).toEqual([
    { date: "2026-01-02", value: 2200, unpriced: [] },
    { date: "2026-01-05", value: 1952.3809523809523, unpriced: [] },
    { date: "2026-02-02", value: 2090.909090909091, unpriced: [] },
  ]);
});

test("reports missing instrument prices instead of treating them as zero", () => {
  const result = computePortfolioValueSeries(
    POSITIONS,
    TRADES,
    PRICE_BARS.filter((bar) => bar.symbol !== "MSFT"),
    "EUR",
    FX_RATES,
  );

  expect(result[1]).toEqual({ date: "2026-01-05", value: 952.3809523809523, unpriced: ["MSFT"] });
});

test("normalizes benchmark to portfolio's first value", () => {
  const portfolio: PortfolioValuePoint[] = [
    { date: "2026-01-02", value: 2200, unpriced: [] },
    { date: "2026-01-05", value: 2310, unpriced: [] },
  ];
  expect(normalizeBenchmarkSeries(BENCHMARK_BARS, portfolio)).toEqual([
    { date: "2026-01-02", value: 2200 },
    { date: "2026-01-05", value: 2310 },
  ]);
});

test("normalizes benchmark from first date shared with portfolio", () => {
  const portfolio: PortfolioValuePoint[] = [{ date: "2026-01-05", value: 2310, unpriced: [] }];
  expect(normalizeBenchmarkSeries(BENCHMARK_BARS, portfolio)).toEqual([{ date: "2026-01-05", value: 2310 }]);
});

test.each([
  ["1M", "2026-01-02"],
  ["6M", "2025-08-02"],
  ["1Y", "2025-02-02"],
  ["YTD", "2026-01-01"],
  ["All", "0000-01-01"],
] as const)("filters %s from latest data date", (range, start) => {
  const points: PortfolioValuePoint[] = [
    { date: "2025-01-01", value: 1, unpriced: [] },
    { date: "2026-01-01", value: 2, unpriced: [] },
    { date: "2026-02-02", value: 3, unpriced: [] },
  ];
  expect(filterPortfolioValueRange(points, range).map((point) => point.date)).toEqual(
    points.filter((point) => point.date >= start).map((point) => point.date),
  );
});
