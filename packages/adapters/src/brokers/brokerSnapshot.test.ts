import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { computePortfolioValueSeries, type Position } from "@lavega/core";
import type { BrokerResult } from "./BrokerAccessAdapter.js";
import { createBrokerDataCache, type BrokerDataSnapshot } from "./brokerSnapshot.js";
import { createDeGiroFileImport } from "./degiro/fileImport.js";
import { parseFlexStatement } from "./ibkr/flexParser.js";

function window(trades: string, funds = "", period?: [string, string]): BrokerResult {
  const range = period ? ` fromDate="${period[0]}" toDate="${period[1]}"` : "";
  const xml = `<FlexStatements><FlexStatement accountId="U1"${range}><Trades>${trades}</Trades>${
    funds ? `<StatementOfFunds>${funds}</StatementOfFunds>` : ""
  }</FlexStatement></FlexStatements>`;
  return { ...parseFlexStatement(xml, "personal"), source: "ibkr-flex" };
}

function outcome(result: BrokerResult) {
  return {
    outcomes: [{ broker: "ibkr" as const, status: "synced" as const, lastSyncedAt: null, result }],
    problems: [],
  };
}

const trade = (id: string, day: string) =>
  `<Trade accountId="U1" symbol="VUSA" transactionID="${id}" tradeDate="${day}" buySell="BUY" quantity="1" tradePrice="10" proceeds="-10" currency="EUR" />`;
const deposit = (id: string, day: string) =>
  `<StatementOfFundsLine accountId="U1" transactionID="${id}" date="${day}" currency="EUR" activityCode="DEP" activityDescription="Deposit" amount="100" />`;

const A: [string, string] = ["20251001", "20261001"];
const B: [string, string] = ["20241001", "20251001"];

/* DeGiro names a product only inside an export; its identity is the ISIN
 * (issue #322). A rename between two imports therefore replaces the row
 * instead of adding a second holding for the same instrument. */
describe("DeGiro import identity", () => {
  const isin = "XS00PF000003";
  const position = (description: string): Position => ({
    entity: "personal",
    broker: "degiro",
    symbol: isin,
    isin,
    description,
    quantity: 3,
    averagePrice: null,
    marketPrice: 41.66,
    marketValue: 124.98,
    currency: "USD",
    asOf: "2026-11-12",
  });
  const snapshot = (description: string): BrokerDataSnapshot => ({
    degiro: {
      positions: [position(description)],
      trades: [],
      dividends: [],
      cashBalances: [],
      cashFlows: [],
    },
  });

  test("a product renamed between two imports is one position, not two", () => {
    const cache = createBrokerDataCache();
    cache.restore(snapshot("VOORBEELD GLOBAL EQUITY ETF"));
    cache.restore(snapshot("VOORBEELD GLOBAL EQUITY ETF (hernoemd)"));

    const positions = cache.read().positions;
    expect(positions).toHaveLength(1);
    expect(positions[0]).toMatchObject({
      symbol: isin,
      isin,
      description: "VOORBEELD GLOBAL EQUITY ETF (hernoemd)",
    });
  });
});

test("a restored snapshot keeps its import metadata", () => {
  const lastImport = {
    importedAt: "2026-11-13T12:00:00.000Z",
    files: [{ filename: "Account.csv", sha256: "0".repeat(64) }],
  };
  const cache = createBrokerDataCache({
    degiro: {
      positions: [],
      trades: [],
      dividends: [],
      cashBalances: [],
      cashFlows: [],
      lastImport,
    },
  });
  const restored = createBrokerDataCache(cache.snapshot());
  expect(restored.snapshot().degiro?.lastImport).toEqual(lastImport);
});

