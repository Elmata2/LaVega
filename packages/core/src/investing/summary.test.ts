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

const day = (index: number): string =>
  (() => {
    const date = new Date("2026-01-01T00:00:00Z");
    let left = index + 1;
    while (left > 0) {
      date.setUTCDate(date.getUTCDate() + 1);
      if (date.getUTCDay() !== 0 && date.getUTCDay() !== 6) left -= 1;
    }
    return date.toISOString().slice(0, 10);
  })();

test("volatility matches hand-computed sample stdev, annualized", () => {
  // 22 returns: eleven +2%, eleven 0% interleaved -> mean 0.01, var = 22*(0.01)^2/21.
  const returns = Array.from({ length: 22 }, (_, index) => (index % 2 === 0 ? 0.02 : 0));
  const metrics = computePortfolioMetrics({ valuePoints: seriesFromReturns(100, returns) });
  expect(metrics.observationDays).toBe(22);
  expect(metrics.dailyVolatility).toBeCloseTo(Math.sqrt((22 * 0.0001) / 21), 12);
  expect(metrics.annualizedVolatility).toBeCloseTo(
    Math.sqrt((22 * 0.0001) / 21) * Math.sqrt(252),
    12,
  );
});

test("beta and alpha match hand-computed covariance ratio and annualized excess", () => {
  const benchmarkReturns = Array.from({ length: 24 }, (_, index) =>
    index % 3 === 0 ? 0.01 : index % 3 === 1 ? -0.004 : 0.002,
  );
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
  const short = seriesFromReturns(
    100,
    Array.from({ length: 19 }, (_, index) => (index % 2 === 0 ? 0.01 : -0.01)),
  );
  const metrics = computePortfolioMetrics({ valuePoints: short, benchmarkPoints: short });
  expect(metrics.observationDays).toBe(19);
  expect(metrics.dailyVolatility).toBeNull();
  expect(metrics.annualizedVolatility).toBeNull();
  expect(metrics.beta).toBeNull();
  expect(metrics.alpha).toBeNull();
  expect(metrics.maxDrawdown).not.toBeNull();
});

test("null value gaps are skipped and dates align portfolio to benchmark", () => {
  const benchmark = seriesFromReturns(
    100,
    Array.from({ length: 30 }, (_, index) => (index % 2 === 0 ? 0.005 : -0.005)),
  );
  const portfolio = benchmark.map((point, index) => ({
    ...point,
    value: index === 5 ? null : point.value,
  }));
  const metrics = computePortfolioMetrics({ valuePoints: portfolio, benchmarkPoints: benchmark });
  // Gap removes both adjacent intervals; no return bridges unknown value.
  expect(metrics.observationDays).toBe(28);
  expect(metrics.beta).not.toBeNull();
});

test("sector exposure accumulates a weight vector per position, residual folds into Unknown", () => {
  const weights = new Map([
    ["ACME", [{ sector: "Technology", weight: 1 }]],
    ["BLOK", [{ sector: "Industrials", weight: 1 }]],
  ]);
  const exposure = buildSectorExposure(
    [
      { symbol: "ACME", marketValue: 300 },
      { symbol: "blok", marketValue: 100 },
      { symbol: "MYST", marketValue: 100 }, // no entry in weights at all
      { symbol: "ZERO", marketValue: null },
      { symbol: "NEG", marketValue: -50 },
    ],
    weights,
  );
  expect(exposure).toEqual([
    { sector: "Technology", weight: 0.6 },
    { sector: "Industrials", weight: 0.2 },
    { sector: "Unknown", weight: 0.2 },
  ]);
});

test("an unpriced portfolio has no exposure at all", () => {
  expect(buildSectorExposure([{ symbol: "ACME", marketValue: null }], new Map())).toEqual([]);
});

test("a fund position splits its market value across its own weight vector", () => {
  const weights = new Map([
    [
      "VFEM.L",
      [
        { sector: "Technology", weight: 0.4 },
        { sector: "Financial Services", weight: 0.3 },
      ],
    ],
  ]);
  const exposure = buildSectorExposure([{ symbol: "VFEM.L", marketValue: 1000 }], weights);
  expect(exposure).toEqual([
    { sector: "Technology", weight: 0.4 },
    // 1 - (0.4+0.3) computes as 0.30000000000000004 (double rounding), a
    // near-tie with the exact 0.3 covered bucket at sort precision — resolved
    // by sector name, not the float dust in the raw residual.
    { sector: "Financial Services", weight: 0.3 },
    { sector: "Unknown", weight: 0.30000000000000004 },
  ]);
});

test("a fund with an empty weight vector (bond fund) is entirely Unknown, not an error", () => {
  const weights = new Map([["AGGG.L", []]]);
  expect(buildSectorExposure([{ symbol: "AGGG.L", marketValue: 500 }], weights)).toEqual([
    { sector: "Unknown", weight: 1 },
  ]);
});

test("weights overshooting 1 scale down instead of inflating total exposure past 100%", () => {
  const weights = new Map([
    ["ACME", [
      { sector: "Technology", weight: 0.5001 },
      { sector: "Health Care", weight: 0.5 },
    ]],
  ]);
  const exposure = buildSectorExposure([{ symbol: "ACME", marketValue: 1000 }], weights);
  expect(exposure.map((entry) => entry.sector)).not.toContain("Unknown");
  const total = exposure.reduce((sum, entry) => sum + entry.weight, 0);
  expect(total).toBeCloseTo(1, 12);
});

