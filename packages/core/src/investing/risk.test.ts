import { expect, test } from "vitest";
import type { BenchmarkSeries } from "./benchmarks.js";
import { emptyInvestingDashboard, type InvestingDashboardData } from "./dashboard.js";
import type { PortfolioValuePoint } from "./portfolio.js";
import { buildHistoricalRisk, RISK_MINIMUM_OBSERVATIONS } from "./risk.js";

function businessDates(count: number): string[] {
  const dates: string[] = [];
  const date = new Date("2026-01-02T00:00:00Z");
  while (dates.length < count) {
    if (date.getUTCDay() !== 0 && date.getUTCDay() !== 6)
      dates.push(date.toISOString().slice(0, 10));
    date.setUTCDate(date.getUTCDate() + 1);
  }
  return dates;
}

function pointsFromReturns(returns: readonly number[]): PortfolioValuePoint[] {
  const dates = businessDates(returns.length + 1);
  let value = 100;
  return dates.map((date, index) => {
    if (index > 0) value *= 1 + returns[index - 1]!;
    return {
      date,
      positionsValue: value,
      cashValue: null,
      value,
      unpriced: [],
      forwardFilled: [],
      cashUnknown: [],
    };
  });
}

function benchmarkFromReturns(
  returns: readonly number[],
  currency = "EUR",
): BenchmarkSeries {
  return {
    symbol: "BENCH",
    name: "Benchmark",
    exchange: "TEST",
    currency,
    points: pointsFromReturns(returns).map(({ date, value }) => ({ date, value })),
  };
}

function dashboard(
  points: PortfolioValuePoint[],
  options: {
    benchmarks?: BenchmarkSeries[];
    flows?: Array<{ date: string; amount: number | null }>;
  } = {},
): InvestingDashboardData {
  const empty = emptyInvestingDashboard("EUR");
  return {
    ...empty,
    portfolio: {
      "1M": points,
      "6M": points,
      "1Y": points,
      YTD: points,
      All: points,
    },
    benchmarks: options.benchmarks ?? [],
    externalCashFlows: options.flows ?? [],
  };
}

test("calculates beta and alpha from matching flow-adjusted daily intervals", () => {
  const benchmarkReturns = Array.from(
    { length: RISK_MINIMUM_OBSERVATIONS },
    (_, index) => (index % 4 === 0 ? 0.012 : index % 4 === 1 ? -0.007 : index % 4 === 2 ? 0.004 : -0.002),
  );
  const portfolioReturns = benchmarkReturns.map((value) => 1.5 * value + 0.0007);
  const report = buildHistoricalRisk(
    dashboard(pointsFromReturns(portfolioReturns), {
      benchmarks: [benchmarkFromReturns(benchmarkReturns)],
    }),
  );

  expect(report.risk.status).toBe("estimate");
  expect(report.metrics.observationDays).toBe(RISK_MINIMUM_OBSERVATIONS);
  expect(report.metrics.pairedObservationDays).toBe(RISK_MINIMUM_OBSERVATIONS);
  expect(report.metrics.beta).toBeCloseTo(1.5, 10);
  expect(report.metrics.alpha).toBeCloseTo(0.0007 * 252, 10);
});

test("removes owner cash flow instead of counting deposit as return", () => {
  const dates = businessDates(RISK_MINIMUM_OBSERVATIONS + 1);
  const depositIndex = 30;
  let value = 100;
  const points = dates.map((date, index): PortfolioValuePoint => {
    if (index > 0) value = value * 1.01 + (index === depositIndex ? 75 : 0);
    return {
      date,
      positionsValue: value,
      cashValue: null,
      value,
      unpriced: [],
      forwardFilled: [],
      cashUnknown: [],
    };
  });
  const report = buildHistoricalRisk(
    dashboard(points, { flows: [{ date: dates[depositIndex]!, amount: 75 }] }),
  );

  expect(report.risk.status).toBe("estimate");
  expect(report.metrics.dailyVolatility).toBeCloseTo(0, 12);
  expect(report.metrics.maxDrawdown).toBe(0);
});

const incompleteQualityCases: Array<[string, Partial<PortfolioValuePoint>]> = [
  ["missing price", { unpriced: ["SEZL"] }],
  ["unknown cash", { cashUnknown: ["trading212:USD"] }],
  ["unknown holding history", { holdingsUnknown: ["PIE"] }],
  ["carried-forward price", { forwardFilled: ["AAPL"] }],
];

test.each(incompleteQualityCases)("returns no risk metrics for %s in strict window", (_label, quality) => {
  const points = pointsFromReturns(Array.from({ length: RISK_MINIMUM_OBSERVATIONS }, () => 0.001));
  points[30] = { ...points[30]!, ...quality };
  const report = buildHistoricalRisk(dashboard(points));

  expect(report.risk.status).toBe("unavailable");
  expect(report.metrics).toMatchObject({
    dailyVolatility: null,
    annualizedVolatility: null,
    beta: null,
    alpha: null,
    maxDrawdown: null,
  });
  expect(report.risk.reasons).toContain(
    "A complete return history is required; partial values are excluded.",
  );
});

test("keeps beta and alpha null when no benchmark is selected", () => {
  const points = pointsFromReturns(
    Array.from({ length: RISK_MINIMUM_OBSERVATIONS }, (_, index) => index % 2 ? 0.01 : -0.005),
  );
  const report = buildHistoricalRisk(dashboard(points));

  expect(report.risk.status).toBe("estimate");
  expect(report.metrics.annualizedVolatility).not.toBeNull();
  expect(report.metrics.beta).toBeNull();
  expect(report.metrics.alpha).toBeNull();
  expect(report.risk.reasons).toContain(
    "Add a benchmark with Compare above to calculate beta and alpha.",
  );
});

test("rejects benchmark quoted outside presentation currency", () => {
  const returns = Array.from(
    { length: RISK_MINIMUM_OBSERVATIONS },
    (_, index) => index % 2 ? 0.01 : -0.005,
  );
  const report = buildHistoricalRisk(
    dashboard(pointsFromReturns(returns), {
      benchmarks: [benchmarkFromReturns(returns, "USD")],
    }),
  );

  expect(report.risk.status).toBe("estimate");
  expect(report.metrics.annualizedVolatility).not.toBeNull();
  expect(report.metrics.beta).toBeNull();
  expect(report.metrics.alpha).toBeNull();
  expect(report.risk.reasons).toContain(
    "Beta and alpha need a EUR-quoted benchmark; BENCH is quoted in USD.",
  );
});

test("requires 60 valid daily return observations", () => {
  const short = buildHistoricalRisk(
    dashboard(pointsFromReturns(Array.from({ length: 59 }, () => 0.001))),
  );
  const enough = buildHistoricalRisk(
    dashboard(pointsFromReturns(Array.from({ length: 60 }, (_, index) => index % 2 ? 0.002 : 0))),
  );

  expect(short.risk.status).toBe("unavailable");
  expect(short.metrics.observationDays).toBe(59);
  expect(short.metrics.annualizedVolatility).toBeNull();
  expect(enough.risk.status).toBe("estimate");
  expect(enough.metrics.observationDays).toBe(60);
  expect(enough.metrics.annualizedVolatility).not.toBeNull();
});