describe("IBKR history windows", () => {
  test("exposes the statement period", () => {
    expect(window("", "", A).period).toEqual({ from: "2025-10-01", to: "2026-10-01" });
    expect(window("").period).toBeUndefined();
  });

  test("two identical same-day cash flows survive a second sync of the same window", () => {
    const cache = createBrokerDataCache();
    const current = window("", deposit("d1", "20260301") + deposit("d2", "20260301"), A);
    cache.apply(outcome(current));
    cache.apply(outcome(current));
    expect(cache.read().cashFlows).toHaveLength(2);
  });

  test("an older window adds to the current one, and the current one again duplicates nothing", () => {
    const cache = createBrokerDataCache();
    const current = window(trade("t-new", "20260301"), deposit("d-new", "20260301"), A);
    const older = window(trade("t-old", "20250301"), deposit("d-old", "20250301"), B);
    cache.apply(outcome(current));
    cache.apply(outcome(older));
    expect(cache.read().trades).toHaveLength(2);
    cache.apply(outcome(current));
    const data = cache.read();
    expect(data.trades.map((t) => t.id).sort()).toEqual(["ibkr:t-new", "ibkr:t-old"]);
    expect(data.cashFlows).toHaveLength(2);
  });

  test("a trade removed from its window disappears on resync", () => {
    const cache = createBrokerDataCache();
    cache.apply(
      outcome(
        window(trade("t-1", "20260301") + trade("t-2", "20260302"), deposit("d", "20260301"), A),
      ),
    );
    cache.apply(outcome(window(trade("t-1", "20260301"), deposit("d", "20260301"), A)));
    expect(cache.read().trades.map((t) => t.id)).toEqual(["ibkr:t-1"]);
  });

  test("without a period trades merge and nothing outside the sync is dropped", () => {
    const cache = createBrokerDataCache();
    cache.apply(outcome(window(trade("t-1", "20260301"))));
    cache.apply(outcome(window(trade("t-2", "20250301"))));
    expect(
      cache
        .read()
        .trades.map((t) => t.id)
        .sort(),
    ).toEqual(["ibkr:t-1", "ibkr:t-2"]);
  });

  test("partial fills sharing a broker trade id keep distinct ids across resyncs", () => {
    /* A broker trade id names the order, not the execution: DeGiro's partial
     * fills all carry one Order Id, and IBKR reports one transactionID per fill
     * group. With the bare id as row id, a merge keeps one fill and drops the
     * other. The first row keeps the bare id; the rest get an occurrence
     * suffix, so re-importing the same window neither duplicates nor renumbers. */
    const fills =
      `<Trade accountId="U1" symbol="VUSA" transactionID="p1" tradeDate="20260301" buySell="BUY" quantity="1" tradePrice="10" proceeds="-10" currency="EUR" />` +
      `<Trade accountId="U1" symbol="VUSA" transactionID="p1" tradeDate="20260302" buySell="BUY" quantity="2" tradePrice="10" proceeds="-20" currency="EUR" />`;
    const cache = createBrokerDataCache();

    cache.apply(outcome(window(fills, "", A)));
    expect(cache.read().trades.map((trade) => trade.id)).toEqual(["ibkr:p1", "ibkr:p1#2"]);

    cache.apply(outcome(window(fills, "", A)));
    const data = cache.read();
    expect(data.trades.map((trade) => trade.id)).toEqual(["ibkr:p1", "ibkr:p1#2"]);
    expect(data.trades.map((trade) => trade.quantity)).toEqual([1, 2]);
  });
});

