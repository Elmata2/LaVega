import { expect, test } from "vitest";
import {
  buildInvestingDashboard,
  emptyInvestingDashboard,
  type InvestingDashboardInput,
} from "./dashboard.js";
import {
  BENCHMARK_BARS,
  FX_RATES,
  POSITIONS,
  PRICE_BARS,
  TRADES,
} from "./__fixtures__/portfolio.js";

test("empty dashboard has every range and no invented records", () => {
  expect(emptyInvestingDashboard()).toEqual({
    dataVersion: 0,
    presentationCurrency: "EUR",
    benchmarks: [],
    portfolio: { "1M": [], "6M": [], "1Y": [], YTD: [], All: [] },
    externalCashFlows: [],
    allocation: {
      instrument: { buckets: [], unpriced: [] },
      entity: { buckets: [], unpriced: [] },
    },
    positions: [],
    position: null,
    problems: [],
  });
});

test("dashboard builder returns finished chart series and selected position markers", () => {
  const dashboard = buildInvestingDashboard({
    positions: POSITIONS,
    trades: TRADES,
    dividends: [
      {
        id: "dividend",
        entity: "personal",
        broker: "ibkr",
        date: "2026-01-05",
        symbol: "AAPL",
        amount: 1.5,
        currency: "USD",
      },
    ],
    priceBars: PRICE_BARS,
    benchmarkBars: BENCHMARK_BARS,
    presentationCurrency: "EUR",
    fxRates: FX_RATES,
    selectedSymbol: "aapl",
    today: "2026-02-02",
  });

  expect(dashboard.portfolio.All[0]).toMatchObject({
    date: "2026-01-02",
    positionsValue: 2200,
    cashValue: null,
    value: 2200,
  });
  expect(dashboard.allocation.instrument.buckets).toHaveLength(2);
  expect(dashboard.positions.map((position) => position.symbol)).toEqual(["AAPL", "MSFT"]);
  expect(dashboard.position?.symbol).toBe("AAPL");
  expect(dashboard.position?.points[1]?.markers).toEqual([
    {
      kind: "buy",
      eventDate: "2026-01-03",
      label: "Koop 2",
      quantity: 2,
      executionPrice: 100,
      amount: 200,
      commission: 0,
      currency: "USD",
    },
    {
      kind: "dividend",
      eventDate: "2026-01-05",
      label: "Dividend 1.5 USD",
      amount: 1.5,
      dividendAmount: 1.5,
      currency: "USD",
    },
  ]);
  expect(dashboard.position).toMatchObject({
    status: "open",
    quantity: 10,
    averageCost: 100,
    firstBuyDate: "2026-01-02",
  });
  expect(dashboard.position?.currentValue).toBeCloseTo(1200 / 1.1);
});

test("undefined fxRates (a failed FX provider) marks foreign positions missing-fx instead of crashing or pricing wrong", () => {
  const dashboard = buildInvestingDashboard({
    positions: POSITIONS,
    trades: TRADES,
    dividends: [],
    priceBars: PRICE_BARS,
    benchmarkBars: BENCHMARK_BARS,
    presentationCurrency: "EUR",
    fxRates: undefined,
    selectedSymbol: "aapl",
    problems: ["FX-koers kon niet worden geladen"],
    today: "2026-02-02",
  });

  expect(dashboard.positions.every((position) => position.priceStatus === "missing-fx")).toBe(true);
  expect(dashboard.positions.every((position) => position.marketValue === null)).toBe(true);
  expect(dashboard.portfolio.All.at(-1)).toMatchObject({ positionsValue: null, value: null });
  expect(dashboard.position?.currentValue).toBeNull();
  // The FX provider's own failure reason, passed in by the caller, must
  // reach the read model unchanged so the UI can surface it.
  expect(dashboard.problems).toEqual(["FX-koers kon niet worden geladen"]);
});

test("a non-FX failure in return calculation reaches problems instead of claiming missing-fx", () => {
  const dashboard = buildInvestingDashboard({
    positions: [
      {
        entity: "personal",
        symbol: "GBPCO",
        quantity: 1,
        averagePrice: 10,
        marketPrice: 10,
        marketValue: 10,
        currency: "EUR",
        asOf: "2026-01-05",
      },
    ],
    trades: [
      {
        id: "buy",
        entity: "personal",
        date: "2026-01-02",
        symbol: "GBPCO",
        side: "buy",
        quantity: 1,
        price: 10,
        amount: 10,
        currency: "GBP",
        commission: 0,
      },
    ],
    dividends: [],
    priceBars: [{ symbol: "GBPCO", date: "2026-01-05", close: 10, currency: "EUR" }],
    benchmarkBars: [],
    presentationCurrency: "EUR",
    fxRates: { base: "EUR", date: "2026-01-02", rates: {} },
    today: "2026-01-05",
  });

  const position = dashboard.positions.find((entry) => entry.symbol === "GBPCO")!;
  expect(position.returns.status).not.toBe("missing-fx");
  expect(dashboard.problems).toEqual(["GBPCO: Unknown currency: GBP"]);
});

