import { readFileSync } from "node:fs";
import { expect, test } from "vitest";
import type { Dividend } from "../../investing/dividend.js";
import type { CashBalance, CashFlow, CashHistoryCoverage } from "../../investing/model.js";
import { computePortfolioValueSeries } from "../../investing/portfolio.js";
import { readDeGiroAccount } from "./accountProfile.js";
import { readCsv } from "./read.js";

/* Issue #317: the whole account-statement import. One `Account.csv` must yield a
 * full `BrokerResult`-shaped result: four trades, 21 cash flows, two dividends,
 * two cash balances, a complete coverage claim and the period. The fixture is
 * the sanitized real NL statement from #313 (29 rows, newest first, EUR + USD);
 * every amount, balance, ISIN and product is synthetic. */

const fixture = (): string =>
  readFileSync(new URL("../__fixtures__/degiro/nl/account.csv", import.meta.url), "utf8");

const isSweep = (description: string): boolean =>
  /^(?:degiro )?cash sweep transfer\b/i.test(description);

const isoFromDutch = (raw: string): string | null => {
  const match = /^(\d{2})-(\d{2})-(\d{4})$/.exec(raw);
  return match ? `${match[3]}-${match[2]}-${match[1]}` : null;
};

/**
 * End-of-day `Saldo` per currency per date, read straight from the fixture and
 * not through the parser. The file is newest first, so the first
 * walk-participating row of a date carries that date's closing balance. A
 * walk-participating row is one with a non-empty `Mutatie` whose description is
 * not a cash sweep. Dates without such a row carry the previous closing balance.
 */
function fixtureSaldo(text: string): Map<string, Map<string, number>> {
  const byCurrency = new Map<string, Map<string, number>>();
  for (const row of readCsv(text).rows) {
    const description = (row.cells[5] ?? "").trim();
    const amount = (row.cells[8] ?? "").trim();
    const currency = (row.cells[9] ?? "").trim();
    const rawSaldo = (row.cells[10] ?? "").trim();
    const date = isoFromDutch((row.cells[0] ?? "").trim());
    if (amount === "" || isSweep(description)) continue;
    if (date === null || currency === "" || rawSaldo === "") continue;
    const byDate = byCurrency.get(currency) ?? new Map<string, number>();
    // Newest first: keep the first (newest) row of the date.
    if (!byDate.has(date)) byDate.set(date, Number(rawSaldo));
    byCurrency.set(currency, byDate);
  }
  return byCurrency;
}

/** The carried end-of-day `Saldo` for a date: the latest date on or before it. */
function expectedSaldo(
  table: ReadonlyMap<string, ReadonlyMap<string, number>>,
  currency: string,
  date: string,
): number {
  const byDate = table.get(currency);
  const carried = byDate
    ? [...byDate.keys()]
        .filter((known) => known <= date)
        .sort()
        .at(-1)
    : undefined;
  if (byDate === undefined || carried === undefined)
    throw new Error(`geen saldo voor ${currency} op ${date}`);
  return byDate.get(carried)!;
}

test("the fixture yields balances, coverage, period, flows and dividends", () => {
  const account = readDeGiroAccount(fixture());

  expect(account.cashBalances).toEqual([
    { currency: "EUR", amount: 1467.64, asOf: "2026-03-06" },
    { currency: "USD", amount: 0, asOf: "2026-01-16" },
  ]);
  expect(account.coverage).toEqual({
    status: "complete",
    from: "2026-01-05",
    to: "2026-03-06",
  });
  expect(account.period).toEqual({ from: "2026-01-05", to: "2026-03-06" });
  // 11 statement cash-flow rows (the sweep is a skip now) + 10 trade rows.
  expect(account.cashFlows).toHaveLength(21);
  expect(account.trades).toHaveLength(4);
  expect(account.dividends).toHaveLength(2);
  expect(account.problems).toEqual([]);
});

test("the cash flows are the statement's and no sweep is among them", () => {
  const account = readDeGiroAccount(fixture());

  expect(account.cashFlows.some((flow) => isSweep(flow.description ?? ""))).toBe(false);
  // Trades are the cash-flows stream: each execution and its fee is a row.
  expect(account.cashFlows.filter((flow) => flow.kind === "fee")).toHaveLength(5);
  // The dividend rows emit no cash flow; dividends are their own stream.
  expect(account.cashFlows.some((flow) => /^Dividend/i.test(flow.description ?? ""))).toBe(false);
});

