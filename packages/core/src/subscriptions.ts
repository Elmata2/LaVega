import type { Tx } from "./model.js";
import { norm } from "./hash.js";

/* Subscription detection for the Optimisatie tab. Distinct from the forecast's
 * detectRecurringStreams: that one REJECTS amount drift (to keep a clean
 * recurring signal), which would hide exactly the price increases we want to
 * surface here. This detector keeps the stream and reports its amount trend.
 * Pure + deterministic: integer cents, ISO-date day math via Date.UTC. */

export type Subscription = {
  key: string;              // merchantKey(counterparty) + "|out"
  name: string;             // raw counterparty of the first occurrence
  function: string;         // "Videostreaming" | "Muziekstreaming" | ... | "Overig"
  cadenceDays: number;      // 30 | 61 | 91 | 182 | 365
  monthlyCents: number;     // current price normalized to per-month (positive)
  firstAmountCents: number; // earliest REPEATING charge (the old price)
  lastAmountCents: number;  // latest REPEATING charge (the current price)
  changePct: number;        // (last - first) / first, rounded to 0.001
  occurrences: number;
  lastDate: string;
  /** Cycles that were expected inside the observed history and never arrived —
   *  a failed direct debit. Kept because "monthly, seen 5x" and "monthly, seen
   *  4x with one miss" are different claims, and because the empty-list
   *  explanation needs to be able to say which one it saw. */
  skippedCycles: number;
};

export type SubscriptionOverlap = { function: string; subs: Subscription[]; monthlyCents: number };

/* --- merchant -> "function" map, finer than the category list: two services
 * with the SAME function (e.g. Netflix + HBO Max) are a candidate duplicate.
 * Substring match on the normalized counterparty; first match wins. --- */
const SUBSCRIPTION_FUNCTIONS: ReadonlyArray<{ match: string; fn: string }> = [
  // Videostreaming
  { match: "netflix", fn: "Videostreaming" },
  { match: "videoland", fn: "Videostreaming" },
  { match: "disney", fn: "Videostreaming" },
  { match: "hbo max", fn: "Videostreaming" },
  { match: "hbomax", fn: "Videostreaming" },
  { match: "prime video", fn: "Videostreaming" },
  { match: "amazon prime", fn: "Videostreaming" },
  { match: "viaplay", fn: "Videostreaming" },
  { match: "apple tv", fn: "Videostreaming" },
  { match: "skyshowtime", fn: "Videostreaming" },
  // Muziekstreaming
  { match: "spotify", fn: "Muziekstreaming" },
  { match: "apple music", fn: "Muziekstreaming" },
  { match: "deezer", fn: "Muziekstreaming" },
  { match: "tidal", fn: "Muziekstreaming" },
  { match: "youtube premium", fn: "Muziekstreaming" },
  { match: "youtube music", fn: "Muziekstreaming" },
  { match: "amazon music", fn: "Muziekstreaming" },
  // Cloudopslag
  { match: "icloud", fn: "Cloudopslag" },
  { match: "apple.com/bill", fn: "Cloudopslag" },
  { match: "google one", fn: "Cloudopslag" },
  { match: "google storage", fn: "Cloudopslag" },
  { match: "dropbox", fn: "Cloudopslag" },
  { match: "onedrive", fn: "Cloudopslag" },
  // Sportschool
  { match: "basic-fit", fn: "Sportschool" },
  { match: "basic fit", fn: "Sportschool" },
  { match: "fit for free", fn: "Sportschool" },
  { match: "sportcity", fn: "Sportschool" },
  { match: "anytime fitness", fn: "Sportschool" },
  // Nieuws
  { match: "de volkskrant", fn: "Nieuws" },
  { match: "nrc", fn: "Nieuws" },
  { match: "de telegraaf", fn: "Nieuws" },
  { match: "het parool", fn: "Nieuws" },
  { match: "algemeen dagblad", fn: "Nieuws" },
  { match: "dagblad trouw", fn: "Nieuws" },
  // Software / AI
  { match: "adobe", fn: "Software" },
  { match: "microsoft 365", fn: "Software" },
  { match: "office 365", fn: "Software" },
  { match: "chatgpt", fn: "Software" },
  { match: "openai", fn: "Software" },
  { match: "notion", fn: "Software" },
  { match: "canva", fn: "Software" },
  // Mobiel abonnement
  { match: "vodafone", fn: "Mobiel abonnement" },
  { match: "kpn", fn: "Mobiel abonnement" },
  { match: "odido", fn: "Mobiel abonnement" },
  { match: "t-mobile", fn: "Mobiel abonnement" },
  { match: "simyo", fn: "Mobiel abonnement" },
  { match: "ben.nl", fn: "Mobiel abonnement" },
  { match: "lebara", fn: "Mobiel abonnement" },
  { match: "youfone", fn: "Mobiel abonnement" },
  { match: "hollandsnieuwe", fn: "Mobiel abonnement" },
];

/* The merchant dictionary above is matched on a TOKEN boundary, not a bare
 * substring: "nrc" must not fire inside another word, and "SIMYO B.V. 4839201"
 * must still hit "simyo". Compiled once. */
const MERCHANT_MATCHERS: ReadonlyArray<{ match: string; fn: string; re: RegExp }> =
  SUBSCRIPTION_FUNCTIONS.map((f) => ({
    ...f,
    re: new RegExp(`(^|[^a-z0-9])${f.match.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^a-z0-9]|$)`),
  }));

