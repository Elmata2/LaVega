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

export type UncategorizedMonth = { month: string; txs: Tx[] };

/** The still-"onbekend" remainder grouped per calendar month, NEWEST month
 *  first, each month's transactions newest-first within it.
 *
 *  Why this exists: transactions are stored in import order, i.e. oldest first,
 *  so `uncategorizedTxs(...).slice(0, batchCap)` hands the AI pass the OLDEST
 *  unknowns. The blocks that show "onbekend" (Top-uitgaven, Categorie-trend)
 *  look at the LATEST month, which is therefore the last thing a capped run
 *  would ever reach. Running the pass month by month, newest month first, fixes
 *  what the owner is actually looking at, and keeps each request inside the
 *  server's 200-item cap on a realistic month. */
export function uncategorizedByMonth(txs: Tx[], rules: Rule[], own?: OwnAccounts): UncategorizedMonth[] {
  const byMonth = new Map<string, Tx[]>();
  for (const t of uncategorizedTxs(txs, rules, own)) {
    const month = t.date.slice(0, 7);
    const list = byMonth.get(month);
    if (list) list.push(t);
    else byMonth.set(month, [t]);
  }
  return [...byMonth.entries()]
    .map(([month, list]) => ({ month, txs: list.slice().sort((a, b) => b.date.localeCompare(a.date)) }))
    .sort((a, b) => b.month.localeCompare(a.month));
}

/** Run the categorisation engine over transactions that are ALREADY STORED and
 *  write the resolved category onto them. This is what makes an existing vault
 *  improve when the rules improve, instead of only new imports benefiting.
 *
 *  Contract:
 *   - `manual: true` (a category the owner set, or confirmed in the AI review)
 *     is NEVER touched.
 *   - every other transaction is re-derived from scratch, so the pass is
 *     idempotent AND re-runnable: a better rule set overwrites a category an
 *     earlier run wrote. Call it after an import and after any rule change.
 *   - a transaction the engine cannot place keeps an EMPTY category, never the
 *     literal "onbekend" — "onbekend" is the absence of an answer, and storing
 *     it would freeze that absence in place (categorize() short-circuits on any
 *     non-empty tx.category).
 *
 *  Returns fresh arrays plus the number of transactions whose category changed,
 *  so the caller can say what the run actually did. Pure. */
export function recategorize(txs: Tx[], rules: Rule[], own?: OwnAccounts): { txs: Tx[]; changed: number } {
  let changed = 0;
  const next = txs.map((t) => {
    if (t.manual) return t;
    const derived = categorize({ ...t, category: "" }, rules, own);
    const category = derived === "onbekend" ? "" : derived;
    if (category === t.category) return t;
    changed++;
    return { ...t, category };
  });
  return { txs: next, changed };
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
