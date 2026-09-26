import { expect, test } from "vitest";
import type {
  CashBalance,
  CashFlow,
  CashHistoryCoverage,
  Position,
  PriceBar,
  Trade,
} from "./model.js";
import {
  computePortfolioValueSeries,
  filterPortfolioValueRange,
  type PortfolioValuePoint,
} from "./portfolio.js";
import { FX_RATES, POSITIONS, PRICE_BARS, TRADES } from "./__fixtures__/portfolio.js";

const complete = (
  broker: string,
  from: string,
  tradeCash: "trade-settlement" | "cash-flows",
  to = "2026-01-06",
): CashHistoryCoverage => ({ entity: "personal", broker, status: "complete", from, to, tradeCash });

const point = (date: string, value: number, unpriced: string[] = []): PortfolioValuePoint => ({
  date,
  positionsValue: value,
  cashValue: null,
  value,
  unpriced,
  forwardFilled: [],
  cashUnknown: [],
});

test("values holdings by walking trades out from the broker position", () => {
  const result = computePortfolioValueSeries(POSITIONS, TRADES, PRICE_BARS, "EUR", FX_RATES, {
    today: "2026-02-02",
  });

  expect(result.find(({ date }) => date === "2026-01-02")).toEqual(point("2026-01-02", 2200));
  expect(result.find(({ date }) => date === "2026-01-05")).toEqual(
    point("2026-01-05", 1952.3809523809523),
  );
  expect(result.at(-1)).toEqual(point("2026-02-02", 2090.909090909091));
});

test("values the broker position when the trade history is short", () => {
  const trades = TRADES.filter((trade) => trade.id !== "a");

  const result = computePortfolioValueSeries(POSITIONS, trades, PRICE_BARS, "EUR", FX_RATES, {
    today: "2026-02-02",
  });

  expect(result.at(-1)?.positionsValue).toBeCloseTo((10 * 120 + 5 * 220) / 1.1, 9);
});

test("marks a pie holding as unknown before its first broker snapshot", () => {
  const positions: Position[] = [
    {
      entity: "personal",
      symbol: "OTHER",
      quantity: 1,
      averagePrice: 100,
      marketPrice: 100,
      marketValue: 100,
      currency: "EUR",
      asOf: "2026-02-02",
    },
    {
      entity: "personal",
      symbol: "PIE",
      quantity: 4,
      averagePrice: 50,
      marketPrice: 60,
      marketValue: 240,
      currency: "EUR",
      asOf: "2026-02-02",
    },
  ];
  const trades: Trade[] = [
    {
      id: "other",
      entity: "personal",
      date: "2026-01-02",
      symbol: "OTHER",
      side: "buy",
      quantity: 1,
      price: 100,
      amount: 100,
      currency: "EUR",
      commission: 0,
    },
  ];
  const bars: PriceBar[] = ["OTHER", "PIE"].flatMap((symbol) => [
    { symbol, date: "2026-01-02", close: symbol === "PIE" ? 50 : 100, currency: "EUR" },
    { symbol, date: "2026-02-02", close: symbol === "PIE" ? 60 : 100, currency: "EUR" },
  ]);

  const result = computePortfolioValueSeries(positions, trades, bars, "EUR", FX_RATES, {
    today: "2026-02-02",
  });

  expect(result[0]?.positionsValue).toBe(300);
  expect(result[0]?.holdingsUnknown).toEqual(["PIE"]);
  expect(result.at(-1)?.positionsValue).toBe(340);
  expect(result.at(-1)?.holdingsUnknown).toBeUndefined();
});

test("does not invent pre-snapshot history for an all-pie portfolio", () => {
  const positions: Position[] = [
    {
      entity: "personal",
      symbol: "PIE",
      quantity: 4,
      averagePrice: 50,
      marketPrice: 60,
      marketValue: 240,
      currency: "EUR",
      asOf: "2026-02-02",
    },
  ];
  const bars: PriceBar[] = [
    { symbol: "PIE", date: "2026-01-02", close: 50, currency: "EUR" },
    { symbol: "PIE", date: "2026-02-02", close: 60, currency: "EUR" },
  ];

  const result = computePortfolioValueSeries(positions, [], bars, "EUR", FX_RATES, {
    today: "2026-02-02",
  });

  expect(result).toHaveLength(1);
  expect(result[0]).toMatchObject({ date: "2026-02-02", positionsValue: 240, value: 240 });
  expect(result[0]?.holdingsUnknown).toBeUndefined();
});