function knownMerchant(normalized: string): { match: string; fn: string } | null {
  for (const m of MERCHANT_MATCHERS) if (m.re.test(normalized)) return m;
  return null;
}

/** The "function" of a subscription by merchant name, or "Overig" if unknown. */
export function subscriptionFunction(name: string): string {
  return knownMerchant(norm(name))?.fn ?? "Overig";
}

/* Tokens a Dutch bank export adds around the merchant's actual name: the legal
 * form and the payment-scheme boilerplate. Dropped when building the merchant
 * key, so "Incasso Simyo B.V." and "SIMYO" are one merchant. */
const NAME_NOISE_TOKENS = new Set([
  "bv", "nv", "vof", "cv", "bvba", "ltd", "llc", "inc", "gmbh", "ag", "sa", "sarl", "plc", "kg",
  "sepa", "incasso", "machtiging", "doorlopend", "doorlopende", "eenmalig", "eenmalige",
  "ideal", "bea", "gea", "betaling", "betaalautomaat",
]);

/** The identity of the MERCHANT behind a counterparty string — the group key of
 *  the detector. This is the fix for the review's Simyo: a bank does not repeat
 *  the counterparty verbatim every month. One incasso stream arrives as
 *  "SIMYO B.V. 4839201", "Simyo B.V." and "SIMYO", and keying on the literal
 *  string split it into three streams of one — invisible when each lands once,
 *  and worse when the spellings alternate: two "tweemaandelijks" halves at half
 *  the real price, counted twice in the total.
 *
 *  Two steps, cheapest first:
 *   1. a merchant we already know (the dictionary above) collapses to its own
 *      token — data this module already held and did not use for grouping;
 *   2. anything else keeps only its name-like tokens: reference numbers, dates
 *      and legal forms are dropped.
 *  Returns "" for a counterparty with no name in it at all (a blank field, a
 *  bare reference) — the detector refuses those rather than inventing a name. */
export function merchantKey(counterparty: string): string {
  const h = norm(counterparty);
  const known = knownMerchant(h);
  if (known) return known.match;
  const kept: string[] = [];
  for (const t of h.replace(/[^a-z0-9]+/g, " ").split(" ")) {
    if (t.length < 2) continue;                     // initials, "b" + "v" of b.v.
    if (/^\d+$/.test(t)) continue;                  // invoice / customer number
    if (/\d/.test(t) && t.length >= 4) continue;     // "m0123456", "20260115"
    if (NAME_NOISE_TOKENS.has(t)) continue;
    kept.push(t);
  }
  return kept.join(" ");
}

/* Phrases (and IBAN shape) that mark a counterparty as a transfer/settlement,
 * not a subscription — so a recurring "Overschrijving naar <persoon>" or an
 * Amex/creditcard settlement is never listed as an abonnement. */
const TRANSFER_HINTS = [
  "overschrijving", "overboeking", "spaarrekening", "tikkie", "geld toegevoegd",
  "geld toevoegen", "kosten zakelijk", "american express", "incasso ing creditcard", "naar creditcard",
  // A payment arrangement with the tax office is a fixed monthly outflow with a
  // stable counterparty — a textbook match for this detector, and the one thing
  // in the list nobody can cancel. The tax modules own it (VAT set-aside, BTW
  // deadlines); an "abonnement" it is not.
  "belastingdienst",
];
/* A private person, not a merchant: Dutch bank exports write people as initials
 * plus an optional tussenvoegsel plus a surname ("J.C. de Vries", "A. Jansen").
 * A fixed monthly amount to a person is an arrangement between people —
 * alimony, rent to a private landlord, money to a child — and listing it as an
 * "abonnement he could cancel" is exactly the kind of entry that costs trust.
 * Anchored at both ends and deliberately narrow: a wrong hit here COSTS a real
 * subscription, so anything with extra words in it is left alone. */
const PERSON_NAME = /^[a-z]\.\s?(?:[a-z]\.\s?)*(?:(?:van|van der|van den|van de|de|den|der|ten|ter|te|op|in|het) )?([a-z]{2,})$/;
/* Dutch companies are written with initials too — "A.S.R. Verzekeringen",
 * "D.A.S. Rechtsbijstand" — and an insurance premium IS a subscription. Stems,
 * because the plural and the compound both occur. */
const COMPANY_WORD_STEMS = [
  "verzeker", "assurant", "hypothe", "bank", "telecom", "mobile", "energie", "pensioen",
  "zorg", "groep", "group", "holding", "beheer", "vastgoed", "service", "system", "media",
  "fonds", "uitgever", "rechtsbijstand", "advocat", "notaris", "accountant",
];
function looksLikePerson(normalized: string): boolean {
  const m = PERSON_NAME.exec(normalized);
  if (!m) return false;
  return !COMPANY_WORD_STEMS.some((w) => m[1].startsWith(w));
}

function looksLikeTransfer(counterparty: string): boolean {
  const h = norm(counterparty);
  if (/^[a-z]{2}\d{2}[a-z0-9]{10,}$/.test(h.replace(/\s+/g, ""))) return true; // IBAN counterparty
  if (looksLikePerson(h)) return true;
  return TRANSFER_HINTS.some((w) => h.includes(w));
}

/* The roof, and only the roof. Rent, mortgage and the VvE/service charge are
 * recurring monthly outflows that this detector would happily list as the
 * biggest "subscriptions" he has — while the same screen already shows them as
 * Woonlasten (see housing.ts), so they would be counted twice and would swamp
 * the € 10-a-month streams the module exists to find. Energy and water are
 * deliberately NOT here: nothing else surfaces them.
 * Matched on a word start so "schuur" is not "huur" and "vve" is not "vveel". */