test("ten weights summing just under 1 by float error don't create a phantom Unknown row", () => {
  const sectors = Array.from({ length: 10 }, (_, index) => `Sector${index}`);
  const weights = new Map([["FUND", sectors.map((sector) => ({ sector, weight: 0.1 }))]]);
  const exposure = buildSectorExposure([{ symbol: "FUND", marketValue: 1000 }], weights);
  expect(exposure).toHaveLength(10);
  expect(exposure.map((entry) => entry.sector)).not.toContain("Unknown");
});

test("near-tied weights sort deterministically by sector name, not float noise", () => {
  const weights = new Map([
    ["FUND", [
      { sector: "Zeta", weight: 0.5 },
      { sector: "Alpha", weight: 0.5 - 1e-10 },
    ]],
  ]);
  const exposure = buildSectorExposure([{ symbol: "FUND", marketValue: 1000 }], weights);
  expect(exposure.map((entry) => entry.sector)).toEqual(["Alpha", "Zeta"]);
});

test("owner deposit is removed from daily return", () => {
  const points: MetricPoint[] = [{ date: "2026-01-01", value: 100 }];
  let value = 100;
  for (let index = 0; index < 21; index += 1) {
    value = value * 1.01 + (index === 10 ? 100 : 0);
    points.push({ date: day(index), value });
  }
  const metrics = computePortfolioMetrics({
    valuePoints: points,
    externalCashFlows: [{ date: day(10), amount: 100 }],
  });
  expect(metrics.observationDays).toBe(21);
  expect(metrics.dailyVolatility).toBeCloseTo(0, 12);
  expect(metrics.annualizedVolatility).toBeCloseTo(0, 12);
});

test("weekend flows apply to following business-day interval and unknown flow invalidates it", () => {
  const points = seriesFromReturns(
    100,
    Array.from({ length: 21 }, () => 0.01),
  );
  const weekend = "2026-01-03";
  const followingBusiness = points[2]!.date;
  points[2] = { date: followingBusiness, value: points[2]!.value! + 50 };
  for (let index = 3; index < points.length; index += 1)
    points[index] = { date: points[index]!.date, value: points[index - 1]!.value! * 1.01 };
  const metrics = computePortfolioMetrics({
    valuePoints: points,
    externalCashFlows: [{ date: weekend, amount: 50 }],
  });
  expect(metrics.dailyVolatility).toBeCloseTo(0, 12);
  const unknown = computePortfolioMetrics({
    valuePoints: points,
    externalCashFlows: [{ date: weekend, amount: null }],
  });
  expect(unknown.maxDrawdown).toBeNull();
});

test("invalid dates do not create a return", () => {
  const points = seriesFromReturns(
    100,
    Array.from({ length: 21 }, () => 0.01),
  );
  points[5] = { date: "not-a-date", value: 101 };
  const metrics = computePortfolioMetrics({ valuePoints: points });
  expect(metrics.excludedIntervals).toBeGreaterThan(0);
  expect(metrics.maxDrawdown).toBeNull();
});

test("invalid values and gaps do not produce extreme statistics", () => {
  const points = seriesFromReturns(
    100,
    Array.from({ length: 21 }, () => 0.01),
  );
  points[8] = { date: points[8]!.date, value: -1 };
  const metrics = computePortfolioMetrics({ valuePoints: points });
  expect(metrics.dailyVolatility).toBeNull();
  expect(metrics.maxDrawdown).toBeNull();
  expect(metrics.excludedIntervals).toBeGreaterThan(0);
});

test("beta pairs exact interval, not only ending date", () => {
  const portfolio = seriesFromReturns(
    100,
    Array.from({ length: 24 }, () => 0.01),
  );
  const benchmark = Array.from({ length: 25 }, (_, i) => ({
    date: i === 0 ? "2026-01-01" : day((i - 1) * 2),
    value: 100 * Math.pow(i % 2 ? 1.01 : 0.99, i),
  }));
  // Ending dates can overlap, but intervals have different starts.
  const shifted = benchmark;
  const metrics = computePortfolioMetrics({ valuePoints: portfolio, benchmarkPoints: shifted });
  expect(metrics.beta).toBeNull();
  expect(metrics.pairedObservationDays).toBeLessThan(20);
});

test("duplicate dates are excluded instead of being silently ordered", () => {
  const points = seriesFromReturns(
    100,
    Array.from({ length: 21 }, () => 0.01),
  );
  points.push({ date: points[5]!.date, value: points[5]!.value });
  const metrics = computePortfolioMetrics({ valuePoints: points });
  expect(metrics.excludedIntervals).toBeGreaterThan(0);
  expect(metrics.maxDrawdown).toBeNull();
});

test("valid drawdown stays bounded and unknown interval makes it null", () => {
  const points = seriesFromReturns(
    100,
    Array.from({ length: 21 }, (_, i) => (i === 10 ? -0.2 : 0.01)),
  );
  const metrics = computePortfolioMetrics({ valuePoints: points });
  expect(metrics.maxDrawdown).toBeGreaterThanOrEqual(-1);
  expect(metrics.maxDrawdown).toBeLessThanOrEqual(0);
  points[7] = { date: points[7]!.date, value: null };
  expect(computePortfolioMetrics({ valuePoints: points }).maxDrawdown).toBeNull();
});