test("starts at first account trade instead of earliest market quote", () => {
  const positions: Position[] = [
    {
      entity: "personal",
      symbol: "AAPL",
      quantity: 1,
      averagePrice: 100,
      marketPrice: 110,
      marketValue: 110,
      currency: "EUR",
      asOf: "2024-10-02",
    },
  ];
  const trades: Trade[] = [
    {
      id: "buy",
      entity: "personal",
      date: "2024-10-01",
      symbol: "AAPL",
      side: "buy",
      quantity: 1,
      price: 100,
      amount: 100,
      currency: "EUR",
      commission: 0,
    },
  ];
  const bars: PriceBar[] = [
    { symbol: "AAPL", date: "2000-01-03", close: 10, currency: "EUR" },
    { symbol: "AAPL", date: "2024-10-01", close: 100, currency: "EUR" },
    { symbol: "AAPL", date: "2024-10-02", close: 110, currency: "EUR" },
  ];

  const result = computePortfolioValueSeries(positions, trades, bars, "EUR", FX_RATES, {
    today: "2024-10-02",
  });

  expect(result.map(({ date }) => date)).toEqual(["2024-10-01", "2024-10-02"]);
  expect(result[0]?.positionsValue).toBe(100);
});

test("includes closed positions only while trade history says they were held", () => {
  const trades: Trade[] = [
    {
      id: "buy",
      entity: "personal",
      date: "2026-01-02",
      symbol: "CLOSED",
      side: "buy",
      quantity: 2,
      price: 10,
      amount: 20,
      currency: "EUR",
      commission: 0,
    },
    {
      id: "sell",
      entity: "personal",
      date: "2026-01-06",
      symbol: "CLOSED",
      side: "sell",
      quantity: 2,
      price: 12,
      amount: 24,
      currency: "EUR",
      commission: 0,
    },
  ];
  const bars: PriceBar[] = ["2026-01-02", "2026-01-05", "2026-01-06"].map((date) => ({
    tenantId: "local",
    symbol: "CLOSED",
    date,
    close: 10,
    currency: "EUR",
  }));

  const result = computePortfolioValueSeries([], trades, bars, "EUR", FX_RATES, {
    today: "2026-01-06",
  });
  expect(result.map(({ date, positionsValue }) => ({ date, positionsValue }))).toEqual([
    { date: "2026-01-02", positionsValue: 20 },
    { date: "2026-01-05", positionsValue: 20 },
    { date: "2026-01-06", positionsValue: 0 },
  ]);
});

test("forward-fills five business days then marks held symbol unpriced", () => {
  const trades = TRADES.filter((trade) => trade.symbol === "AAPL");
  const bars = PRICE_BARS.filter((bar) => bar.symbol === "AAPL" && bar.date === "2026-01-05");
  const result = computePortfolioValueSeries([], trades, bars, "EUR", FX_RATES, {
    today: "2026-01-13",
  });

  expect(result.find(({ date }) => date === "2026-01-12")?.forwardFilled).toEqual(["AAPL"]);
  expect(result.find(({ date }) => date === "2026-01-13")).toMatchObject({
    positionsValue: null,
    value: null,
    unpriced: ["AAPL"],
    forwardFilled: [],
  });
});

test("a day the market was closed carries the last close as a real value", () => {
  const trades = TRADES.filter((trade) => trade.symbol === "AAPL");
  const bars: PriceBar[] = [
    { symbol: "AAPL", date: "2026-01-05", close: 100, currency: "USD" },
    { symbol: "AAPL", date: "2026-01-07", close: 101, currency: "USD" },
  ];
  const result = computePortfolioValueSeries([], trades, bars, "EUR", FX_RATES, {
    today: "2026-01-08",
  });

  expect(result.find(({ date }) => date === "2026-01-06")).toMatchObject({
    forwardFilled: [],
    unpriced: [],
  });
  expect(result.find(({ date }) => date === "2026-01-08")?.forwardFilled).toEqual(["AAPL"]);
});