const HOUSING_HINTS = [
  "huur", "verhuur", "hypothe", "vve", "vereniging van eigenaren",
  "woningstichting", "woningcorporatie", "woonstichting", "servicekosten",
];
const HOUSING_RES = HOUSING_HINTS.map((w) => new RegExp(`(^|[^a-z0-9])${w}`));
function looksLikeHousing(counterparty: string): boolean {
  const h = norm(counterparty);
  return HOUSING_RES.some((re) => re.test(h));
}

/** Whole days between two ISO dates via Date.UTC (locale/TZ-safe). */
function daysBetween(a: string, b: string): number {
  const [ay, am, ad] = a.split("-").map(Number);
  const [by, bm, bd] = b.split("-").map(Number);
  return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86_400_000);
}

function mean(nums: number[]): number {
  return nums.reduce((s, n) => s + n, 0) / nums.length;
}
function std(nums: number[]): number {
  if (nums.length < 2) return 0;
  const m = mean(nums);
  return Math.sqrt(nums.reduce((s, n) => s + (n - m) ** 2, 0) / (nums.length - 1));
}

/* Cadence bands accepted for a subscription. Weekly is deliberately excluded —
 * a weekly fixed outflow is rarely a "subscription".
 *
 * There is NO lookback window in this detector: it reads every transaction it is
 * handed. What limits it is this table. Before 2026-08-17 it held three rows —
 * monthly (26–36d, 3 occurrences), quarterly (84–98d, 2) and yearly (350–380d,
 * 2) — which left a hole from 37 to 83 days and another from 99 to 349, so a
 * two-monthly or half-yearly charge matched no band and could never appear. The
 * two rows below close those holes; both need 3 occurrences, because two
 * payments 60 days apart at a similar amount are just as likely to be two
 * ordinary purchases at the same shop, and a third occurrence gives the cycle
 * fit a second gap to check the rhythm against. (That last clause used to say
 * "brings the interval-CV guard into play"; that guard is gone — see the
 * fitter below — and a comment describing a removed knob is how two detectors
 * drifted apart in the first place.)
 *
 * The real constraint is therefore HISTORY, not a window: see
 * `minHistoryDaysFor` and `subscriptionCoverage`. */
const CADENCE_BANDS: ReadonlyArray<{ cadenceDays: number; min: number; max: number; minOcc: number }> = [
  { cadenceDays: 30, min: 26, max: 36, minOcc: 3 },
  { cadenceDays: 61, min: 55, max: 68, minOcc: 3 },
  { cadenceDays: 91, min: 80, max: 100, minOcc: 2 },
  { cadenceDays: 182, min: 170, max: 195, minOcc: 2 },
  { cadenceDays: 365, min: 350, max: 380, minOcc: 2 },
];

/* ===========================================================================
 * READING THE RHYTHM — ONE FITTER, BOTH DETECTORS.
 *
 * There used to be two, in this one file. `detectSubscriptions` picked a band
 * by MEDIAN gap and then demanded a coefficient of variation <= 0.4 over all
 * gaps at once. `detectScheduleStreams` (the Betaalagenda, further down) read
 * the gaps as whole CYCLES and tolerated a skipped one — a repair built for the
 * agenda in round 2/3 and never carried across.
 *
 * Measured on his Simyo stream with a failed June direct debit, gaps
 * [31, 61, 30]: mean 40.67, sd 17.62, CV 0.433 against a 0.4 limit. The agenda
 * printed "SIMYO B.V. 11,89 every 30d, 1 skipped"; Optimalisatie printed
 * nothing, on the very same rows. Two functions looking at one series and
 * disagreeing is the defect — he reported the symptom five times.
 *
 * Copying the cycle logic across by hand would have made a THIRD copy, and two
 * copies are exactly what drifted, so the copies are gone: both detectors call
 * `fitCadence` and can no longer disagree. A CV cannot express "one cycle was
 * missed" at all — it can only see a series that got bumpier — which is why the
 * cycle reading wins the merge and the CV knob is deleted rather than retuned.
 *
 * What this adds on top of the agenda's old `fitCycles`: a bounded number of
 * charges may be left OUT of the stream. One merchant is one group (that is
 * what fixed the alternating spellings), so a Simyo extra data bundle 11 days
 * after the incasso sits in the same group as the incasso — and a pure cycle
 * fit refuses the whole group over that one row, which would have cost him the
 * subscription he asked about. The budget is deliberately mean: `extras <=
 * floor(members / 3)`, i.e. at least three of every four charges at that
 * merchant must fall on the rhythm. That is what keeps a shop he visits weekly
 * from having a "monthly subscription" carved out of its busiest quarter — the
 * phantom he complained about before the miss — and it is arithmetic rather
 * than a hope: weekly visits produce roughly four rows for every one a monthly
 * rhythm can claim, so `extras` lands near `3 x members` and the budget refuses
 * it. Measured: twelve weekly groceries around three monthly charges of the
 * same amount gives nothing, while those same three rows on their own are a
 * subscription.
 * ========================================================================= */

type CadenceBand = (typeof CADENCE_BANDS)[number];

export type CadenceFit = {
  band: CadenceBand;
  /** Indices into the sorted dates that form the stream, ascending. */
  members: number[];
  /** Gaps between consecutive members, in days — the honest record of what the
   *  rhythm looked like, so a rejection can be explained in numbers. */
  gaps: number[];
  /** Expected cycles that never arrived inside the observed history. */
  skippedCycles: number;
  /** Rows in the group that are NOT on the rhythm (a one-off, an extra bundle,
   *  a device instalment). Bounded — see the comment above. */
  extras: number;
  /** Summed absolute day-drift of the member gaps; the tie-breaker. */
  residual: number;
};

