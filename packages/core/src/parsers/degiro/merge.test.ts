import { readFileSync } from "node:fs";
import { expect, test } from "vitest";
import { parseBrokerFiles } from "../parseBrokerFile.js";

/* Issue #318: one import, several DeGiro exports, one result. The account
 * statement stays the cash truth and the transaction export only enriches its
 * executions. The overlap fixture is hand-built so every execution appears in
 * both exports with the same Order Id + Datum + Tijd. */

const ORDER_003 = "00000000-0000-4000-8000-000000000003";
const ORDER_002 = "00000000-0000-4000-8000-000000000002";
const ORDER_001 = "00000000-0000-4000-8000-000000000001";

const fixture = (path: string): string =>
  readFileSync(new URL(`../__fixtures__/degiro/${path}`, import.meta.url), "utf8");

const account = fixture("nl/account.csv");
const overlap = fixture("nl/transactions-overlap.csv");
const transactions = fixture("nl/transactions.csv");
const portfolio = fixture("nl/portfolio.csv");
const AS_OF = "2026-11-12";

test("the account statement and the transaction export merge by execution", () => {
  const parsed = parseBrokerFiles([
    { filename: "Account.csv", text: account },
    { filename: "Transactions.csv", text: overlap },
  ]);

  expect(parsed.profile).toBe("account");
  expect(parsed.source).toBe("DeGiro account + transactions");
  expect(parsed.problems).toEqual([]);
  // One trade per execution, not one per export: 4 account rows, 4 overlaps.
  expect(parsed.trades).toHaveLength(4);
  expect(parsed.trades.filter((trade) => trade.brokerTradeId === ORDER_001)).toHaveLength(2);

  const usd = parsed.trades.find((trade) => trade.brokerTradeId === ORDER_002);
  if (usd === undefined) throw new Error("merged trade missing");
  // The account row wins the cash fields; the transactions row adds provenance.
  expect(usd).toMatchObject({
    amount: -98.24,
    currency: "USD",
    price: 19.648,
    venue: "XNAS",
    fxRate: 1.092,
  });
  expect("settlement" in usd).toBe(false);

  const executions = parsed.trades.map(
    (trade) => `${trade.brokerTradeId ?? ""}\u0000${trade.executionAt ?? ""}`,
  );
  expect(new Set(executions).size).toBe(executions.length);
  expect(parsed.cashHistory).toEqual({
    status: "complete",
    from: "2026-01-05",
    to: "2026-03-06",
  });
  expect(parsed.sections).toEqual(["trades", "dividends", "cashFlows", "cashBalances"]);
});

test("the file order of one import does not change the result", () => {
  const forward = parseBrokerFiles([
    { filename: "Account.csv", text: account },
    { filename: "Transactions.csv", text: overlap },
  ]);
  const reversed = parseBrokerFiles([
    { filename: "Transactions.csv", text: overlap },
    { filename: "Account.csv", text: account },
  ]);

  expect(reversed).toEqual(forward);
});

test("disjoint Order Ids do not merge, so both exports keep their trades", () => {
  const parsed = parseBrokerFiles([
    { filename: "Account.csv", text: account },
    { filename: "Transactions.csv", text: transactions },
  ]);

  // 4 account executions plus 25 unpaired transaction rows.
  expect(parsed.trades).toHaveLength(29);
  expect(parsed.trades.filter((trade) => trade.brokerTradeId === ORDER_003)).toHaveLength(1);
});

test("an Order Id at another execution is kept and reported, never merged", () => {
  const shifted = overlap.replace(
    "16-01-2026,14:20,VOORBEELD TECHNOLOGIE FONDS",
    "16-01-2026,15:20,VOORBEELD TECHNOLOGIE FONDS",
  );
  expect(shifted).not.toBe(overlap);

  const parsed = parseBrokerFiles([
    { filename: "Account.csv", text: account },
    { filename: "Transactions.csv", text: shifted },
  ]);

  // The statement's four executions stay; the export's second execution of the
  // same order is a real row the statement did not list, so it is appended.
  expect(parsed.trades).toHaveLength(5);
  expect(parsed.problems).toHaveLength(1);
  expect(parsed.problems[0]).toMatch(/andere uitvoering/);
  expect(parsed.problems[0]).toContain(ORDER_002);
});

