import { expect, test } from "vitest";
import type { BenchmarkSeries } from "./benchmarks.js";
import { businessDaysAfter } from "./calendar.js";
import {
  buildInvestingDashboard,
  emptyInvestingDashboard,
  type InvestingDashboardData,
} from "./dashboard.js";
import type { PortfolioValuePoint } from "./portfolio.js";
import {
  benchmarkCurrencyMismatchReason,
  buildHistoricalRisk,
  RISK_MAX_STALE_BUSINESS_DAYS,
  RISK_MINIMUM_OBSERVATIONS,
  RISK_SETTLING_BUSINESS_DAYS,
} from "./risk.js";

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

function appendUnknownDays(
  points: readonly PortfolioValuePoint[],
  days: number,
): PortfolioValuePoint[] {
  const last = points.at(-1)!;
  const extra: PortfolioValuePoint[] = [];
  let cursor = new Date(`${last.date}T00:00:00Z`);
  while (extra.length < days) {
    cursor = new Date(cursor.getTime() + 86_400_000);
    if (cursor.getUTCDay() === 0 || cursor.getUTCDay() === 6) continue;
    extra.push({ ...last, date: cursor.toISOString().slice(0, 10), unpriced: ["AAPL"] });
  }
  const appended = [...points, ...extra];
  if (businessDaysAfter(last.date, appended.at(-1)!.date) !== days)
    throw new Error(`appendUnknownDays(${days}) drifted from businessDaysAfter's own count`);
  return appended;
}

test("warns when the measured risk window contains negative cash", () => {
  const points = pointsFromReturns(
    Array.from({ length: RISK_MINIMUM_OBSERVATIONS + 2 }, (_, index) =>
      index % 2 === 0 ? 0.01 : -0.005,
    ),
  );
  for (const index of [10, 11, 12]) {
    points[index] = { ...points[index]!, positionsValue: points[index]!.value! + 5, cashValue: -5 };
  }

  const report = buildHistoricalRisk(dashboard(points));

  expect(report.risk.status).toBe("estimate");
  expect(report.risk.reasons).toContain(
    "Cash balance is below zero on 3 dates; risk estimates may be inaccurate.",
  );
});

