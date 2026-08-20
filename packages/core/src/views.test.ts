import { describe, expect, test } from "vitest";
import type { Account, Tx } from "./model.js";
import { enrichTxs, filterTxs, accountSummaries, reassignEntity, monthlyTotals, categorize, categoryTotals, categoryComparison, foreignTerminalCategory, ownAccounts, mergeImportedAccounts, selectMajorCategories, windowDaysFromMonths } from "./views.js";
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

test("categoryComparison: empty input yields empty result, and nothing comparable", () => {
  const cmp = categoryComparison([], []);
  expect(cmp.month).toBe("");
  expect(cmp.prevMonth).toBe("");
  expect(cmp.rows).toEqual([]);
  expect(cmp.coverage).toEqual({
    comparedAccountKeys: [],
    excludedAccountKeys: [],
    excludedOut: { current: 0, previous: 0 },
    comparable: false,
  });
});

/* ── Like-for-like coverage: the ~€24.000 rise that was not real ──────────── */

const cmpTx = (accountKey: string, id: string, date: string, amount: number, cp: string): Tx => ({
  id, accountKey, date, amount, currency: "EUR", counterparty: cp, description: "", category: "", manual: false,
});
const shopRules: Rule[] = [
  { id: "b1", match: "albert heijn", category: "Boodschappen" },
  { id: "kl", match: "kledingzaak", category: "Kleding" },
];

test("categoryComparison: a card imported for the current month only is left OUT of both sides", () => {
  const rows: Tx[] = [
    // ABN: a full run of months, so it covers July and August.
    cmpTx("ABN", "a1", "2026-07-05", -100, "Albert Heijn"),
    cmpTx("ABN", "a2", "2026-08-05", -110, "Albert Heijn"),
    // Amex: August only — July never had this card.
    cmpTx("AMEX", "x1", "2026-08-09", -24_000, "Kledingzaak"),
  ];
  const cmp = categoryComparison(rows, shopRules);
  expect(cmp.coverage.comparable).toBe(true);
  expect(cmp.coverage.comparedAccountKeys).toEqual(["ABN"]);
  expect(cmp.coverage.excludedAccountKeys).toEqual(["AMEX"]);
  expect(cmp.coverage.excludedOut.current).toBeCloseTo(24_000, 5);
  expect(cmp.coverage.excludedOut.previous).toBeCloseTo(0, 5);
  // The Amex spend is not in the rows at all — no fictional new category, and
  // Boodschappen is compared against the account that was there both months.
  expect(cmp.rows.map((r) => r.category)).toEqual(["Boodschappen"]);
  expect(cmp.rows[0].out).toBeCloseTo(110, 5);
  expect(cmp.rows[0].prevOut).toBeCloseTo(100, 5);
  expect(cmp.rows[0].changePct).toBeCloseTo(10, 5);
});

test("categoryComparison: when NO account covers both months, changePct is null — the whole comparison is refused", () => {
  // Everything the vault holds is August: there is no July to compare against.
  const rows: Tx[] = [
    cmpTx("ABN", "a1", "2026-08-05", -100, "Albert Heijn"),
    cmpTx("AMEX", "x1", "2026-08-09", -24_000, "Kledingzaak"),
  ];
  const cmp = categoryComparison(rows, shopRules);
  expect(cmp.month).toBe("2026-08");
  expect(cmp.prevMonth).toBe("2026-07");
  expect(cmp.coverage.comparable).toBe(false);
  expect(cmp.coverage.comparedAccountKeys).toEqual([]);
  expect(cmp.coverage.excludedAccountKeys).toEqual(["ABN", "AMEX"]);
  expect(cmp.rows).toEqual([]);
  // The rule the travel ranking lives by: no number is printed at all.
  expect(cmp.rows.every((r) => r.changePct === null)).toBe(true);
});

test("categoryComparison: an account merely UNUSED in the previous month still counts as covered", () => {
  const rows: Tx[] = [
    cmpTx("ABN", "a0", "2026-06-05", -100, "Albert Heijn"),
    cmpTx("ABN", "a1", "2026-07-05", -100, "Albert Heijn"),
    cmpTx("ABN", "a2", "2026-08-05", -100, "Albert Heijn"),
    // The card spans June->August but had no July transaction. That is a real
    // zero, not a hole, so it belongs in the comparison.
    cmpTx("AMEX", "x0", "2026-06-09", -50, "Kledingzaak"),
    cmpTx("AMEX", "x1", "2026-08-09", -80, "Kledingzaak"),
  ];
  const cmp = categoryComparison(rows, shopRules);
  expect(cmp.coverage.comparedAccountKeys).toEqual(["ABN", "AMEX"]);
  expect(cmp.coverage.excludedAccountKeys).toEqual([]);
  const kleding = cmp.rows.find((r) => r.category === "Kleding")!;
  expect(kleding.out).toBeCloseTo(80, 5);
  expect(kleding.prevOut).toBeCloseTo(0, 5);
  expect(kleding.changePct).toBeNull(); // no prior spend => no percentage
});