describe("IBKR backfill and multi-account windows", () => {
  type Part = {
    account?: string;
    period: [string, string];
    trades?: string;
    funds?: string;
    positions?: string;
    cash?: string;
    transfers?: string;
  };
  const statement = (...parts: Part[]): BrokerResult => {
    const xml = `<FlexStatements>${parts
      .map(
        (part) =>
          `<FlexStatement accountId="${part.account ?? "U1"}" fromDate="${part.period[0]}" toDate="${part.period[1]}">` +
          `<OpenPositions>${part.positions ?? ""}</OpenPositions><Trades>${part.trades ?? ""}</Trades>` +
          `<Transfers>${part.transfers ?? ""}</Transfers><CorporateActions></CorporateActions>` +
          `<CashReport>${part.cash ?? ""}</CashReport><StatementOfFunds>${part.funds ?? ""}</StatementOfFunds></FlexStatement>`,
      )
      .join("")}</FlexStatements>`;
    return { ...parseFlexStatement(xml, "personal"), source: "ibkr-flex" };
  };
  const holding = (qty: number, day: string) =>
    `<OpenPosition accountId="U1" symbol="VUSA" position="${qty}" currency="EUR" reportDate="${day}" />`;
  const cashRow = (amount: number, day: string) =>
    `<CashReportCurrency accountId="U1" currency="EUR" endingCash="${amount}" toDate="${day}" />`;

  const ACATS = '<Transfer accountId="U1" symbol="VUSA" quantity="93" />';
  const proofOf = (cache: ReturnType<typeof createBrokerDataCache>) =>
    (cache.read().cashCoverage[0] as { quantityProvenFrom?: string }).quantityProvenFrom;
  const apply = (...results: BrokerResult[]) => {
    const cache = createBrokerDataCache();
    for (const result of results) cache.apply(outcome(result));
    return cache;
  };
  const recent = statement({ period: ["20251001", "20261001"] });
  const older = statement({ period: ["20240601", "20251001"] });
  const olderUnproven = statement({ period: ["20240601", "20251001"], transfers: ACATS });
  const recentUnproven = statement({ period: ["20251001", "20261001"], transfers: ACATS });

  test("the proven start survives merges as one date, taking the earliest when both prove", () => {
    expect(proofOf(apply(recent))).toBe("2025-10-01");
    expect(proofOf(apply(recent, older))).toBe("2024-06-01");
    expect(apply(recent, older).read().cashCoverage[0]).toMatchObject({ from: "2024-06-01" });
  });

  test("a backfill that is not proven neither adds nor moves the proof", () => {
    const cache = apply(recent, olderUnproven);
    expect(cache.read().cashCoverage[0]).toMatchObject({ from: "2024-06-01" });
    expect(proofOf(cache)).toBe("2025-10-01");
    expect(proofOf(apply(recentUnproven, older))).toBeUndefined();
  });

  test("a proven backfill separated from the proof by an unproven one cannot move it", () => {
    const bars = [{ symbol: "VUSA", date: "2025-01-06", close: 100, currency: "EUR" }];
    const positions = holding(93, "20261001");
    const cache = apply(
      statement({ period: ["20251001", "20261001"], positions }),
      statement({
        period: ["20240601", "20251001"],
        transfers: ACATS,
        funds: deposit("d1", "20250106"),
      }),
      statement({ period: ["20230601", "20240601"] }),
    );
    expect(proofOf(cache)).toBe("2025-10-01");
    const data = cache.read();
    const point = computePortfolioValueSeries(data.positions, data.trades, bars, "EUR", undefined, {
      cashBalances: data.cashBalances,
      cashFlows: data.cashFlows,
      cashCoverage: data.cashCoverage,
      today: "2026-10-01",
    }).find((day) => day.date === "2025-01-06");
    expect(point?.holdingsUnknown).toEqual(["VUSA"]);
  });

  test("a proven backfill that reaches the stored proof still extends it", () => {
    const touching = statement({ period: ["20240601", "20250930"] });
    expect(proofOf(apply(recent, touching))).toBe("2024-06-01");
    const chained = apply(recent, older, statement({ period: ["20230601", "20240601"] }));
    expect(proofOf(chained)).toBe("2023-06-01");
  });

  test("a proven forward sync activates the proof on stored coverage that has none", () => {
    const stored = createBrokerDataCache();
    stored.apply(outcome(recentUnproven));
    const restored = createBrokerDataCache(structuredClone(stored.snapshot()));
    expect(proofOf(restored)).toBeUndefined();
    restored.apply(outcome(statement({ period: ["20260101", "20261101"] })));
    expect(proofOf(restored)).toBe("2026-01-01");
  });

  test("a forward sync keeps the proof only while its new end is inside the proven span", () => {
    const inside = apply(recent, statement({ period: ["20260101", "20260901"], transfers: ACATS }));
    expect(proofOf(inside)).toBe("2025-10-01");
    const beyond = apply(recent, statement({ period: ["20260901", "20261101"], transfers: ACATS }));
    expect(proofOf(beyond)).toBeUndefined();
  });

  test("shares that arrived by ACATS stay unknown before the anchor instead of reading as owned", () => {
    const days: string[] = [];
    for (let at = Date.UTC(2026, 0, 5); at <= Date.UTC(2026, 9, 1); at += 86_400_000) {
      const day = new Date(at);
      if (day.getUTCDay() % 6 !== 0) days.push(day.toISOString().slice(0, 10));
    }
    const bars = days.map((date) => ({
      symbol: "VUSA",
      date,
      close: 100,
      currency: "EUR",
    }));
    const valueOn = (result: BrokerResult) => {
      const data = apply(result).read();
      return computePortfolioValueSeries(data.positions, data.trades, bars, "EUR", undefined, {
        cashBalances: data.cashBalances,
        cashFlows: data.cashFlows,
        cashCoverage: data.cashCoverage,
        today: "2026-10-01",
      }).find((point) => point.date === "2026-01-05");
    };
    const period: [string, string] = ["20260101", "20261001"];
    const positions = holding(93, "20261001");
    const funds = deposit("early", "20260105");

    expect(valueOn(statement({ period, positions, funds }))?.positionsValue).toBe(9300);
    const acats = valueOn(statement({ period, positions, funds, transfers: ACATS }));
    expect(acats?.holdingsUnknown).toEqual(["VUSA"]);
  });

  test("an older window does not overwrite the latest positions and cash", () => {
    const cache = createBrokerDataCache();
    cache.apply(
      outcome(
        statement({
          period: ["20251001", "20261001"],
          positions: holding(10, "20261001"),
          cash: cashRow(500, "20261001"),
        }),
      ),
    );
    cache.apply(
      outcome(
        statement({
          period: ["20241001", "20251001"],
          positions: holding(3, "20251001"),
          cash: cashRow(9000, "20251001"),
        }),
      ),
    );
    const data = cache.read();
    expect(data.positions.map((p) => p.quantity)).toEqual([10]);
    expect(data.cashBalances.map((c) => c.amount)).toEqual([500]);
  });

  test("a contiguous older window extends cash coverage backwards and keeps its end", () => {
    const cache = createBrokerDataCache();
    cache.apply(outcome(statement({ period: ["20251001", "20261001"] })));
    cache.apply(outcome(statement({ period: ["20241001", "20250930"] })));
    expect(cache.read().cashCoverage).toEqual([
      expect.objectContaining({ status: "complete", from: "2024-10-01", to: "2026-10-01" }),
    ]);
  });

  test("an older window separated by a gap leaves cash coverage alone", () => {
    const cache = createBrokerDataCache();
    cache.apply(outcome(statement({ period: ["20251001", "20261001"] })));
    cache.apply(outcome(statement({ period: ["20240101", "20250601"] })));
    expect(cache.read().cashCoverage).toEqual([
      expect.objectContaining({ status: "complete", from: "2025-10-01", to: "2026-10-01" }),
    ]);
  });

  test("a trade re-sent across the window boundary is stored once", () => {
    const cache = createBrokerDataCache();
    cache.apply(
      outcome(statement({ period: ["20241001", "20251001"], trades: trade("x1", "20250930") })),
    );
    cache.apply(
      outcome(statement({ period: ["20251001", "20261001"], trades: trade("x1", "20250930") })),
    );
    expect(cache.read().trades.map((t) => t.id)).toEqual(["ibkr:x1"]);
  });

  test("two identical distinct deposits both survive a re-read", () => {
    const cache = createBrokerDataCache();
    const both = statement({
      period: ["20251001", "20261001"],
      funds: deposit("d1", "20260301") + deposit("d2", "20260301"),
    });
    cache.apply(outcome(both));
    cache.apply(outcome(both));
    expect(cache.read().cashFlows).toHaveLength(2);
  });

  test("accounts with differing periods give no window", () => {
    const result = statement(
      { account: "U1", period: ["20251001", "20261001"] },
      { account: "U2", period: ["20260101", "20261001"] },
    );
    expect(result.period).toBeUndefined();
  });

  test("rows of an account absent from the statement are kept", () => {
    const cache = createBrokerDataCache();
    const u2Trade = trade("u2", "20260301").replace("U1", "U2");
    const u2Deposit = deposit("u2d", "20260301").replace("U1", "U2");
    cache.apply(
      outcome(
        statement({
          account: "U2",
          period: ["20251001", "20261001"],
          trades: u2Trade,
          funds: u2Deposit,
        }),
      ),
    );
    cache.apply(outcome(statement({ account: "U1", period: ["20251001", "20261001"] })));
    const data = cache.read();
    expect(data.trades.map((t) => t.account)).toEqual(["U2"]);
    expect(data.cashFlows).toHaveLength(1);
  });

  const WIN_A: [string, string] = ["20251001", "20261001"];
  const WIN_B: [string, string] = ["20241001", "20251001"];
  const full = (period: [string, string], qty: number, cash: number, extra: Partial<Part> = {}) =>
    statement({
      period,
      positions: holding(qty, period[1]),
      cash: cashRow(cash, period[1]),
      ...extra,
    });
  const windowA = () =>
    full(WIN_A, 10, 500, {
      trades: trade("x1", "20250930") + trade("t-new", "20260301"),
      funds: deposit("d1", "20260301") + deposit("d2", "20260301"),
    });
  const windowB = () =>
    full(WIN_B, 3, 9000, {
      trades: trade("x1", "20250930") + trade("t-old", "20250301"),
      funds: deposit("d-old", "20250301"),
    });
  const run = (...results: BrokerResult[]) => {
    const cache = createBrokerDataCache();
    for (const result of results) cache.apply(outcome(result));
    return cache.read();
  };

  test("a forward sync after a backfill keeps the newest positions, cash and older rows", () => {
    const data = run(windowA(), windowB(), windowA());
    expect(data.positions.map((p) => [p.quantity, p.asOf])).toEqual([[10, "2026-10-01"]]);
    expect(data.cashBalances.map((c) => c.amount)).toEqual([500]);
    expect(data.trades.map((t) => t.id).sort()).toEqual(["ibkr:t-new", "ibkr:t-old", "ibkr:x1"]);
    expect(data.cashFlows.map((f) => f.date).sort()).toEqual([
      "2025-03-01",
      "2026-03-01",
      "2026-03-01",
    ]);
  });

  test("identical deposits stay two across A, A, B, A", () => {
    const data = run(windowA(), windowA(), windowB(), windowA());
    expect(data.cashFlows.filter((f) => f.date === "2026-03-01")).toHaveLength(2);
  });

  test("an overlapping older window after A extends coverage and keeps the latest state", () => {
    const data = run(
      windowA(),
      full(["20250601", "20260301"], 4, 7000, { trades: trade("t-mid", "20250801") }),
    );
    expect(data.positions.map((p) => p.quantity)).toEqual([10]);
    expect(data.cashBalances.map((c) => c.amount)).toEqual([500]);
    expect(data.trades.map((t) => t.id)).toContain("ibkr:t-mid");
    expect(data.cashCoverage).toEqual([
      expect.objectContaining({ status: "complete", from: "2025-06-01", to: "2026-10-01" }),
    ]);
  });

  test("coverage stays 2024-10-01..2026-10-01 after A, B, A", () => {
    expect(run(windowA(), windowB(), windowA()).cashCoverage).toEqual([
      expect.objectContaining({ status: "complete", from: "2024-10-01", to: "2026-10-01" }),
    ]);
  });

  test("a forward sync across a gap replaces the stored coverage", () => {
    const data = run(
      statement({ period: ["20240101", "20240601"] }),
      statement({ period: ["20251001", "20261001"] }),
    );
    expect(data.cashCoverage).toEqual([
      expect.objectContaining({ status: "complete", from: "2025-10-01", to: "2026-10-01" }),
    ]);
  });

  test("accounts with differing periods merge without dropping rows", () => {
    const u2 = (id: string, day: string) => trade(id, day).replace("U1", "U2");
    const cache = createBrokerDataCache();
    cache.apply(
      outcome(statement({ account: "U1", period: WIN_A, trades: trade("keep1", "20260301") })),
    );
    cache.apply(
      outcome(
        statement(
          { account: "U1", period: WIN_A, trades: trade("n1", "20260302") },
          { account: "U2", period: ["20260101", "20261001"], trades: u2("n2", "20260303") },
        ),
      ),
    );
    expect(
      cache
        .read()
        .trades.map((t) => t.id)
        .sort(),
    ).toEqual(["ibkr:keep1", "ibkr:n1", "ibkr:n2"]);
  });

  test("an older statement whose accounts' periods differ is a backfill", () => {
    const older = statement(
      {
        account: "U1",
        period: ["20240101", "20250601"],
        positions: holding(3, "20250601"),
        cash: cashRow(9000, "20250601"),
      },
      { account: "U2", period: ["20240201", "20250701"] },
    );
    expect(older.period).toBeUndefined();
    const data = run(windowA(), older);
    expect(data.positions.map((p) => [p.quantity, p.asOf])).toEqual([[10, "2026-10-01"]]);
    expect(data.cashBalances.map((c) => c.amount)).toEqual([500]);
  });

  test("a future-dated stored position does not freeze a forward sync", () => {
    const cache = createBrokerDataCache({
      ibkr: {
        positions: [
          {
            entity: "personal",
            broker: "ibkr",
            symbol: "BAD",
            quantity: 1,
            brokerCost: { status: "unknown", reason: "not-reported" },
            averagePrice: null,
            marketPrice: null,
            marketValue: null,
            currency: "EUR",
            asOf: "2999-01-01",
          },
        ],
        trades: [],
        dividends: [],
        cashBalances: [],
      },
    });
    cache.apply(outcome(windowA()));
    expect(cache.read().positions.map((p) => p.symbol)).toEqual(["VUSA"]);
    expect(cache.read().cashBalances.map((c) => c.amount)).toEqual([500]);
  });

  test("after A, B, A the value series holds 10 VUSA on 2026-10-01 and cash 2025-09-01 is not estimated", () => {
    const data = run(windowA(), windowB(), windowA());
    const bars = ["2025-09-01", "2026-10-01"].map((date) => ({
      symbol: "VUSA",
      date,
      close: 10,
      currency: "EUR",
      split: 1,
    }));
    const series = computePortfolioValueSeries(
      data.positions,
      data.trades,
      bars,
      "EUR",
      undefined,
      {
        cashBalances: data.cashBalances,
        cashFlows: data.cashFlows,
        dividends: data.dividends,
        cashCoverage: data.cashCoverage,
        today: "2026-10-01",
      },
    );
    const at = (day: string) => series.find((p) => p.date === day);
    expect(at("2026-10-01")?.positionsValue).toBe(100);
    expect(at("2025-09-01")).toBeDefined();
    expect(at("2025-09-01")?.cashEstimated).toBeUndefined();
  });
});