/** How far a gap may sit off a whole cycle. DERIVED FROM THE BAND TABLE, not
 *  from a constant of its own: the table already says how wide monthly is
 *  (26-36 days), and a second number saying the same thing differently is the
 *  precise mechanism that broke this module. Monthly -> 6 days, quarterly ->
 *  11, yearly -> 15. The agenda's old `max(4, 12% of cadence)` gave 4 for
 *  monthly (tighter, and it disagreed with the table it sat next to) and 44 for
 *  yearly (three times looser than the table allows). */
function bandTolerance(b: CadenceBand): number {
  return Math.max(b.cadenceDays - b.min, b.max - b.cadenceDays);
}

/** How many cycles a stream may skip and still be the same stream. Three misses
 *  in a row is a stopped stream, not a bumpy one. */
const MAX_SKIPPED_CYCLES = 2;

/** One chain, anchored at `start`: greedy from cycle to cycle, but never greedy
 *  WITHIN a cycle — see the pick below. Exported nowhere: `fitCadence` tries
 *  every anchor and keeps the best. */
function chainFrom(dates: string[], start: number, band: CadenceBand): CadenceFit | null {
  const tol = bandTolerance(band);
  const members = [start];
  const gaps: number[] = [];
  let skippedCycles = 0;
  let residual = 0;
  let onCycle = 0;
  let last = start;
  for (let i = start + 1; i < dates.length; i++) {
    const g = daysBetween(dates[last], dates[i]);
    const k = Math.round(g / band.cadenceDays);
    const drift = Math.abs(g - k * band.cadenceDays);
    if (k >= 1 && k <= MAX_SKIPPED_CYCLES + 1 && drift <= tol) {
      /* `i` is the FIRST row that fits this cycle, which is not the same thing
       * as the row that IS it. Taking the first one cost a whole subscription,
       * measured: five clean € 11,89 incasso's plus one € 80,00 device charge
       * three days BEFORE the June debit put the device charge in the stream
       * and the debit out of it, and the amount spread that followed
       * (11,89 / 80,00, CV 1,19) failed the 0,35 guard — NIETS, no
       * subscription at all. The same charge three days AFTER the debit was
       * harmless, because then the debit was simply scanned first. An
       * asymmetry with no reason behind it other than the reading order is a
       * defect, and it is the same class of defect as the one he reported five
       * times: the rhythm is there and the detector looks past it.
       *
       * So every row inside THIS cycle's window competes and the one nearest
       * the expected day wins. No row outside the window is jumped over — a row
       * lying between two candidates is inside the window too, by definition —
       * so a chain is no easier to start, extend or fabricate than before. Only
       * which row fills one slot changes. */
      const target = k * band.cadenceDays;
      let pick = i;
      let pickDrift = drift;
      for (let j = i + 1; j < dates.length; j++) {
        const gj = daysBetween(dates[last], dates[j]);
        if (gj > target + tol) break;
        const dj = Math.abs(gj - target);
        if (dj < pickDrift) { pick = j; pickDrift = dj; }
      }
      members.push(pick);
      gaps.push(daysBetween(dates[last], dates[pick]));
      residual += pickDrift;
      if (k === 1) onCycle++;
      else skippedCycles += k - 1;
      last = pick;
      /* Resume after the row we took. What sat between `i` and it stays a
       * stray, counted in `extras` and governed by the budget below. */
      i = pick;
      continue;
    }
    /* Too soon to be the next cycle: a charge from the same merchant that is
     * not this stream. Step over it WITHOUT moving the anchor — the next real
     * cycle must still be measured from the last real one, or one extra bundle
     * would shift every gap after it and take the whole stream down. */
    if (g < band.cadenceDays - tol) continue;
    /* Anything else — a gap of four cycles or more, or one that lands between
     * cycles — ends the chain here. Stopping is the strict choice, and it is
     * deliberate: it is what stops a stream being carved out of the middle of a
     * merchant that is simply visited a lot. */
    break;
  }
  if (members.length < band.minOcc) return null;
  /* The majority must be SINGLE cycles. Without this a monthly stream fits a
   * weekly cadence arithmetically (30 ~ 4x7) while being nothing of the sort. */
  if (onCycle < Math.ceil(gaps.length / 2)) return null;
  const extras = dates.length - members.length;
  if (extras > Math.floor(members.length / 3)) return null;
  return { band, members, gaps, skippedCycles, extras, residual };
}

function betterFit(a: CadenceFit, b: CadenceFit): boolean {
  if (a.members.length !== b.members.length) return a.members.length > b.members.length;
  if (a.skippedCycles !== b.skippedCycles) return a.skippedCycles < b.skippedCycles;
  if (a.residual !== b.residual) return a.residual < b.residual;
  return a.band.cadenceDays < b.band.cadenceDays;
}

/** The cadence a series of dates actually follows, or null when none does.
 *  `sortedDates` must be ascending. Deterministic: the winner puts the most
 *  charges on the rhythm, then skips the fewest cycles, then drifts the least,
 *  then has the shortest cadence.
 *
 *  The anchor is bounded by `floor(n / 4)` rather than tried everywhere: with
 *  `extras <= floor(members / 3)` a chain can never start later than that, so
 *  the extra anchors could only produce fits that are thrown away again. */