test("a missing deposit breaks the Saldo walk and the coverage names the failing row", () => {
  const text = fixture();
  const broken = text.replace(
    "05-03-2026,09:00,05-03-2026,,,flatex Storting,,EUR,101.76,EUR,1445.88,\n",
    "",
  );
  expect(broken).not.toBe(text);

  const account = readDeGiroAccount(broken);
  expect(account.coverage.status).toBe("unknown");
  if (account.coverage.status !== "unknown") throw new Error("coverage is not unknown");
  expect(account.coverage.reason).toMatch(/^rij \d+: saldo EUR is /);
  // The rows are still returned: a broken walk withholds the claim, not the data.
  expect(account.trades).toHaveLength(4);
  expect(account.cashFlows).toHaveLength(20);
});

/* The end-to-end acceptance criterion: core's own date-based cash walk must
 * reproduce the fixture's `Saldo` per currency at every date of the window. The
 * expected values below are derived from the CSV, never from the parser. */
test.each(["EUR", "USD"])(
  "core cash walk reproduces the fixture Saldo for %s at every date",
  (currency) => {
    const account = readDeGiroAccount(fixture());

    const cashBalances: CashBalance[] = account.cashBalances
      .filter((balance) => balance.currency === currency)
      .map((balance) => ({ ...balance, entity: "BV1", broker: "degiro" }));
    const cashFlows: CashFlow[] = account.cashFlows
      .filter((flow) => flow.currency === currency)
      .map((flow) => ({ ...flow, entity: "BV1" }));
    const dividends: Dividend[] = account.dividends
      .filter((dividend) => dividend.currency === currency)
      .map((dividend) => ({ ...dividend, entity: "BV1" }));
    const cashCoverage: CashHistoryCoverage[] = [
      {
        entity: "BV1",
        broker: "degiro",
        tradeCash: "cash-flows",
        status: "complete",
        from: "2026-01-05",
        to: "2026-03-06",
      },
    ];

    expect(cashBalances).toHaveLength(1);
    expect(cashFlows.length).toBeGreaterThan(0);

    const points = computePortfolioValueSeries([], [], [], currency, [], {
      cashBalances,
      cashFlows,
      dividends,
      cashCoverage,
      today: "2026-03-06",
    });
    expect(points.length).toBeGreaterThan(0);

    const saldo = fixtureSaldo(fixture());
    for (const point of points) {
      const expected = expectedSaldo(saldo, currency, point.date);
      expect(point.cashValue, `cash on ${point.date}`).not.toBeNull();
      expect(point.cashValue!).toBeCloseTo(expected, 9);
      // The balance is proven by the fixture, not estimated or unknown.
      expect(point.cashUnknown).toEqual([]);
      expect(point.cashEstimated).toBeUndefined();
    }
  },
);

test("a file that is not an account statement explains itself instead of guessing", () => {
  const transactions = readFileSync(
    new URL("../__fixtures__/degiro/nl/transactions.csv", import.meta.url),
    "utf8",
  );
  const other = readDeGiroAccount(transactions);
  expect(other.trades).toEqual([]);
  expect(other.cashFlows).toEqual([]);
  expect(other.coverage.status).toBe("unknown");
  expect(other.problems).toEqual([
    "geen DeGiro rekeningoverzicht: dit bestand is een transactions-export",
  ]);

  const empty = readDeGiroAccount("");
  expect(empty.cashFlows).toEqual([]);
  expect(empty.problems).toHaveLength(1);
  expect(empty.problems[0]).toMatch(/leeg bestand/);
});

test("cash flow ids are assigned once across the whole ledger and stay unique", () => {
  const account = readDeGiroAccount(fixture());

  expect(new Set(account.cashFlows.map((flow) => flow.id)).size).toBe(account.cashFlows.length);
  expect(account.cashFlows.map((flow) => flow.id)).toEqual(
    readDeGiroAccount(fixture()).cashFlows.map((flow) => flow.id),
  );
  // The trade flows joined the statement flows: the ids do not restart.
  expect(account.cashFlows.every((flow) => flow.broker === "degiro")).toBe(true);
  expect(account.cashFlows.every((flow) => !("entity" in flow))).toBe(true);
});
