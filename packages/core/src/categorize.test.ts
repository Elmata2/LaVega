import { expect, test } from "vitest";
import type { Tx, Rule } from "./model.js";
import { CATEGORY_OPTIONS, uncategorizedTxs, applyCategorizations, recategorize, uncategorizedByMonth } from "./categorize.js";

const tx = (id: string, cp: string, amount: number, category = ""): Tx => ({
  id, accountKey: "A1", date: "2026-08-01", amount, currency: "EUR", counterparty: cp, description: "", category, manual: false,
});
const dated = (id: string, cp: string, date: string): Tx => ({ ...tx(id, cp, -10), date });

test("uncategorizedTxs returns only txs that resolve to 'onbekend'", () => {
  const txs = [tx("t1", "Jan Jansen priv", -10), tx("t2", "Albert Heijn", -20)];
  const rules: Rule[] = [];
  // "Albert Heijn" hits a built-in NL default; "Jan Jansen priv" does not.
  const un = uncategorizedTxs(txs, rules);
  expect(un.map((t) => t.id)).toEqual(["t1"]);
});

test("applyCategorizations sets manual category on decided txs + builds deduped rules", () => {
  const txs = [tx("t1", "Jan Jansen priv", -10), tx("t2", "Jan Jansen priv", -12), tx("t3", "Mystery BV", -5)];
  const rules: Rule[] = [];
  const out = applyCategorizations(txs, rules, [
    { id: "t1", category: "Overboekingen" },
    { id: "t2", category: "Overboekingen" },
    { id: "t3", category: "NietBestaand" }, // invalid -> skipped
  ]);
  const byId = Object.fromEntries(out.txs.map((t) => [t.id, t]));
  expect(byId.t1).toMatchObject({ category: "Overboekingen", manual: true });
  expect(byId.t2).toMatchObject({ category: "Overboekingen", manual: true });
  expect(byId.t3.category).toBe(""); // invalid category ignored, tx untouched
  // One deduped rule for "Jan Jansen priv" -> Overboekingen (not two)
  const janRules = out.rules.filter((r) => r.match.toLowerCase().includes("jan jansen"));
  expect(janRules).toHaveLength(1);
  expect(janRules[0].category).toBe("Overboekingen");
});

test("applyCategorizations does not duplicate an existing rule and skips empty counterparty", () => {
  const txs = [tx("t1", "Albert Heijn", -10), tx("t2", "", -5)];
  const existing: Rule[] = [{ id: "r0", match: "Albert Heijn", category: "Boodschappen" }];
  const out = applyCategorizations(txs, existing, [
    { id: "t1", category: "Boodschappen" },
    { id: "t2", category: "Overboekingen" },
  ]);
  expect(out.rules.filter((r) => r.match.toLowerCase() === "albert heijn")).toHaveLength(1); // no dup
  expect(out.rules.some((r) => r.match === "")).toBe(false); // empty counterparty -> no rule
  expect(out.txs.find((t) => t.id === "t2")).toMatchObject({ category: "Overboekingen", manual: true });
});

/* --- recategorize: the pass over transactions that are ALREADY stored ----- */

test("recategorize categorizes a STORED, previously-uncategorised transaction on a re-run", () => {
  // Exactly the vault situation: the tx was imported before the rule existed,
  // so it sits in storage with an empty category.
  const stored: Tx[] = [tx("t1", "Albert Heijn 1234", -20), tx("t2", "Nationale-Nederlanden", -95)];
  expect(stored.every((t) => t.category === "")).toBe(true);

  const out = recategorize(stored, []);
  expect(out.changed).toBe(2);
  expect(out.txs.map((t) => t.category)).toEqual(["Boodschappen", "Verzekeringen"]);
  // Pure: the stored array is untouched.
  expect(stored.map((t) => t.category)).toEqual(["", ""]);
});