test("with no FX rate at all, foreign holdings go unpriced but EUR cash still values", () => {
  const trades = TRADES.filter((trade) => trade.symbol === "AAPL");
  const bars = PRICE_BARS.filter((bar) => bar.symbol === "AAPL");
  const cashBalances: CashBalance[] = [
    { entity: "personal", broker: "ibkr", currency: "EUR", amount: 150, asOf: "2026-01-02" },
  ];
  const result = computePortfolioValueSeries([], trades, bars, "EUR", undefined, {
    cashBalances,
    today: "2026-01-02",
  });

  expect(result.find(({ date }) => date === "2026-01-02")).toMatchObject({
    positionsValue: null,
    cashValue: 150,
    value: 150,
    unpriced: ["AAPL"],
  });
});

test("walks cash anchors with deduplicated flows and dividends", () => {
  const cashBalances: CashBalance[] = [
    { entity: "personal", broker: "ibkr", currency: "EUR", amount: 150, asOf: "2026-01-06" },
  ];
  const cashFlows: CashFlow[] = [
    {
      id: "deposit-1",
      brokerFlowId: "same",
      entity: "personal",
      broker: "ibkr",
      date: "2026-01-02",
      currency: "EUR",
      amount: 100,
      kind: "deposit",
    },
    {
      id: "deposit-copy",
      brokerFlowId: "same",
      entity: "personal",
      broker: "ibkr",
      date: "2026-01-02",
      currency: "EUR",
      amount: 100,
      kind: "deposit",
    },
  ];
  const dividends = [
    {
      id: "dividend",
      tenantId: "local",
      entity: "personal",
      broker: "ibkr",
      date: "2026-01-05",
      symbol: "AAPL",
      amount: 50,
      currency: "EUR",
    },
  ];
  const result = computePortfolioValueSeries([], TRADES, PRICE_BARS, "EUR", FX_RATES, {
    cashBalances,
    cashFlows,
    dividends,
    cashCoverage: [complete("ibkr", "2026-01-02", "cash-flows")],
    today: "2026-01-06",
  });

  expect(result.find(({ date }) => date === "2026-01-02")?.cashValue).toBe(100);
  expect(result.find(({ date }) => date === "2026-01-05")?.cashValue).toBe(150);
  expect(result.find(({ date }) => date === "2026-01-06")?.cashValue).toBe(150);
});

test("a cash flow with an unknown amount marks the leg unknown instead of crashing or guessing", () => {
  const cashBalances: CashBalance[] = [
    { entity: "personal", broker: "ibkr", currency: "EUR", amount: 9.54, asOf: "2026-01-01" },
  ];
  const cashFlows: CashFlow[] = [
    {
      id: "transfer",
      entity: "personal",
      broker: "ibkr",
      date: "2026-01-02",
      currency: "EUR",
      amount: null,
      kind: "other",
    },
  ];
  const result = computePortfolioValueSeries([], [], [], "EUR", FX_RATES, {
    cashBalances,
    cashFlows,
    today: "2026-01-05",
  });

  expect(result.find(({ date }) => date === "2026-01-01")).toMatchObject({
    cashValue: 9.54,
    cashUnknown: [],
  });
  expect(result.find(({ date }) => date === "2026-01-05")).toMatchObject({
    cashValue: null,
    cashUnknown: ["ibkr:EUR"],
  });
});

test("a trade moves cash between the deposit and the broker balance", () => {
  const trades: Trade[] = [
    {
      id: "buy",
      entity: "personal",
      broker: "ibkr",
      date: "2026-01-05",
      symbol: "AAPL",
      side: "buy",
      quantity: 10,
      price: 100,
      amount: 1000,
      currency: "EUR",
      commission: 1,
    },
  ];
  const bars: PriceBar[] = [
    { symbol: "AAPL", date: "2026-01-02", close: 100, currency: "EUR" },
    { symbol: "AAPL", date: "2026-01-06", close: 100, currency: "EUR" },
  ];
  const cashBalances: CashBalance[] = [
    { entity: "personal", broker: "ibkr", currency: "EUR", amount: 0, asOf: "2026-01-06" },
  ];
  const cashFlows: CashFlow[] = [
    {
      id: "deposit",
      entity: "personal",
      broker: "ibkr",
      date: "2026-01-02",
      currency: "EUR",
      amount: 1001,
      kind: "deposit",
    },
  ];
  const result = computePortfolioValueSeries([], trades, bars, "EUR", FX_RATES, {
    cashBalances,
    cashFlows,
    cashCoverage: [complete("ibkr", "2026-01-02", "trade-settlement")],
    today: "2026-01-06",
  });

  expect(result.find(({ date }) => date === "2026-01-02")).toMatchObject({
    cashValue: 1001,
    value: 1001,
  });
  expect(result.find(({ date }) => date === "2026-01-06")).toMatchObject({
    cashValue: 0,
    value: 1000,
  });
});

