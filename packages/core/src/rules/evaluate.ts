/**
 * Rules evaluator v2 — one transaction, one projection.
 *
 * SEMANTICS, in one place:
 *  - the array index is the ONLY priority. No priority field exists, so there is
 *    one ordering authority and `views.ts` order is what the owner sees.
 *  - conditions inside a rule are ANDed. A rule that does not hold leaves no
 *    trace at all.
 *  - a rule is in force when it has no `effectiveFrom`, or when
 *    `tx.date >= effectiveFrom`. Both are ISO strings, so the comparison is
 *    lexicographic; NO clock is read. The transaction date is the gate, which is
 *    what keeps a categorisation pass re-runnable and stops a new rule from
 *    relabelling older rows.
 *  - attribute claims are FIRST-WINS across rules and within one rule. Every
 *    `addTag` is the one exception and contributes.
 *  - a locked attribute is never claimed; the lock reason is copied into
 *    `locked` so the UI can explain the skip instead of silently ignoring a
 *    rule.
 *  - only `patch.category` is ever written to a transaction (`views.ts`). The
 *    other patch fields are the editor's preview; nothing persists them.
 */
import { matchNorm } from "../categories.js";
import { toCents } from "../money.js";
import type {
  RuleAction,
  RuleAttribute,
  RuleField,
  RuleLocks,
  RuleMatch,
  RuleOutcome,
  RuleTextOp,
  RuleTx,
} from "./model.js";
import type { CompiledRule, RuleProgram } from "./compile.js";

/** The attributes a hand edit protects today. Only the category is locked; the
 *  fields Sure's `Enrichable` also protects (display name, merchant, tags) do not
 *  live on `Tx` yet, so locking them here would be a promise the data cannot
 *  keep. This is the single extension point for WS1.6. */
export function locksForTx(tx: RuleTx): RuleLocks {
  return tx.manual ? { category: "met de hand gezet" } : {};
}

const attributeOf = (action: RuleAction): RuleAttribute => {
  switch (action.kind) {
    case "setCategory":
      return "category";
    case "setDisplayName":
      return "displayName";
    case "setMerchant":
      return "merchant";
    case "addTag":
      return "tags";
    case "exclude":
      return "excluded";
    case "markTransfer":
      return "transfer";
  }
};

const textMatches = (hay: string, op: RuleTextOp, needle: string): boolean => {
  switch (op) {
    case "contains":
      return hay.includes(needle);
    case "equals":
      return hay === needle;
    case "startsWith":
      return hay.startsWith(needle);
    case "endsWith":
      return hay.endsWith(needle);
  }
};

const amountMatches = (
  cents: number,
  op: "eq" | "gt" | "gte" | "lt" | "lte" | "between",
  valueCents: number,
  upperCents: number,
): boolean => {
  switch (op) {
    case "eq":
      return cents === valueCents;
    case "gt":
      return cents > valueCents;
    case "gte":
      return cents >= valueCents;
    case "lt":
      return cents < valueCents;
    case "lte":
      return cents <= valueCents;
    case "between":
      // Inclusive on both ends, in cents.
      return cents >= valueCents && cents <= upperCents;
  }
};

/** Evaluate a compiled rule's conditions against one transaction. Returns the
 *  deduped fields that held, or null when any condition failed (AND). */
