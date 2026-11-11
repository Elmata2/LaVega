/**
 * Rules evaluator v2 — the domain shapes.
 *
 * Ported from Sure (we-promise/sure) commit 562fe09 — AGPL-3.0 — independently
 * reimplemented for LaVega; changed 2026-11-10.
 *
 * Sure sources: `app/models/rule.rb`, `app/models/rule/**`, and the
 * `Enrichable` lock semantics. Sure stores outflow POSITIVE; this model never
 * reads a raw amount sign. Amount conditions are integer cents in LaVega's
 * convention (negative = outflow, ADR 0011) and every comparison goes through
 * `money.ts` at the boundary.
 *
 * TWO SHAPES, ONE ENGINE. A `LegacyRule` is what older vaults hold and what the
 * one-line quick-add still writes: one substring, one category. A `RuleV2` is
 * the typed form the editor authors. `Rules` are parsed/upgraded at the vault
 * boundary (`parse.ts`), so the evaluator only ever sees one shape: `RuleV2`.
 * The storage union is what keeps a downgraded build able to read its own vault.
 *
 * ORDER IS THE ONLY PRIORITY. The array index is the rule priority. There is no
 * `priority` field on purpose: two ordering authorities drift, and the whole
 * engine's behaviour is "the first rule that claims an attribute wins it"
 * (`Regels.tsx` carried the same warning before v2 existed).
 *
 * EFFECTIVE DATE IS DATA, NOT A CLOCK. `effectiveFrom` is compared against an
 * `asOf` string the caller supplies (`rulesInForce`), so core stays clock-free
 * (§2.3) and a test can move time by passing a different string.
 *
 * ACTIONS ARE CLAIMS, NOT WRITES. The evaluator returns one `RuleOutcome` per
 * transaction with a `patch`. Only `category` is written to `Tx` today: a rule
 * must never change a total silently, and display name, merchant, tags,
 * exclusion and transfer need the `Tx` fields and the transfer-pair bridge that
 * WS1.5/WS1.6 own. The dry-run shows the full patch; execution applies the
 * category through `views.ts` and nothing else.
 */
import type { Tx } from "../model.js";

/** The transaction fields a condition may read. Recorded in the run log so the
 *  owner can see which fields a winning rule actually matched. */
export type RuleField =
  | "counterparty"
  | "description"
  | "text"
  | "amount"
  | "accountKey"
  | "category"
  | "direction"
  | "date";

/** The attributes a rule can claim. First claim per attribute wins. */
export type RuleAttribute =
  | "category"
  | "displayName"
  | "merchant"
  | "tags"
  | "excluded"
  | "transfer";

export type RuleTextTarget = "counterparty" | "description" | "text";
export type RuleTextOp = "contains" | "equals" | "startsWith" | "endsWith";
export type RuleAmountOp = "eq" | "gt" | "gte" | "lt" | "lte" | "between";
export type RuleCategoryOp = "equals" | "empty" | "notEmpty";
export type RuleDateOp = "onOrAfter" | "onOrBefore" | "between";

/** Conditions inside one rule are ANDed. `amount` is signed integer cents
 *  (negative = outflow); `between` is inclusive on both ends. `text` and
 *  `merchant` compare with `matchNorm` (see `compile.ts`), which is what makes
 *  a legacy substring rule behave exactly as it did in `views.ts`. */
export type RuleCondition =
  | { kind: "text"; target: RuleTextTarget; op: RuleTextOp; value: string }
  | { kind: "merchant"; op: "contains" | "equals"; value: string }
  | { kind: "amount"; op: RuleAmountOp; valueCents: number; upperCents?: number }
  | { kind: "account"; accountKey: string }
  | { kind: "category"; op: RuleCategoryOp; value?: string }
  | { kind: "direction"; direction: "in" | "out" }
  | { kind: "date"; op: RuleDateOp; from: string; to?: string };

/** Actions are claimed in order within a rule; the engine claims at most one
 *  attribute per kind (the first action of that kind wins). `addTag` is the one
 *  exception: every `addTag` action in a winning rule contributes. */
export type RuleAction =
  | { kind: "setCategory"; category: string }
  | { kind: "setDisplayName"; displayName: string }
  | { kind: "setMerchant"; merchant: string }
  | { kind: "addTag"; tag: string }
  | { kind: "exclude" }
  | { kind: "markTransfer" };

/** What a legacy vault row looks like. Kept readable forever, upgraded in
 *  memory (never rewritten wholesale) so an older build still opens the vault. */
export type LegacyRule = { id: string; match: string; category: string };

export type RuleV2 = {
  v: 2;
  id: string;
  /** Owner-visible name for the editor list. Optional; the row falls back to a
   *  generated summary. */
  name?: string;
  conditions: RuleCondition[];
  actions: RuleAction[];
  /** After this rule claims anything, later rules make no claims at all. */
  stopProcessing?: boolean;
  /** ISO `YYYY-MM-DD`. The rule is in force when `asOf >= effectiveFrom`. */
  effectiveFrom?: string;
};