test("a single-wallet broker settles foreign trades and flows into its wallet", () => {
  const trades: Trade[] = [
    {
      id: "buy",
      entity: "personal",
      broker: "trading212",
      date: "2026-01-05",
      symbol: "AAPL",
      side: "buy",
      quantity: 1,
      price: 110,
      amount: 110,
      currency: "USD",
      commission: 0,
      settlement: { currency: "EUR", amount: -100.15 },
    },
  ];
  const cashBalances: CashBalance[] = [
    { entity: "personal", broker: "trading212", currency: "EUR", amount: 0, asOf: "2026-01-06" },
  ];
  const cashFlows: CashFlow[] = [
    {
      id: "deposit",
      entity: "personal",
      broker: "trading212",
      date: "2026-01-02",
      currency: "EUR",
      amount: 99.15,
      kind: "deposit",
    },
    {
      id: "interest",
      entity: "personal",
      broker: "trading212",
      date: "2026-01-06",
      currency: "USD",
      amount: 1.05,
      kind: "interest",
    },
  ];
  const result = computePortfolioValueSeries([], trades, PRICE_BARS, "EUR", FX_RATES, {
    cashBalances,
    cashFlows,
    cashCoverage: [complete("trading212", "2026-01-02", "trade-settlement")],
    today: "2026-01-06",
  });

  const opening = result.find(({ date }) => date === "2026-01-02");
  expect(opening?.cashUnknown).toEqual([]);
  expect(opening?.cashValue).toBeCloseTo(99.15, 9);
});

test("keeps unreachable and unconvertible cash legs unknown", () => {
  const cashBalances: CashBalance[] = [
    { entity: "personal", broker: "ibkr", currency: "EUR", amount: 100, asOf: "2026-01-06" },
    { entity: "personal", broker: "trading212", currency: "GBP", amount: 50, asOf: "2026-01-02" },
  ];
  const cashFlows: CashFlow[] = [
    {
      id: "late",
      entity: "personal",
      broker: "ibkr",
      date: "2026-01-05",
      currency: "EUR",
      amount: 100,
      kind: "deposit",
    },
  ];
  const result = computePortfolioValueSeries([], TRADES, PRICE_BARS, "EUR", FX_RATES, {
    cashBalances,
    cashFlows,
    today: "2026-01-02",
  });

  expect(result[0]).toMatchObject({ cashValue: null, cashUnknown: ["ibkr:EUR", "trading212:GBP"] });
});

function thousandEuroAccount(broker: string) {
  const deposit: CashFlow = {
    id: "deposit",
    entity: "personal",
    broker,
    date: "2026-01-02",
    currency: "EUR",
    amount: 1000,
    kind: "deposit",
  };
  const purchase: Trade = {
    id: "buy",
    entity: "personal",
    broker,
    date: "2026-01-05",
    symbol: "X",
    side: "buy",
    quantity: 1,
    price: 200,
    amount: 200,
    currency: "EUR",
    commission: 0,
    settlement: { currency: "EUR", amount: -200 },
  };
  const purchaseCash: CashFlow = {
    id: "purchase-cash",
    entity: "personal",
    broker,
    date: "2026-01-05",
    currency: "EUR",
    amount: -200,
    kind: "other",
  };
  const holding: Position = {
    entity: "personal",
    broker,
    symbol: "X",
    quantity: 1,
    averagePrice: 200,
    marketPrice: 200,
    marketValue: 200,
    currency: "EUR",
    asOf: "2026-01-06",
  };
  const bars: PriceBar[] = ["2026-01-02", "2026-01-05", "2026-01-06"].map((date) => ({
    symbol: "X",
    date,
    close: 200,
    currency: "EUR",
  }));
  const closingCash: CashBalance = {
    entity: "personal",
    broker,
    currency: "EUR",
    amount: 800,
    asOf: "2026-01-06",
  };
  const series = (cashFlows: CashFlow[], cashCoverage: CashHistoryCoverage[]) =>
    computePortfolioValueSeries([holding], [purchase], bars, "EUR", FX_RATES, {
      cashBalances: [closingCash],
      cashFlows,
      cashCoverage,
      today: "2026-01-06",
    }).map(({ date, value, cashUnknown }) => ({ date, value, cashUnknown }));
  return { deposit, purchaseCash, series };
}

