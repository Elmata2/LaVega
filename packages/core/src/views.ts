import type { Account, Tx, Rule } from "./model.js";
import { norm } from "./hash.js";
import {
  NL_CATEGORY_RULES_NORMALIZED, matchNorm, foreignCodeIn,
  isPersonName, isMerchantRow, isOwnName, directDebit,
  PERSON_CATEGORY, DIRECT_DEBIT_CATEGORY, type OwnName,
} from "./categories.js";

/* Pure derivations behind the Transacties and Rekeningen views. No I/O — these
 * take the already-loaded accounts/txs and return view-ready data, so the
 * React components stay thin and the logic is unit-tested here. */

export type EnrichedTx = Tx & { entity: string; bank: string; accountName: string };

/** Join each tx to its account so the Transacties table can show entity/bank
 *  without a per-row lookup. A tx whose accountKey has no account (shouldn't
 *  normally happen) falls back to entity "onbekend" — matching consolidate. */
export function enrichTxs(txs: Tx[], accounts: Account[]): EnrichedTx[] {
  const byKey = new Map(accounts.map((a) => [a.key, a]));
  return txs.map((t) => {
    const a = byKey.get(t.accountKey);
    return { ...t, entity: a?.entity ?? "onbekend", bank: a?.bank ?? "", accountName: a?.name ?? t.accountKey };
  });
}

export type TxFilter = { entity?: string; accountKey?: string; search?: string; from?: string; to?: string };

/** Apply the (combinable) Transacties filters. Search is case/space-insensitive
 *  over counterparty + description (via norm). from/to bound the date range
 *  inclusively (ISO dates compare lexicographically). Input order is preserved. */
export function filterTxs(txs: EnrichedTx[], f: TxFilter): EnrichedTx[] {
  const q = f.search ? norm(f.search) : "";
  return txs.filter((t) => {
    if (f.entity && t.entity !== f.entity) return false;
    if (f.accountKey && t.accountKey !== f.accountKey) return false;
    if (f.from && t.date < f.from) return false;
    if (f.to && t.date > f.to) return false;
    if (q && !(norm(t.counterparty).includes(q) || norm(t.description).includes(q))) return false;
    return true;
  });
}

export type AccountSummary = { account: Account; txCount: number };

/** Per-account transaction count for the Rekeningen table (balance is already
 *  on the account). Accounts with zero txs are still returned. */
export function accountSummaries(accounts: Account[], txs: Tx[]): AccountSummary[] {
  const counts = new Map<string, number>();
  for (const t of txs) counts.set(t.accountKey, (counts.get(t.accountKey) ?? 0) + 1);
  return accounts.map((a) => ({ account: a, txCount: counts.get(a.key) ?? 0 }));
}

/** Return a new accounts array with one account reassigned to `entity`
 *  (immutable — never mutates the input). The caller persists + re-consolidates. */
export function reassignEntity(accounts: Account[], key: string, entity: string): Account[] {
  return accounts.map((a) => (a.key === key ? { ...a, entity } : a));
}

export type MonthlyTotal = { month: string; in: number; out: number };

/** Per-calendar-month inflow/outflow totals, sorted ascending by month
 *  (YYYY-MM). Drives the Overzicht bar chart. */
export function monthlyTotals(txs: Tx[]): MonthlyTotal[] {
  const byMonth = new Map<string, { in: number; out: number }>();
  for (const t of txs) {
    const m = t.date.slice(0, 7);
    const b = byMonth.get(m) ?? { in: 0, out: 0 };
    if (t.amount >= 0) b.in += t.amount; else b.out += t.amount;
    byMonth.set(m, b);
  }
  return [...byMonth.entries()]
    .map(([month, b]) => ({ month, in: b.in, out: b.out }))
    .sort((a, b) => a.month.localeCompare(b.month));
}

/** Identifiers of the user's own accounts, used to flag transfers between them
 *  as "Eigen overboeking". `all` is the set of normalized, space-stripped IBANs
 *  and account numbers; `byKey` maps each account.key to its own identifiers so
 *  categorize can skip a transaction's OWN account (e.g. a bank-fee row that
 *  cites its own IBAN in the description). */
