import { expect, test } from "vitest";
import type { Rule, RuleV2, Tx } from "../model.js";
import { categorize, categorizeDetailed, dryRunRuleChanges } from "../views.js";
import { dryRunRules } from "./dryrun.js";

const tx = (
  id: string,
  counterparty: string,
  amount: number,
  category = "",
  manual = false,
): Tx => ({
  id,
  accountKey: "A1",
  date: "2026-06-15",
  amount,
  currency: "EUR",
  counterparty,
  description: "",
  category,
  manual,
});

/* A corpus with the three interesting kinds of row: plain, stored and manual.
 * Rules mix a legacy row with v2 rows, including one that is not in force. */
const txs: Tx[] = [
  tx("t1", "Albert Heijn", -20),
  tx("t2", "Albert Heijn", -20, "Boodschappen"),
  tx("t3", "Albert Heijn", -20, "Handmatig", true),
  tx("t4", "Albert Heijn", -20, "", true),
  tx("t5", "Quiosc 4412", -5),
  tx("t6", "Salaris", 2500),
  tx("t7", "Quiosc 4412", -500),
];

const v2 = (
  id: string,
  conditions: RuleV2["conditions"],
  actions: RuleV2["actions"],
  extra: Partial<Pick<RuleV2, "effectiveFrom" | "stopProcessing">> = {},
): RuleV2 => ({ v: 2, id, conditions, actions, ...extra });

const rules: Rule[] = [
  v2(
    "v2-tag",
    [{ kind: "text", target: "text", op: "contains", value: "albert" }],
    [{ kind: "addTag", tag: "boodschappen" }],
  ),
  { id: "legacy-ah", match: "albert heijn", category: "Boodschappen" },
  v2(
    "v2-kiosk",
    [
      { kind: "merchant", op: "contains", value: "quiosc" },
      { kind: "amount", op: "between", valueCents: -1000, upperCents: -100 },
    ],
    [{ kind: "setCategory", category: "Overig" }],
  ),
  v2(
    "v2-future",
    [{ kind: "text", target: "text", op: "contains", value: "albert" }],
    [{ kind: "setCategory", category: "Toekomst" }],
    { effectiveFrom: "2030-01-01" },
  ),
];

test("dry-run winner equals execution, row for row (legacy and v2 rules)", () => {
  const result = dryRunRuleChanges(txs, rules);
  // Samples are the MATCHED rows (t1-t5), in input order.
  expect(result.samples.map((sample) => sample.txId)).toEqual(["t1", "t2", "t3", "t4", "t5"]);
  result.samples.forEach((sample) => {
    const row = txs.find((candidate) => candidate.id === sample.txId)!;
    // The injected `decide` IS categorizeDetailed, so this is the real engine.
    expect(sample.decision.category).toBe(categorize(row, rules));
    expect(sample.decision).toEqual(categorizeDetailed(row, rules));
    if (sample.decision.source === "rule" && sample.outcome.claims.category !== undefined) {
      // The rule the OUTCOME says claimed the category is the one execution
      // reports. A stored category wins before the engine, and a locked category
      // (manual row) has no claim; both are covered by their own tests.
      expect(sample.decision.ruleId).toBe(sample.outcome.claims.category);
    }
    expect(sample.amountCents).toBe(Math.round(row.amount * 100));
  });
});

test("counters: matchedTxs, changed, byRule and the default sample cap", () => {
  const result = dryRunRuleChanges(txs, rules);
  expect(result.totalTxs).toBe(7);
  // t1-t5 matched at least one rule and claimed at least one attribute; t6/t7 did not.
  // t3/t4 are manual, so the category lock stops a claim but the tag claim stands.
  expect(result.matchedTxs).toBe(5);
  // changed = a RULE decides a category the built-in tiers would not have given.
  // The Albert Heijn rules only re-state "Boodschappen", which the built-ins
  // already say, so those rows do not move. t5 (Quiosc, -€5.00) matches the
  // kiosk amount band and lands on "Overig", which the built-ins do not give it.
  expect(result.changed).toBe(1);
  expect(result.byRule).toEqual([
    { ruleId: "v2-tag", matches: 4 },
    { ruleId: "legacy-ah", matches: 4 },
    { ruleId: "v2-kiosk", matches: 1 },
    // Zero-match rules are still listed, so the editor can show an unused rule.
    { ruleId: "v2-future", matches: 0 },
  ]);
  expect(result.samples).toHaveLength(5);
});