export type Rule = LegacyRule | RuleV2;

export function isRuleV2(rule: Rule): rule is RuleV2 {
  return (rule as RuleV2).v === 2;
}

/** Attributes a hand edit protects. The value is the reason shown in the UI, so
 *  the lock is explainable instead of a silent skip. `locksForTx` in
 *  `parse.ts` is the only producer today (a manual category). */
export type RuleLocks = Partial<Record<RuleAttribute, string>>;

/** One rule's contribution, as provenance rather than a mutation. */
export type RuleMatch = {
  ruleId: string;
  /** Condition fields that actually held for this rule. */
  fields: RuleField[];
  /** Attributes this rule contributed. */
  attributes: RuleAttribute[];
};

/** The projection a rule set makes over one transaction. Nothing here is
 *  persisted except `patch.category` (through `views.ts`). */
export type RuleOutcome = {
  txId: string;
  /** Attribute -> winning rule id. This is the "first-match claims" record. */
  claims: Partial<Record<RuleAttribute, string>>;
  matches: RuleMatch[];
  patch: {
    category?: string;
    displayName?: string;
    merchant?: string;
    tags: string[];
    excluded: boolean;
    transfer: boolean;
  };
  /** Attribute -> reason, for every attribute a lock kept a rule from claiming. */
  locked: Partial<Record<RuleAttribute, string>>;
  /** The first rule that produced at least one claim, or null. */
  winnerRuleId: string | null;
  /** Set when a claiming rule carried `stopProcessing`. */
  stoppedBy: string | null;
};

/** The one decision a transaction gets. `source` names which tier answered, so
 *  the editor can say "de ingebouwde lijst deed dit" instead of blaming a rule. */
export type RuleDecisionSource = "stored" | "own" | "rule" | "builtin" | "unknown";

export type RuleDecision = {
  category: string;
  source: RuleDecisionSource;
  /** The winning rule when `source === "rule"`. */
  ruleId: string | null;
  /** True when a hand edit locked the category, so no rule was consulted. */
  locked: boolean;
};

/** One line of the run log. The issue's acceptance asks for rule id and the
 *  matched fields; `applied` is what the rule actually contributed. */
export type RuleRunEntry = {
  txId: string;
  ruleId: string;
  fields: RuleField[];
  applied: RuleAttribute[];
};

/** A dry run reports the same winner execution uses, because both call the
 *  same engine and the same `decide` function. `decision` is injected by the
 *  caller (`views.ts` supplies `categorizeDetailed`) so `rules/` never imports
 *  a view and cannot drift from it. */
export type DryRunSample = {
  txId: string;
  date: string;
  counterparty: string;
  amountCents: number;
  currentCategory: string;
  decision: RuleDecision;
  outcome: RuleOutcome;
};

export type DryRunRule = {
  ruleId: string;
  name?: string;
  matches: number;
};

export type DryRunResult = {
  totalTxs: number;
  /** Transactions with at least one rule claim. */
  matchedTxs: number;
  /** Transactions a rule would move to a different category than the built-in
   *  tiers give them. A stored or locked category is not a rule change. */
  changed: number;
  byRule: DryRunRule[];
  /** One sample per transaction where a rule matched, in input order, capped
   *  by the caller's limit. A row no rule matched is not a preview sample. */
  samples: DryRunSample[];
  log: RuleRunEntry[];
};

/** A stored rule row that could not be used as written. Reported, never
 *  silently dropped: a rule the owner can see must never stop acting without
 *  saying so. */
export type RuleProblem = {
  index: number;
  ruleId?: string;
  reason: "invalid" | "empty" | "duplicate-id" | "unknown-action";
};

export type UpgradeResult = {
  rules: Rule[];
  /** Rows the upgrade actually rewrote (legacy -> canonical, junk repaired). */
  migrated: number;
  problems: RuleProblem[];
};

/** A transaction is the only input. Kept as a type alias so tests can build
 *  minimal rows without the full `Tx`. */
export type RuleTx = Pick<
  Tx,
  "id" | "accountKey" | "date" | "amount" | "counterparty" | "description" | "category" | "manual"
>;

/** The decision function a dry run reuses. `views.ts` supplies
 *  `categorizeDetailed`, so the preview and the real categorization cannot
 *  diverge. */
export type RuleDecide = (tx: RuleTx) => RuleDecision;

export type DryRunOptions = {
  decide: RuleDecide;
  /** The category the row would get WITHOUT the user's rules (the built-in
   *  tiers). `changed` is measured against this, not against the stored
   *  category, because categories are derived on read and the stored value is
   *  empty on every imported row. Defaults to the stored category. */
  baseline?: (tx: RuleTx) => string;
  /** Cap on samples returned. The counters always cover every transaction. */
  limit?: number;
};
