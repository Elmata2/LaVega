import { expect, test } from "vitest";
import type { Tx, Rule } from "./model.js";
import { CATEGORY_OPTIONS, uncategorizedTxs, applyCategorizations } from "./categorize.js";

const tx = (id: string, cp: string, amount: number, category = ""): Tx => ({
  id, accountKey: "A1", date: "2026-08-01", amount, currency: "EUR", counterparty: cp, description: "", category, manual: false,
});

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

test("CATEGORY_OPTIONS is a non-empty set including the common NL buckets", () => {
  expect(CATEGORY_OPTIONS).toContain("Boodschappen");
  expect(CATEGORY_OPTIONS).toContain("Overboekingen");
  expect(CATEGORY_OPTIONS.length).toBeGreaterThan(10);
});
