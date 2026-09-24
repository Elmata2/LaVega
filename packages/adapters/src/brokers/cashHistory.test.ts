import { createServer, type ServerResponse } from "node:http";
import {
  buildHistoricalRisk,
  buildIndexedSeries,
  buildInvestingDashboard,
  computePortfolioValueSeries,
  type FxRate,
  type PriceBar,
} from "@lavega/core";
import { afterEach, describe, expect, test, vi } from "vitest";
import { allSections, type BrokerResult } from "./BrokerAccessAdapter.js";
import { createBrokerDataCache, type BrokerDataSnapshot } from "./brokerSnapshot.js";
import { parseFlexStatement } from "./ibkr/flexParser.js";
import { createTrading212Adapter } from "./trading212/adapter.js";

const DATES = ["2026-01-05", "2026-01-06", "2026-01-07", "2026-01-08", "2026-01-09"];
const FX: FxRate = { base: "EUR", date: "2026-01-05", rates: { USD: 1.25 } };
const BARS: PriceBar[] = DATES.map((date) => ({
  symbol: "AAPL",
  date,
  close: 100,
  currency: "USD",
}));

// Synthetic EUR account that converts EUR 200 into USD 250 and buys two USD
// shares. The Statement of Funds books the purchase and its commission as their
// own rows, and repeats the purchase row, as a re-exported period would.
const statement = `<FlexStatements><FlexStatement accountId="U1" fromDate="20260105" toDate="20260109"><OpenPositions>
  <OpenPosition accountId="U1" symbol="AAPL" position="2" avgPrice="100.5" markPrice="100" positionValue="200" currency="USD" reportDate="20260109" />
</OpenPositions><Trades>
  <Trade accountId="U1" symbol="AAPL" transactionID="trade-1" tradeDate="20260107;101500" buySell="BUY" quantity="2" tradePrice="100" proceeds="-200" ibCommission="-1" currency="USD" />
</Trades><CashReport>
  <CashReportCurrency accountId="U1" currency="EUR" toDate="20260109" endingCash="1000" />
  <CashReportCurrency accountId="U1" currency="USD" toDate="20260109" endingCash="49" />
</CashReport><StatementOfFunds>
  <StatementOfFundsLine accountId="U1" transactionID="dep-1" date="20260105" currency="EUR" activityCode="DEP" activityDescription="Deposit" amount="1200" />
  <StatementOfFundsLine accountId="U1" transactionID="fx-1" date="20260106" currency="EUR" activityCode="FOREX" activityDescription="EUR.USD conversion" amount="-200" />
  <StatementOfFundsLine accountId="U1" transactionID="fx-2" date="20260106" currency="USD" activityCode="FOREX" activityDescription="EUR.USD conversion" amount="250" />
  <StatementOfFundsLine accountId="U1" transactionID="buy-1" date="20260107" currency="USD" activityCode="BUY" activityDescription="Buy 2 AAPL" amount="-200" />
  <StatementOfFundsLine accountId="U1" transactionID="comm-1" date="20260107" currency="USD" activityCode="OFEE" activityDescription="Commission" amount="-1" />
  <StatementOfFundsLine accountId="U1" transactionID="buy-1" date="20260107" currency="USD" activityCode="BUY" activityDescription="Buy 2 AAPL" amount="-200" />
</StatementOfFunds></FlexStatement></FlexStatements>`;

function ibkrResult(xml = statement): BrokerResult {
  return { ...parseFlexStatement(xml, "personal"), source: "ibkr-flex" };
}

function outcome(broker: "ibkr" | "trading212", result: BrokerResult) {
  return {
    outcomes: [{ broker, status: "synced" as const, lastSyncedAt: null, result }],
    problems: [],
  };
}

function valueSeries(cache: ReturnType<typeof createBrokerDataCache>) {
  const data = cache.read();
  return computePortfolioValueSeries(data.positions, data.trades, BARS, "EUR", FX, {
    cashBalances: data.cashBalances,
    cashFlows: data.cashFlows,
    dividends: data.dividends,
    cashCoverage: data.cashCoverage,
    today: "2026-01-09",
  }).map(({ date, value, cashUnknown }) => ({ date, value, cashUnknown }));
}

