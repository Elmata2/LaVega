import { describe, expect, test } from "vitest";
import { computePortfolioValueSeries } from "@lavega/core";
import type { BrokerResult } from "./BrokerAccessAdapter.js";
import { createBrokerDataCache, type BrokerDataSnapshot } from "./brokerSnapshot.js";
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
});

describe("IBKR backfill and multi-account windows", () => {
  type Part = {
    account?: string;
    period: [string, string];
    trades?: string;
    funds?: string;
    positions?: string;
    cash?: string;
  };
  const statement = (...parts: Part[]): BrokerResult => {
    const xml = `<FlexStatements>${parts
      .map(
        (part) =>
          `<FlexStatement accountId="${part.account ?? "U1"}" fromDate="${part.period[0]}" toDate="${part.period[1]}">` +
          `<OpenPositions>${part.positions ?? ""}</OpenPositions><Trades>${part.trades ?? ""}</Trades>` +
          `<CashReport>${part.cash ?? ""}</CashReport><StatementOfFunds>${part.funds ?? ""}</StatementOfFunds></FlexStatement>`,
      )
      .join("")}</FlexStatements>`;
    return { ...parseFlexStatement(xml, "personal"), source: "ibkr-flex" };
  };
  const holding = (qty: number, day: string) =>
    `<OpenPosition accountId="U1" symbol="VUSA" position="${qty}" currency="EUR" reportDate="${day}" />`;
  const cashRow = (amount: number, day: string) =>
    `<CashReportCurrency accountId="U1" currency="EUR" endingCash="${amount}" toDate="${day}" />`;

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