describe("stale IBKR currency-pair rows", () => {
  const position = (symbol: string) => ({
    entity: "personal",
    broker: "ibkr",
    symbol,
    quantity: 1,
    brokerCost: { status: "unknown" as const, reason: "not-reported" as const },
    averagePrice: null,
    marketPrice: null,
    marketValue: null,
    currency: "USD",
    asOf: "2026-03-01",
  });
  const staleTrade = (symbol: string, id: string) => ({
    id,
    entity: "personal",
    broker: "ibkr",
    date: "2026-01-01",
    symbol,
    side: "buy" as const,
    quantity: 1,
    price: 1,
    amount: -1,
    currency: "USD",
    commission: null,
  });
  const stored = (): BrokerDataSnapshot => ({
    ibkr: {
      positions: [position("EUR.USD"), position("BRK.B")],
      trades: [staleTrade("EUR.USD", "ibkr:fx"), staleTrade("BRK.B", "ibkr:brk")],
      dividends: [],
    },
  });

  test("are dropped on restore while share classes survive", () => {
    const data = createBrokerDataCache(stored()).read();
    expect(data.positions.map((p) => p.symbol)).toEqual(["BRK.B"]);
    expect(data.trades.map((t) => t.symbol)).toEqual(["BRK.B"]);
  });

  test("disappear after the next apply that merges trades", () => {
    const cache = createBrokerDataCache(stored());
    cache.apply(outcome(window(trade("t-1", "20260301"))));
    expect(
      cache
        .read()
        .trades.map((t) => t.symbol)
        .sort(),
    ).toEqual(["BRK.B", "VUSA"]);
  });
});

