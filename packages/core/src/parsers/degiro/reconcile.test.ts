import { readFileSync } from "node:fs";
import { expect, test } from "vitest";
import { parseBrokerFiles } from "../parseBrokerFile.js";
import { reconcileDeGiroImport } from "./reconcile.js";

/* Issue #326: the DeGiro files are separate statements of one account. When
 * they disagree, the import names the identity and both numbers; it never picks
 * a number silently and never rewrites the trade history. */

const fixture = (path: string): string =>
  readFileSync(new URL(`../__fixtures__/degiro/${path}`, import.meta.url), "utf8");

const account = fixture("nl/account.csv");
const overlap = fixture("nl/transactions-overlap.csv");
const reconciled = fixture("nl/portfolio-reconciled.csv");
const split = fixture("nl/portfolio-split.csv");
const cashMismatch = fixture("nl/portfolio-cash-mismatch.csv");

const AS_OF = "2026-03-06";
const ISIN = "IE0VORB00033";

const position = (quantity: number, asOf = AS_OF) => ({
  isin: ISIN,
  description: "VOORBEELD TECHNOLOGIE FONDS",
  quantity,
  asOf,
});

const trade = (quantity: number, date = "2026-01-16") => ({
  date,
  isin: ISIN,
  side: "buy" as const,
  quantity,
});

const cash = (amount: number, asOf = AS_OF, currency = "EUR") => ({
  currency,
  amount,
  asOf,
});

test("a consistent portfolio and trade history raise no problem", () => {
  expect(
    reconcileDeGiroImport({
      positions: [position(5)],
      trades: [trade(5)],
      portfolioCashBalances: [cash(1467.64)],
      accountCashBalances: [cash(1467.64)],
    }),
  ).toEqual([]);
});

test("a split without a corporate-action row is one clear problem with both numbers", () => {
  const problems = reconcileDeGiroImport({
    positions: [position(10)],
    trades: [trade(5)],
    portfolioCashBalances: [cash(1467.64)],
    accountCashBalances: [cash(1467.64)],
  });
  expect(problems).toHaveLength(1);
  expect(problems[0]).toContain(ISIN);
  expect(problems[0]).toContain("portfolio zegt 10");
  expect(problems[0]).toContain("transacties geven 5");
  expect(problems[0]).toMatch(/splitsing/);
});

test("cash disagreement on the same day reports both amounts", () => {
  const problems = reconcileDeGiroImport({
    positions: [position(5)],
    trades: [trade(5)],
    portfolioCashBalances: [cash(201.76)],
    accountCashBalances: [cash(1467.64)],
  });
  expect(problems).toHaveLength(1);
  expect(problems[0]).toContain("EUR");
  expect(problems[0]).toContain("201.76");
  expect(problems[0]).toContain("1467.64");
});

test("cash on a different day is a different moment, not a disagreement", () => {
  expect(
    reconcileDeGiroImport({
      positions: [position(5)],
      trades: [trade(5)],
      portfolioCashBalances: [cash(201.76)],
      accountCashBalances: [cash(1467.64, "2026-03-05")],
    }),
  ).toEqual([]);
});

test("trades after the portfolio date do not count against that snapshot", () => {
  expect(
    reconcileDeGiroImport({
      positions: [position(5)],
      trades: [trade(5), trade(5, "2026-03-07")],
    }),
  ).toEqual([]);
});

test("a trade-built quantity missing from the portfolio is reported the other way too", () => {
  const problems = reconcileDeGiroImport({
    positions: [position(5)],
    trades: [
      trade(5),
      {
        date: "2026-02-01",
        isin: "NL0VORB00029",
        side: "buy",
        quantity: 3,
      },
    ],
  });
  expect(problems).toHaveLength(1);
  expect(problems[0]).toContain("NL0VORB00029");
  expect(problems[0]).toContain("portfolio zegt 0");
  expect(problems[0]).toContain("transacties geven 3");
});

test("files that share no ISIN are not compared", () => {
  expect(
    reconcileDeGiroImport({
      positions: [position(10)],
      trades: [{ ...trade(5), isin: "XS00PF000003" }],
    }),
  ).toEqual([]);
});

test("the account fixture and the reconciled portfolio fixture give zero problems", () => {
  const parsed = parseBrokerFiles(
    [
      { filename: "Account.csv", text: account },
      { filename: "Portfolio.csv", text: reconciled },
    ],
    { asOf: AS_OF },
  );
  expect(parsed.positions).toHaveLength(1);
  expect(parsed.problems).toEqual([]);
  expect(parsed.reconciliationProblems).toBeUndefined();
});

test("the split portfolio fixture reports exactly the quantity problem", () => {
  const parsed = parseBrokerFiles(
    [
      { filename: "Account.csv", text: account },
      { filename: "Portfolio.csv", text: split },
    ],
    { asOf: AS_OF },
  );
  expect(parsed.problems).toEqual([]);
  expect(parsed.reconciliationProblems).toHaveLength(1);
  expect(parsed.reconciliationProblems?.[0]).toContain(ISIN);
  expect(parsed.reconciliationProblems?.[0]).toContain("portfolio zegt 10");
  expect(parsed.reconciliationProblems?.[0]).toContain("transacties geven 5");
  // The portfolio quantity stays the holding; the trades are not rewritten.
  expect(parsed.positions[0]?.quantity).toBe(10);
  expect(parsed.trades.every((row) => row.quantity !== 10)).toBe(true);
});

test("the cash-mismatch fixture reports both amounts", () => {
  const parsed = parseBrokerFiles(
    [
      { filename: "Account.csv", text: account },
      { filename: "Portfolio.csv", text: cashMismatch },
    ],
    { asOf: AS_OF },
  );
  expect(parsed.reconciliationProblems).toHaveLength(1);
  expect(parsed.reconciliationProblems?.[0]).toContain("201.76");
  expect(parsed.reconciliationProblems?.[0]).toContain("1467.64");
});

test("a transaction export alone can reconcile quantities; it has no Saldo to compare", () => {
  const consistent = parseBrokerFiles(
    [
      { filename: "Transactions.csv", text: overlap },
      { filename: "Portfolio.csv", text: reconciled },
    ],
    { asOf: AS_OF },
  );
  expect(consistent.problems).toEqual([]);
  expect(consistent.reconciliationProblems).toBeUndefined();

  const mismatched = parseBrokerFiles(
    [
      { filename: "Transactions.csv", text: overlap },
      { filename: "Portfolio.csv", text: split },
    ],
    { asOf: AS_OF },
  );
  expect(mismatched.reconciliationProblems).toHaveLength(1);
  expect(mismatched.reconciliationProblems?.[0]).toContain("portfolio zegt 10");
});