export type OwnAccounts = {
  all: string[];
  byKey: Map<string, string[]>;
  /** The owner's OWN name(s), when he has told the app what they are. USER
   *  DATA — `ownAccounts()` cannot derive it from a statement, so the UI adds it
   *  (`{ ...ownAccounts(accounts), names: [parseOwnName(profile.fullName)] }`).
   *  Absent means no claim: without a name, nothing is matched on one. */
  names?: readonly OwnName[];
};

/** Build OwnAccounts from the full accounts list. Only values that contain a
 *  digit and are >= 8 chars qualify as identifiers — this deliberately excludes
 *  generic keys like "Betaalrekening"/"Current" that would substring-match
 *  unrelated descriptions and cause false "Eigen overboeking" hits. Pass the
 *  FULL list (not an entity-scoped subset) so a BV1->BV2 move still counts. */
export function ownAccounts(accounts: Account[]): OwnAccounts {
  const byKey = new Map<string, string[]>();
  const all = new Set<string>();
  for (const a of accounts) {
    const ids = [a.iban, a.key]
      .map((v) => norm(v).replace(/\s+/g, ""))
      .filter((s) => s.length >= 8 && /\d/.test(s));
    byKey.set(a.key, ids);
    for (const id of ids) all.add(id);
  }
  return { all: [...all], byKey };
}

/** The identifier of ANOTHER of the owner's own accounts inside an ALREADY
 *  normalized, space-stripped haystack — or null. Takes the prepared haystack
 *  rather than the tx because `categorize` runs on every transaction at read
 *  time and already has one; normalizing twice per row is a cost a vault of ten
 *  thousand rows notices. */
function ownAccountIn(hayCompact: string, accountKey: string, own: OwnAccounts): string | null {
  const skip = own.byKey.get(accountKey);
  for (const id of own.all) {
    if (skip && skip.includes(id)) continue; // don't match the tx's own account
    if (hayCompact.includes(id)) return id;
  }
  return null;
}

/** Which of the owner's OWN accounts this row names on its other side, or null.
 *
 *  THE SAME RULE `categorize` USES to reach "Eigen overboeking", exported so
 *  there is exactly ONE copy of it. The privé/zakelijk boundary module
 *  (`crossScope.ts`) needs the same question answered — and needs to know WHICH
 *  account was named, not just that one was — and a second implementation of
 *  "is this my own account" would drift from the category within a release. */
export function ownAccountNamed(
  tx: Pick<Tx, "accountKey" | "counterparty" | "description">,
  own?: OwnAccounts,
): string | null {
  if (!own || own.all.length === 0) return null;
  const hayCompact = matchNorm(tx.counterparty + " " + tx.description).replace(/\s+/g, "");
  return ownAccountIn(hayCompact, tx.accountKey, own);
}

/** Category for a tx, in precedence order: a non-empty tx.category (manual
 *  override) wins; else — when `own` is supplied — an "Eigen overboeking" if the
 *  counterparty/description names another of the user's own accounts; else the
 *  first user rule whose match text is a substring of counterparty+description;
 *  else the first built-in Dutch default (NL_CATEGORY_RULES) that matches; else
 *  one of the three last-resort readings of WHO the counterparty is (an incasso
 *  code, another person's name, the payment mechanism — see the block at the end
 *  of this function); else "onbekend". So internal transfers are separated out
 *  and the defaults categorize the rest out of the box, while a user's own rule
 *  or manual label always takes precedence over both.
 *
 *  `own.names` extends the "this is me" test from his IBANs to his NAME, which
 *  is data only he can supply — see OwnAccounts.
 *
 *  This runs at READ time on every transaction, stored or fresh — so improving
 *  the rules improves an existing vault immediately; nothing has to be
 *  re-imported. (`recategorize` in categorize.ts is the persisted counterpart,
 *  for when the resolved category has to live on the transaction itself.)
 *
 *  Matching uses `matchNorm`, not `norm`: real counterparty strings arrive with
 *  punctuation ("Nationale-Nederlanden", "CCV*ALBERT HEIJN", "K.v.K.") that a
 *  lowercase-and-collapse-whitespace comparison misses. Both the entry and the
 *  transaction text go through it, so a user rule typed with a hyphen or an
 *  accent keeps matching. */