test("portfolio weight over an unpriced subset gets a problem instead of a silent 100 percent", () => {
  const dashboard = buildInvestingDashboard({
    positions: [
      {
        entity: "personal",
        symbol: "PRICED",
        quantity: 1,
        averagePrice: 10,
        marketPrice: 10,
        marketValue: 10,
        currency: "EUR",
        asOf: "2026-01-05",
      },
      {
        entity: "personal",
        symbol: "DARK",
        quantity: 1,
        averagePrice: 10,
        marketPrice: 10,
        marketValue: 10,
        currency: "EUR",
        asOf: "2026-01-05",
      },
    ],
    trades: [
      {
        id: "p1",
        entity: "personal",
        date: "2026-01-02",
        symbol: "PRICED",
        side: "buy",
        quantity: 1,
        price: 10,
        amount: 10,
        currency: "EUR",
        commission: 0,
      },
      {
        id: "d1",
        entity: "personal",
        date: "2026-01-02",
        symbol: "DARK",
        side: "buy",
        quantity: 1,
        price: 10,
        amount: 10,
        currency: "EUR",
        commission: 0,
      },
    ],
    dividends: [],
    priceBars: [{ symbol: "PRICED", date: "2026-01-05", close: 10, currency: "EUR" }],
    benchmarkBars: [],
    presentationCurrency: "EUR",
    fxRates: undefined,
    today: "2026-01-05",
  });

  const priced = dashboard.positions.find((entry) => entry.symbol === "PRICED")!;
  expect(priced.portfolioWeight).toBe(1);
  expect(dashboard.problems).toEqual([
    "Portfolio weight is calculated only across priced positions: 1 of 2 positions are unpriced and excluded from the total.",
  ]);
});

test("allocation uses current price bars and omits values beyond the five-day cap", () => {
  const dashboard = buildInvestingDashboard({
    positions: [
      {
        entity: "personal",
        symbol: "STALE",
        quantity: 2,
        averagePrice: 8,
        marketPrice: 999,
        marketValue: 1998,
        currency: "EUR",
        asOf: "2026-01-13",
      },
    ],
    trades: [
      {
        id: "buy",
        entity: "personal",
        date: "2026-01-02",
        symbol: "STALE",
        side: "buy",
        quantity: 2,
        price: 8,
        amount: 16,
        currency: "EUR",
        commission: 0,
      },
    ],
    dividends: [],
    priceBars: [{ symbol: "STALE", date: "2026-01-02", close: 10, currency: "EUR" }],
    benchmarkBars: [],
    presentationCurrency: "EUR",
    fxRates: [],
    today: "2026-01-13",
  });
  expect(dashboard.positions[0]).toMatchObject({ marketValue: null, priceStatus: "unpriced" });
  expect(dashboard.allocation.instrument).toEqual({
    buckets: [{ key: "STALE", label: "STALE", value: null, unpriced: true }],
    unpriced: ["STALE"],
  });
});

test("dashboard resolves a closed historical symbol with return and stable activity", () => {
  const dashboard = buildInvestingDashboard({
    positions: [],
    trades: [
      {
        id: "buy",
        entity: "personal",
        date: "2026-01-02",
        symbol: "CLOSED",
        description: "Closed Co",
        side: "buy",
        quantity: 2,
        price: 10,
        amount: 20,
        currency: "EUR",
        commission: 1,
      },
      {
        id: "sell-1",
        entity: "personal",
        date: "2026-01-05",
        symbol: "CLOSED",
        side: "sell",
        quantity: 1,
        price: 14,
        amount: 14,
        currency: "EUR",
        commission: 1,
      },
      {
        id: "sell-2",
        entity: "personal",
        date: "2026-01-05",
        symbol: "CLOSED",
        side: "sell",
        quantity: 1,
        price: 15,
        amount: 15,
        currency: "EUR",
        commission: 1,
      },
    ],
    dividends: [
      {
        id: "div",
        entity: "personal",
        broker: "ibkr",
        date: "2026-01-05",
        symbol: "CLOSED",
        amount: 2,
        currency: "EUR",
      },
    ],
    priceBars: [
      { symbol: "CLOSED", date: "2026-01-02", close: 10, currency: "EUR" },
      { symbol: "CLOSED", date: "2026-01-05", close: 15, currency: "EUR" },
    ],
    benchmarkBars: [],
    presentationCurrency: "EUR",
    fxRates: [],
    selectedSymbol: "closed",
    today: "2026-01-06",
  });
  expect(dashboard.position).toMatchObject({
    symbol: "CLOSED",
    description: "Closed Co",
    status: "closed",
    quantity: 0,
    currentValue: null,
    currentPrice: null,
    returns: {
      status: "available",
      unrealizedGain: 0,
      realizedGain: 6,
      dividendsReceived: 2,
      totalReturn: 8,
      totalReturnPercentage: 8 / 21,
    },
    quantityHistory: [
      { date: "2026-01-02", quantity: 2, delta: 2, reason: "buy", sourceOrder: 0 },
      { date: "2026-01-05", quantity: 1, delta: -1, reason: "sell", sourceOrder: 1 },
      { date: "2026-01-05", quantity: 0, delta: -1, reason: "sell", sourceOrder: 2 },
    ],
  });
  expect(
    dashboard.position?.activity.map((item) => `${item.date}:${item.kind}:${item.sourceOrder}`),
  ).toEqual([
    "2026-01-05:sell:1",
    "2026-01-05:sell:2",
    "2026-01-05:dividend:3",
    "2026-01-02:buy:0",
  ]);
});

