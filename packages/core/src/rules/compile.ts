/**
 * Rules evaluator v2 — compilation.
 *
 * `categorize()` runs over every row of every view, and several views each run
 * it, so the rule set is compiled ONCE per array identity (`WeakMap`) and the
 * hot path only walks prepared structures: text already normalized, amount
 * bounds already integer cents, no schema work per row.
 *
 * WHY `matchNorm` AND NOT `norm`. This is the legacy-compatibility requirement,
 * not a preference. `views.ts` matched with `matchNorm` on BOTH sides, so a
 * rule typed "Nationale-Nederlanden" still matched the row the bank printed as
 * "NATIONALE NEDERLANDEN", and "Café" matched "cafe". Compiling with any other
 * normalizer would change what existing rules do.
 *
 * An EMPTY normalized text value never matches. The old loop had `if (m && ...)`
 * for exactly this reason: a whitespace-only or punctuation-only match
 * normalizes to "", and `"".includes` / `hay.includes("")` is always true — it
 * would relabel the whole dataset. `empty` is compiled into the condition so the
 * evaluator cannot forget the guard.
 */
import { matchNorm } from "../categories.js";
import type {
  Rule,
  RuleAction,
  RuleAmountOp,
  RuleCategoryOp,
  RuleCondition,
  RuleDateOp,
  RuleTextOp,
  RuleTextTarget,
  RuleV2,
} from "./model.js";
import { lowerRule } from "./parse.js";

/** A text condition with its needle normalized once. `empty` is the legacy
 *  guard, precomputed. */
export type CompiledTextCondition = {
  kind: "text";
  target: RuleTextTarget;
  op: RuleTextOp;
  value: string;
  empty: boolean;
};

/** A merchant condition. Reads the counterparty (that is the field it maps to
 *  in the run log — there is no separate `merchant` field on a transaction). */
export type CompiledMerchantCondition = {
  kind: "merchant";
  op: "contains" | "equals";
  value: string;
  empty: boolean;
};

export type CompiledAmountCondition = {
  kind: "amount";
  op: RuleAmountOp;
  /** Signed integer cents; negative = outflow. */
  valueCents: number;
  /** Only meaningful for `between`; inclusive. Defaults to `valueCents`. */
  upperCents: number;
};

export type CompiledAccountCondition = { kind: "account"; accountKey: string };

export type CompiledCategoryCondition = {
  kind: "category";
  op: RuleCategoryOp;
  value: string;
};

export type CompiledDirectionCondition = { kind: "direction"; direction: "in" | "out" };

export type CompiledDateCondition = {
  kind: "date";
  op: RuleDateOp;
  from: string;
  to: string;
};

export type CompiledCondition =
  | CompiledTextCondition
  | CompiledMerchantCondition
  | CompiledAmountCondition
  | CompiledAccountCondition
  | CompiledCategoryCondition
  | CompiledDirectionCondition
  | CompiledDateCondition;

/** One rule, ready to evaluate. `actions` stay in author order: the evaluator
 *  claims the first action of each kind, and every `addTag` contributes. */
export type CompiledRule = {
  id: string;
  name?: string;
  conditions: readonly CompiledCondition[];
  actions: readonly RuleAction[];
  stopProcessing: boolean;
  /** ISO `YYYY-MM-DD`; absent means always in force. Compared to `tx.date`,
   *  never to a clock. */
  effectiveFrom?: string;
  /** The lowered source rule, kept for provenance/debugging. */
  rule: RuleV2;
};

/** The compiled form of one rules array. Opaque to callers: evaluate against
 *  it, do not rebuild it by hand. */
export type RuleProgram = {
  rules: readonly CompiledRule[];
};

const EMPTY_TEXT = "";

function compileCondition(condition: RuleCondition): CompiledCondition {
  switch (condition.kind) {
    case "text": {
      const value = matchNorm(condition.value);
      return {
        kind: "text",
        target: condition.target,
        op: condition.op,
        value,
        empty: value === EMPTY_TEXT,
      };
    }
    case "merchant": {
      const value = matchNorm(condition.value);
      return { kind: "merchant", op: condition.op, value, empty: value === EMPTY_TEXT };
    }
    case "amount":
      return {
        kind: "amount",
        op: condition.op,
        valueCents: Math.trunc(condition.valueCents),
        upperCents: Math.trunc(condition.upperCents ?? condition.valueCents),
      };
    case "account":
      return { kind: "account", accountKey: condition.accountKey };
    case "category":
      return { kind: "category", op: condition.op, value: condition.value ?? EMPTY_TEXT };
    case "direction":
      return { kind: "direction", direction: condition.direction };
    case "date":
      return {
        kind: "date",
        op: condition.op,
        from: condition.from,
        to: condition.to ?? condition.from,
      };
  }
}

function compileRule(rule: RuleV2): CompiledRule {
  return {
    id: rule.id,
    ...(rule.name === undefined ? {} : { name: rule.name }),
    conditions: rule.conditions.map(compileCondition),
    actions: rule.actions,
    stopProcessing: rule.stopProcessing === true,
    ...(rule.effectiveFrom === undefined ? {} : { effectiveFrom: rule.effectiveFrom }),
    rule,
  };
}

const cache = new WeakMap<readonly Rule[], RuleProgram>();

/** Compile a rules array. Cached by ARRAY IDENTITY: `categorize` is called per
 *  row across many views with the same stored array, and recompiling per row
 *  would normalize every rule text once per transaction. A caller that builds a
 *  fresh array per call simply misses the cache; correctness is unaffected. */
export function compileRules(rules: readonly Rule[]): RuleProgram {
  const hit = cache.get(rules);
  if (hit) return hit;
  const program: RuleProgram = { rules: rules.map((rule) => compileRule(lowerRule(rule))) };
  cache.set(rules, program);
  return program;
}