describe("IBKR cash history from adapter to portfolio", () => {
  const settled = [
    { date: "2026-01-05", value: 1200, cashUnknown: [] },
    { date: "2026-01-06", value: 1200, cashUnknown: [] },
    { date: "2026-01-07", value: 1199.2, cashUnknown: [] },
    { date: "2026-01-08", value: 1199.2, cashUnknown: [] },
    { date: "2026-01-09", value: 1199.2, cashUnknown: [] },
  ];

  test("counts a USD execution and its commission once from the Statement of Funds", () => {
    const cache = createBrokerDataCache();
    cache.apply(outcome("ibkr", ibkrResult()));

    expect(cache.read().cashCoverage).toEqual([
      {
        entity: "personal",
        broker: "ibkr",
        status: "complete",
        from: "2026-01-05",
        to: "2026-01-09",
        tradeCash: "cash-flows",
      },
    ]);
    expect(valueSeries(cache)).toEqual(settled);
  });

  test("a repeated import and a snapshot round trip keep the same cash", () => {
    const cache = createBrokerDataCache();
    cache.apply(outcome("ibkr", ibkrResult()));
    cache.apply(outcome("ibkr", ibkrResult()));
    const restored = createBrokerDataCache(structuredClone(cache.snapshot()));

    expect(cache.read().cashFlows).toHaveLength(5);
    expect(valueSeries(restored)).toEqual(settled);
  });

  test("a failed sync keeps the stored cash and its proof together", () => {
    const cache = createBrokerDataCache();
    cache.apply(outcome("ibkr", ibkrResult()));
    cache.apply(
      outcome("ibkr", {
        sections: allSections("unavailable"),
        source: "ibkr-flex",
        problems: ["down"],
      }),
    );

    expect(valueSeries(cache)).toEqual(settled);
  });

  test("a statement without Statement of Funds proves nothing about past cash", () => {
    const cache = createBrokerDataCache();
    cache.apply(outcome("ibkr", ibkrResult()));
    cache.apply(
      outcome(
        "ibkr",
        ibkrResult(statement.replace(/<StatementOfFunds>[\s\S]*<\/StatementOfFunds>/, "")),
      ),
    );

    expect(cache.read().cashCoverage).toEqual([
      expect.objectContaining({ broker: "ibkr", status: "unknown" }),
    ]);
    expect(valueSeries(cache).map(({ cashUnknown }) => cashUnknown)).toEqual([
      ["ibkr:EUR", "ibkr:USD"],
      ["ibkr:EUR", "ibkr:USD"],
      ["ibkr:EUR", "ibkr:USD"],
      ["ibkr:EUR", "ibkr:USD"],
      [],
    ]);
  });

  test("a snapshot stored before coverage existed restores as unknown", () => {
    const current = createBrokerDataCache();
    current.apply(outcome("ibkr", ibkrResult()));
    const legacy: BrokerDataSnapshot = { ibkr: { ...current.snapshot().ibkr! } };
    delete legacy.ibkr!.cashHistory;

    const restored = createBrokerDataCache(legacy);

    expect(restored.read().cashCoverage).toEqual([]);
    expect(valueSeries(restored)[0]).toMatchObject({ cashUnknown: ["ibkr:EUR", "ibkr:USD"] });
  });
});