test("a manual row is locked in the outcome but execution still reports the same decision", () => {
  const result = dryRunRuleChanges(txs, rules);
  const manualWithCategory = result.samples.find((s) => s.txId === "t3")!;
  expect(manualWithCategory.decision).toEqual({
    category: "Handmatig",
    source: "stored",
    ruleId: null,
    locked: true,
  });
  expect(manualWithCategory.outcome.locked).toEqual({ category: "met de hand gezet" });

  const manualEmpty = result.samples.find((s) => s.txId === "t4")!;
  // The dry-run outcome shows the lock (nothing claims the category)...
  expect(manualEmpty.outcome.locked).toEqual({ category: "met de hand gezet" });
  expect(manualEmpty.outcome.claims.category).toBeUndefined();
  // ...while execution follows its own precedence: a manual row with an EMPTY
  // category always fell through to the rules, and still does.
  expect(manualEmpty.decision.category).toBe("Boodschappen");
});

test("samples are capped by limit, in input order; counters and log are not capped", () => {
  const result = dryRunRuleChanges(txs, rules, undefined, 2);
  expect(result.samples.map((s) => s.txId)).toEqual(["t1", "t2"]);
  expect(result.totalTxs).toBe(7);
  expect(result.matchedTxs).toBe(5);
  expect(result.log).toHaveLength(9);
});

test("the default cap is 50 samples", () => {
  const many = Array.from({ length: 60 }, (_, i) => tx(`m${i}`, "Quiosc 4412", -5));
  const result = dryRunRuleChanges(many, rules);
  expect(result.totalTxs).toBe(60);
  expect(result.samples).toHaveLength(50);
  expect(result.samples[49]!.txId).toBe("m49");
});

test("the run log records one entry per match with fields and applied attributes", () => {
  const result = dryRunRuleChanges(txs, rules);
  expect(result.log).toHaveLength(9);
  expect(result.log[0]).toEqual({
    txId: "t1",
    ruleId: "v2-tag",
    fields: ["text"],
    applied: ["tags"],
  });
  expect(result.log[1]).toEqual({
    txId: "t1",
    ruleId: "legacy-ah",
    fields: ["text"],
    applied: ["category"],
  });
  const kiosk = result.log.find((entry) => entry.ruleId === "v2-kiosk")!;
  expect(kiosk).toEqual({
    txId: "t5",
    ruleId: "v2-kiosk",
    fields: ["counterparty", "amount"],
    applied: ["category"],
  });
  // No log line for a rule that is out of force (`v2-future`).
  expect(result.log.some((entry) => entry.ruleId === "v2-future")).toBe(false);
});

test("changed counts only rows a rule moves away from the built-in category", () => {
  // t1 and t4 are decided by the rule and land outside the built-in "Boodschappen";
  // t2 holds a stored category and t3 is manual, so neither is a rule change.
  const moved = dryRunRuleChanges(
    txs,
    [
      v2(
        "v2-moved",
        [{ kind: "text", target: "text", op: "contains", value: "albert" }],
        [{ kind: "setCategory", category: "Mijn boodschappen" }],
      ),
    ],
    undefined,
  );
  expect(moved.changed).toBe(2);
});

test("dryRunRules compiles once and calls the injected decide for every row", () => {
  // Type-level proof that the caller's own function is the only categorizer the
  // preview uses: a decide that always says "Eigen keuze" must win every sample.
  const seen: string[] = [];
  const result = dryRunRules(txs, rules, {
    decide: (row) => {
      seen.push(row.id);
      return { category: "Eigen keuze", source: "unknown", ruleId: null, locked: false };
    },
    limit: 3,
  });
  expect(seen).toEqual(txs.map((row) => row.id));
  expect(result.samples).toHaveLength(3);
  expect(result.samples.every((s) => s.decision.category === "Eigen keuze")).toBe(true);
  // The injected decide claims source "unknown", which is not a rule decision:
  // samples show it, but no row counts as changed by a rule.
  expect(result.changed).toBe(0);
});