export function categorize(tx: Tx, rules: Rule[], own?: OwnAccounts): string {
  if (tx.category) return tx.category;
  const hay = matchNorm(tx.counterparty + " " + tx.description);
  if (own && own.all.length) {
    // Compare against a space-stripped haystack so an IBAN printed with spaces
    // ("NL95 INGB 0674 ...") still matches the compact stored identifier.
    if (ownAccountIn(hay.replace(/\s+/g, ""), tx.accountKey, own) !== null) return "Eigen overboeking";
  }
  // HIS OWN NAME on the other side of the row is the same fact as his own IBAN
  // on it: his own money moving. It sits here, above the rules, for that reason
  // — and it only ever fires on a name he typed himself (see OwnAccounts.names).
  if (own?.names?.length && isOwnName(tx.counterparty, own.names)) return "Eigen overboeking";
  for (const r of rules) {
    // Guard on the NORMALIZED match: a whitespace-only (or punctuation-only)
    // match normalizes to "" and would otherwise substring-match every tx,
    // mislabeling the whole dataset.
    const m = matchNorm(r.match);
    if (m && hay.includes(m)) return r.category;
  }
  // A direction-specific built-in (e.g. "salaris" -> Inkomen) only applies to
  // its own direction; an entry without a `sign` applies to both.
  const sign = tx.amount >= 0 ? "in" : "out";
  for (const r of NL_CATEGORY_RULES_NORMALIZED) {
    if (r.weak) continue; // a mechanism, not a merchant — held back to the end
    if (r.sign && r.sign !== sign) continue;
    if (hay.includes(r.m)) return r.category;
  }
  // LAST, AND ONLY WHERE NOTHING ELSE SPOKE: a card payment made at a terminal
  // abroad. His three Barcelona rows were reaching "onbekend" while the app had
  // already worked out they were foreign — the detection existed and produced a
  // label, not a category, so €4.000 of a July he could account for perfectly well
  // sat in a bucket he could not.
  //
  // The discriminator is a PHYSICAL terminal, not merely a foreign country: a row
  // carrying both a card number and a terminal or a time was made in person, which
  // is what makes "spending while travelling" the honest reading. A foreign ONLINE
  // purchase has no terminal, and calling that travel would be a guess — it stays
  // unknown, which is the right answer for it.
  const abroad = foreignTerminalCategory(tx);
  if (abroad) return abroad;

  /* ── WHO the counterparty is (review 20-08-2026, item 6) ─────────────────
   * Everything below is a last resort, in order of how much the row proves.
   *
   * 1. An INCASSO is read off a code the bank printed — a mandate id, a
   *    creditor id, or the SEPA phrase. It comes first because it is evidence
   *    rather than a shape, and because a collection is nearly always a company
   *    taking money, which is the safe reading when both could fire.
   * 2. A PERSON'S NAME is a shape, so it is second, and never on a row paid at
   *    a terminal — a till receipt is a purchase whatever the shop is called.
   * 3. Only then the mechanism rules (betaalverzoek/tikkie), so a payment
   *    request from a person lands between people and not in "Overboekingen". */
  if (directDebit(tx)) return DIRECT_DEBIT_CATEGORY;
  const raw = `${tx.counterparty} ${tx.description}`;
  if (isPersonName(tx.counterparty) && !isMerchantRow(raw)) return PERSON_CATEGORY;
  for (const r of NL_CATEGORY_RULES_NORMALIZED) {
    if (!r.weak) continue;
    if (r.sign && r.sign !== sign) continue;
    if (hay.includes(r.m)) return r.category;
  }
  return "onbekend";
}