function matchFields(rule: CompiledRule, tx: RuleTx): RuleField[] | null {
  if (rule.effectiveFrom !== undefined && tx.date < rule.effectiveFrom) return null;

  // ADR 0011 boundary: half away from zero on both signs, never a bare
  // Math.round (which truncates negative halves toward positive infinity).
  const cents = toCents(tx.amount);
  let textHay: string | undefined;
  let counterpartyHay: string | undefined;
  let descriptionHay: string | undefined;

  const fields: RuleField[] = [];
  const add = (field: RuleField) => {
    if (!fields.includes(field)) fields.push(field);
  };

  for (const condition of rule.conditions) {
    switch (condition.kind) {
      case "text": {
        // An empty normalized needle NEVER matches. Without this guard a
        // whitespace-only rule matches every row (the old `if (m && ...)`).
        if (condition.empty) return null;
        let hay: string;
        switch (condition.target) {
          case "text":
            textHay ??= matchNorm(tx.counterparty + " " + tx.description);
            hay = textHay;
            break;
          case "counterparty":
            counterpartyHay ??= matchNorm(tx.counterparty);
            hay = counterpartyHay;
            break;
          case "description":
            descriptionHay ??= matchNorm(tx.description);
            hay = descriptionHay;
            break;
        }
        if (!textMatches(hay, condition.op, condition.value)) return null;
        add(condition.target);
        break;
      }
      case "merchant": {
        if (condition.empty) return null;
        counterpartyHay ??= matchNorm(tx.counterparty);
        if (!textMatches(counterpartyHay, condition.op, condition.value)) return null;
        add("counterparty");
        break;
      }
      case "amount":
        if (!amountMatches(cents, condition.op, condition.valueCents, condition.upperCents))
          return null;
        add("amount");
        break;
      case "account":
        if (tx.accountKey !== condition.accountKey) return null;
        add("accountKey");
        break;
      case "category":
        switch (condition.op) {
          case "equals":
            if (tx.category !== condition.value) return null;
            break;
          case "empty":
            if (tx.category.trim() !== "") return null;
            break;
          case "notEmpty":
            if (tx.category.trim() === "") return null;
            break;
        }
        add("category");
        break;
      case "direction":
        if ((tx.amount >= 0 ? "in" : "out") !== condition.direction) return null;
        add("direction");
        break;
      case "date":
        switch (condition.op) {
          case "onOrAfter":
            if (tx.date < condition.from) return null;
            break;
          case "onOrBefore":
            if (tx.date > condition.from) return null;
            break;
          case "between":
            if (tx.date < condition.from || tx.date > condition.to) return null;
            break;
        }
        add("date");
        break;
    }
  }
  return fields;
}

/** Evaluate the whole program for one transaction.
 *
 *  Pure: no I/O, no clock, no mutation of `tx` or `rules`. `locks` defaults to
 *  none, so an ordinary call sees every attribute as claimable; the dry run and
 *  the app pass `locksForTx(tx)`. */
export function evaluateRules(
  tx: RuleTx,
  program: RuleProgram,
  locks: RuleLocks = {},
): RuleOutcome {
  const claims: Partial<Record<RuleAttribute, string>> = {};
  const locked: Partial<Record<RuleAttribute, string>> = {};
  const matches: RuleMatch[] = [];
  const tags: string[] = [];
  const patch: RuleOutcome["patch"] = { tags, excluded: false, transfer: false };
  let winnerRuleId: string | null = null;
  let stoppedBy: string | null = null;

  for (const rule of program.rules) {
    const fields = matchFields(rule, tx);
    if (fields === null) continue;

    const attributes: RuleAttribute[] = [];
    const claim = (attribute: RuleAttribute) => {
      if (!attributes.includes(attribute)) attributes.push(attribute);
    };

    for (const action of rule.actions) {
      const attribute = attributeOf(action);
      const lockReason = locks[attribute];
      if (lockReason !== undefined) {
        // A hand edit protects this attribute. Recorded once, with the reason, so
        // the UI can show WHY a visible rule did not act.
        locked[attribute] = lockReason;
        continue;
      }
      if (action.kind === "addTag") {
        // The exception: tags accumulate; only the first rule that adds one owns
        // the claim, and every `addTag` in a matched rule contributes.
        claims.tags ??= rule.id;
        tags.push(action.tag);
        claim("tags");
        continue;
      }
      // First claim wins — across rules and within this rule.
      if (claims[attribute] !== undefined) continue;
      claims[attribute] = rule.id;
      switch (action.kind) {
        case "setCategory":
          patch.category = action.category;
          break;
        case "setDisplayName":
          patch.displayName = action.displayName;
          break;
        case "setMerchant":
          patch.merchant = action.merchant;
          break;
        case "exclude":
          patch.excluded = true;
          break;
        case "markTransfer":
          patch.transfer = true;
          break;
      }
      claim(attribute);
    }

    matches.push({ ruleId: rule.id, fields, attributes });
    if (winnerRuleId === null && attributes.length > 0) winnerRuleId = rule.id;

    if (rule.stopProcessing) {
      stoppedBy = rule.id;
      break;
    }
  }

  return {
    txId: tx.id,
    claims,
    matches,
    patch,
    locked,
    winnerRuleId,
    stoppedBy,
  };
}