export function fitCadence(sortedDates: string[]): CadenceFit | null {
  const maxStart = Math.floor(sortedDates.length / 4);
  let best: CadenceFit | null = null;
  for (const band of CADENCE_BANDS) {
    if (sortedDates.length < band.minOcc) continue;
    for (let s = 0; s <= maxStart && s + band.minOcc <= sortedDates.length; s++) {
      const fit = chainFrom(sortedDates, s, band);
      if (fit !== null && (best === null || betterFit(fit, best))) best = fit;
    }
  }
  return best;
}

/** Dutch name of each cadence, for the UI. */
export const CADENCE_LABEL_NL: Readonly<Record<number, string>> = {
  30: "maandelijks",
  61: "tweemaandelijks",
  91: "per kwartaal",
  182: "halfjaarlijks",
  365: "jaarlijks",
};

/** Shortest history in which a charge on this cadence could be seen at all:
 *  the gaps between the minimum number of occurrences. A quarterly charge needs
 *  one full gap (~91 days) before there is anything to recognise — which is why
 *  a one- or two-month import can never show one, no matter how the detector is
 *  tuned. Returns 0 for an unknown cadence. */
export function minHistoryDaysFor(cadenceDays: number): number {
  const band = CADENCE_BANDS.find((b) => b.cadenceDays === cadenceDays);
  return band ? band.cadenceDays * (band.minOcc - 1) : 0;
}

export type SubscriptionCoverage = {
  /** Oldest / newest outflow date in the data, "" when there are none. */
  firstDate: string;
  lastDate: string;
  /** Days from the first outflow to the last, inclusive. 0 when there are none. */
  historyDays: number;
  /** Cadences this much history could show, shortest first. */
  visibleCadences: number[];
  /** Cadences it cannot show yet, shortest first — with the history each needs. */
  hiddenCadences: { cadenceDays: number; needsDays: number }[];
};

/** How much of the subscription picture the data can possibly contain. This is
 *  the honest answer to "why is my quarterly subscription missing?": with 47
 *  days of statements the detector is not blind, the history simply does not
 *  reach back far enough — and saying so beats showing an empty list. */
export function subscriptionCoverage(txs: Tx[]): SubscriptionCoverage {
  let firstDate = "";
  let lastDate = "";
  for (const t of txs) {
    if (t.amount >= 0 || !t.date) continue;
    if (firstDate === "" || t.date < firstDate) firstDate = t.date;
    if (t.date > lastDate) lastDate = t.date;
  }
  const historyDays = firstDate === "" ? 0 : daysBetween(firstDate, lastDate) + 1;
  const visibleCadences: number[] = [];
  const hiddenCadences: { cadenceDays: number; needsDays: number }[] = [];
  for (const b of CADENCE_BANDS) {
    const needsDays = b.cadenceDays * (b.minOcc - 1);
    if (historyDays >= needsDays) visibleCadences.push(b.cadenceDays);
    else hiddenCadences.push({ cadenceDays: b.cadenceDays, needsDays });
  }
  return { firstDate, lastDate, historyDays, visibleCadences, hiddenCadences };
}

export type DetectSubscriptionOptions = {
  /* There is no interval knob any more. It was `maxIntervalCv` (0.4), and it is
   * the number that hid his Simyo: gaps [31, 61, 30] give a CV of 0.433, 8%
   * over the line, on a stream that is perfectly monthly with one failed
   * incasso in it. Raising it would have let genuinely irregular series in;
   * the rhythm is read in cycles now (`fitCadence`) and there is nothing left
   * to tune. */
  maxAmountCv?: number;
  /** The day the answer is "as of", used to tell a running subscription from a
   *  cancelled one. Defaults per account to the last date that account's data
   *  reaches, so the module stays pure (no clock) AND an older export is read on
   *  its own terms instead of having its subscriptions declared dead. */
  asOf?: string;
};

/** Detect subscriptions = regular OUTflows on a monthly/quarterly/yearly
 *  cadence, grouped per MERCHANT (see `merchantKey`). Amount is allowed to
 *  drift (that's the point — price changes) as long as the stream still bills a
 *  repeating figure. Returns a list sorted by monthly cost, descending.
 *
 *  Which way this errs, deliberately (app review, 20 Aug 2026): toward
 *  PRECISION. A missed subscription costs an insight; a phantom one costs trust
 *  in the whole tab, and he named the phantom before he named the miss. So a
 *  stream is refused unless it has a merchant name, an amount that actually
 *  repeats, and a charge recent enough to still be running. */
