import { expect, test } from "vitest";
import type { Account, Tx } from "./model.js";
import { enrichTxs, filterTxs, accountSummaries, reassignEntity, monthlyTotals, categorize, categoryTotals, categoryComparison, ownAccounts, mergeImportedAccounts } from "./views.js";
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

test("categoryComparison: latest month vs prior — share % + change %, transfers excluded", () => {
  // Build `own` via the real helper so the transfer ids are normalized exactly
  // as categorize expects (the ING account is "own"; the tx below references it).
  const own = ownAccounts([
    { key: "NL01INGB0001", iban: "NL01INGB0001", name: "ING", bank: "ING", entity: "BV1", currency: "EUR", balance: null },
  ]);
  const t = (id: string, date: string, amount: number, cp: string): Tx => ({
    id, accountKey: "NL91ABNA0417164300", date, amount, currency: "EUR", counterparty: cp, description: "", category: "", manual: false,
  });
  const rows: Tx[] = [
    // previous month (2026-07): boodschappen 100, transport 50
    t("p1", "2026-07-05", -60, "Albert Heijn"),
    t("p2", "2026-07-20", -40, "Jumbo"),
    t("p3", "2026-07-10", -50, "NS"),
    // current month (2026-08): boodschappen 120 (+20%), transport 50 (0%), horeca 30 (nieuw)
    t("c1", "2026-08-03", -70, "Albert Heijn"),
    t("c2", "2026-08-18", -50, "Jumbo"),
    t("c3", "2026-08-12", -50, "NS"),
    t("c4", "2026-08-14", -30, "Restaurant"),
    // an own-account transfer in the current month — must be EXCLUDED from spend
    { id: "x1", accountKey: "NL91ABNA0417164300", date: "2026-08-15", amount: -500, currency: "EUR", counterparty: "NL01INGB0001 eigen", description: "spaar", category: "", manual: false },
    // income — ignored
    t("i1", "2026-08-01", 3000, "Salaris"),
  ];
  // Explicit rules so categories don't depend on the built-in NL merchant list.
  const cmpRules: Rule[] = [
    { id: "b1", match: "albert heijn", category: "Boodschappen" },
    { id: "b2", match: "jumbo", category: "Boodschappen" },
    { id: "tr", match: "ns", category: "Transport" },
    { id: "ho", match: "restaurant", category: "Horeca" },
  ];
  const cmp = categoryComparison(rows, cmpRules, own);
  expect(cmp.month).toBe("2026-08");
  expect(cmp.prevMonth).toBe("2026-07");
  const by = Object.fromEntries(cmp.rows.map((r) => [r.category, r]));
  // Boodschappen: current 120 of total 200 => 60% share; vs prev 100 => +20%
  expect(by["Boodschappen"].out).toBeCloseTo(120, 5);
  expect(by["Boodschappen"].sharePct).toBeCloseTo(60, 5);
  expect(by["Boodschappen"].changePct).toBeCloseTo(20, 5);
  // Transport: 50 vs 50 => 0%
  expect(by["Transport"].changePct).toBeCloseTo(0, 5);
  // Horeca (Restaurant): new this month => changePct null
  expect(by["Horeca"].changePct).toBeNull();
  // Own transfer excluded, income ignored
  expect(by["Eigen overboeking"]).toBeUndefined();
  // Sorted biggest-first
  expect(cmp.rows[0].category).toBe("Boodschappen");
});

test("categoryComparison: empty input yields empty result", () => {
  expect(categoryComparison([], [])).toEqual({ month: "", prevMonth: "", rows: [] });
});

test("a re-import keeps a bank/name the owner typed, but may fix a stale parser one", () => {
  const renamed = { key: "A28641213", iban: "", name: "Oranje Spaarrekening", bank: "ING", entity: "Prive",
    currency: "EUR", balance: 100, type: "Spaarrekening", renamed: true };
  const stale = { ...renamed, key: "D12883091", name: "D 128-83091", bank: "", renamed: undefined };
  const imported = [
    { key: "A28641213", iban: "", name: "D 286-41213", bank: "", entity: "", currency: "EUR", balance: null },
    { key: "D12883091", iban: "", name: "Oranje Spaarrekening", bank: "ING", entity: "", currency: "EUR", balance: null },
  ];
  const merged = mergeImportedAccounts([renamed, stale], imported);

  // His own rename survives the import that would have blanked the bank again.
  expect(merged[0]).toMatchObject({ bank: "ING", name: "Oranje Spaarrekening", renamed: true });
  // The row he never touched takes the better data the current parser produces.
  expect(merged[1]).toMatchObject({ bank: "ING", name: "Oranje Spaarrekening" });
  // Entity/type/balance preservation is unchanged.
  expect(merged[0]).toMatchObject({ entity: "Prive", type: "Spaarrekening", balance: 100 });
});
