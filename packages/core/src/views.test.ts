import { expect, test } from "vitest";
import type { Account, Tx } from "./model.js";
import { enrichTxs, filterTxs, accountSummaries, reassignEntity, monthlyTotals, categorize, categoryTotals, mergeImportedAccounts } from "./views.js";
import type { Rule } from "./model.js";

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

const txsForMonths: Tx[] = [
  { id: "a", accountKey: "A1", date: "2026-06-05", amount: 100, currency: "EUR", counterparty: "Klant", description: "Factuur", category: "", manual: false },
  { id: "b", accountKey: "A1", date: "2026-06-20", amount: -30, currency: "EUR", counterparty: "Albert Heijn", description: "Boodschappen", category: "", manual: false },
  { id: "c", accountKey: "A1", date: "2026-07-02", amount: -12.5, currency: "EUR", counterparty: "Coffee", description: "Koffie", category: "", manual: false },
];

test("filterTxs: from/to bound the date range (inclusive), combinable with other filters", () => {
  const e = enrichTxs(txsForMonths, accounts);
  expect(filterTxs(e, { from: "2026-07-01" }).map((t) => t.id)).toEqual(["c"]);
  expect(filterTxs(e, { to: "2026-06-30" }).map((t) => t.id)).toEqual(["a", "b"]);
  expect(filterTxs(e, { from: "2026-06-10", to: "2026-06-30" }).map((t) => t.id)).toEqual(["b"]);
  expect(filterTxs(e, { from: "2026-06-01", to: "2026-07-31", search: "koffie" }).map((t) => t.id)).toEqual(["c"]);
});

test("monthlyTotals: groups by YYYY-MM, sums in/out, sorted ascending by month", () => {
  expect(monthlyTotals(txsForMonths)).toEqual([
    { month: "2026-06", in: 100, out: -30 },
    { month: "2026-07", in: 0, out: -12.5 },
  ]);
});

const rules: Rule[] = [
  { id: "r1", match: "albert heijn", category: "Boodschappen" },
  { id: "r2", match: "klant", category: "Inkomen" },
];

test("categorize: first matching rule wins (case-insensitive over counterparty+description); else 'onbekend'; manual tx.category wins", () => {
  expect(categorize(txsForMonths[0], rules)).toBe("Inkomen");
  expect(categorize(txsForMonths[1], rules)).toBe("Boodschappen");
  expect(categorize(txsForMonths[2], rules)).toBe("onbekend");
  const manual: Tx = { ...txsForMonths[2], category: "Handmatig" };
  expect(categorize(manual, rules)).toBe("Handmatig");
});

test("categorize: a whitespace-only rule match does NOT match everything (guards on normalized match)", () => {
  const bad: Rule[] = [{ id: "r0", match: "   ", category: "Alles" }];
  // Use a tx that matches no user rule AND no built-in NL default, so this
  // isolates the whitespace guard (txsForMonths[1] is "Albert Heijn", which now
  // hits a built-in default — that's covered in categories.test.ts).
  const unmatched: Tx = { id: "u", accountKey: "A1", date: "2026-06-01", amount: -5, currency: "EUR", counterparty: "Jan Jansen", description: "particuliere betaling", category: "", manual: false };
  expect(categorize(unmatched, bad)).toBe("onbekend");
});

test("categoryTotals: sums in/out per derived category", () => {
  const t = categoryTotals(txsForMonths, rules);
  expect(t["Inkomen"]).toEqual({ in: 100, out: 0 });
  expect(t["Boodschappen"]).toEqual({ in: 0, out: -30 });
  expect(t["onbekend"]).toEqual({ in: 0, out: -12.5 });
});

test("mergeImportedAccounts preserves user entity/type + manual balance on re-import; new accounts pass through", () => {
  const existing: Account[] = [
    { key: "A1", iban: "A1", name: "ING", bank: "ING", entity: "BV2", type: "Spaarrekening", currency: "EUR", balance: 500, balanceDate: "2026-08-01" },
  ];
  const imported: Account[] = [
    { key: "A1", iban: "A1", name: "ING", bank: "ING", entity: "BV1", currency: "EUR", balance: null }, // CSV re-import
    { key: "A2", iban: "A2", name: "ABN", bank: "ABN AMRO", entity: "BV1", currency: "EUR", balance: 100, balanceDate: "2026-07-31" },
  ];
  const merged = mergeImportedAccounts(existing, imported);
  const a1 = merged.find((a) => a.key === "A1")!;
  expect(a1.entity).toBe("BV2");           // user entity kept
  expect(a1.type).toBe("Spaarrekening");   // user type kept
  expect(a1.balance).toBe(500);            // CSV null -> manual saldo kept
  expect(a1.balanceDate).toBe("2026-08-01");
  expect(merged.find((a) => a.key === "A2")).toMatchObject({ entity: "BV1", balance: 100 }); // new passes through
});

test("mergeImportedAccounts: a fresh non-null statement balance updates the existing account (entity still kept)", () => {
  const existing: Account[] = [{ key: "A1", iban: "A1", name: "x", bank: "ABN AMRO", entity: "BV1", currency: "EUR", balance: 10, balanceDate: "2026-06-01" }];
  const imported: Account[] = [{ key: "A1", iban: "A1", name: "x", bank: "ABN AMRO", entity: "BV9", currency: "EUR", balance: 999, balanceDate: "2026-07-31" }];
  expect(mergeImportedAccounts(existing, imported)[0]).toMatchObject({ entity: "BV1", balance: 999, balanceDate: "2026-07-31" });
});