describe("cost-basis provenance across a sync (WS4.2)", () => {
  const position = (quantity: number, extra: Partial<Position> = {}): Position => ({
    entity: "personal",
    broker: "trading212",
    account: "main",
    symbol: "ACME",
    quantity,
    averagePrice: 10,
    marketPrice: 10,
    marketValue: 10 * quantity,
    currency: "EUR",
    asOf: "2026-01-02",
    ...extra,
  });
  const snapshot = (rows: Position[]) => ({
    outcomes: [
      {
        broker: "trading212" as const,
        status: "synced" as const,
        lastSyncedAt: null,
        result: {
          sections: {
            positions: { status: "complete" as const, rows },
            trades: { status: "complete" as const, rows: [] },
            dividends: { status: "complete" as const, rows: [] },
            cashBalances: { status: "unavailable" as const, rows: [] },
            cashFlows: { status: "unavailable" as const, rows: [] },
          },
          source: "trading212-api",
          problems: [],
        },
      },
    ],
    problems: [],
  });

  test("a user's manual basis and lock survive a complete provider replace", () => {
    const cache = createBrokerDataCache();
    cache.apply(
      snapshot([
        position(10, { manualCostBasis: { amountCents: 123_400, currency: "EUR", locked: true } }),
      ]),
    );
    cache.apply(snapshot([position(10)]));
    expect(cache.read().positions[0]?.manualCostBasis).toEqual({
      amountCents: 123_400,
      currency: "EUR",
      locked: true,
    });
  });

  test("a broker basis carries forward when the row did not move, not when it did", () => {
    const cache = createBrokerDataCache();
    cache.apply(
      snapshot([position(10, { brokerCost: { status: "known", amount: 100, currency: "EUR" } })]),
    );
    cache.apply(
      snapshot([position(10, { brokerCost: { status: "unknown", reason: "not-reported" } })]),
    );
    expect(cache.read().positions[0]?.brokerCost).toEqual({
      status: "known",
      amount: 100,
      currency: "EUR",
    });

    cache.apply(
      snapshot([position(12, { brokerCost: { status: "unknown", reason: "not-reported" } })]),
    );
    expect(cache.read().positions[0]?.brokerCost).toEqual({
      status: "unknown",
      reason: "not-reported",
    });
  });
});