/** Words that place a foreign in-person payment more precisely than "travel".
 *  Deliberately short: each entry is a word whose meaning does not shift between
 *  the languages these exports are printed in, and a wrong category here is worse
 *  than the general one, because it silently distorts a real total. */
const ABROAD_WORDS: ReadonlyArray<{ m: string; category: string }> = [
  { m: "metro", category: "Transport" },
  { m: "taxi", category: "Transport" },
  { m: "renfe", category: "Transport" },
  { m: "sncf", category: "Transport" },
  { m: "aeroport", category: "Transport" },
  { m: "airport", category: "Transport" },
  { m: "parking", category: "Transport" },
  { m: "camping", category: "Reizen" },
  { m: "camper park", category: "Reizen" },
  { m: "hotel", category: "Reizen" },
  { m: "hostal", category: "Reizen" },
  { m: "hostel", category: "Reizen" },
  { m: "gelato", category: "Café" },
  { m: "heladeria", category: "Café" },
  { m: "cafe", category: "Café" },
  { m: "bar ", category: "Café" },
  { m: "restaurant", category: "Café" },
  { m: "supermercat", category: "Boodschappen" },
  { m: "supermercado", category: "Boodschappen" },
  { m: "mercadona", category: "Boodschappen" },
  { m: "carrefour", category: "Boodschappen" },
];

/** The category for a card payment made at a terminal abroad, or null when this
 *  row is not one. Exported for the tests that pin the discriminator. */
export function foreignTerminalCategory(tx: Tx): string | null {
  const raw = `${tx.counterparty} ${tx.description}`;
  if (!foreignCodeIn(raw)) return null;
  // "Kaartnr" alone is not enough — an online card payment carries one too. A
  // terminal id or a time of day is what says someone stood there.
  const inPerson = /kaartnr/i.test(raw) && /\bterm\b|\bterm:|\btijd:/i.test(raw);
  if (!inPerson) return null;
  const hay = matchNorm(raw);
  for (const w of ABROAD_WORDS) if (hay.includes(w.m)) return w.category;
  return "Reizen";
}

/** In/out totals grouped by derived category (via categorize). Pass `own` to
 *  split out "Eigen overboeking" (transfers between the user's own accounts). */
export function categoryTotals(txs: Tx[], rules: Rule[], own?: OwnAccounts): Record<string, { in: number; out: number }> {
  const out: Record<string, { in: number; out: number }> = {};
  for (const t of txs) {
    const c = categorize(t, rules, own);
    const b = (out[c] ??= { in: 0, out: 0 });
    if (t.amount >= 0) b.in += t.amount; else b.out += t.amount;
  }
  return out;
}

export type CategoryComparisonRow = {
  category: string;
  out: number; // current-month spend on the COMPARED accounts, positive euros
  sharePct: number; // % of the compared current-month total
  prevOut: number; // previous-month spend on the SAME accounts, positive euros
  changePct: number | null; // vs previous month; null when there was no prior spend
};

/** What we actually observed of one calendar month. `partial` is the honest
 *  warning behind "eleven days against a full month": the newest transaction we
 *  hold for this month falls before the month's last day, so the month is still
 *  filling up (or the statement stops there). The raw dates are exposed too, so
 *  the UI can be specific ("11 van 31 dagen") instead of vague. A month with no
 *  data at all has empty dates, `daysObserved: 0` and `partial: true`. */
export type MonthCoverage = {
  month: string; // "YYYY-MM"
  firstDate: string; // earliest tx date observed in the month, "" when none
  lastDate: string; // newest tx date observed in the month, "" when none
  daysObserved: number; // day-of-month of lastDate, 0 when none
  daysInMonth: number;
  partial: boolean;
};

/** Which accounts the comparison could honestly use, and what it therefore left
 *  out. An account "covers" a month when its observed date range spans into
 *  that month — so a card imported for August only does NOT cover July, while a
 *  card that simply had no July transactions (but has June and August ones)
 *  does, and its €0 for July is a real zero rather than a hole. */