function benchmarkFromReturns(returns: readonly number[], currency = "EUR"): BenchmarkSeries {
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
  const benchmarkReturns = Array.from({ length: RISK_MINIMUM_OBSERVATIONS }, (_, index) =>
    index % 4 === 0 ? 0.012 : index % 4 === 1 ? -0.007 : index % 4 === 2 ? 0.004 : -0.002,
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

test.each(incompleteQualityCases)(
  "returns no risk metrics for %s in strict window",
  (_label, quality) => {
    const points = pointsFromReturns(
      Array.from({ length: RISK_MINIMUM_OBSERVATIONS }, () => 0.001),
    );
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
    expect(report.risk.from).toBe(points[0]!.date);
    expect(report.risk.reasons).toContain(
      `At least ${RISK_MINIMUM_OBSERVATIONS} valid daily returns are required.`,
    );
  },
);

test("measures the complete window after an incomplete stretch", () => {
  const points = pointsFromReturns(
    Array.from({ length: RISK_MINIMUM_OBSERVATIONS + 20 }, (_, index) => (index % 2 ? 0.002 : 0)),
  );
  points[10] = { ...points[10]!, unpriced: ["MASI"] };
  const report = buildHistoricalRisk(dashboard(points));

  expect(report.risk.status).toBe("estimate");
  expect(report.risk.from).toBe(points[0]!.date);
  expect(report.metrics.observationDays).toBe(points.length - 3);
  expect(report.risk.missingPrices).toEqual(["MASI"]);
});

test("keeps daily returns from before an isolated incomplete date instead of discarding all earlier history", () => {
  // ~14 months of business days, one broker cash-history gap about a third
  // of the way back. Only the interval touching that date is unmeasurable;
  // the roughly 200 clean days before and after it are real, knowable
  // returns and must still count.
  const points = pointsFromReturns(Array.from({ length: 300 }, () => 0.0005));
  const gapIndex = 100;
  points[gapIndex] = { ...points[gapIndex]!, cashUnknown: ["trading212:EUR"] };
  const report = buildHistoricalRisk(dashboard(points, { flows: [] }), "All");

  expect(report.risk.status).toBe("estimate");
  expect(report.metrics.observationDays).toBe(points.length - 3);
  expect(report.risk.from).toBe(points[0]!.date);
  expect(report.risk.to).toBe(points.at(-1)!.date);
  expect(report.risk.drawdownFrom).toBe(points[gapIndex + 1]!.date);
  expect(report.metrics.annualizedVolatility).not.toBeNull();
});

test("benchmark pairs also survive an isolated incomplete portfolio date", () => {
  const returns = Array.from({ length: 300 }, (_, index) =>
    index % 4 === 0 ? 0.012 : index % 4 === 1 ? -0.007 : index % 4 === 2 ? 0.004 : -0.002,
  );
  const points = pointsFromReturns(returns);
  const gapIndex = 100;
  points[gapIndex] = { ...points[gapIndex]!, cashUnknown: ["trading212:EUR"] };
  const report = buildHistoricalRisk(
    dashboard(points, { benchmarks: [benchmarkFromReturns(returns)] }),
    "All",
  );

  expect(report.risk.status).toBe("estimate");
  expect(report.metrics.pairedObservationDays).toBe(points.length - 3);
  expect(report.metrics.beta).not.toBeNull();
});

test("max drawdown still removes an owner withdrawal even after an isolated incomplete date shrinks its window", () => {
  const points = pointsFromReturns(Array.from({ length: 90 }, () => 0.001));
  points[10] = { ...points[10]!, cashUnknown: ["trading212:EUR"] };
  const withdrawalIndex = 50;
  const withdrawalDate = points[withdrawalIndex]!.date;
  points[withdrawalIndex] = {
    ...points[withdrawalIndex]!,
    value: points[withdrawalIndex]!.value! - 40,
  };
  const report = buildHistoricalRisk(
    dashboard(points, { flows: [{ date: withdrawalDate, amount: -40 }] }),
  );

  expect(report.risk.status).toBe("estimate");
  expect(report.metrics.maxDrawdown).toBeCloseTo(0, 6);
});

test("measures risk through the last known date instead of hiding it when today is still settling", () => {
  const points = pointsFromReturns(
    Array.from({ length: RISK_MINIMUM_OBSERVATIONS + 20 }, () => 0.001),
  );
  const priorDate = points.at(-2)!.date;
  points[points.length - 1] = { ...points.at(-1)!, unpriced: ["AAPL"] };

  const report = buildHistoricalRisk(dashboard(points));

  expect(report.risk.status).toBe("estimate");
  expect(report.risk.to).toBe(priorDate);
  expect(report.metrics.observationDays).toBeGreaterThanOrEqual(RISK_MINIMUM_OBSERVATIONS);
  expect(report.metrics.annualizedVolatility).not.toBeNull();
  expect(report.risk.drawdownFrom).toBe(points[0]!.date);
  expect(report.risk.missingPrices).toEqual(["AAPL"]);
  expect(report.risk.reasons).toContain(
    `Measured through ${priorDate}; later dates are still settling.`,
  );
});

test("an interior gap plus an incomplete last day still measures through the last known date", () => {
  const points = pointsFromReturns(Array.from({ length: 300 }, () => 0.0005));
  const gapIndex = 100;
  points[gapIndex] = { ...points[gapIndex]!, cashUnknown: ["trading212:EUR"] };
  const priorDate = points.at(-2)!.date;
  points[points.length - 1] = { ...points.at(-1)!, unpriced: ["AAPL"] };

  const report = buildHistoricalRisk(dashboard(points, { flows: [] }), "All");

  expect(report.risk.status).toBe("estimate");
  expect(report.risk.to).toBe(priorDate);
  expect(report.risk.drawdownFrom).toBe(points[gapIndex + 1]!.date);
  expect(report.risk.reasons).toContain(
    `Measured through ${priorDate}; later dates are still settling.`,
  );
});

test("caps how stale the last known date may be before the estimate goes unavailable", () => {
  const base = pointsFromReturns(
    Array.from({ length: RISK_MINIMUM_OBSERVATIONS + 20 }, () => 0.001),
  );
  const lastKnownDate = base.at(-1)!.date;

  const withinCap = buildHistoricalRisk(dashboard(appendUnknownDays(base, 3)));
  expect(withinCap.risk.status).toBe("estimate");
  expect(withinCap.risk.to).toBe(lastKnownDate);

  const staleExtended = appendUnknownDays(base, RISK_MAX_STALE_BUSINESS_DAYS + 3);
  const firstBadDate = staleExtended[base.length]!.date;
  const pastCap = buildHistoricalRisk(dashboard(staleExtended));
  expect(pastCap.risk.status).toBe("unavailable");
  expect(pastCap.risk.reasons).toContain(`Risk data has been incomplete since ${firstBadDate}.`);
});

test("names a short trailing gap as still settling and a longer one as incomplete", () => {
  const base = pointsFromReturns(
    Array.from({ length: RISK_MINIMUM_OBSERVATIONS + 20 }, () => 0.001),
  );
  const lastKnownDate = base.at(-1)!.date;

  const settling = buildHistoricalRisk(
    dashboard(appendUnknownDays(base, RISK_SETTLING_BUSINESS_DAYS)),
  );
  expect(settling.risk.status).toBe("estimate");
  expect(settling.risk.reasons).toContain(
    `Measured through ${lastKnownDate}; later dates are still settling.`,
  );

  const incomplete = buildHistoricalRisk(
    dashboard(appendUnknownDays(base, RISK_SETTLING_BUSINESS_DAYS + 3)),
  );
  expect(incomplete.risk.status).toBe("estimate");
  expect(incomplete.risk.reasons).toContain(
    `Measured through ${lastKnownDate}; later dates are incomplete.`,
  );
});

test("includes a last day whose close is still settling when the position is immaterial", () => {
  const points = pointsFromReturns(
    Array.from({ length: RISK_MINIMUM_OBSERVATIONS + 1 }, (_, index) => (index % 2 ? 0.002 : 0)),
  );
  const last = points.at(-1)!;
  points[points.length - 1] = {
    ...last,
    forwardFilled: ["AAPL"],
    unaccountedValue: last.value! * 0.0003,
  };
  const report = buildHistoricalRisk(dashboard(points));

  expect(report.risk.status).toBe("estimate");
  expect(report.risk.to).toBe(last.date);
  expect(report.risk.coverage).not.toBeNull();
  expect(report.risk.coverage!).toBeLessThan(1);
  expect(report.risk.reasons).toEqual([
    expect.stringMatching(/^Estimate covers \d+\.\d{2}% of portfolio value/),
    "Add a benchmark with Compare above to calculate beta and alpha.",
  ]);
});

test("measures through the prior day when the last day's carried-forward position is too large to bound", () => {
  const points = pointsFromReturns(
    Array.from({ length: RISK_MINIMUM_OBSERVATIONS + 1 }, (_, index) => (index % 2 ? 0.002 : 0)),
  );
  const last = points.at(-1)!;
  const priorDate = points.at(-2)!.date;
  points[points.length - 1] = {
    ...last,
    forwardFilled: ["AAPL"],
    unaccountedValue: last.value! * 0.2,
  };
  const report = buildHistoricalRisk(dashboard(points));

  expect(report.risk.status).toBe("estimate");
  expect(report.risk.to).toBe(priorDate);
  expect(report.metrics.annualizedVolatility).not.toBeNull();
  expect(report.risk.reasons).toContain(
    `Measured through ${priorDate}; later dates are still settling.`,
  );
});

test("keeps beta and alpha null when no benchmark is selected", () => {
  const points = pointsFromReturns(
    Array.from({ length: RISK_MINIMUM_OBSERVATIONS }, (_, index) => (index % 2 ? 0.01 : -0.005)),
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
  const returns = Array.from({ length: RISK_MINIMUM_OBSERVATIONS }, (_, index) =>
    index % 2 ? 0.01 : -0.005,
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

test("a benchmark converted by buildInvestingDashboard resolves comparable without touching risk.ts", () => {
  const dates = businessDates(RISK_MINIMUM_OBSERVATIONS + 1);
  const benchmarkReturns = Array.from({ length: RISK_MINIMUM_OBSERVATIONS }, (_, index) =>
    index % 4 === 0 ? 0.012 : index % 4 === 1 ? -0.007 : index % 4 === 2 ? 0.004 : -0.002,
  );
  const portfolioReturns = benchmarkReturns.map((value) => 1.5 * value + 0.0007);

  let usdClose = 100;
  const usdBars = dates.map((date, index) => {
    if (index > 0) usdClose *= 1 + benchmarkReturns[index - 1]!;
    return { symbol: "SP500US", date, close: usdClose, currency: "USD" };
  });
  const fxRates = dates.map((date) => ({ base: "EUR", date, rates: { USD: 1.1 } }));

  const converted = buildInvestingDashboard({
    positions: [],
    trades: [],
    dividends: [],
    priceBars: [],
    benchmarkBars: usdBars,
    benchmarkInstruments: [
      { symbol: "SP500US", name: "S&P 500", exchange: "NYSE Arca", currency: "USD" },
    ],
    presentationCurrency: "EUR",
    fxRates,
    today: dates.at(-1)!,
  }).benchmarks[0]!;
  expect(converted.currency).toBe("EUR");
  expect(converted.converted).toBe(true);

  const report = buildHistoricalRisk(
    dashboard(pointsFromReturns(portfolioReturns), { benchmarks: [converted] }),
  );

  expect(report.risk.status).toBe("estimate");
  expect(report.metrics.beta).toBeCloseTo(1.5, 6);
  expect(report.metrics.alpha).toBeCloseTo(0.0007 * 252, 6);
  expect(report.risk.reasons.some((reason) => reason.startsWith("Beta and alpha need a"))).toBe(
    false,
  );
});

test("benchmarkCurrencyMismatchReason builds the mismatch sentence", () => {
  expect(benchmarkCurrencyMismatchReason("EUR", { symbol: "SPY", currency: "USD" })).toBe(
    "Beta and alpha need a EUR-quoted benchmark; SPY is quoted in USD.",
  );
});

test("treats a small unresolved holding as immaterial and reports coverage", () => {
  const points = pointsFromReturns(
    Array.from({ length: RISK_MINIMUM_OBSERVATIONS + 5 }, () => 0.001),
  ).map((point) => ({
    ...point,
    holdingsUnknown: ["TWND_US_EQ"],
    unaccountedValue: point.value! * 0.0003,
  }));
  const report = buildHistoricalRisk(dashboard(points));

  expect(report.risk.status).toBe("estimate");
  expect(report.metrics.annualizedVolatility).not.toBeNull();
  expect(report.risk.coverage).not.toBeNull();
  expect(report.risk.coverage!).toBeGreaterThan(0.999);
  expect(report.risk.coverage!).toBeLessThan(1);
  expect(report.risk.reasons.some((reason) => reason.startsWith("Estimate covers"))).toBe(true);
});

test("still disqualifies a materially large unresolved holding", () => {
  const points = pointsFromReturns(
    Array.from({ length: RISK_MINIMUM_OBSERVATIONS + 5 }, () => 0.001),
  ).map((point) => ({
    ...point,
    holdingsUnknown: ["TWND_US_EQ"],
    unaccountedValue: point.value! * 0.2,
  }));
  const report = buildHistoricalRisk(dashboard(points));

  expect(report.risk.status).toBe("unavailable");
});

test("a tiny holding failing through holdingsUnknown, unpriced, and forwardFilled still yields a usable window", () => {
  const points = pointsFromReturns(Array.from({ length: 287 }, () => 0.0005));
  const tiny = (point: PortfolioValuePoint) => point.value! * 0.0003;
  points[40] = {
    ...points[40]!,
    holdingsUnknown: ["TWND_US_EQ"],
    unaccountedValue: tiny(points[40]!),
  };
  points[120] = { ...points[120]!, unpriced: ["TWND_US_EQ"], unaccountedValue: tiny(points[120]!) };
  const last = points.at(-1)!;
  points[points.length - 1] = {
    ...last,
    forwardFilled: ["TWND_US_EQ"],
    unaccountedValue: tiny(last),
  };

  const report = buildHistoricalRisk(dashboard(points));

  expect(report.risk.status).toBe("estimate");
  expect(report.metrics.observationDays).toBeGreaterThan(RISK_MINIMUM_OBSERVATIONS);
  expect(report.risk.to).toBe(last.date);
  expect(report.risk.from).toBe(points[0]!.date);
  expect(report.risk.coverage).not.toBeNull();
  expect(report.risk.coverage!).toBeLessThan(1);
});

test.each([
  [
    "holdingsUnknown",
    (point: PortfolioValuePoint): PortfolioValuePoint => ({
      ...point,
      holdingsUnknown: ["TWND_US_EQ"],
    }),
  ],
  [
    "unpriced",
    (point: PortfolioValuePoint): PortfolioValuePoint => ({
      ...point,
      unpriced: ["TWND_US_EQ"],
    }),
  ],
  [
    "forwardFilled",
    (point: PortfolioValuePoint): PortfolioValuePoint => ({
      ...point,
      forwardFilled: ["TWND_US_EQ"],
    }),
  ],
])(
  "a holding at 20%% of value on the latest date via %s is dropped, not shown as valid",
  (_route, apply) => {
    const points = pointsFromReturns(Array.from({ length: 287 }, () => 0.0005));
    const last = points.at(-1)!;
    const priorDate = points.at(-2)!.date;
    points[points.length - 1] = { ...apply(last), unaccountedValue: last.value! * 0.2 };

    const report = buildHistoricalRisk(dashboard(points));

    expect(report.risk.status).toBe("estimate");
    expect(report.risk.to).toBe(priorDate);
    expect(report.risk.reasons).toContain(
      `Measured through ${priorDate}; later dates are still settling.`,
    );
  },
);

test("requires 60 valid daily return observations", () => {
  const short = buildHistoricalRisk(
    dashboard(pointsFromReturns(Array.from({ length: 59 }, () => 0.001))),
  );
  const enough = buildHistoricalRisk(
    dashboard(pointsFromReturns(Array.from({ length: 60 }, (_, index) => (index % 2 ? 0.002 : 0)))),
  );

  expect(short.risk.status).toBe("unavailable");
  expect(short.metrics.observationDays).toBe(59);
  expect(short.metrics.annualizedVolatility).toBeNull();
  expect(enough.risk.status).toBe("estimate");
  expect(enough.metrics.observationDays).toBe(60);
  expect(enough.metrics.annualizedVolatility).not.toBeNull();
});

test("risk is available once the broker's proven trade window makes the holding known", () => {
  const days: string[] = [];
  for (let at = new Date("2025-09-29T00:00:00Z"); at <= new Date("2026-10-05T00:00:00Z");) {
    if (at.getUTCDay() !== 0 && at.getUTCDay() !== 6) days.push(at.toISOString().slice(0, 10));
    at = new Date(at.getTime() + 86_400_000);
  }
  const dates = days.filter((date) => date >= "2025-10-02" && date <= "2026-10-02");
  const bars = days.map((date, index) => ({
    symbol: "VUSA",
    date,
    close: 100 + (index % 7) - (index % 3),
    currency: "EUR",
  }));
  const data = buildInvestingDashboard({
    positions: [
      {
        entity: "personal",
        broker: "ibkr",
        symbol: "VUSA",
        quantity: 93,
        averagePrice: 100,
        marketPrice: 100,
        marketValue: 9300,
        currency: "EUR",
        asOf: "2026-10-02",
      },
    ],
    trades: [],
    dividends: [],
    cashBalances: [
      { entity: "personal", broker: "ibkr", currency: "EUR", amount: 1, asOf: "2026-10-02" },
    ],
    cashFlows: [
      {
        id: "early-deposit",
        entity: "personal",
        broker: "ibkr",
        date: "2025-09-29",
        currency: "EUR",
        amount: 0,
        kind: "deposit",
      },
    ],
    priceBars: bars,
    benchmarkBars: [],
    presentationCurrency: "EUR",
    fxRates: [],
    today: "2026-10-05",
    cashCoverage: [
      {
        entity: "personal",
        broker: "ibkr",
        status: "complete",
        from: "2025-10-02",
        to: "2026-10-02",
        tradeCash: "cash-flows",
        quantityProvenFrom: "2025-10-02",
      },
    ],
  });

  const report = buildHistoricalRisk(data, "1Y");

  expect(dates.length).toBeGreaterThanOrEqual(250);
  expect(report.metrics.observationDays).toBeGreaterThanOrEqual(RISK_MINIMUM_OBSERVATIONS);
  expect(report.metrics.dailyVolatility).not.toBeNull();
});
