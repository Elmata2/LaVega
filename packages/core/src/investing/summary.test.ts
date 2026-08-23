import { expect, test } from "vitest";
import { buildSectorExposure, computePortfolioMetrics, type MetricPoint } from "./summary.js";

function seriesFromReturns(start: number, returns: readonly number[]): MetricPoint[] {
  const points: MetricPoint[] = [{ date: "2026-01-01", value: start }];
  let value = start;
  returns.forEach((ret, index) => {
    value *= 1 + ret;
    points.push({ date: day(index), value });
  });
  return points;
}

const day = (index: number): string => `2026-${String(Math.floor(index / 28) + 2).padStart(2, "0")}-${String((index % 28) + 1).padStart(2, "0")}`;

test("volatility matches hand-computed sample stdev, annualized", () => {
  // 22 returns: eleven +2%, eleven 0% interleaved -> mean 0.01, var = 22*(0.01)^2/21.
  const returns = Array.from({ length: 22 }, (_, index) => (index % 2 === 0 ? 0.02 : 0));
  const metrics = computePortfolioMetrics({ valuePoints: seriesFromReturns(100, returns) });
  expect(metrics.observationDays).toBe(22);
  expect(metrics.dailyVolatility).toBeCloseTo(Math.sqrt(22 * 0.0001 / 21), 12);
  expect(metrics.annualizedVolatility).toBeCloseTo(Math.sqrt(22 * 0.0001 / 21) * Math.sqrt(252), 12);
});

test("beta and alpha match hand-computed covariance ratio and annualized excess", () => {
  const benchmarkReturns = Array.from({ length: 24 }, (_, index) => (index % 3 === 0 ? 0.01 : index % 3 === 1 ? -0.004 : 0.002));
  // Portfolio tracks 2x the benchmark plus a constant 0.1% daily edge.
  const portfolioReturns = benchmarkReturns.map((ret) => 2 * ret + 0.001);
  const metrics = computePortfolioMetrics({
    valuePoints: seriesFromReturns(100, portfolioReturns),
    benchmarkPoints: seriesFromReturns(100, benchmarkReturns),
  });
  expect(metrics.beta).not.toBeNull();
  expect(metrics.beta!).toBeCloseTo(2, 9);
  expect(metrics.alpha).not.toBeNull();
  expect(metrics.alpha!).toBeCloseTo(0.001 * 252, 9);
});

test("max drawdown measures worst peak-to-trough of the cumulative series", () => {
  const points: MetricPoint[] = [
    { date: "2026-01-01", value: 100 },
    { date: "2026-01-02", value: 120 },
    { date: "2026-01-03", value: 90 },
    { date: "2026-01-04", value: 110 },
  ];
  expect(computePortfolioMetrics({ valuePoints: points }).maxDrawdown).toBeCloseTo(-0.25, 12);
});

test("too few observations yields null statistics but keeps drawdown", () => {
  const short = seriesFromReturns(100, Array.from({ length: 19 }, (_, index) => (index % 2 === 0 ? 0.01 : -0.01)));
  const metrics = computePortfolioMetrics({ valuePoints: short, benchmarkPoints: short });
  expect(metrics.observationDays).toBe(19);
  expect(metrics.dailyVolatility).toBeNull();
  expect(metrics.annualizedVolatility).toBeNull();
  expect(metrics.beta).toBeNull();
  expect(metrics.alpha).toBeNull();
  expect(metrics.maxDrawdown).not.toBeNull();
});

test("null value gaps are skipped and dates align portfolio to benchmark", () => {
  const benchmark = seriesFromReturns(100, Array.from({ length: 30 }, (_, index) => (index % 2 === 0 ? 0.005 : -0.005)));
  const portfolio = benchmark.map((point, index) => ({ ...point, value: index === 5 ? null : point.value }));
  const metrics = computePortfolioMetrics({ valuePoints: portfolio, benchmarkPoints: benchmark });
  // One gap removes one paired observation but still leaves >= 20 pairs.
  expect(metrics.observationDays).toBe(29);
  expect(metrics.beta).not.toBeNull();
});

test("sector exposure buckets by weight, unknown last-resort bucket, sorted desc", () => {
  const sectors = new Map([["ACME", "Technology"], ["BLOK", "Industrials"]]);
  const exposure = buildSectorExposure([
    { symbol: "ACME", marketValue: 300 },
    { symbol: "blok", marketValue: 100 },
    { symbol: "MYST", marketValue: 100 },
    { symbol: "ZERO", marketValue: null },
    { symbol: "NEG", marketValue: -50 },
  ], sectors);
  expect(exposure).toEqual([
    { sector: "Technology", weight: 0.6 },
    { sector: "Industrials", weight: 0.2 },
    { sector: "Unknown", weight: 0.2 },
  ]);
});

test("sector exposure is empty without priced positions", () => {
  expect(buildSectorExposure([{ symbol: "ACME", marketValue: null }], new Map())).toEqual([]);
});