export type ComparisonCoverage = {
  comparedAccountKeys: string[]; // accounts covering BOTH months — the like-for-like basis
  excludedAccountKeys: string[]; // accounts covering exactly one of the two months
  excludedOut: { current: number; previous: number }; // spend left out, positive euros
  comparable: boolean; // at least one account covers both months
};

export type CategoryComparison = {
  month: string;
  prevMonth: string;
  /** Empty when `coverage.comparable` is false — there is nothing to compare,
   *  and a percentage would be a claim we cannot support. */
  rows: CategoryComparisonRow[];
  coverage: ComparisonCoverage;
  current: MonthCoverage;
  previous: MonthCoverage;
};

const TRANSFER_CATEGORY = "Eigen overboeking";
const monthOf = (date: string): string => date.slice(0, 7); // "YYYY-MM"

/** Days in a "YYYY-MM" month. Day 0 of the NEXT month is the last day of this
 *  one; Date.UTC does the calendar carry, so December works too. */
function daysInMonth(month: string): number {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/** Step a "YYYY-MM" back by one month. */
function prevMonthOf(month: string): string {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 2, 1)); // m is 1-based; m-2 = prev month (0-based)
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

const emptyCoverage = (month: string): MonthCoverage => ({
  month,
  firstDate: "",
  lastDate: "",
  daysObserved: 0,
  daysInMonth: month ? daysInMonth(month) : 0,
  partial: true,
});

/** Internal category comparison for the LATEST month present in the data vs the
 *  month before it: each expense category's share of that month's spend and its
 *  change vs the prior month. Own transfers ("Eigen overboeking") are excluded
 *  (not spending). Deterministic — the "current" month is derived from the
 *  newest tx date, so it also works on historical/imported statements.
 *
 *  LIKE FOR LIKE. Both months are restricted to the accounts whose observed data
 *  reaches into BOTH of them. Without that, importing one bank for Jan–Aug and a
 *  credit card for August only makes August carry a whole extra card that July
 *  never had — a large, entirely fictional "increase". What was left out is
 *  reported in `coverage` so the block can name it, and when NO account covers
 *  both months the comparison is refused outright (`rows: []`,
 *  `comparable: false`) rather than printing a percentage that cannot mean what
 *  it appears to mean.
 *
 *  Comparing eleven days of August against a full July is the same lie in a
 *  different shape, so `current`/`previous` carry each month's observed span and
 *  a `partial` flag; the caller decides how loudly to say it. */
