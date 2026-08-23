import type { Tx, Rule } from "./model.js";
import { categorize, type OwnAccounts } from "./views.js";
import { hash, norm } from "./hash.js";
import { CREDIT_CARD_PAYMENT_CATEGORY, DIRECT_DEBIT_CATEGORY, foreignCodeIn, PERSON_CATEGORY } from "./categories.js";

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
  /* The two the person/collection rules place. They belong in this list for a
   * concrete reason, not for tidiness: VALID gates what the AI pass is allowed to
   * return AND what the category picker offers, so a category the categoriser can
   * assign but the picker cannot offer is one he can see and never correct. */
  PERSON_CATEGORY,
  CREDIT_CARD_PAYMENT_CATEGORY,
  DIRECT_DEBIT_CATEGORY,
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

/* ===========================================================================
 * Why "onbekend" stays unknown — and what actually leaves the browser.
 *
 * App review 20-08-2026, item 2 ("we really need to look into this unknown
 * shit"): the AI-categorize pass exists but was not reaching these rows. It was
 * not a routing problem. Measured over the owner's own exports — 1.394 rows that
 * stay "onbekend" across ING NL, ING EN, the ING creditcard, Revolut, Amex and
 * MT940 — 747 of them (53,6%) arrived at the model as an EMPTY STRING, because
 * the redaction that is supposed to remove IBANs was removing the merchant name
 * with them. An empty string cannot be categorised by any model, so those rows
 * came back unplaced every single time, forever.
 *
 * The redaction lives here, in core, rather than in a view helper: it is a
 * domain rule (what may leave the machine) and it has to be testable on its own.
 * ======================================================================== */

/** Best-effort scrub of sensitive numeric content from free text BEFORE it
 *  leaves the browser: IBANs, dates, money amounts and long digit runs
 *  (account/card fragments, payment references). Merchant names are alphabetic,
 *  so they survive — that is what lets the field be free text while keeping the
 *  consent promise ("geen IBANs, bedragen of datums"). Pure.
 *
 *  THE IBAN PATTERN IS LOAD-BEARING AND EASY TO GET WRONG. It must not be able
 *  to cross whitespace. An earlier version used `(?:\s?[A-Z0-9]){8,30}` with
 *  the /i flag, which let one character-at-a-time repetition hop over spaces and
 *  swallow every word behind the IBAN:
 *      "NL17INGB0539576085 Albert Heijn 1234 Rotterdam"  ->  "Rotterdam"
 *      "DE77100110012424146089 Wise Europe SA"           ->  ""
 *  A contiguous `[A-Z0-9]{8,30}` cannot leave the token it started in, so the
 *  name behind the IBAN is kept. Verified against the real exports: 747 rows
 *  arrived blank before, 0 after, and no IBAN survives either version.
 *
 *  Deliberately NOT handled: the space-grouped form ("NL91 ABNA 0417 1643 00").
 *  Zero rows in any of the owner's exports print an IBAN that way, and a pattern
 *  loose enough to catch it is loose enough to eat an ALL-CAPS merchant name
 *  ("BE68539007547034 ALBERT HEIJN" -> "HEIJN") — which is the bug above again.
 *  If a bank export ever does group them, add a separate pattern for it with a
 *  fixture, do not loosen this one.
 *
 *  Privacy over recall: over-scrubbing a city or a store number is acceptable. */
export function redactForAi(text: string): string {
  return text
    .replace(/\b[A-Z]{2}\d{2}[A-Z0-9]{8,30}\b/gi, " ") // IBANs / account identifiers (one token, never across a space)
    .replace(/\b\d{4}[-/.]\d{1,2}[-/.]\d{1,2}\b/g, " ") // ISO-ish dates: 2026-08-01
    .replace(/\b\d{1,2}[-/.]\d{1,2}[-/.]\d{2,4}\b/g, " ") // 01-08-2026 / 1/8/26
    .replace(/(?:€|eur)\s?\d[\d.,]*/gi, " ") // € 45 / EUR 45,00
    .replace(/\b\d{1,3}(?:[.\s]\d{3})+[,.]\d{2}\b/g, " ") // grouped amounts: 1.234,56
    .replace(/\b\d+[,.]\d{2}\b/g, " ") // plain amounts: 45,00 / 45.00
    .replace(/\b\d{4,}\b/g, " ") // long digit runs (account/card/ref fragments)
    .replace(/\s+/g, " ")
    .trim();
}