/* --- per-stream replace vs merge (#304) ------------------------------------ */

describe("two freshness lanes", () => {
  const trade = (id: string, day: string) => ({
    entity: "BV",
    date: day,
    symbol: "AAPL",
    side: "buy" as const,
    quantity: 1,
    price: 10,
    amount: 10,
    currency: "EUR",
    commission: 0,
    brokerTradeId: id,
  });
  const snapshot = (input: {
    trades?: ReturnType<typeof trade>[];
    tradesStatus?: "complete" | "unavailable";
    fullStreams?: Array<"orders" | "transactions" | "dividends">;
    positions?: Position[];
    positionsStatus?: "complete" | "unavailable";
  }) => ({
    outcomes: [
      {
        broker: "trading212" as const,
        status: "synced" as const,
        lastSyncedAt: null,
        result: {
          sections: {
            positions: {
              status: input.positionsStatus ?? "complete",
              rows: input.positions ?? [],
            },
            trades: {
              status: input.tradesStatus ?? "complete",
              rows: input.trades ?? [],
            },
            dividends: { status: "complete" as const, rows: [] },
            cashBalances: { status: "ok" as unknown as "complete", rows: [] },
            cashFlows: { status: "complete" as const, rows: [] },
          },
          source: "trading212-api",
          problems: [],
          ...(input.fullStreams ? { fullStreams: input.fullStreams } : {}),
        },
      },
    ],
    problems: [],
  });

  test("a holdings-only read leaves the stored history collections alone", () => {
    const cache = createBrokerDataCache();
    cache.apply(snapshot({ trades: [trade("1", "2026-08-01")], fullStreams: ["orders"] }));
    expect(cache.read().trades).toHaveLength(1);

    // The holdings lane reports the history sections as unavailable: that is
    // "not read", not "empty", so nothing may be dropped.
    cache.apply(snapshot({ tradesStatus: "unavailable", positionsStatus: "complete" }));
    expect(cache.read().trades).toHaveLength(1);
  });

  test("a tail read merges by row id and never duplicates a stored row", () => {
    const cache = createBrokerDataCache();
    cache.apply(
      snapshot({
        trades: [trade("1", "2026-08-01"), trade("2", "2026-08-02")],
        fullStreams: ["orders"],
      }),
    );

    // The tail reads the first page it already knows plus one new row.
    cache.apply(
      snapshot({
        trades: [trade("3", "2026-08-03"), trade("2", "2026-08-02")],
        fullStreams: [],
      }),
    );

    expect(cache.read().trades).toHaveLength(3);
    expect(
      cache
        .read()
        .trades.map((row) => row.brokerTradeId)
        .sort(),
    ).toEqual(["1", "2", "3"]);
    // Applying the same tail twice still adds no duplicate.
    cache.apply(snapshot({ trades: [trade("3", "2026-08-03")], fullStreams: [] }));
    expect(cache.read().trades).toHaveLength(3);
  });
});

/* Issue #320: snapshot keys come from the one broker table, so a broker that
 * only has file imports keeps its rows through a save and restore instead of
 * being dropped by a hand-written key check. */
test("a snapshot keeps every broker the table declares, including import-only DeGiro", () => {
  const stored: BrokerDataSnapshot = {
    degiro: { positions: [], trades: [], dividends: [], cashBalances: [], cashFlows: [] },
  };
  const cache = createBrokerDataCache(stored);
  expect(cache.snapshot().degiro).toBeDefined();
  expect(createBrokerDataCache(structuredClone(cache.snapshot())).snapshot()).toEqual(
    cache.snapshot(),
  );
});