test("Trading 212 cash with unproven history is known only on its balance date", () => {
  const sections = allSections("complete");
  sections.cashBalances.rows = [
    { entity: "personal", broker: "trading212", currency: "EUR", amount: 800, asOf: "2026-01-09" },
  ];
  sections.cashFlows.status = "partial";
  sections.cashFlows.rows = [
    {
      id: "deposit",
      entity: "personal",
      broker: "trading212",
      date: "2026-01-05",
      currency: "EUR",
      amount: 1000,
      kind: "deposit",
      brokerFlowId: "deposit",
    },
  ];
  sections.trades.rows = [
    {
      entity: "personal",
      broker: "trading212",
      date: "2026-01-07",
      symbol: "AAPL",
      side: "buy",
      quantity: 2,
      price: 100,
      amount: 200,
      currency: "USD",
      commission: 0,
      settlement: { currency: "EUR", amount: -160 },
      brokerTradeId: "fill-1",
    },
  ];
  const cache = createBrokerDataCache();
  cache.apply(
    outcome("trading212", {
      sections,
      cashHistory: {
        entity: "personal",
        broker: "trading212",
        status: "unknown",
        reason: "unproven",
      },
      source: "trading-212",
      problems: [],
    }),
  );

  expect(valueSeries(cache).map(({ cashUnknown }) => cashUnknown)).toEqual([
    ["trading212:EUR"],
    ["trading212:EUR"],
    ["trading212:EUR"],
    ["trading212:EUR"],
    [],
  ]);
});

describe("Trading 212 history that is paginated short and holds an ambiguous transfer", () => {
  const servers: ReturnType<typeof createServer>[] = [];

  afterEach(async () => {
    vi.useRealTimers();
    await Promise.all(
      servers.splice(0).map((server) => new Promise<void>((done) => server.close(() => done()))),
    );
  });

  async function trading212(): Promise<string> {
    const json = (response: ServerResponse, body: unknown) => {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify(body));
    };
    const server = createServer((request, response) => {
      const url = request.url ?? "";
      if (url === "/api/v0/equity/account/summary")
        return json(response, {
          currency: "EUR",
          cash: { availableToTrade: 800, inPies: 0, reservedForOrders: 0 },
        });
      if (url === "/api/v0/equity/positions") return json(response, []);
      if (url.startsWith("/api/v0/equity/history/transactions"))
        return json(response, {
          items: [
            {
              amount: 1000,
              currency: "EUR",
              dateTime: "2026-01-05T10:00:00Z",
              reference: "deposit-1",
              type: "DEPOSIT",
            },
            {
              amount: 200,
              currency: "EUR",
              dateTime: "2026-01-06T10:00:00Z",
              reference: "transfer-1",
              type: "TRANSFER",
            },
          ],
          nextPagePath: "/loop",
        });
      if (url === "/loop") return json(response, { items: [], nextPagePath: "/loop" });
      return json(response, { items: [], nextPagePath: null });
    });
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Loopback server has no port");
    return `http://127.0.0.1:${address.port}`;
  }

  test("keeps cash unknown and yields no complete return or risk", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-01-09T12:00:00Z"));
    const result = await createTrading212Adapter({
      token: "token",
      secret: "secret",
      baseUrl: await trading212(),
    }).sync({ entity: "personal" });
    const cache = createBrokerDataCache();
    cache.apply(outcome("trading212", { ...result, source: "trading-212" }));
    const data = cache.read();

    expect(result.problems).toEqual(
      expect.arrayContaining([
        "Trading 212 transaction transfer-1 has ambiguous TRANSFER direction",
        "Trading 212 transactions pagination repeated nextPagePath",
      ]),
    );
    expect(data.cashCoverage).toEqual([
      expect.objectContaining({ broker: "trading212", status: "unknown" }),
    ]);

    const dashboard = buildInvestingDashboard({
      ...data,
      priceBars: [],
      benchmarkBars: [],
      presentationCurrency: "EUR",
      fxRates: FX,
      today: "2026-01-09",
    });
    const points = dashboard.portfolio.All;
    const history = points.filter((point) => point.date < "2026-01-09");

    expect(history.map(({ date }) => date)).toEqual(DATES.slice(0, 4));
    expect(history.every((point) => point.cashUnknown.includes("trading212:EUR"))).toBe(true);
    expect(
      buildIndexedSeries(history, [], dashboard.externalCashFlows).map(
        (point) => point.portfolioReturn,
      ),
    ).toEqual([null, null, null, null]);
    const { metrics, risk } = buildHistoricalRisk(dashboard, "All");
    expect(risk.status).toBe("unavailable");
    expect(risk.reasons).toContain("Cash history missing: trading212:EUR.");
    expect(metrics.annualizedVolatility).toBeNull();
    expect(metrics.maxDrawdown).toBeNull();
  });
});
