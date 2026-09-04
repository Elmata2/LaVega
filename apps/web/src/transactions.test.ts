import { expect, test } from "vitest";
import type { Account, Tx } from "@lavega/core";
import { enrichTxs, filterTxs } from "@lavega/core";

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
  {
    key: "A2",
    iban: "A2",
    name: "ABN",
    bank: "ABN AMRO",
    entity: "BV2",
    currency: "EUR",
    balance: 100,
  },
];
const txs: Tx[] = [
  {
    id: "t1",
    accountKey: "A1",
    date: "2026-01-02",
    amount: -10,
    currency: "EUR",
    counterparty: "Albert Heijn",
    description: "Eten",
    category: "",
    manual: false,
  },
  {
    id: "t2",
    accountKey: "A2",
    date: "2026-01-05",
    amount: 200,
    currency: "EUR",
    counterparty: "Klant",
    description: "Factuur",
    category: "",
    manual: false,
  },
  {
    id: "t3",
    accountKey: "A1",
    date: "2026-01-03",
    amount: -5,
    currency: "EUR",
    counterparty: "Coffee",
    description: "Koffie",
    category: "",
    manual: false,
  },
];

test("Transacties pipeline: enrich + filter(entity=BV1) + sort desc by date", () => {
  const rows = filterTxs(enrichTxs(txs, accounts), { entity: "BV1" })
    .slice()
    .sort((a, b) => b.date.localeCompare(a.date));
  expect(rows.map((r) => r.id)).toEqual(["t3", "t1"]);
  expect(rows[0]).toMatchObject({ bank: "ING", entity: "BV1" });
});
