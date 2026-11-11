import { expect, test } from "vitest";
import type { Account, Tx } from "@lavega/core";
import { accountBalances, spendingSummary } from "./tools.js";

/* The client-side tools are pure over the decrypted snapshot: no storage, no
 * fetch, no clock. That is what makes "the server never sees a ledger row"
 * checkable in code rather than only in a screenshot. */

const tx = (overrides: Partial<Tx>): Tx => ({
  id: "t",
  accountKey: "A",
  date: "2026-11-03",
  amount: -1000,
  currency: "EUR",
  counterparty: "Shop",
  description: "Shop",
  category: "boodschappen",
  manual: false,
  ...overrides,
});

const snapshot = {
  accounts: [
    {
      key: "A",
      iban: "NL01",
      name: "Betaal",
      bank: "X",
      entity: "personal",
      currency: "EUR",
      balance: 1234.56,
    },
    {
      key: "B",
      iban: "NL02",
      name: "Spaar",
      bank: "X",
      entity: "personal",
      currency: "EUR",
      balance: null,
    },
  ] as Account[],
  txs: [
    tx({ id: "1", amount: -25, category: "boodschappen" }),
    tx({ id: "2", amount: -15, category: "vervoer" }),
    tx({ id: "3", amount: -9, category: "boodschappen" }),
    tx({ id: "4", amount: 20, category: "inkomen" }), // income is not spending
    tx({ id: "5", amount: -7, category: "boodschappen", pending: true }),
    tx({ id: "6", amount: -8, category: "boodschappen", excluded: true }),
    tx({ id: "7", amount: -9.99, category: "boodschappen", date: "2026-10-31" }),
  ] as Tx[],
  rules: [],
  asOf: "2026-11-11",
};

test("spending sums only this month's settled, non-excluded expenses", () => {
  const summary = spendingSummary(snapshot, "2026-11");
  expect(summary.totalOutCents).toBe(4900);
  expect(summary.countedRows).toBe(3);
  expect(summary.pendingRows).toBe(1);
  expect(summary.categories).toEqual([
    { category: "boodschappen", outCents: 3400 },
    { category: "vervoer", outCents: 1500 },
  ]);
});

test("the month defaults to the caller's asOf, never a wall clock", () => {
  expect(spendingSummary(snapshot, null).month).toBe("2026-11");
});

test("balances come straight from the vault; an unknown balance stays unknown", () => {
  expect(accountBalances(snapshot)).toEqual([
    { name: "Betaal", currency: "EUR", balanceCents: 123_456 },
    { name: "Spaar", currency: "EUR", balanceCents: null },
  ]);
});