test("position detail does not estimate incomplete return history", () => {
  const dashboard = buildInvestingDashboard({
    positions: [
      {
        entity: "personal",
        symbol: "PARTIAL",
        quantity: 2,
        averagePrice: null,
        marketPrice: 10,
        marketValue: 20,
        currency: "EUR",
        asOf: "2026-01-05",
      },
    ],
    trades: [
      {
        id: "partial",
        entity: "personal",
        date: "2026-01-02",
        symbol: "PARTIAL",
        side: "buy",
        quantity: 1,
        price: null,
        amount: null,
        currency: "EUR",
        commission: null,
      },
    ],
    dividends: [],
    priceBars: [{ symbol: "PARTIAL", date: "2026-01-05", close: 10, currency: "EUR" }],
    benchmarkBars: [],
    presentationCurrency: "EUR",
    fxRates: [],
    selectedSymbol: "PARTIAL",
    today: "2026-01-05",
  });
  expect(dashboard.position).toMatchObject({
    returnStatus: "missing-cost",
    returns: { totalReturn: null, realizedGain: null },
    averageCost: null,
  });
});

test("broker cost after an unreconciled sale exposes unrealized return only", () => {
  const dashboard = buildInvestingDashboard({
    positions: [
      {
        entity: "personal",
        symbol: "PARTIAL-SALE",
        quantity: 2,
        brokerCost: { status: "known", amount: 20, currency: "EUR" },
        averagePrice: 10,
        marketPrice: 15,
        marketValue: 30,
        currency: "EUR",
        asOf: "2026-01-05",
      },
    ],
    trades: [
      {
        id: "known-buy-only",
        entity: "personal",
        date: "2026-01-02",
        symbol: "PARTIAL-SALE",
        side: "buy",
        quantity: 4,
        price: 10,
        amount: 40,
        currency: "EUR",
        commission: null,
      },
    ],
    dividends: [],
    priceBars: [{ symbol: "PARTIAL-SALE", date: "2026-01-05", close: 15, currency: "EUR" }],
    benchmarkBars: [],
    presentationCurrency: "EUR",
    fxRates: [],
    selectedSymbol: "PARTIAL-SALE",
    today: "2026-01-05",
  });

  expect(dashboard.positions[0]).toMatchObject({
    returns: { status: "broker-unrealized", unrealizedGain: 10, totalReturn: null },
  });
  expect(dashboard.position).toMatchObject({
    returnStatus: "broker-unrealized",
    returns: { realizedGain: null, unrealizedGain: 10, totalReturn: null },
  });
});