test("settles a purchase once from the trade when the broker proves its settlement", () => {
  const account = thousandEuroAccount("trading212");

  expect(
    account.series([account.deposit], [complete("trading212", "2026-01-02", "trade-settlement")]),
  ).toEqual([
    { date: "2026-01-02", value: 1000, cashUnknown: [] },
    { date: "2026-01-05", value: 1000, cashUnknown: [] },
    { date: "2026-01-06", value: 1000, cashUnknown: [] },
  ]);
});

test("settles a purchase once from the ledger row when the broker books trade cash", () => {
  const account = thousandEuroAccount("ibkr");

  expect(
    account.series(
      [account.deposit, account.purchaseCash],
      [complete("ibkr", "2026-01-02", "cash-flows")],
    ),
  ).toEqual([
    { date: "2026-01-02", value: 1000, cashUnknown: [] },
    { date: "2026-01-05", value: 1000, cashUnknown: [] },
    { date: "2026-01-06", value: 1000, cashUnknown: [] },
  ]);
});

test.each([
  ["no coverage", []],
  [
    "unknown coverage",
    [
      {
        entity: "personal",
        broker: "trading212",
        status: "unknown",
        reason: "trade settlement unverified",
      },
    ],
  ],
] satisfies [string, CashHistoryCoverage[]][])(
  "with %s only the dated broker balance says what cash was",
  (_, cashCoverage) => {
    const account = thousandEuroAccount("trading212");

    expect(account.series([account.deposit], cashCoverage)).toEqual([
      { date: "2026-01-02", value: 0, cashUnknown: ["trading212:EUR"] },
      { date: "2026-01-05", value: 200, cashUnknown: ["trading212:EUR"] },
      { date: "2026-01-06", value: 1000, cashUnknown: [] },
    ]);
  },
);

test("a proven window leaves cash before it unknown", () => {
  const account = thousandEuroAccount("ibkr");

  expect(
    account.series(
      [account.deposit, account.purchaseCash],
      [complete("ibkr", "2026-01-05", "cash-flows")],
    ),
  ).toEqual([
    { date: "2026-01-02", value: 0, cashUnknown: ["ibkr:EUR"] },
    { date: "2026-01-05", value: 1000, cashUnknown: [] },
    { date: "2026-01-06", value: 1000, cashUnknown: [] },
  ]);
});

function eurCash(amount: number, asOf: string): CashBalance {
  return { entity: "personal", broker: "trading212", currency: "EUR", amount, asOf };
}

const cashSeries = (options: Parameters<typeof computePortfolioValueSeries>[5]) =>
  computePortfolioValueSeries([], [], [], "EUR", FX_RATES, options).map(
    ({ date, cashValue, cashUnknown }) => ({ date, cashValue, cashUnknown }),
  );

test("the latest broker balance carries to dates after it when history is unknown", () => {
  expect(
    cashSeries({
      cashBalances: [eurCash(500, "2026-01-02"), eurCash(800, "2026-01-06")],
      today: "2026-01-08",
    }),
  ).toEqual([
    { date: "2026-01-02", cashValue: 500, cashUnknown: [] },
    { date: "2026-01-05", cashValue: null, cashUnknown: ["trading212:EUR"] },
    { date: "2026-01-06", cashValue: 800, cashUnknown: [] },
    { date: "2026-01-07", cashValue: 800, cashUnknown: [] },
    { date: "2026-01-08", cashValue: 800, cashUnknown: [] },
  ]);
});

test("a weekend broker balance carries to the next business day", () => {
  expect(
    cashSeries({
      cashBalances: [eurCash(700, "2026-01-08"), eurCash(800, "2026-01-10")],
      today: "2026-01-13",
    }),
  ).toEqual([
    { date: "2026-01-08", cashValue: 700, cashUnknown: [] },
    { date: "2026-01-09", cashValue: null, cashUnknown: ["trading212:EUR"] },
    { date: "2026-01-12", cashValue: 800, cashUnknown: [] },
    { date: "2026-01-13", cashValue: 800, cashUnknown: [] },
  ]);
});