export function categoryComparison(txs: Tx[], rules: Rule[], own?: OwnAccounts): CategoryComparison {
  const dated = txs.filter((t) => t.date);
  if (dated.length === 0) {
    return {
      month: "",
      prevMonth: "",
      rows: [],
      coverage: { comparedAccountKeys: [], excludedAccountKeys: [], excludedOut: { current: 0, previous: 0 }, comparable: false },
      current: emptyCoverage(""),
      previous: emptyCoverage(""),
    };
  }

  const month = monthOf(dated.reduce((a, b) => (a.date > b.date ? a : b)).date);
  const prevMonth = prevMonthOf(month);

  // Per-account observed span. "Covers month M" = the span overlaps M, which is
  // the closest thing to statement coverage we can derive from transactions
  // alone — and, unlike "has a transaction in M", it does not punish an account
  // that was simply unused for a month.
  const span = new Map<string, { first: string; last: string }>();
  for (const t of dated) {
    const s = span.get(t.accountKey);
    if (!s) span.set(t.accountKey, { first: t.date, last: t.date });
    else {
      if (t.date < s.first) s.first = t.date;
      if (t.date > s.last) s.last = t.date;
    }
  }
  const covers = (key: string, m: string): boolean => {
    const s = span.get(key);
    if (!s) return false;
    return s.first <= `${m}-${String(daysInMonth(m)).padStart(2, "0")}` && s.last >= `${m}-01`;
  };

  const comparedAccountKeys: string[] = [];
  const excludedAccountKeys: string[] = [];
  for (const key of [...span.keys()].sort()) {
    const inCur = covers(key, month);
    const inPrev = covers(key, prevMonth);
    if (inCur && inPrev) comparedAccountKeys.push(key);
    else if (inCur || inPrev) excludedAccountKeys.push(key);
  }
  const compared = new Set(comparedAccountKeys);

  // Month coverage is measured over the accounts actually compared when there
  // are any — otherwise the whole dataset, so an uncomparable result still says
  // how much of the newest month it holds.
  const spanSource = compared.size > 0 ? dated.filter((t) => compared.has(t.accountKey)) : dated;
  const coverageOf = (m: string): MonthCoverage => {
    let firstDate = "";
    let lastDate = "";
    for (const t of spanSource) {
      if (monthOf(t.date) !== m) continue;
      if (firstDate === "" || t.date < firstDate) firstDate = t.date;
      if (t.date > lastDate) lastDate = t.date;
    }
    if (lastDate === "") return emptyCoverage(m);
    const total = daysInMonth(m);
    const daysObserved = Number(lastDate.slice(8, 10));
    return { month: m, firstDate, lastDate, daysObserved, daysInMonth: total, partial: daysObserved < total };
  };

  const cur: Record<string, number> = {};
  const prev: Record<string, number> = {};
  const excludedOut = { current: 0, previous: 0 };
  for (const t of dated) {
    if (t.amount >= 0) continue; // spend only
    const mo = monthOf(t.date);
    if (mo !== month && mo !== prevMonth) continue;
    const c = categorize(t, rules, own);
    if (c === TRANSFER_CATEGORY) continue;
    const spend = -t.amount; // positive euros
    if (!compared.has(t.accountKey)) {
      if (mo === month) excludedOut.current += spend;
      else excludedOut.previous += spend;
      continue;
    }
    if (mo === month) cur[c] = (cur[c] ?? 0) + spend;
    else prev[c] = (prev[c] ?? 0) + spend;
  }

  const coverage: ComparisonCoverage = {
    comparedAccountKeys,
    excludedAccountKeys,
    excludedOut,
    comparable: comparedAccountKeys.length > 0,
  };
  const base = { month, prevMonth, coverage, current: coverageOf(month), previous: coverageOf(prevMonth) };
  if (!coverage.comparable) return { ...base, rows: [] };

  const totalCur = Object.values(cur).reduce((s, v) => s + v, 0);
  const rows: CategoryComparisonRow[] = Object.keys(cur)
    .map((category) => {
      const out = cur[category];
      const prevOut = prev[category] ?? 0;
      return {
        category,
        out,
        sharePct: totalCur > 0 ? (out / totalCur) * 100 : 0,
        prevOut,
        changePct: prevOut > 0 ? ((out - prevOut) / prevOut) * 100 : null,
      };
    })
    .sort((a, b) => b.out - a.out);
  return { ...base, rows };
}

/* ── The "smaller categories not shown" cut-off, per timeframe ─────────────
 *
 * A fixed rank (or a fixed euro floor) hides different things depending on how
 * long the window is: €30 a month is 6% of a month and 0,5% of a year, so a
 * category worth watching inside one month disappears against twelve. The
 * threshold therefore scales WITH the window — it is a rate (per 30 days), not
 * an amount — and everything folded away is returned, named, so the block can
 * say what it hid instead of only counting it. */

export type CategorySlice = {
  category: string;
  out: number;
  sharePct: number;
  /** True when the category fell under the window-relative floor. A hidden slice
   *  with `false` was pushed out by the chart's cap instead — a different
   *  sentence ("nog 3 categorieën, niet getekend") than "6 kleinere
   *  categorieën", and the block should not conflate them. */
  belowThreshold: boolean;
};