test("dashboard exposes cash-aware value fields and netted external TWR inputs", () => {
  const dashboard = buildInvestingDashboard({
    positions: POSITIONS,
    trades: TRADES,
    dividends: [],
    cashBalances: [
      { entity: "personal", broker: "ibkr", currency: "EUR", amount: 300, asOf: "2026-02-02" },
    ],
    cashFlows: [
      {
        id: "deposit",
        entity: "personal",
        broker: "ibkr",
        date: "2026-01-05",
        currency: "EUR",
        amount: 250,
        kind: "deposit",
      },
      {
        id: "withdrawal",
        entity: "personal",
        broker: "ibkr",
        date: "2026-01-05",
        currency: "EUR",
        amount: -50,
        kind: "withdrawal",
      },
      {
        id: "fee",
        entity: "personal",
        broker: "ibkr",
        date: "2026-01-05",
        currency: "EUR",
        amount: -5,
        kind: "fee",
      },
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
  expect(dashboard.portfolio.All.at(-1)).toMatchObject({
    positionsValue: 2090.909090909091,
    cashValue: 300,
    value: 2390.909090909091,
    cashUnknown: [],
  });
});

test("a deposit or withdrawal with an unknown amount stays unmeasurable, not a crash or a guessed sign", () => {
  const dashboard = buildInvestingDashboard({
    positions: [],
    trades: [],
    dividends: [],
    cashBalances: [
      { entity: "personal", broker: "ibkr", currency: "EUR", amount: 300, asOf: "2026-01-05" },
    ],
    cashFlows: [
      {
        id: "known",
        entity: "personal",
        broker: "ibkr",
        date: "2026-01-05",
        currency: "EUR",
        amount: 50,
        kind: "deposit",
      },
      {
        id: "unknown",
        entity: "personal",
        broker: "ibkr",
        date: "2026-01-05",
        currency: "EUR",
        amount: null,
        kind: "deposit",
      },
    ],
    priceBars: [],
    benchmarkBars: [],
    presentationCurrency: "EUR",
    fxRates: FX_RATES,
    today: "2026-01-05",
    dataVersion: 1,
  });

  expect(dashboard.externalCashFlows).toEqual([{ date: "2026-01-05", amount: null }]);
});
function freshnessInput() {
  return {
    positions: [
      {
        entity: "personal",
        symbol: "A",
        quantity: 1,
        averagePrice: 15,
        marketPrice: 15,
        marketValue: 15,
        currency: "EUR",
        asOf: "2026-09-14",
      },
    ],
    trades: [
      {
        id: "buy",
        entity: "personal",
        date: "2026-07-01",
        symbol: "A",
        side: "buy",
        quantity: 1,
        price: 15,
        amount: 15,
        currency: "EUR",
        commission: 0,
      },
    ],
    dividends: [],
    priceBars: [],
    benchmarkBars: [],
    presentationCurrency: "EUR",
    fxRates: [],
    selectedSymbol: "a",
    today: "2026-09-14",
  } satisfies InvestingDashboardInput;
}

function freshnessDashboard(barDates: string[]) {
  return buildInvestingDashboard({
    ...freshnessInput(),
    priceBars: barDates.map((date) => ({ symbol: "A", date, close: 20, currency: "EUR" })),
  });
}

test("list and detail agree on availability at 0, 5 and 6 business days", () => {
  for (const [barDate, expected] of [
    ["2026-09-14", "priced"],
    ["2026-09-07", "forward-filled"],
    ["2026-09-04", "unpriced"],
  ] as const) {
    const dashboard = freshnessDashboard([barDate]);
    const available = expected !== "unpriced";
    expect(dashboard.positions[0]).toMatchObject({
      priceStatus: expected,
      marketValue: available ? 20 : null,
    });
    expect(dashboard.position).toMatchObject({
      priceStatus: expected,
      currentValue: available ? 20 : null,
      currentPrice: available ? 20 : null,
    });
    expect(dashboard.position?.returns.unrealizedGain).toBe(available ? 5 : null);
  }
});

test("a future-dated bar values neither list nor detail", () => {
  const dashboard = freshnessDashboard(["2026-09-21"]);
  expect(dashboard.positions[0]).toMatchObject({ marketValue: null, priceStatus: "unpriced" });
  expect(dashboard.position).toMatchObject({
    currentValue: null,
    currentPrice: null,
    priceStatus: "unpriced",
    quoteDate: null,
  });

  const withToday = freshnessDashboard(["2026-09-14", "2026-09-21"]);
  expect(withToday.positions[0]).toMatchObject({ marketValue: 20, priceStatus: "priced" });
  expect(withToday.position).toMatchObject({
    currentValue: 20,
    priceStatus: "priced",
    quoteDate: "2026-09-14",
  });
});

test("a stale detail keeps its chart history and invents no daily change", () => {
  const dashboard = freshnessDashboard(["2026-07-01", "2026-08-03"]);
  expect(dashboard.position?.points.map((point) => point.date)).toEqual([
    "2026-07-01",
    "2026-08-03",
  ]);
  expect(dashboard.position).toMatchObject({
    currentValue: null,
    dailyChange: null,
    dailyChangePercentage: null,
    priceStatus: "unpriced",
    quoteDate: "2026-08-03",
  });
});

test("a multiweek quote gap is not reported as one day of movement", () => {
  const gapped = freshnessDashboard(["2026-08-03", "2026-09-14"]);
  expect(gapped.position).toMatchObject({
    currentValue: 20,
    dailyChange: null,
    dailyChangePercentage: null,
  });

  const consecutive = buildInvestingDashboard({
    ...freshnessInput(),
    priceBars: [
      { symbol: "A", date: "2026-09-11", close: 16, currency: "EUR" },
      { symbol: "A", date: "2026-09-14", close: 20, currency: "EUR" },
    ],
  });
  expect(consecutive.position).toMatchObject({ dailyChange: 4, dailyChangePercentage: 0.25 });
});