test("categoryComparison: the newest month is flagged PARTIAL when the data stops mid-month", () => {
  const rows: Tx[] = [
    cmpTx("ABN", "a1", "2026-07-05", -100, "Albert Heijn"),
    cmpTx("ABN", "a2", "2026-07-31", -10, "Albert Heijn"),
    cmpTx("ABN", "a3", "2026-08-11", -110, "Albert Heijn"),
  ];
  const cmp = categoryComparison(rows, shopRules);
  expect(cmp.current).toEqual({
    month: "2026-08",
    firstDate: "2026-08-11",
    lastDate: "2026-08-11",
    daysObserved: 11,
    daysInMonth: 31,
    partial: true,
  });
  // July ran to its last day, so it is not partial — eleven days against a full
  // month is exactly the asymmetry the caller has to be able to see.
  expect(cmp.previous).toMatchObject({ month: "2026-07", daysObserved: 31, daysInMonth: 31, partial: false });
});

test("categoryComparison: a February that runs to the 28th of a 28-day month is NOT partial", () => {
  const rows: Tx[] = [
    cmpTx("ABN", "a1", "2026-01-15", -100, "Albert Heijn"),
    cmpTx("ABN", "a2", "2026-02-28", -100, "Albert Heijn"),
  ];
  const cmp = categoryComparison(rows, shopRules);
  expect(cmp.current).toMatchObject({ month: "2026-02", daysInMonth: 28, daysObserved: 28, partial: false });
});

test("categoryComparison: December rolls back to November, not to month 0", () => {
  const rows: Tx[] = [
    cmpTx("ABN", "a1", "2026-11-15", -100, "Albert Heijn"),
    cmpTx("ABN", "a2", "2026-12-31", -150, "Albert Heijn"),
  ];
  const cmp = categoryComparison(rows, shopRules);
  expect(cmp.month).toBe("2026-12");
  expect(cmp.prevMonth).toBe("2026-11");
  expect(cmp.rows[0].changePct).toBeCloseTo(50, 5);
});

/* ── The "smaller categories" cut-off, per timeframe ──────────────────────── */

test("selectMajorCategories: the same category survives a one-month window and is folded away over a year", () => {
  // €40 a month of "Cadeaus" against a €1.000-a-month household.
  const oneMonth: [string, number][] = [
    ["Boodschappen", 500],
    ["Wonen", 400],
    ["Cadeaus", 40],
    ["Postzegels", 4],
  ];
  const short = selectMajorCategories(oneMonth, { windowDays: 31, maxShown: 4 });
  expect(short.shown.map((s) => s.category)).toEqual(["Boodschappen", "Wonen", "Cadeaus"]);
  expect(short.hidden.map((h) => h.category)).toEqual(["Postzegels"]);
  expect(short.thresholdOut).toBeCloseTo((25 * 31) / 30, 5);

  // Twelve months of the same spending: the €25/month floor scales to €300, so
  // "Cadeaus" (€480/yr) is STILL shown — a fixed global floor would have hidden
  // it, which is the defect.
  const year: [string, number][] = oneMonth.map(([c, v]) => [c, v * 12]);
  const long = selectMajorCategories(year, { windowDays: 365, maxShown: 4 });
  expect(long.shown.map((s) => s.category)).toContain("Cadeaus");
  expect(long.thresholdOut).toBeCloseTo((25 * 365) / 30, 5);
  // €48/yr of postage really is noise at a year's scale, and it is named.
  expect(long.hidden.map((h) => h.category)).toEqual(["Postzegels"]);
});

test("selectMajorCategories: what was folded away is named, totalled and shared", () => {
  const sel = selectMajorCategories(
    [["A", 500], ["B", 300], ["C", 200], ["D", 100], ["E", 60], ["F", 20]],
    { windowDays: 30, maxShown: 3 },
  );
  expect(sel.shown.map((s) => s.category)).toEqual(["A", "B", "C"]);
  // D and E clear the €25 floor but are past the chart's cap; F is below it.
  // Both kinds are folded away, both are named, and the two are told apart so
  // the block does not call a €100 category "kleiner".
  expect(sel.hidden.map((h) => h.category)).toEqual(["D", "E", "F"]);
  expect(sel.hidden.map((h) => h.belowThreshold)).toEqual([false, false, true]);
  expect(sel.hiddenOut).toBeCloseTo(180, 5);
  expect(sel.totalOut).toBeCloseTo(1180, 5);
  expect(sel.hiddenSharePct).toBeCloseTo((180 / 1180) * 100, 5);
  expect(sel.shown[0].sharePct).toBeCloseTo((500 / 1180) * 100, 5);
});

test("selectMajorCategories: a Map works, zero/negative totals are dropped, ties are stable", () => {
  const sel = selectMajorCategories(
    new Map([["A", 100], ["B", 100], ["Leeg", 0], ["Negatief", -10]]),
    { windowDays: 30 },
  );
  expect(sel.shown.map((s) => s.category)).toEqual(["A", "B"]);
  expect(sel.hidden).toEqual([]);
});