export function detectSubscriptions(txs: Tx[], opts: DetectSubscriptionOptions = {}): Subscription[] {
  // 0.6 let three ordinary dinners at one restaurant (€ 42,50 / € 18,90 / € 71)
  // through as a € 71-a-month subscription. A real price change is far tamer:
  // Netflix 13,99 -> 15,99 over five charges is a CV of 0.07.
  const maxAmountCv = opts.maxAmountCv ?? 0.35;

  /* "Still running?" is measured against the end of the statement the stream is
   * charged on, not against the newest date anywhere in the vault. With file
   * imports the accounts have different end dates — an Amex CSV to August next
   * to an ING CSV to June — and one global asOf would declare every
   * subscription on the older statement cancelled. */
  const accountEnd = new Map<string, string>();
  for (const t of txs) {
    if (!t.date) continue;
    const cur = accountEnd.get(t.accountKey);
    if (cur === undefined || t.date > cur) accountEnd.set(t.accountKey, t.date);
  }

  const groups = new Map<string, Tx[]>();
  for (const t of txs) {
    if (t.amount >= 0) continue; // outflows only
    const h = norm(t.counterparty);
    // A merchant the dictionary knows sells subscriptions is a merchant, full
    // stop — it is never re-read as a person ("T.Mobile") or a housing cost.
    if (knownMerchant(h) === null) {
      // Not subscription material at all: a transfer to himself or to a person,
      // a card settlement, or a housing cost the Woonlasten block already owns.
      if (looksLikeTransfer(h) || looksLikeHousing(h)) continue;
    }
    const merchant = merchantKey(h);
    // No name, no subscription. Blank counterparties (MT940 rows, ABN
    // fallbacks) all shared the key "|out" and were emitted as ONE phantom
    // subscription with an empty name and a total no merchant ever charged.
    if (merchant === "") continue;
    const key = merchant + "|out";
    const g = groups.get(key);
    if (g) g.push(t);
    else groups.set(key, [t]);
  }

  const subs: Subscription[] = [];
  for (const [key, group] of groups) {
    if (group.length < 2) continue;
    const sorted = [...group].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

    /* The rhythm, read by the same function the Betaalagenda uses. Everything
     * below this line therefore looks at `stream` — the charges that ARE the
     * subscription — and not at every row the merchant produced. That matters
     * twice over: the price is read off the stream (an extra bundle can no
     * longer inflate the amount spread and get the whole thing refused), and
     * `occurrences` counts what was actually billed on the cadence. */
    const fit = fitCadence(sorted.map((t) => t.date));
    if (fit === null) continue;
    const band = fit.band;
    const stream = fit.members.map((i) => sorted[i]);

    // Still being paid? A cancelled stream keeps its cadence and its history
    // forever, so without this the tab lists what he USED to pay as what he
    // pays. Two missed cycles (plus a few days' slack for a weekend shift) is
    // the line: one skipped charge is a billing hiccup, two is a cancellation.
    const lastDate = stream[stream.length - 1].date;
    let asOf = opts.asOf ?? "";
    if (asOf === "") for (const t of stream) {
      const end = accountEnd.get(t.accountKey) ?? "";
      if (end > asOf) asOf = end;
    }
    if (asOf !== "" && daysBetween(lastDate, asOf) > band.cadenceDays * 2 + 5) continue;

    const amountsCents = stream.map((t) => Math.round(Math.abs(t.amount) * 100));
    const amtMean = mean(amountsCents);
    if (amtMean <= 0) continue;
    if (amountsCents.length >= 2 && std(amountsCents) / amtMean > maxAmountCv) continue;
    // A subscription bills the SAME figure more than once — that is what makes
    // it a price and not a series of purchases. Replaces the old ±25% guard on
    // 2-occurrence streams, and closes the same hole for 3+ occurrences, where
    // repeated visits to one shop used to pass on cadence alone. A price change
    // survives it (13,99 x3 then 15,99 x2 still repeats 13,99); a usage-based
    // bill that is never twice the same does not, and is refused rather than
    // reported at a "monthly price" that was never charged.
    const timesCharged = new Map<number, number>();
    for (const c of amountsCents) timesCharged.set(c, (timesCharged.get(c) ?? 0) + 1);
    if (Math.max(...timesCharged.values()) < 2) continue;

    /* The price is the figure the stream REPEATS, not simply its first and last
     * row. Now that one merchant's charges are grouped together, a one-off from
     * the same merchant (a Simyo extra bundle, an app purchase at Apple) can sit
     * at either end of the group — and taken literally it would be printed as
     * "what you pay per month" and as a price change that never happened. */
    const repeats = (c: number) => (timesCharged.get(c) ?? 0) >= 2;
    const firstAmountCents = amountsCents.find(repeats) ?? amountsCents[0];
    let lastAmountCents = amountsCents[amountsCents.length - 1];
    if (!repeats(lastAmountCents)) {
      for (let i = amountsCents.length - 1; i >= 0; i--) {
        if (repeats(amountsCents[i])) { lastAmountCents = amountsCents[i]; break; }
      }
    }
    const changePct = firstAmountCents > 0 ? Math.round(((lastAmountCents - firstAmountCents) / firstAmountCents) * 1000) / 1000 : 0;
    const monthlyCents = Math.round((lastAmountCents * 30) / band.cadenceDays);

    subs.push({
      key,
      name: stream[0].counterparty,
      function: subscriptionFunction(stream[0].counterparty),
      cadenceDays: band.cadenceDays,
      monthlyCents,
      firstAmountCents,
      lastAmountCents,
      changePct,
      occurrences: stream.length,
      lastDate,
      skippedCycles: fit.skippedCycles,
    });
  }

  return subs.sort((a, b) => b.monthlyCents - a.monthlyCents);
}

export type PriceIncrease = { sub: Subscription; fromCents: number; toCents: number; changePct: number };

/** Subscriptions whose price rose meaningfully (>= 3% AND >= €0.50), so a
 *  one-cent rounding wobble isn't reported. */
export function subscriptionPriceIncreases(subs: Subscription[]): PriceIncrease[] {
  return subs
    .filter((s) => s.changePct >= 0.03 && s.lastAmountCents - s.firstAmountCents >= 50)
    .map((s) => ({ sub: s, fromCents: s.firstAmountCents, toCents: s.lastAmountCents, changePct: s.changePct }))
    .sort((a, b) => b.toCents - a.toCents);
}

/** Groups of >= 2 subscriptions sharing a known function (candidate duplicates,
 *  e.g. two videostreaming services). "Overig" is never grouped. Sorted by
 *  combined monthly cost, descending. */