/* Issue #321: a DeGiro re-import replaces its own window, like IBKR. The path
 * under test is the real one: the file import builds the `BrokerResult` from
 * CSV bytes, then the cache applies it with `broker: "degiro"`. Only the
 * outcome wrapper is hand-written. */
describe("DeGiro re-import windows", () => {
  const fixture = (path: string): string =>
    readFileSync(
      new URL(`../../../core/src/parsers/__fixtures__/degiro/${path}`, import.meta.url),
      "utf8",
    );
  const degiroOutcome = (result: BrokerResult) => ({
    outcomes: [
      { broker: "degiro" as const, status: "synced" as const, lastSyncedAt: null, result },
    ],
    problems: [],
  });
  const importFile = (filename: string, text: string, asOf?: string) =>
    createDeGiroFileImport().load({
      files: [{ filename, text }],
      entity: "personal",
      ...(asOf ? { asOf } : {}),
    });

  test("the same account file imported twice leaves the snapshot deep-equal", async () => {
    const cache = createBrokerDataCache();
    const account = fixture("nl/account.csv");
    cache.apply(degiroOutcome(await importFile("Account.csv", account)));
    const first = cache.snapshot();
    cache.apply(degiroOutcome(await importFile("Account.csv", account)));
    expect(cache.snapshot()).toEqual(first);
  });

  /* One synthetic EUR-only ledger. Every window is derived from the same
   * rendered rows, so a row two windows share is byte-identical in both, and
   * every window's `Saldo` is the full-ledger running balance. */
  type LedgerRow = {
    date: string;
    time: string;
    product: string;
    isin: string;
    description: string;
    /** Signed `Mutatie` in EUR. */
    amount: number;
    orderId?: string;
  };
  const LEDGER: readonly LedgerRow[] = [
    {
      date: "2026-01-02",
      time: "09:00",
      product: "",
      isin: "",
      description: "flatex Storting",
      amount: 500,
    },
    {
      date: "2026-01-10",
      time: "11:00",
      product: "VOORBEELD DIVIDEND AANDEEL",
      isin: "NL0VORB00029",
      description: "Dividend",
      amount: 5,
    },
    {
      date: "2026-01-20",
      time: "09:00",
      product: "",
      isin: "",
      description: "flatex Storting",
      amount: 100,
    },
    {
      date: "2026-01-25",
      time: "13:00",
      product: "VOORBEELD GLOBAL EQUITY ETF",
      isin: "NL0VORB00011",
      description: "Koop 2 @ 50.00 EUR",
      amount: -100,
      orderId: "ORDER-2",
    },
    {
      date: "2026-02-02",
      time: "09:00",
      product: "",
      isin: "",
      description: "flatex Storting",
      amount: 50,
    },
    {
      date: "2026-02-20",
      time: "10:00",
      product: "VOORBEELD GLOBAL EQUITY ETF",
      isin: "NL0VORB00011",
      description: "Koop 1 @ 100.00 EUR",
      amount: -100,
      orderId: "ORDER-1",
    },
    {
      date: "2026-02-20",
      time: "14:30",
      product: "VOORBEELD GLOBAL EQUITY ETF",
      isin: "NL0VORB00011",
      description: "Koop 1 @ 101.00 EUR",
      amount: -101,
      orderId: "ORDER-1",
    },
    {
      date: "2026-02-25",
      time: "11:00",
      product: "VOORBEELD DIVIDEND AANDEEL",
      isin: "NL0VORB00029",
      description: "Dividend",
      amount: 7.5,
    },
    {
      date: "2026-03-15",
      time: "15:00",
      product: "VOORBEELD EURO OBLIGATIE ETF",
      isin: "NL0VORB00045",
      description: "Koop 3 @ 20.00 EUR",
      amount: -60,
      orderId: "ORDER-3",
    },
    {
      date: "2026-03-20",
      time: "09:00",
      product: "",
      isin: "",
      description: "flatex Storting",
      amount: 200,
    },
    {
      date: "2026-04-01",
      time: "09:00",
      product: "",
      isin: "",
      description: "flatex Storting",
      amount: 25,
    },
    {
      date: "2026-04-15",
      time: "11:00",
      product: "VOORBEELD EURO OBLIGATIE ETF",
      isin: "NL0VORB00045",
      description: "Dividend",
      amount: 9,
    },
    {
      date: "2026-04-20",
      time: "09:00",
      product: "",
      isin: "",
      description: "flatex Storting",
      amount: 30,
    },
    {
      date: "2026-05-01",
      time: "12:00",
      product: "VOORBEELD GLOBAL EQUITY ETF",
      isin: "NL0VORB00011",
      description: "Koop 4 @ 10.00 EUR",
      amount: -40,
      orderId: "ORDER-4",
    },
    {
      date: "2026-05-10",
      time: "09:00",
      product: "",
      isin: "",
      description: "flatex Storting",
      amount: 40,
    },
  ];
  const ACCOUNT_HEADER =
    "Datum,Tijd,Valutadatum,Product,ISIN,Omschrijving,FX,Mutatie,,Saldo,,Order Id";
  const ddMmYyyy = (day: string): string =>
    `${day.slice(8, 10)}-${day.slice(5, 7)}-${day.slice(0, 4)}`;
  const renderedLedger = (): { date: string; line: string }[] => {
    let running = 0;
    const rows = LEDGER.map((row) => {
      running += row.amount;
      return {
        date: row.date,
        line: [
          ddMmYyyy(row.date),
          row.time,
          ddMmYyyy(row.date),
          row.product,
          row.isin,
          row.description,
          "",
          row.amount.toFixed(2),
          "EUR",
          running.toFixed(2),
          "EUR",
          row.orderId ?? "",
        ].join(","),
      };
    });
    return rows.reverse();
  };
  const windowCsv = (from: string, to: string): string =>
    [
      ACCOUNT_HEADER,
      ...renderedLedger()
        .filter((row) => row.date >= from && row.date <= to)
        .map((row) => row.line),
    ].join("\n") + "\n";
  const closingBalance = LEDGER.reduce((sum, row) => sum + row.amount, 0);

  test("three overlapping account windows in every order give one ledger", async () => {
    const windows: Record<"A" | "B" | "C", string> = {
      A: windowCsv("2026-01-02", "2026-02-20"),
      B: windowCsv("2026-01-20", "2026-04-01"),
      C: windowCsv("2026-02-20", "2026-05-10"),
    };
    const orders: ReadonlyArray<readonly ("A" | "B" | "C")[]> = [
      ["A", "B", "C"],
      ["A", "C", "B"],
      ["B", "A", "C"],
      ["B", "C", "A"],
      ["C", "A", "B"],
      ["C", "B", "A"],
    ];
    const summaries = [];
    for (const order of orders) {
      const cache = createBrokerDataCache();
      for (const key of order)
        cache.apply(degiroOutcome(await importFile("Account.csv", windows[key])));
      const data = cache.read();
      // Array order is arrival order; the assertion is over the row set.
      summaries.push({
        trades: data.trades.map((row) => row.id).sort(),
        dividends: data.dividends.map((row) => row.id).sort(),
        cashFlows: data.cashFlows.map((row) => row.id).sort(),
        cashBalances: data.cashBalances,
        cashCoverage: data.cashCoverage,
      });
    }

    const expected = summaries[0]!;
    expect(expected.trades).toHaveLength(5);
    expect(expected.dividends).toHaveLength(3);
    expect(expected.cashFlows).toHaveLength(12);
    expect(new Set(expected.trades).size).toBe(5);
    expect(new Set(expected.dividends).size).toBe(3);
    expect(new Set(expected.cashFlows).size).toBe(12);
    expect(expected.cashBalances).toEqual([
      {
        entity: "personal",
        broker: "degiro",
        currency: "EUR",
        amount: closingBalance,
        asOf: "2026-05-10",
      },
    ]);
    expect(expected.cashCoverage).toEqual([
      {
        entity: "personal",
        broker: "degiro",
        tradeCash: "cash-flows",
        status: "complete",
        from: "2026-01-02",
        to: "2026-05-10",
      },
    ]);
    for (const summary of summaries.slice(1)) expect(summary).toEqual(expected);
  });

  test("a newer portfolio survives an older one, in either order", async () => {
    const portfolio = fixture("nl/portfolio.csv");
    const loadPortfolio = (asOf: string) => importFile("Portfolio.csv", portfolio, asOf);

    const newerFirst = createBrokerDataCache();
    newerFirst.apply(degiroOutcome(await loadPortfolio("2026-11-12")));
    const newer = newerFirst.snapshot().degiro!;
    newerFirst.apply(degiroOutcome(await loadPortfolio("2026-10-01")));
    const afterOlder = newerFirst.snapshot().degiro!;
    expect(afterOlder.positions).toEqual(newer.positions);
    expect(afterOlder.cashBalances).toEqual(newer.cashBalances);
    expect(afterOlder.positions.every((row) => row.asOf === "2026-11-12")).toBe(true);

    const olderFirst = createBrokerDataCache();
    olderFirst.apply(degiroOutcome(await loadPortfolio("2026-10-01")));
    olderFirst.apply(degiroOutcome(await loadPortfolio("2026-11-12")));
    const afterNewer = olderFirst.snapshot().degiro!;
    expect(afterNewer.positions).toEqual(newer.positions);
    expect(afterNewer.cashBalances).toEqual(newer.cashBalances);
  });

  test("two non-touching windows leave the gap uncovered and keep earlier trades", async () => {
    const a = windowCsv("2026-01-02", "2026-02-20");
    const late = windowCsv("2026-04-20", "2026-05-10");
    for (const order of [
      [a, late],
      [late, a],
    ]) {
      const cache = createBrokerDataCache();
      for (const text of order) cache.apply(degiroOutcome(await importFile("Account.csv", text)));
      const data = cache.read();
      expect(data.cashCoverage).toHaveLength(1);
      expect(data.cashCoverage[0]).toMatchObject({
        status: "complete",
        from: "2026-04-20",
        to: "2026-05-10",
      });
      expect(data.trades.map((row) => row.id).sort()).toEqual([
        "degiro:ORDER-1",
        "degiro:ORDER-1#2",
        "degiro:ORDER-2",
        "degiro:ORDER-4",
      ]);
    }
  });
});