test("selectMajorCategories: no window means no floor — nothing is dropped for being small", () => {
  const sel = selectMajorCategories([["A", 100], ["B", 1]], { windowDays: 0 });
  expect(sel.thresholdOut).toBe(0);
  expect(sel.shown.map((s) => s.category)).toEqual(["A", "B"]);
});

test("selectMajorCategories: an empty window yields zeroed shares, not NaN", () => {
  const sel = selectMajorCategories([], { windowDays: 30 });
  expect(sel).toMatchObject({ shown: [], hidden: [], hiddenOut: 0, hiddenSharePct: 0, totalOut: 0 });
});

test("windowDaysFromMonths counts real calendar days, leap year included", () => {
  expect(windowDaysFromMonths(["2026-01"])).toBe(31);
  expect(windowDaysFromMonths(["2026-02"])).toBe(28);
  expect(windowDaysFromMonths(["2024-02"])).toBe(29);
  expect(windowDaysFromMonths(["2026-06", "2026-07", "2026-08"])).toBe(30 + 31 + 31);
  expect(windowDaysFromMonths([])).toBe(0);
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

/* HIS ONBEKEND ROWS, verbatim from the 20 August review.
 *
 * Three Barcelona card payments were reaching "onbekend" while the app had
 * already worked out they were foreign — the detection produced a LABEL and not a
 * category, so a July he could account for perfectly well sat in a bucket he
 * could not. And a Rabo Betaalverzoek had no rule at all.
 */
describe("onbekend: the rows he showed us", () => {
  const row = (counterparty: string, description: string, amount: number): Tx => ({
    id: "t", accountKey: "NL88INGB0793113504", date: "2026-07-19",
    amount, currency: "EUR", counterparty, description, category: "", manual: false,
  });

  test("a metro ride in Barcelona is Transport, not onbekend", () => {
    const t = row("METRO BARCELONA", "METRO BARCELONA BARCELONA ESP Kaartnr: 5238 53** **** 1748 Datum: 18-07-2026 Tijd: 18:43 Transactie: I13241 Term: 86324463 Apple Pay", -7.8);
    expect(categorize(t, [])).toBe("Transport");
  });

  test("a campsite abroad is Reizen", () => {
    const t = row("CAMPER PARK BARCELONA", "CAMPER PARK BARCELONA TEIA ESP Kaartnr: 5238 53** **** 1748 Tijd: 11:36 Term: KJOLH2QT Apple Pay", -30);
    expect(categorize(t, [])).toBe("Reizen");
  });

  test("gelato is Café", () => {
    const t = row("MUST GELATO", "MUST GELATO BARCELONA ESP Kaartnr: 5238 53** **** 1748 Tijd: 21:41 Term: 02013791 Apple Pay", -4.2);
    expect(categorize(t, [])).toBe("Café");
  });

  test("an unrecognised merchant at a terminal abroad still lands somewhere honest", () => {
    const t = row("XURRERIA TREBOL", "XURRERIA TREBOL BARCELONA ESP Kaartnr: 5238 53** **** 1748 Tijd: 09:12 Term: 11223344", -3.5);
    expect(categorize(t, [])).toBe("Reizen");
  });

  test("a Rabo Betaalverzoek is a transfer between people", () => {
    const t = row("T.J. van Wijngaarden via Rabo Betaalverzoek", "Naam: T.J. van Wijngaarden via Rabo Betaalverzoek Omschrijving: Vacance IBAN: NL42RABO0114668043", -52.8);
    expect(categorize(t, [])).toBe("Overboekingen");
  });

  test("a FOREIGN ONLINE purchase is NOT called travel — no terminal, no claim", () => {
    // The discriminator earning its place: calling an order from a foreign webshop
    // "Reizen" would silently distort the travel total. Asserted on the rule
    // itself, because an existing rule already places AliExpress under Online
    // shopping — which is the right answer and not the one under test here.
    const t = row("ALIEXPRESS", "ALIEXPRESS CHN Kaartnr: 5238 53** **** 1748", -18.4);
    expect(foreignTerminalCategory(t)).toBeNull();
    expect(categorize(t, [])).not.toBe("Reizen");
  });

  test("a foreign card row with NO merchant rule and no terminal stays unknown", () => {
    const t = row("QUIOSC 4412", "QUIOSC 4412 ESP Kaartnr: 5238 53** **** 1748", -2.1);
    expect(foreignTerminalCategory(t)).toBeNull();
    expect(categorize(t, [])).toBe("onbekend");
  });

  test("a DOMESTIC terminal payment is untouched by the abroad rule", () => {
    const t = row("ALBERT HEIJN 1234", "ALBERT HEIJN 1234 AMSTERDAM Kaartnr: 5238 53** **** 1748 Term: 8899 Tijd: 12:03", -42.15);
    expect(categorize(t, [])).toBe("Boodschappen");
  });
});