export function subscriptionOverlaps(subs: Subscription[]): SubscriptionOverlap[] {
  const byFn = new Map<string, Subscription[]>();
  for (const s of subs) {
    if (s.function === "Overig") continue;
    const arr = byFn.get(s.function);
    if (arr) arr.push(s);
    else byFn.set(s.function, [s]);
  }
  const out: SubscriptionOverlap[] = [];
  for (const [fn, group] of byFn) {
    if (group.length < 2) continue;
    out.push({ function: fn, subs: group, monthlyCents: group.reduce((s, x) => s + x.monthlyCents, 0) });
  }
  return out.sort((a, b) => b.monthlyCents - a.monthlyCents);
}

/* ===========================================================================
 * The Betaalagenda's schedule detector.
 *
 * WHY THIS IS NOT `detectRecurringStreams` (forecast.ts) and not
 * `detectSubscriptions` above. The agenda used the forecast's detector, and the
 * three streams he named — Simyo, gemeentebelasting, DUO — were all missing.
 * Measured, not reasoned (app review 2, item 5); the causes were:
 *
 *  1. it groups on the VERBATIM normalized counterparty. A Dutch export does not
 *     repeat the name: one Simyo incasso arrives as "SIMYO B.V.",
 *     "Simyo B.V. 4839201" and "SIMYO", and the gemeente as "Gemeente
 *     Amsterdam", "GEMEENTE AMSTERDAM BELASTINGEN" and "Gem. Amsterdam
 *     Belastingen". Each stream shattered into groups of one, and a group of one
 *     is never recurring. `merchantKey` (above) already solved this for
 *     Optimalisatie — the agenda never got it.
 *  2. one skipped cycle kills it. A failed incasso in June turns the gaps into
 *     [31, 30, 61, 31], whose coefficient of variation is 0.41 — over the
 *     forecast's 0.35 limit, and only barely under the 0.4 here. Named as a
 *     known limit last round; measured as a live cause this round, so it is
 *     fixed rather than noted again: gaps are read in CYCLES (a 61-day gap is
 *     one skipped month), not as one flat distribution.
 *  3. DUO, "the government giving me money", is an INFLOW. The detector the
 *     agenda used does read inflows, but the merchant grouping it lacked is what
 *     split "DUO", "DUO Groningen" and "Dienst Uitvoering Onderwijs" apart.
 *
 * A schedule stream is also a different claim from a subscription: nothing here
 * is "cancellable", so the housing and person filters above do NOT apply — rent
 * to a private landlord is exactly a date on a payment agenda. What is filtered
 * is money moving inside his own house (savings sweeps, card settlements): those
 * are not payments due.
 *
 * Pure: integer cents, ISO-date arithmetic, `asOf` passed in.
 * ========================================================================= */

/** One recurring money movement the agenda may expect again, either direction. */
export type ScheduleStream = {
  /** Stable identity: payer/payee key + "|in" / "|out". */
  key: string;
  /** What to put on the row — the institution's name when we know it. */
  label: string;
  sign: 1 | -1;
  cadenceDays: number;
  /** Positive magnitude in cents: the figure the stream currently repeats. */
  amountCents: number;
  occurrences: number;
  lastDate: string;
  /** Cycles that were expected and never arrived inside the observed history.
   *  Kept because it is the difference between "monthly, seen 5×" and a stream
   *  the detector had to bend to accept. */
  skippedCycles: number;
};

/* Dutch institutions whose name is written a different way every month, and
 * whose payment is a fixed date on the agenda rather than a subscription. Each
 * row collapses every spelling onto one canonical identity and gives the row a
 * label a person would recognise.
 *
 * `any` is matched on a TOKEN boundary against the counterparty AND the
 * description (his item 6 in the same review: read the description, it is often
 * where the useful word is — "Gemeente Amsterdam" alone says nothing, but the
 * description says "Gemeentebelastingen termijn 4"). `needs`, when present, is a
 * plain substring that must also appear: the gemeente charges tax AND sells
 * parking, and only the first is a monthly agenda item. */
const INSTITUTIONS: ReadonlyArray<{ id: string; label: string; any: string[]; needs?: string[] }> = [
  { id: "duo", label: "DUO", any: ["duo", "dienst uitvoering onderwijs", "studiefinanciering"] },
  {
    id: "gemeentebelasting", label: "Gemeentebelasting", any: ["gemeente", "gem"],
    needs: ["belasting", "aanslag", "woz", "afvalstoffen", "rioolheffing", "hondenbelasting", "ozb"],
  },
  { id: "waterschapsbelasting", label: "Waterschapsbelasting", any: ["waterschap", "hoogheemraadschap"] },
  { id: "belastingdienst", label: "Belastingdienst", any: ["belastingdienst"] },
  { id: "cjib", label: "CJIB", any: ["cjib", "centraal justitieel"] },
  { id: "uwv", label: "UWV", any: ["uwv"] },
  { id: "svb", label: "SVB", any: ["sociale verzekeringsbank"] },
];

const INSTITUTION_MATCHERS = INSTITUTIONS.map((i) => ({
  ...i,
  res: i.any.map((a) => new RegExp(`(^|[^a-z0-9])${a.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^a-z0-9]|$)`)),
}));

/* Counterparties that are the owner's own money moving between his own places.
 * Matched on the COUNTERPARTY only: a rent payment often carries
 * "overschrijving" in its description while the counterparty is the landlord. */
