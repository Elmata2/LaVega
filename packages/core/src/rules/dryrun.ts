/**
 * Ported from Sure (we-promise/sure) commit 562fe09 — AGPL-3.0 — independently
 * reimplemented for LaVega; changed 2026-11-11.
 *
 * Rules evaluator v2 — the dry run.
 *
 * The preview CANNOT drift from execution because it does not have its own
 * categorizer: `opts.decide` is the caller's function, and `views.ts` supplies
 * `categorizeDetailed`, the same function `categorize` calls. The engine only
 * supplies the rule outcome and the counters.
 *
 * Counters cover every transaction. `samples` is the MATCHED rows only (a rule
 * actually fired), in input order and capped by `limit` (default 50) — a preview
 * is a preview of the RULES, so an untouched row is not a sample. `log` has one
 * entry per RuleMatch, so a rule that matched but claimed nothing still appears.
 */
import type {
  DryRunOptions,
  DryRunResult,
  DryRunRule,
  Rule,
  RuleRunEntry,
  RuleTx,
} from "./model.js";
import { compileRules } from "./compile.js";
import { evaluateRules, locksForTx } from "./evaluate.js";
import { toCents } from "../money.js";

const DEFAULT_LIMIT = 50;

/** Run `rules` over `txs` without writing anything.
 *
 *  - `matchedTxs`: transactions where at least one rule claimed an attribute
 *    (see `RuleOutcome.claims`);
 *  - `changed`: transactions where a RULE decides the category and that
 *    category differs from the caller's baseline (the built-in tiers). Stored
 *    and locked categories are not rule changes, so they do not count;
 *  - `byRule`: match count per rule, in rule order (zero-match rules included so
 *    the editor can show an unused rule);
 *  - `samples`: transactions with at least one matched rule, in input order,
 *    capped; look them up by `txId` (they are a subset, not a parallel array);
 *  - `log`: one line per matched rule with the fields that held and the
 *    attributes it actually claimed.
 *
 *  Pure: no clock, no mutation, no persistence. */
export function dryRunRules(
  txs: readonly RuleTx[],
  rules: readonly Rule[],
  opts: DryRunOptions,
): DryRunResult {
  const program = compileRules(rules);
  const limit = opts.limit ?? DEFAULT_LIMIT;

  const counts = new Map<string, number>();
  for (const rule of program.rules) counts.set(rule.id, 0);

  let matchedTxs = 0;
  let changed = 0;
  const samples: DryRunResult["samples"] = [];
  const log: RuleRunEntry[] = [];

  for (const tx of txs) {
    const outcome = evaluateRules(tx, program, locksForTx(tx));
    const decision = opts.decide(tx);

    if (Object.keys(outcome.claims).length > 0) matchedTxs++;
    const baseline = opts.baseline === undefined ? tx.category : opts.baseline(tx);
    if (decision.source === "rule" && decision.category !== baseline) changed++;

    for (const match of outcome.matches) {
      counts.set(match.ruleId, (counts.get(match.ruleId) ?? 0) + 1);
      log.push({
        txId: tx.id,
        ruleId: match.ruleId,
        fields: match.fields,
        applied: match.attributes,
      });
    }

    if (outcome.matches.length > 0 && samples.length < limit) {
      samples.push({
        txId: tx.id,
        date: tx.date,
        counterparty: tx.counterparty,
        amountCents: toCents(tx.amount),
        currentCategory: tx.category,
        decision,
        outcome,
      });
    }
  }

  const byRule: DryRunRule[] = program.rules.map((rule) => ({
    ruleId: rule.id,
    ...(rule.name === undefined ? {} : { name: rule.name }),
    matches: counts.get(rule.id) ?? 0,
  }));

  return {
    totalTxs: txs.length,
    matchedTxs,
    changed,
    byRule,
    samples,
    log,
  };
}
