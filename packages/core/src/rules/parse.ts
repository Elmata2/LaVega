/**
 * Ported from Sure (we-promise/sure) commit 562fe09 — AGPL-3.0 — independently
 * reimplemented for LaVega; changed 2026-11-11.
 *
 * Rules evaluator v2 — the vault boundary.
 *
 * Two stored shapes exist (`LegacyRule` and `RuleV2`, see `model.ts`). This
 * module is the only place that knows both: the rest of the engine consumes
 * `RuleV2` only, because `lowerRule` is total and `upgradeRules` runs once when
 * the vault opens.
 *
 * The legacy lowering is a BYTE-COMPATIBILITY CONTRACT, not a convenience. The
 * old `categorize()` loop was:
 *
 *     const m = matchNorm(r.match);
 *     if (m && hay.includes(m)) return r.category;
 *
 * so the lowered rule is one `text contains` condition over
 * `counterparty + " " + description`, one `setCategory`, and `stopProcessing`
 * because the old loop returned on the first match. The match text is NOT
 * normalized here: `compile.ts` does that with `matchNorm`, exactly like the
 * old loop normalized both sides at comparison time.
 */
import { Schema } from "effect";
import type {
  LegacyRule,
  Rule,
  RuleAction,
  RuleCondition,
  RuleProblem,
  RuleV2,
  UpgradeResult,
} from "./model.js";
import { isRuleV2 } from "./model.js";

const Id = Schema.String.check(Schema.isMinLength(1));

/* ---------------------------------------------------------------------------
 * Schemas. They describe the stored rows exactly as they arrive from the vault
 * (untrusted JSON): no classes, no defaults, no coercion. `upgradeRules` uses
 * them with `Schema.is`, so a row that decodes is returned as the SAME object
 * and no key the current build does not know is dropped from a v2 rule.
 * ------------------------------------------------------------------------- */

const RuleTextCondition = Schema.Struct({
  kind: Schema.Literal("text"),
  target: Schema.Literals(["counterparty", "description", "text"]),
  op: Schema.Literals(["contains", "equals", "startsWith", "endsWith"]),
  value: Schema.String,
});

const RuleMerchantCondition = Schema.Struct({
  kind: Schema.Literal("merchant"),
  op: Schema.Literals(["contains", "equals"]),
  value: Schema.String,
});

const RuleAmountCondition = Schema.Struct({
  kind: Schema.Literal("amount"),
  op: Schema.Literals(["eq", "gt", "gte", "lt", "lte", "between"]),
  // Signed integer cents (negative = outflow), ADR 0011.
  valueCents: Schema.Int,
  upperCents: Schema.optionalKey(Schema.Int),
});

const RuleAccountCondition = Schema.Struct({
  kind: Schema.Literal("account"),
  accountKey: Schema.String,
});

const RuleCategoryCondition = Schema.Struct({
  kind: Schema.Literal("category"),
  op: Schema.Literals(["equals", "empty", "notEmpty"]),
  value: Schema.optionalKey(Schema.String),
});

const RuleDirectionCondition = Schema.Struct({
  kind: Schema.Literal("direction"),
  direction: Schema.Literals(["in", "out"]),
});

const RuleDateCondition = Schema.Struct({
  kind: Schema.Literal("date"),
  op: Schema.Literals(["onOrAfter", "onOrBefore", "between"]),
  from: Schema.String,
  to: Schema.optionalKey(Schema.String),
});

export const RuleConditionSchema = Schema.Union([
  RuleTextCondition,
  RuleMerchantCondition,
  RuleAmountCondition,
  RuleAccountCondition,
  RuleCategoryCondition,
  RuleDirectionCondition,
  RuleDateCondition,
]);

export const RuleActionSchema = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("setCategory"), category: Schema.String }),
  Schema.Struct({ kind: Schema.Literal("setDisplayName"), displayName: Schema.String }),
  Schema.Struct({ kind: Schema.Literal("setMerchant"), merchant: Schema.String }),
  Schema.Struct({ kind: Schema.Literal("addTag"), tag: Schema.String }),
  Schema.Struct({ kind: Schema.Literal("exclude") }),
  Schema.Struct({ kind: Schema.Literal("markTransfer") }),
]);

/** A row as older vaults hold it, and as the one-line quick-add still writes. */
export const LegacyRuleSchema = Schema.Struct({
  id: Id,
  match: Schema.String,
  category: Schema.String,
});

/** The typed rule the editor authors. */
export const RuleV2Schema = Schema.Struct({
  v: Schema.Literal(2),
  id: Id,
  name: Schema.optionalKey(Schema.String),
  conditions: Schema.Array(RuleConditionSchema),
  actions: Schema.Array(RuleActionSchema),
  stopProcessing: Schema.optionalKey(Schema.Boolean),
  effectiveFrom: Schema.optionalKey(Schema.String),
});

