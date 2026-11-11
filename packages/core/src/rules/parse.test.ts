import { expect, test } from "vitest";
import { Schema } from "effect";
import type { LegacyRule, RuleV2 } from "./model.js";
import {
  LegacyRuleSchema,
  RuleV2Schema,
  StoredRulesSchema,
  lowerRule,
  ruleCategoryValue,
  ruleTextValue,
  upgradeRules,
} from "./parse.js";

const legacy = (id: string, match: string, category: string): LegacyRule => ({
  id,
  match,
  category,
});

const v2 = (id: string, overrides: Partial<RuleV2> = {}): RuleV2 => ({
  v: 2,
  id,
  conditions: [{ kind: "text", target: "text", op: "contains", value: "albert heijn" }],
  actions: [{ kind: "setCategory", category: "Boodschappen" }],
  ...overrides,
});

test("a legacy row upgrades to exactly the old substring rule", () => {
  const out = upgradeRules([legacy("r1", "Albert Heijn", "Boodschappen")]);
  expect(out.problems).toEqual([]);
  expect(out.migrated).toBe(1);
  expect(out.rules).toEqual([
    {
      v: 2,
      id: "r1",
      conditions: [{ kind: "text", target: "text", op: "contains", value: "Albert Heijn" }],
      actions: [{ kind: "setCategory", category: "Boodschappen" }],
      // The old loop returned on the first match.
      stopProcessing: true,
    },
  ]);
});

test("the legacy lowering does NOT pre-normalize the text (compile.ts owns matchNorm)", () => {
  const lowered = lowerRule(legacy("r1", "  Nationale-Nederlanden ", "Verzekeringen")) as RuleV2;
  expect(lowered.conditions).toEqual([
    { kind: "text", target: "text", op: "contains", value: "  Nationale-Nederlanden " },
  ]);
});

test("a v2 row passes through unchanged (same object) and re-upgrading is a no-op", () => {
  const original = v2("v2-1", { name: "Boodschappen", stopProcessing: false });
  const first = upgradeRules([original]);
  expect(first.migrated).toBe(0);
  expect(first.problems).toEqual([]);
  expect(first.rules[0]).toBe(original);

  const second = upgradeRules(first.rules);
  expect(second.migrated).toBe(0);
  expect(second.problems).toEqual([]);
  expect(second.rules).toEqual(first.rules);
});

test("lowerRule is total and idempotent", () => {
  const lowered = lowerRule(legacy("r1", "x", "Y"));
  expect(lowerRule(lowered)).toBe(lowered);
  const already = v2("v2-1");
  expect(lowerRule(already)).toBe(already);
});

test("valid rows survive junk rows; junk is reported, never thrown", () => {
  const stored: unknown[] = [
    null,
    42,
    {},
    { id: "x" }, // no match/category
    { id: "v-bad", v: 2, conditions: [], actions: "nope" },
    { id: "", v: 2, conditions: [], actions: [] },
    legacy("good", "albert heijn", "Boodschappen"),
    "not a rule",
  ];
  const out = upgradeRules(stored);
  expect(out.rules).toHaveLength(1);
  expect((out.rules[0] as RuleV2).id).toBe("good");
  expect(out.migrated).toBe(1);
  expect(out.problems).toEqual([
    { index: 0, reason: "invalid" },
    { index: 1, reason: "invalid" },
    { index: 2, reason: "invalid" },
    { index: 3, ruleId: "x", reason: "invalid" },
    { index: 4, ruleId: "v-bad", reason: "invalid" },
    { index: 5, reason: "invalid" },
    { index: 7, reason: "invalid" },
  ]);
});

test("duplicate ids keep the first row and report the later ones", () => {
  const out = upgradeRules([
    legacy("dup", "albert heijn", "Eerste"),
    v2("dup"),
    legacy("dup", "jumbo", "Derde"),
    v2("unique"),
  ]);
  expect(out.rules).toHaveLength(2);
  expect(ruleCategoryValue(out.rules[0]!)).toBe("Eerste");
  expect(out.migrated).toBe(1);
  expect(out.problems).toEqual([
    { index: 1, ruleId: "dup", reason: "duplicate-id" },
    { index: 2, ruleId: "dup", reason: "duplicate-id" },
  ]);
});

test("a non-array store reads as empty and is reported", () => {
  expect(upgradeRules(undefined)).toEqual({
    rules: [],
    migrated: 0,
    problems: [{ index: 0, reason: "empty" }],
  });
  expect(upgradeRules({ rules: [] })).toEqual({
    rules: [],
    migrated: 0,
    problems: [{ index: 0, reason: "empty" }],
  });
});

test("both shapes are read through ruleCategoryValue/ruleTextValue", () => {
  expect(ruleCategoryValue(legacy("r1", "ah", "Boodschappen"))).toBe("Boodschappen");
  expect(ruleTextValue(legacy("r1", "ah", "Boodschappen"))).toBe("ah");
  expect(ruleTextValue(v2("v2-1"))).toBe("albert heijn");
  expect(ruleCategoryValue(v2("v2-1"))).toBe("Boodschappen");
  // A rule with no category/text action has no value; callers must not read the
  // legacy fields off a v2 row.
  const tagOnly = v2("v2-tag", { actions: [{ kind: "addTag", tag: "x" }] });
  expect(ruleCategoryValue(tagOnly)).toBeUndefined();
  const amountOnly = v2("v2-amount", {
    conditions: [{ kind: "amount", op: "lt", valueCents: 0 }],
  });
  expect(ruleTextValue(amountOnly)).toBeUndefined();
});

test("the Effect schemas accept both stored shapes", () => {
  expect(Schema.is(LegacyRuleSchema)(legacy("r1", "x", "Y"))).toBe(true);
  expect(Schema.is(RuleV2Schema)(v2("v2-1"))).toBe(true);
  expect(Schema.is(StoredRulesSchema)([legacy("r1", "x", "Y"), v2("v2-1")])).toBe(true);
  expect(Schema.is(StoredRulesSchema)([{ id: "r1", match: 1, category: "Y" }])).toBe(false);
  expect(Schema.is(RuleV2Schema)({ ...v2("v2-1"), v: 1 })).toBe(false);
});

test("every condition and action kind decodes", () => {
  const full: RuleV2 = v2("v2-full", {
    conditions: [
      { kind: "text", target: "counterparty", op: "startsWith", value: "albert" },
      { kind: "merchant", op: "equals", value: "ah" },
      { kind: "amount", op: "between", valueCents: -5000, upperCents: -100 },
      { kind: "account", accountKey: "NL01INGB0001" },
      { kind: "category", op: "notEmpty" },
      { kind: "direction", direction: "out" },
      { kind: "date", op: "between", from: "2026-01-01", to: "2026-12-31" },
    ],
    actions: [
      { kind: "setCategory", category: "Boodschappen" },
      { kind: "setDisplayName", displayName: "AH" },
      { kind: "setMerchant", merchant: "ah.nl" },
      { kind: "addTag", tag: "x" },
      { kind: "exclude" },
      { kind: "markTransfer" },
    ],
  });
  expect(Schema.is(RuleV2Schema)(full)).toBe(true);
});