export type CategorySelection = {
  /** The categories to draw, biggest first. */
  shown: CategorySlice[];
  /** Everything folded away, biggest first: below the threshold, or past the
   *  chart's cap. Named so the caller can list them. */
  hidden: CategorySlice[];
  /** Combined spend / share of `hidden`. */
  hiddenOut: number;
  hiddenSharePct: number;
  /** The window-relative floor actually applied, in the unit of the totals. */
  thresholdOut: number;
  /** The rate it came from, per 30 days, and the window it was scaled to. */
  minPer30Days: number;
  windowDays: number;
  /** Total spend across all categories, in the unit of the totals. */
  totalOut: number;
};

export type SelectCategoriesOptions = {
  /** Length of the displayed window, in days. */
  windowDays: number;
  /** Most categories to draw — a chart cap, not a judgement about relevance. */
  maxShown?: number;
  /** A category is material when it averages at least this much per 30 days.
   *  Same unit as the totals (euros for `categoryTotals`). */
  minPer30Days?: number;
};

/** Split category totals into what a window of `windowDays` should show and what
 *  it should fold away. Totals are positive spend, in any consistent unit; the
 *  threshold is expressed in that same unit per 30 days and scaled to the
 *  window, which is what makes the cut-off per-timeframe rather than global.
 *  A non-positive `windowDays` yields a zero floor (nothing is dropped for being
 *  small) — we do not invent a window we were not given. */
export function selectMajorCategories(
  totals: Iterable<readonly [string, number]>,
  opts: SelectCategoriesOptions,
): CategorySelection {
  const maxShown = opts.maxShown ?? 4;
  const minPer30Days = opts.minPer30Days ?? 25;
  const windowDays = opts.windowDays > 0 ? opts.windowDays : 0;
  const thresholdOut = (minPer30Days * windowDays) / 30;

  const ranked = [...totals]
    .filter(([, out]) => out > 0)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const totalOut = ranked.reduce((s, [, out]) => s + out, 0);
  const slice = ([category, out]: readonly [string, number]): CategorySlice => ({
    category,
    out,
    sharePct: totalOut > 0 ? (out / totalOut) * 100 : 0,
    belowThreshold: out < thresholdOut,
  });

  const material = ranked.filter(([, out]) => out >= thresholdOut);
  const shown = material.slice(0, maxShown).map(slice);
  const shownNames = new Set(shown.map((s) => s.category));
  const hidden = ranked.filter(([c]) => !shownNames.has(c)).map(slice);
  const hiddenOut = hidden.reduce((s, h) => s + h.out, 0);

  return {
    shown,
    hidden,
    hiddenOut,
    hiddenSharePct: totalOut > 0 ? (hiddenOut / totalOut) * 100 : 0,
    thresholdOut,
    minPer30Days,
    windowDays,
    totalOut,
  };
}

/** Calendar days covered by a list of "YYYY-MM" months — the `windowDays` to
 *  hand `selectMajorCategories` when the window is expressed in months. */
export function windowDaysFromMonths(months: string[]): number {
  return months.reduce((s, m) => s + daysInMonth(m), 0);
}

/** Merge freshly-imported accounts with the existing ones, preserving the user's
 *  manual edits on accounts they already have: their entity, their type (soort),
 *  and — for imports carrying no balance (CSV) — their manually-set saldo. A
 *  fresh statement balance (MT940/ABN, non-null) still wins. New accounts pass
 *  through unchanged. Returns only the imported accounts (the caller upserts
 *  them; untouched existing accounts stay put). */
export function mergeImportedAccounts(existing: Account[], imported: Account[]): Account[] {
  const byKey = new Map(existing.map((a) => [a.key, a]));
  return imported.map((imp) => {
    const prev = byKey.get(imp.key);
    if (!prev) return imp;
    return {
      ...imp,
      entity: prev.entity,
      type: prev.type,
      balance: imp.balance !== null ? imp.balance : prev.balance,
      balanceDate: imp.balance !== null ? imp.balanceDate : prev.balanceDate,
      // A bank/name the owner typed himself survives a re-import; one that only
      // ever came from a parser does not, so an improved parser can still fix a
      // stale row (his old ING savings accounts came in as their own number).
      ...(prev.renamed ? { bank: prev.bank, name: prev.name, renamed: true } : {}),
    };
  });
}
