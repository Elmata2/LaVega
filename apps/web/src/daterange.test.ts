import { expect, test } from "vitest";
import type { Account, Tx } from "@lavega/core";
import { enrichTxs, filterTxs, monthlyTotals } from "@lavega/core";

const accounts: Account[] = [
  {
    key: "A1",
    iban: "A1",
    name: "ING",
    bank: "ING",
    entity: "BV1",
    currency: "EUR",
    balance: null,
  },
];
const txs: Tx[] = [
  {
    id: "t1",
    accountKey: "A1",
    date: "2026-06-05",
    amount: 100,
    currency: "EUR",
    counterparty: "Klant",
    description: "F",
    category: "",
    manual: false,
  },
  {
    id: "t2",
    accountKey: "A1",
    date: "2026-07-05",
    amount: -20,
    currency: "EUR",
    counterparty: "AH",
    description: "B",
    category: "",
    manual: false,
  },
];

test("Transacties date-range pipeline: from/to bound the rows", () => {
  const e = enrichTxs(txs, accounts);
  expect(filterTxs(e, { from: "2026-07-01", to: "2026-07-31" }).map((t) => t.id)).toEqual(["t2"]);
});

test("Overzicht chart data: one bar-pair per month", () => {
  expect(monthlyTotals(txs)).toEqual([
    { month: "2026-06", in: 100, out: 0 },
    { month: "2026-07", in: 0, out: -20 },
  ]);
});