test("a quantity disagreement keeps both rows and names the order", () => {
  const revised = overlap.replace(
    "16-01-2026,14:20,VOORBEELD TECHNOLOGIE FONDS,IE0VORB00033,NDQ,XNAS,5,",
    "16-01-2026,14:20,VOORBEELD TECHNOLOGIE FONDS,IE0VORB00033,NDQ,XNAS,4,",
  );
  expect(revised).not.toBe(overlap);

  const parsed = parseBrokerFiles([
    { filename: "Account.csv", text: account },
    { filename: "Transactions.csv", text: revised },
  ]);

  expect(parsed.trades).toHaveLength(5);
  expect(parsed.problems).toHaveLength(1);
  expect(parsed.problems[0]).toMatch(/beide rijen behouden/);
  expect(parsed.problems[0]).toContain(ORDER_002);
});

test("transactions alone yield trades but no cash-history claim", () => {
  const parsed = parseBrokerFiles([{ filename: "Transactions.csv", text: transactions }]);

  expect(parsed.trades).toHaveLength(25);
  expect(parsed.cashHistory).toEqual({
    status: "unknown",
    reason: expect.stringMatching(/geen rekeningoverzicht/),
  });
  expect(parsed.sections).toEqual(["trades"]);
});

test("the account statement and the portfolio export merge, account balances winning", () => {
  const parsed = parseBrokerFiles(
    [
      { filename: "Account.csv", text: account },
      { filename: "Portfolio.csv", text: portfolio },
    ],
    { asOf: AS_OF },
  );

  expect(parsed.profile).toBe("account");
  expect(parsed.source).toBe("DeGiro account + portfolio");
  expect(parsed.problems).toEqual([]);
  expect(parsed.positions).toHaveLength(12);
  // The statement's Saldo walk proves both anchors; the portfolio has one cash row.
  expect(parsed.cashBalances).toHaveLength(2);
  expect(parsed.sections).toEqual([
    "trades",
    "dividends",
    "cashFlows",
    "cashBalances",
    "positions",
  ]);
  expect(parsed.cashHistory).toEqual({
    status: "complete",
    from: "2026-01-05",
    to: "2026-03-06",
  });
});

test("transactions and the portfolio export merge, still with no cash history", () => {
  const parsed = parseBrokerFiles(
    [
      { filename: "Transactions.csv", text: transactions },
      { filename: "Portfolio.csv", text: portfolio },
    ],
    { asOf: AS_OF },
  );

  expect(parsed.profile).toBe("transactions");
  expect(parsed.source).toBe("DeGiro transactions + portfolio");
  expect(parsed.positions).toHaveLength(12);
  expect(parsed.sections).toEqual(["trades", "cashBalances", "positions"]);
  expect(parsed.cashHistory).toEqual({
    status: "unknown",
    reason: expect.stringMatching(/geen rekeningoverzicht/),
  });
});

test("an undated portfolio export contributes its problem and no positions", () => {
  const parsed = parseBrokerFiles([
    { filename: "Account.csv", text: account },
    { filename: "Portfolio.csv", text: portfolio },
  ]);

  expect(parsed.positions).toEqual([]);
  expect(parsed.sections).toEqual(["trades", "dividends", "cashFlows", "cashBalances"]);
  expect(parsed.problems).toHaveLength(1);
  expect(parsed.problems[0]).toContain("Portfolio.csv: ");
  expect(parsed.problems[0]).toMatch(/exportdatum/);
});