/** One transaction as it may leave the browser: id, redacted text, direction.
 *  Nothing else — no amount, no balance, no account key, no date field. */
export type AiCategorizeItem = { id: string; text: string; sign: "in" | "out" };

/** Build the redacted payload for the AI-categorize proxy, and DROP every row
 *  whose redacted text has no letters left.
 *
 *  Dropping matters for two reasons. Honesty: a row with no readable text has no
 *  answer, and asking a model to invent one is how a wrong category gets into a
 *  total. Reach: the request is capped at 200 items, so every blank row sent was
 *  a slot stolen from a row that could actually have been placed. */
export function aiCategorizeItems(txs: Tx[]): AiCategorizeItem[] {
  const items: AiCategorizeItem[] = [];
  for (const t of txs) {
    const text = redactForAi(`${t.counterparty} ${t.description}`).slice(0, 200);
    if (!/[A-Za-z]/.test(text)) continue;
    items.push({ id: t.id, text, sign: t.amount >= 0 ? "in" : "out" });
  }
  return items;
}

/** The ISO-3166 alpha-3 country code a card export printed on this row, or null.
 *  Only a STANDALONE, UPPERCASE token counts, and NLD never does — see
 *  FOREIGN_COUNTRY_CODES in categories.ts for why the set is curated. Pure. */
export function foreignCode(tx: Tx): string | null {
  return foreignCodeIn(`${tx.counterparty} ${tx.description}`);
}

/** Why a row could not be placed. "onbekend" on its own is a dead end: the owner
 *  sees €4.000 he cannot account for and has nothing to act on. Each reason
 *  points at a different action, which is the whole point of naming it:
 *   - "buitenland"            a foreign card payment; the AI pass is the route
 *   - "onbekende-tegenpartij" there is text, no rule matches it; AI or a rule
 *   - "alleen-nummers"        only identifiers survive redaction; nothing any
 *                             model can read — this one needs a manual label
 *   - "geen-tekst"            the export carried no counterparty or description */
export type UnknownReason = "buitenland" | "onbekende-tegenpartij" | "alleen-nummers" | "geen-tekst";

export function unknownReason(tx: Tx): UnknownReason {
  return classifyUnknown(tx).reason;
}

/** reason + the country code behind it, in one pass — unknownBreakdown needs
 *  both for every row and the text is walked three times otherwise. */
function classifyUnknown(tx: Tx): { reason: UnknownReason; code: string | null } {
  const text = `${tx.counterparty} ${tx.description}`;
  if (!text.trim()) return { reason: "geen-tekst", code: null };
  const code = foreignCodeIn(text);
  if (code) return { reason: "buitenland", code };
  if (!/[A-Za-z]/.test(redactForAi(text))) return { reason: "alleen-nummers", code: null };
  return { reason: "onbekende-tegenpartij", code: null };
}

export type UnknownBucket = {
  reason: UnknownReason;
  count: number;
  /** Signed sum, so an unknown outflow reads as negative like everywhere else. */
  amount: number;
  /** Country codes seen in this bucket, sorted — only ever set on "buitenland". */
  countries: string[];
};

/** What the "onbekend" pile actually IS, per reason, biggest bucket first.
 *  Buckets with no rows are omitted: an empty bucket is not a finding. Pure —
 *  the caller supplies the rules and its own-accounts map. */
export function unknownBreakdown(
  txs: Tx[],
  rules: Rule[],
  own?: OwnAccounts,
): { count: number; amount: number; byReason: UnknownBucket[] } {
  const buckets = new Map<UnknownReason, { count: number; amount: number; countries: Set<string> }>();
  let count = 0;
  let amount = 0;
  for (const t of uncategorizedTxs(txs, rules, own)) {
    count++;
    amount += t.amount;
    const { reason, code } = classifyUnknown(t);
    let b = buckets.get(reason);
    if (!b) buckets.set(reason, (b = { count: 0, amount: 0, countries: new Set() }));
    b.count++;
    b.amount += t.amount;
    if (code) b.countries.add(code);
  }
  const byReason = [...buckets.entries()]
    .map(([reason, b]) => ({ reason, count: b.count, amount: b.amount, countries: [...b.countries].sort() }))
    // Biggest bucket first so the UI leads with what actually matters; ties fall
    // back to the reason name so the order is stable across renders.
    .sort((a, b) => b.count - a.count || a.reason.localeCompare(b.reason));
  return { count, amount, byReason };
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
