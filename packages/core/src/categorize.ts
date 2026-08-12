import type { Tx, Rule } from "./model.js";
import { categorize, type OwnAccounts } from "./views.js";
import { hash, norm } from "./hash.js";

/** The categories the AI may assign + the review dropdown offers — LaVega's
 *  existing taxonomy so results stay consistent with the rules engine. */
export const CATEGORY_OPTIONS: readonly string[] = [
  "Boodschappen",
  "Eten & drinken",
  "Transport",
  "Reizen",
  "Wonen & energie",
  "Abonnementen",
  "Verzekeringen",
  "Gezondheid",
  "Kleding & winkelen",
  "Online shopping",
  "Elektronica",
  "Entertainment",
  "Huis & tuin",
  "Huisdieren",
  "Goede doelen",
  "Bankkosten",
  "Belastingen & overheid",
  "Geldopname",
  "Sparen & beleggen",
  "Overboekingen",
  "Eigen overboeking",
  "Inkomen",
];
const VALID = new Set(CATEGORY_OPTIONS);

/** The transactions the AI-categorize flow should offer — those that still fall
 *  through to "onbekend" under the current rules + built-in NL defaults. */
export function uncategorizedTxs(txs: Tx[], rules: Rule[], own?: OwnAccounts): Tx[] {
  return txs.filter((t) => categorize(t, rules, own) === "onbekend");
}

export type CategoryDecision = { id: string; category: string };

/** Apply confirmed category decisions: set a manual category on the decided
 *  transactions (ignoring any category not in CATEGORY_OPTIONS), and append one
 *  deduped rule per (counterparty, category) so future imports auto-categorize.
 *  Returns fresh txs + rules arrays (pure). */
export function applyCategorizations(
  txs: Tx[],
  rules: Rule[],
  decisions: CategoryDecision[],
): { txs: Tx[]; rules: Rule[] } {
  const byId = new Map<string, string>();
  for (const d of decisions) if (VALID.has(d.category)) byId.set(d.id, d.category);

  const nextTxs = txs.map((t) => (byId.has(t.id) ? { ...t, category: byId.get(t.id)!, manual: true } : t));

  // One rule per (counterparty, category), deduped against existing rules + within the batch.
  const seen = new Set(rules.map((r) => `${norm(r.match)}|${r.category}`));
  const nextRules = [...rules];
  for (const t of txs) {
    const cat = byId.get(t.id);
    if (!cat) continue;
    const match = t.counterparty.trim();
    if (!match) continue;
    const key = `${norm(match)}|${cat}`;
    if (seen.has(key)) continue;
    seen.add(key);
    nextRules.push({ id: hash([norm(match), cat].join("|")), match, category: cat });
  }
  return { txs: nextTxs, rules: nextRules };
}