const ibkrFlow = (id: string, date: string, amount: number): CashFlow => ({
  id,
  entity: "personal",
  broker: "ibkr",
  date,
  currency: "EUR",
  amount,
  kind: amount > 0 ? "deposit" : "other",
});

test("a proven window ends at its last date and a later flow makes cash unknown", () => {
  expect(
    cashSeries({
      cashBalances: [{ ...eurCash(800, "2026-01-05"), broker: "ibkr" }],
      cashFlows: [
        ibkrFlow("deposit", "2026-01-02", 1000),
        ibkrFlow("purchase-cash", "2026-01-05", -200),
        ibkrFlow("after-statement", "2026-01-07", -50),
      ],
      cashCoverage: [complete("ibkr", "2026-01-02", "cash-flows", "2026-01-05")],
      today: "2026-01-07",
    }),
  ).toEqual([
    { date: "2026-01-02", cashValue: 1000, cashUnknown: [] },
    { date: "2026-01-05", cashValue: 800, cashUnknown: [] },
    { date: "2026-01-06", cashValue: 800, cashUnknown: [] },
    { date: "2026-01-07", cashValue: null, cashUnknown: ["ibkr:EUR"] },
  ]);
});

test.each([
  [
    "a purchase",
    {
      trades: [
        {
          id: "buy",
          entity: "personal",
          broker: "trading212",
          date: "2026-01-05",
          symbol: "X",
          side: "buy",
          quantity: 1,
          price: 200,
          amount: 200,
          currency: "EUR",
          commission: 0,
        },
      ],
      cashFlows: [],
    },
  ],
  [
    "a withdrawal",
    {
      trades: [],
      cashFlows: [
        {
          id: "withdrawal",
          entity: "personal",
          broker: "trading212",
          date: "2026-01-05",
          currency: "EUR",
          amount: -200,
          kind: "withdrawal",
        },
      ],
    },
  ],
] satisfies [string, { trades: Trade[]; cashFlows: CashFlow[] }][])(
  "the latest balance stops carrying at %s after it when history is unknown",
  (_, { trades, cashFlows }) => {
    const bars: PriceBar[] = ["2026-01-02", "2026-01-05", "2026-01-06"].map((date) => ({
      symbol: "X",
      date,
      close: 200,
      currency: "EUR",
    }));
    const series = computePortfolioValueSeries([], trades, bars, "EUR", FX_RATES, {
      cashBalances: [eurCash(1000, "2026-01-02")],
      cashFlows,
      cashCoverage: [
        { entity: "personal", broker: "trading212", status: "unknown", reason: "unverified" },
      ],
      today: "2026-01-06",
    });

    expect(
      series.map(({ date, cashValue, cashUnknown }) => ({ date, cashValue, cashUnknown })),
    ).toEqual([
      { date: "2026-01-02", cashValue: 1000, cashUnknown: [] },
      { date: "2026-01-05", cashValue: null, cashUnknown: ["trading212:EUR"] },
      { date: "2026-01-06", cashValue: null, cashUnknown: ["trading212:EUR"] },
    ]);
  },
);

test("the balance walked to a window's end carries past an earlier statement", () => {
  expect(
    cashSeries({
      cashBalances: [{ ...eurCash(1000, "2026-01-02"), broker: "ibkr" }],
      cashFlows: [ibkrFlow("purchase-cash", "2026-01-05", -200)],
      cashCoverage: [complete("ibkr", "2026-01-02", "cash-flows", "2026-01-05")],
      today: "2026-01-07",
    }),
  ).toEqual([
    { date: "2026-01-02", cashValue: 1000, cashUnknown: [] },
    { date: "2026-01-05", cashValue: 800, cashUnknown: [] },
    { date: "2026-01-06", cashValue: 800, cashUnknown: [] },
    { date: "2026-01-07", cashValue: 800, cashUnknown: [] },
  ]);
});

test.each([
  ["1M", "2026-01-02"],
  ["6M", "2025-08-02"],
  ["1Y", "2025-02-02"],
  ["YTD", "2026-01-01"],
  ["All", "0000-01-01"],
] as const)("filters %s from latest data date", (range, start) => {
  const points = [point("2025-01-01", 1), point("2026-01-01", 2), point("2026-02-02", 3)];
  expect(filterPortfolioValueRange(points, range).map(({ date }) => date)).toEqual(
    points.filter(({ date }) => date >= start).map(({ date }) => date),
  );
});