const OWN_MONEY_HINTS = [
  "spaarrekening", "geld toegevoegd", "geld toevoegen", "eigen rekening",
  "overschrijving", "overboeking", "naar creditcard", "incasso ing creditcard",
];

/** The identity of the party on the other side of a recurring flow, and the name
 *  to show for it. Institution first (it collapses the most spellings), then the
 *  merchant key the subscription detector already uses. `key` is "" when the row
 *  carries no name at all — those are refused rather than shown nameless. */
export function scheduleParty(counterparty: string, description = ""): { key: string; label: string } {
  const cp = norm(counterparty);
  const ctx = `${cp} ${norm(description)}`;
  for (const inst of INSTITUTION_MATCHERS) {
    if (!inst.res.some((re) => re.test(ctx))) continue;
    if (inst.needs && !inst.needs.some((n) => ctx.includes(n))) continue;
    return { key: inst.id, label: inst.label };
  }
  return { key: merchantKey(cp), label: counterparty };
}

/* `fitCycles` used to live here — tolerance `max(4, 12% of cadence)`, every gap
 * a whole cycle, majority single cycles. It is `fitCadence` now, at the top of
 * this file, and `detectSubscriptions` calls the same one. What the agenda
 * gains from the move: a one-off charge from a party it already tracks (a
 * reminder fee, an extra bundle) no longer refuses the whole schedule row — it
 * is counted as a stray, within the same mean budget. What it loses: the
 * tolerance now comes from the band table instead of a formula next to it, so
 * monthly is 6 days wide instead of 4 and yearly 15 instead of 44. The yearly
 * number is the honest one — 44 days of slack made "a year, give or take six
 * weeks" a cadence. */

export type DetectScheduleOptions = {
  /** The day the answer is "as of" — decides which streams are still running.
   *  Defaults per account to the last date that account's data reaches, so the
   *  module stays pure and an older export is read on its own terms. */
  asOf?: string;
};

/** Recurring money movements the Betaalagenda may expect again — outgoing AND
 *  incoming, grouped per party (see `scheduleParty`), tolerant of a skipped
 *  cycle, and refused unless the amount is one the stream actually repeats.
 *
 *  Sorted by amount, descending, so the order is deterministic; the agenda
 *  re-sorts by date. */
export function detectScheduleStreams(txs: Tx[], opts: DetectScheduleOptions = {}): ScheduleStream[] {
  const accountEnd = new Map<string, string>();
  for (const t of txs) {
    if (!t.date) continue;
    const cur = accountEnd.get(t.accountKey);
    if (cur === undefined || t.date > cur) accountEnd.set(t.accountKey, t.date);
  }

  const groups = new Map<string, { txs: Tx[]; label: string }>();
  for (const t of txs) {
    if (t.amount === 0 || !t.date) continue;
    const party = scheduleParty(t.counterparty, t.description);
    if (party.key === "") continue;
    if (OWN_MONEY_HINTS.some((w) => norm(t.counterparty).includes(w))) continue;
    const key = `${party.key}|${t.amount >= 0 ? "in" : "out"}`;
    const g = groups.get(key);
    if (g) g.txs.push(t);
    else groups.set(key, { txs: [t], label: party.label });
  }

  const out: ScheduleStream[] = [];
  for (const [key, group] of groups) {
    const sorted = [...group.txs].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
    if (sorted.length < 2) continue;

    const fit = fitCadence(sorted.map((t) => t.date));
    if (fit === null) continue;
    const band = fit.band;
    const stream = fit.members.map((i) => sorted[i]);

    // Still running? A stopped stream keeps its cadence forever, and rolling it
    // forward would put a payment on the agenda that nobody is going to make.
    const lastDate = stream[stream.length - 1].date;
    let asOf = opts.asOf ?? "";
    if (asOf === "") for (const t of stream) {
      const end = accountEnd.get(t.accountKey) ?? "";
      if (end > asOf) asOf = end;
    }
    if (asOf !== "" && daysBetween(lastDate, asOf) > band.cadenceDays * 2 + 5) continue;

    /* The amount. An agenda that prints a figure nobody was ever charged is
     * worse than an agenda with one row fewer, so a stream must either repeat a
     * figure or be tight enough that its last charge IS the figure (a yearly
     * index-linked premium). Both are then reported as what it last actually
     * charged, never as an average. */
    const amountsCents = stream.map((t) => Math.round(Math.abs(t.amount) * 100));
    const amtMean = mean(amountsCents);
    if (amtMean <= 0) continue;
    const amtCv = std(amountsCents) / amtMean;
    if (amtCv > 0.35) continue;
    const timesCharged = new Map<number, number>();
    for (const c of amountsCents) timesCharged.set(c, (timesCharged.get(c) ?? 0) + 1);
    const repeats = (c: number) => (timesCharged.get(c) ?? 0) >= 2;
    if (Math.max(...timesCharged.values()) < 2 && amtCv > 0.1) continue;
    let amountCents = amountsCents[amountsCents.length - 1];
    if (!repeats(amountCents)) {
      for (let i = amountsCents.length - 1; i >= 0; i--) {
        if (repeats(amountsCents[i])) { amountCents = amountsCents[i]; break; }
      }
    }

    out.push({
      key,
      label: group.label,
      sign: stream[0].amount >= 0 ? 1 : -1,
      cadenceDays: band.cadenceDays,
      amountCents,
      occurrences: stream.length,
      lastDate,
      skippedCycles: fit.skippedCycles,
    });
  }

  return out.sort((a, b) => b.amountCents - a.amountCents || a.key.localeCompare(b.key));
}
