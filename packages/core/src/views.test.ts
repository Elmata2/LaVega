import { expect, test } from "vitest";
import type { Account, Tx } from "./model.js";
import { enrichTxs, filterTxs, accountSummaries, reassignEntity } from "./views.js";

const accounts: Account[] = [
  { key: "NL01INGB0001", iban: "NL01INGB0001", name: "ING lopend", bank: "ING", entity: "BV1", currency: "EUR", balance: null },
  { key: "NL91ABNA0417164300", iban: "NL91ABNA0417164300", name: "ABN zakelijk", bank: "ABN AMRO", entity: "BV2", currency: "EUR", balance: 3424.5 },
];
const txs: Tx[] = [
  { id: "t1", accountKey: "NL01INGB0001", date: "2026-01-03", amount: 2500, currency: "EUR", counterparty: "Salaris", description: "Loon januari", category: "", manual: false },
  { id: "t2", accountKey: "NL01INGB0001", date: "2026-01-02", amount: -12.34, currency: "EUR", counterparty: "Albert Heijn", description: "Boodschappen", category: "", manual: false },
  { id: "t3", accountKey: "NL91ABNA0417164300", date: "2026-01-05", amount: -45, currency: "EUR", counterparty: "Coolblue", description: "Laptop", category: "", manual: false },
  { id: "t4", accountKey: "NL99UNKNOWN000", date: "2026-01-06", amount: -9.99, currency: "EUR", counterparty: "Onbekend", description: "x", category: "", manual: false },
];

test("enrichTxs joins each tx to its account's entity/bank/name; missing account -> onbekend", () => {
  const e = enrichTxs(txs, accounts);
  expect(e).toHaveLength(4);
  expect(e[0]).toMatchObject({ id: "t1", entity: "BV1", bank: "ING", accountName: "ING lopend" });
  expect(e[2]).toMatchObject({ id: "t3", entity: "BV2", bank: "ABN AMRO" });
  expect(e[3]).toMatchObject({ id: "t4", entity: "onbekend", bank: "", accountName: "NL99UNKNOWN000" });
});

test("filterTxs filters by entity, account, and case-insensitive search, combinable", () => {
  const e = enrichTxs(txs, accounts);
  expect(filterTxs(e, { entity: "BV1" }).map((t) => t.id)).toEqual(["t1", "t2"]);
  expect(filterTxs(e, { accountKey: "NL91ABNA0417164300" }).map((t) => t.id)).toEqual(["t3"]);
  expect(filterTxs(e, { search: "albert" }).map((t) => t.id)).toEqual(["t2"]);
  expect(filterTxs(e, { search: "LOON" }).map((t) => t.id)).toEqual(["t1"]);
  expect(filterTxs(e, { entity: "BV1", search: "boodschappen" }).map((t) => t.id)).toEqual(["t2"]);
  expect(filterTxs(e, {}).map((t) => t.id)).toEqual(["t1", "t2", "t3", "t4"]);
});

test("accountSummaries counts txs per account, including accounts with zero txs", () => {
  const accountsPlusEmpty: Account[] = [
    ...accounts,
    { key: "NL22KNAB0000", iban: "NL22KNAB0000", name: "Knab", bank: "Knab", entity: "BV1", currency: "EUR", balance: null },
  ];
  const s = accountSummaries(accountsPlusEmpty, txs);
  expect(s.find((x) => x.account.key === "NL01INGB0001")!.txCount).toBe(2);
  expect(s.find((x) => x.account.key === "NL91ABNA0417164300")!.txCount).toBe(1);
  expect(s.find((x) => x.account.key === "NL22KNAB0000")!.txCount).toBe(0);
});

test("reassignEntity changes only the target account, immutably", () => {
  const next = reassignEntity(accounts, "NL01INGB0001", "BV3");
  expect(next.find((a) => a.key === "NL01INGB0001")!.entity).toBe("BV3");
  expect(next.find((a) => a.key === "NL91ABNA0417164300")!.entity).toBe("BV2");
  expect(accounts.find((a) => a.key === "NL01INGB0001")!.entity).toBe("BV1");
  expect(next).not.toBe(accounts);
});