test("recategorize never stores 'onbekend' and is idempotent", () => {
  const stored: Tx[] = [tx("t1", "Albert Heijn", -20), tx("t2", "Stichting Derdengelden", -500)];
  const first = recategorize(stored, []);
  expect(first.txs[1].category).toBe(""); // unplaceable stays EMPTY, not "onbekend"
  expect(first.txs.some((t) => t.category === "onbekend")).toBe(false);

  const second = recategorize(first.txs, []);
  expect(second.changed).toBe(0);
  expect(second.txs.map((t) => t.category)).toEqual(first.txs.map((t) => t.category));
});

test("recategorize leaves a manual/AI-confirmed category alone, but re-derives the rest", () => {
  const confirmed: Tx = { ...tx("t1", "Albert Heijn", -20, "Mijn eigen bucket"), manual: true };
  const auto: Tx = tx("t2", "Jan Jansen priv", -30, "Boodschappen"); // written by an earlier run
  const rules: Rule[] = [{ id: "r1", match: "Jan Jansen", category: "Overboekingen" }];

  const out = recategorize([confirmed, auto], rules);
  expect(out.txs[0]).toMatchObject({ category: "Mijn eigen bucket", manual: true }); // untouched
  // A better rule set overwrites what an earlier run wrote — that is what makes
  // the pass re-runnable instead of freezing the first answer.
  expect(out.txs[1].category).toBe("Overboekingen");
  expect(out.changed).toBe(1);
});

test("recategorize picks up a rule the AI review just appended", () => {
  const stored: Tx[] = [tx("t1", "Mystery Holding BV", -75), tx("t2", "Mystery Holding BV", -75)];
  expect(recategorize(stored, []).changed).toBe(0); // nothing matches yet

  // The AI review confirms t1; applyCategorizations appends a rule for it...
  const applied = applyCategorizations(stored, [], [{ id: "t1", category: "Abonnementen" }]);
  // ...and a re-run over storage now also places t2, which was never reviewed.
  const out = recategorize(applied.txs, applied.rules);
  expect(out.txs.find((t) => t.id === "t2")).toMatchObject({ category: "Abonnementen", manual: false });
  expect(out.txs.find((t) => t.id === "t1")).toMatchObject({ category: "Abonnementen", manual: true });
});

/* --- uncategorizedByMonth: point the AI pass at the newest month first ---- */

test("uncategorizedByMonth groups the remainder newest month first", () => {
  // Stored in import order = oldest first, which is why a capped slice of
  // uncategorizedTxs used to hand the AI the oldest rows.
  const stored: Tx[] = [
    dated("a", "Stichting Derdengelden", "2026-06-04"),
    dated("b", "Albert Heijn", "2026-07-11"), // placed by a default -> excluded
    dated("c", "Mystery Holding BV", "2026-07-20"),
    dated("d", "Onbekende Winkel XYZ", "2026-08-02"),
    dated("e", "Andere Onbekende BV", "2026-08-14"),
  ];
  expect(uncategorizedTxs(stored, [])[0].id).toBe("a"); // oldest first, as stored

  const months = uncategorizedByMonth(stored, []);
  expect(months.map((m) => m.month)).toEqual(["2026-08", "2026-07", "2026-06"]);
  expect(months[0].txs.map((t) => t.id)).toEqual(["e", "d"]); // newest first within the month
  expect(months[1].txs.map((t) => t.id)).toEqual(["c"]); // "b" was categorized, so not offered
});

test("uncategorizedByMonth shrinks as rules improve", () => {
  const stored: Tx[] = [dated("a", "Mystery Holding BV", "2026-08-02"), dated("b", "Andere BV", "2026-08-03")];
  expect(uncategorizedByMonth(stored, [])[0].txs).toHaveLength(2);
  const rules: Rule[] = [{ id: "r1", match: "Mystery Holding", category: "Abonnementen" }];
  expect(uncategorizedByMonth(stored, rules)[0].txs.map((t) => t.id)).toEqual(["b"]);
});

test("CATEGORY_OPTIONS is a non-empty set including the common NL buckets", () => {
  expect(CATEGORY_OPTIONS).toContain("Boodschappen");
  expect(CATEGORY_OPTIONS).toContain("Overboekingen");
  expect(CATEGORY_OPTIONS.length).toBeGreaterThan(10);
});