/** One stored row, either shape. `upgradeRules` narrows this union. */
export const StoredRuleSchema = Schema.Union([RuleV2Schema, LegacyRuleSchema]);

/** A whole stored rules array. */
export const StoredRulesSchema = Schema.Array(StoredRuleSchema);

const isRecord = (u: unknown): u is Record<string, unknown> =>
  typeof u === "object" && u !== null && !Array.isArray(u);

const ruleIdOf = (u: unknown): string | undefined =>
  isRecord(u) && typeof u["id"] === "string" && u["id"].length > 0 ? u["id"] : undefined;

/** Lower one rule to the canonical form. TOTAL and IDEMPOTENT: a v2 rule comes
 *  back untouched (same object), so `lowerRule(lowerRule(r))` cannot drift. */
export function lowerRule(rule: Rule): RuleV2 {
  if (isRuleV2(rule)) return rule;
  return {
    v: 2,
    id: rule.id,
    conditions: [{ kind: "text", target: "text", op: "contains", value: rule.match }],
    actions: [{ kind: "setCategory", category: rule.category }],
    // The old loop returned on the first matching rule. Preserved so a legacy
    // rule set behaves exactly as it did: nothing after the match is consulted.
    stopProcessing: true,
  };
}

/** Upgrade a whole stored rules array.
 *
 *  - every valid row survives; legacy rows are lowered to v2 and counted in
 *    `migrated`; valid v2 rows pass through without being rewritten, which is
 *    what makes the function idempotent on its own output;
 *  - junk is reported, never thrown: a vault with one bad row still opens;
 *  - a repeated id keeps the FIRST row (storage is id-keyed, so a second row
 *    with that id could never have been persisted) and reports `duplicate-id`.
 *
 *  Never reads a clock and never writes. Pure. */
export function upgradeRules(stored: unknown): UpgradeResult {
  const problems: RuleProblem[] = [];
  if (!Array.isArray(stored)) {
    // Not a rules array at all: an absent/older shape reads as "no rules", and
    // the caller is told instead of silently overwriting it later.
    return { rules: [], migrated: 0, problems: [{ index: 0, reason: "empty" }] };
  }

  const rules: Rule[] = [];
  const seen = new Set<string>();
  let migrated = 0;

  stored.forEach((row: unknown, index: number) => {
    const ruleId = ruleIdOf(row);
    const isV2 = isRecord(row) && row["v"] === 2;

    if (isV2) {
      if (!Schema.is(RuleV2Schema)(row)) {
        problems.push({ index, ...(ruleId === undefined ? {} : { ruleId }), reason: "invalid" });
        return;
      }
      if (seen.has(row.id)) {
        problems.push({ index, ruleId: row.id, reason: "duplicate-id" });
        return;
      }
      seen.add(row.id);
      // Passthrough: the SAME object, so a build that re-saves the vault does
      // not drop a key a newer build wrote (parse only, never rewrite).
      rules.push(row as RuleV2);
      return;
    }

    if (!Schema.is(LegacyRuleSchema)(row)) {
      problems.push({ index, ...(ruleId === undefined ? {} : { ruleId }), reason: "invalid" });
      return;
    }
    if (seen.has(row.id)) {
      problems.push({ index, ruleId: row.id, reason: "duplicate-id" });
      return;
    }
    seen.add(row.id);
    rules.push(lowerRule(row as LegacyRule));
    migrated++;
  });

  return { rules, migrated, problems };
}

/** The category a rule sets, when it sets one. Works on BOTH shapes, so callers
 *  never have to branch on `.match` / `.category`. */
export function ruleCategoryValue(rule: Rule): string | undefined {
  if (!isRuleV2(rule)) return rule.category;
  const action = rule.actions.find((a) => a.kind === "setCategory");
  return action && action.kind === "setCategory" ? action.category : undefined;
}

/** The text a rule matches on, when it matches on text. The first text
 *  condition in rule order, or the legacy substring. Used by the AI-rule dedupe
 *  in `categorize.ts`. */
export function ruleTextValue(rule: Rule): string | undefined {
  if (!isRuleV2(rule)) return rule.match;
  const condition = rule.conditions.find(
    (c: RuleCondition): c is Extract<RuleCondition, { kind: "text" }> => c.kind === "text",
  );
  return condition?.value;
}

/** The actions of a rule, for callers that only need the v2 view. */
export function ruleActions(rule: Rule): readonly RuleAction[] {
  return isRuleV2(rule) ? rule.actions : lowerRule(rule).actions;
}
