import type { Tx } from "./model.js";
import { norm } from "./hash.js";

/* Subscription detection for the Optimisatie tab. Distinct from the forecast's
 * detectRecurringStreams: that one REJECTS amount drift (to keep a clean
 * recurring signal), which would hide exactly the price increases we want to
 * surface here. This detector keeps the stream and reports its amount trend.
 * Pure + deterministic: integer cents, ISO-date day math via Date.UTC. */

export type Subscription = {
  /** Unique per stream: merchantKey(counterparty) + "|out|" + the repeating
   *  price in cents. The price is in there because one merchant can bill more
   *  than one stream — a phone subscription and the device credit next to it —
   *  and two rows sharing a key is a rendering bug, not a detail. Two streams
   *  at one merchant can never share a price: an amount is what groups them
   *  (see `fitMerchantStreams`). */
  key: string;
  /** The merchant behind the stream (`merchantKey`), without the direction or
   *  the price. Two streams at the SAME merchant are not two competing
   *  services, and `subscriptionOverlaps` needs to be able to see that. */
  merchant: string;
  name: string; // raw counterparty of the first occurrence
  function: string; // "Videostreaming" | "Muziekstreaming" | ... | "Overig"
  cadenceDays: number; // 30 | 61 | 91 | 182 | 365
  monthlyCents: number; // current price normalized to per-month (positive)
  firstAmountCents: number; // earliest REPEATING charge (the old price)
  lastAmountCents: number; // latest REPEATING charge (the current price)
  changePct: number; // (last - first) / first, rounded to 0.001
  occurrences: number;
  lastDate: string;
  /** Cycles that were expected inside the observed history and never arrived —
   *  a failed direct debit. Kept because "monthly, seen 5x" and "monthly, seen
   *  4x with one miss" are different claims, and because the empty-list
   *  explanation needs to be able to say which one it saw.
   *
   *  ONE EXCEPTION: when this stream came from the third reading in
   *  `fitMerchantStreams` (a bounded-outlier rescue), a "skipped" cycle means
   *  the DOMINANT price was not charged that month — a bundle or catch-up month
   *  billed something else — not that nothing was charged at all. */
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
  "bv",
  "nv",
  "vof",
  "cv",
  "bvba",
  "ltd",
  "llc",
  "inc",
  "gmbh",
  "ag",
  "sa",
  "sarl",
  "plc",
  "kg",
  "sepa",
  "incasso",
  "machtiging",
  "doorlopend",
  "doorlopende",
  "eenmalig",
  "eenmalige",
  "ideal",
  "bea",
  "gea",
  "betaling",
  "betaalautomaat",
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
    if (t.length < 2) continue; // initials, "b" + "v" of b.v.
    if (/^\d+$/.test(t)) continue; // invoice / customer number
    /* EEN NAAM MET EEN FILIAALNUMMER ERAAN VAST verliest alleen het nummer, niet
     * zichzelf. Gemeten in zijn eigen data (24 augustus): "MONOP4767" leverde een
     * LEGE sleutel op — negen afschrijvingen, EUR 763,54, en het scherm meldde
     * "geen naam op de regel" terwijl de naam er gewoon staat. Met een spatie
     * ertussen ("MONOP 4767") ging het al goed, dus het hing puur op de schrijfwijze
     * van de betaalautomaat.
     *
     * Minstens DRIE letters en minstens TWEE cijfers, en in die volgorde. Dat laat
     * "n26" met rust (twee letters) en "212" ook (geen letters vooraan) — namen
     * waar het cijfer deel van de naam IS. */
    const gesplitst = /^([a-z]{3,})\d{2,}$/.exec(t);
    if (gesplitst) {
      if (!NAME_NOISE_TOKENS.has(gesplitst[1])) kept.push(gesplitst[1]);
      continue;
    }
    if (/\d/.test(t) && t.length >= 4) continue; // "m0123456", "20260115"
    if (NAME_NOISE_TOKENS.has(t)) continue;
    kept.push(t);
  }
  return kept.join(" ");
}

/* Phrases (and IBAN shape) that mark a counterparty as a transfer/settlement,
 * not a subscription — so a recurring "Overschrijving naar <persoon>" or an
 * Amex/creditcard settlement is never listed as an abonnement. */
const TRANSFER_HINTS = [
  "overschrijving",
  "overboeking",
  "spaarrekening",
  "tikkie",
  "geld toegevoegd",
  "geld toevoegen",
  "kosten zakelijk",
  "american express",
  "incasso ing creditcard",
  "naar creditcard",
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
const PERSON_NAME =
  /^[a-z]\.\s?(?:[a-z]\.\s?)*(?:(?:van|van der|van den|van de|de|den|der|ten|ter|te|op|in|het) )?([a-z]{2,})$/;
/* Dutch companies are written with initials too — "A.S.R. Verzekeringen",
 * "D.A.S. Rechtsbijstand" — and an insurance premium IS a subscription. Stems,
 * because the plural and the compound both occur. */
const COMPANY_WORD_STEMS = [
  "verzeker",
  "assurant",
  "hypothe",
  "bank",
  "telecom",
  "mobile",
  "energie",
  "pensioen",
  "zorg",
  "groep",
  "group",
  "holding",
  "beheer",
  "vastgoed",
  "service",
  "system",
  "media",
  "fonds",
  "uitgever",
  "rechtsbijstand",
  "advocat",
  "notaris",
  "accountant",
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
  "huur",
  "verhuur",
  "hypothe",
  "vve",
  "vereniging van eigenaren",
  "woningstichting",
  "woningcorporatie",
  "woonstichting",
  "servicekosten",
];
const HOUSING_RES = HOUSING_HINTS.map((w) => new RegExp(`(^|[^a-z0-9])${w}`));
function looksLikeHousing(counterparty: string): boolean {
  const h = norm(counterparty);
  return HOUSING_RES.some((re) => re.test(h));
}

/** An ISO date as a whole day number (days since the epoch) via Date.UTC, so
 *  the arithmetic is locale- and TZ-safe. Date-only UTC timestamps are always
 *  exact multiples of a day, so this is an integer. */
function dayNumber(iso: string): number {
  const [y, m, d] = iso.split("-").map(Number);
  return Date.UTC(y, m - 1, d) / 86_400_000;
}

/** Whole days between two ISO dates via Date.UTC (locale/TZ-safe). */
function daysBetween(a: string, b: string): number {
  return dayNumber(b) - dayNumber(a);
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
const CADENCE_BANDS: ReadonlyArray<{
  cadenceDays: number;
  min: number;
  max: number;
  minOcc: number;
}> = [
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
 * merchant must fall on the rhythm. (Since 22 Aug a merchant is read one AMOUNT
 * at a time — `fitMerchantStreams` below — and the same budget is then also
 * checked over the merchant as a whole, because a budget read per amount group
 * would let a busy shop hand out one clean group at a time.) That is what keeps a shop he visits weekly
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

/** Why one chain attempt (one anchor, one band) came up empty — the same three
 *  gates `chainFrom` already enforced, now named instead of collapsed into a
 *  bare `null`. `explainMerchant` reads these to tell an owner which gate
 *  stopped a merchant, not just that one did.
 *
 *  `"gap"` is never produced by `chainFrom` itself — it is a `too-many-extras`
 *  reading that `fitMerchantStreams` re-labels, once it can see the group's own
 *  dates, when one dominant hole is what drove the extras count. Carried here
 *  rather than as a fifth field on `too-many-extras` so a plain reader of that
 *  kind never has to check a maybe-present gap that only one caller fills in. */
export type ChainFailure =
  | { kind: "too-few"; got: number; needed: number }
  | { kind: "majority-multi-cycle"; onCycle: number; totalGaps: number }
  | { kind: "too-many-extras"; extras: number; budget: number; totalMembers: number }
  | { kind: "gap"; gapDays: number };

/** One chain, anchored at `start`: greedy from cycle to cycle, but never greedy
 *  WITHIN a cycle — see the pick below. Exported nowhere: `fitCadence` tries
 *  every anchor and keeps the best. `failure` is populated at exactly the 3
 *  gates below that used to just `return null`; a successful chain still
 *  returns `failure: null`, so a caller can tell "not tried" from "tried and
 *  passed" from "tried and failed here". */
function chainFrom(
  days: number[],
  start: number,
  band: CadenceBand,
): { fit: CadenceFit | null; failure: ChainFailure | null } {
  const tol = bandTolerance(band);
  const members = [start];
  const gaps: number[] = [];
  let skippedCycles = 0;
  let residual = 0;
  let onCycle = 0;
  let last = start;
  for (let i = start + 1; i < days.length; i++) {
    const g = days[i] - days[last];
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
      for (let j = i + 1; j < days.length; j++) {
        const gj = days[j] - days[last];
        if (gj > target + tol) break;
        const dj = Math.abs(gj - target);
        if (dj < pickDrift) {
          pick = j;
          pickDrift = dj;
        }
      }
      members.push(pick);
      gaps.push(days[pick] - days[last]);
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
  if (members.length < band.minOcc)
    return { fit: null, failure: { kind: "too-few", got: members.length, needed: band.minOcc } };
  /* The majority must be SINGLE cycles. Without this a monthly stream fits a
   * weekly cadence arithmetically (30 ~ 4x7) while being nothing of the sort. */
  if (onCycle < Math.ceil(gaps.length / 2))
    return {
      fit: null,
      failure: { kind: "majority-multi-cycle", onCycle, totalGaps: gaps.length },
    };
  const extras = days.length - members.length;
  const budget = Math.floor(members.length / 3);
  if (extras > budget)
    return {
      fit: null,
      failure: { kind: "too-many-extras", extras, budget, totalMembers: members.length },
    };
  return { fit: { band, members, gaps, skippedCycles, extras, residual }, failure: null };
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
  return fitCadenceDays(sortedDates.map(dayNumber)).fit;
}

/** The one failing `(band, start)` attempt that got furthest, alongside the
 *  winner — see `fitCadenceDays`. */
type CadenceDaysResult = {
  fit: CadenceFit | null;
  /** The failing attempt that got furthest (most members) among every band and
   *  anchor tried, when nothing succeeded. Picking by member count is what
   *  makes this "furthest": the more members a broken chain still accumulated,
   *  the closer it reads to a real subscription that one gate refused, not
   *  noise. Ties prefer the shorter cadence — the bands are tried shortest
   *  first, so the earlier one already holds the record and is never displaced
   *  by an equal-length later one. Always computed; the cost is one comparison
   *  per attempt already being made, not a second search. */
  bestFailure: { failure: ChainFailure; band: CadenceBand; members: number } | null;
};

/** How many members an unsuccessful chain attempt got to before it failed —
 *  the "furthest" a broken chain reached, in the sense `CadenceDaysResult`
 *  describes. Read straight off the failure itself rather than re-derived: a
 *  `too-few` failure's `got` IS that count, a `majority-multi-cycle`'s
 *  `totalGaps` is one short of it, and `too-many-extras` already carries
 *  `totalMembers`. `"gap"` never comes out of `chainFrom`, so it scores 0 and
 *  can never win a comparison here. */
function failureMemberCount(failure: ChainFailure): number {
  switch (failure.kind) {
    case "too-few":
      return failure.got;
    case "majority-multi-cycle":
      return failure.totalGaps + 1;
    case "too-many-extras":
      return failure.totalMembers;
    case "gap":
      return 0;
  }
}

/* The same fitter on day numbers that were already parsed. It exists because
 * every date used to be re-parsed inside the innermost loop — `daysBetween`
 * splits two strings and builds two UTC timestamps — and that loop runs
 * O(anchors x rows x window) times. Measured on a synthetic vault of 2400 rows
 * with one 400-row supermarket in it, three runs each: `detectSubscriptions`
 * went from 1992/1996/2269 ms to 23/23/25 ms, on the same answers. That is a
 * pre-existing cost, not one the amount split introduced — but the split does
 * fit more series per merchant, so it is paid off here rather than left to grow.
 * It is the same arithmetic; only the parsing moved out of the loop. */
function fitCadenceDays(days: number[]): CadenceDaysResult {
  const maxStart = Math.floor(days.length / 4);
  let best: CadenceFit | null = null;
  let bestFailure: CadenceDaysResult["bestFailure"] = null;
  for (const band of CADENCE_BANDS) {
    if (days.length < band.minOcc) continue;
    for (let s = 0; s <= maxStart && s + band.minOcc <= days.length; s++) {
      const { fit, failure } = chainFrom(days, s, band);
      if (fit !== null && (best === null || betterFit(fit, best))) {
        best = fit;
      } else if (failure !== null) {
        const members = failureMemberCount(failure);
        if (bestFailure === null || members > bestFailure.members) {
          bestFailure = { failure, band, members };
        }
      }
    }
  }
  return { fit: best, bestFailure };
}

/* ===========================================================================
 * ONE MERCHANT IS NOT ONE STREAM — READ THE AMOUNT BEFORE THE RHYTHM.
 *
 * `merchantKey` put every Simyo row in one group, which is what fixed the
 * alternating spellings. It also created series H from the 21 Aug review: a
 * phone subscription of EUR 11,89 and the device credit of EUR 25,00 at the
 * SAME merchant, both monthly, halfway through each other's month. Measured on
 * those eight rows:
 *
 *   gaps over the heap : 14/17/15/15/16/16/15  -> median 15  (reads as biweekly)
 *   gaps per amount    : 31/30/32  and  32/31/31 -> median 31 each
 *
 * The old gate picked a band by that median of 15 and matched nothing. The
 * cycle fitter above does better — it skips the rows that are "too soon" and
 * lands on the EUR 11,89 chain of four — and then throws it away anyway,
 * because the four device charges are four strays against a budget of
 * `floor(4 / 3) = 1`. Either way: NOTHING, on a merchant with two perfectly
 * regular monthly debits. Not an edge case — a phone with a device, a gym with
 * a second pass, a streaming service with an extra profile all have this shape.
 *
 * WHAT IS NOT DONE HERE, deliberately: widening the tolerance. Letting 11,89
 * and 25,00 into one stream would forge an average of 18,45 that neither of
 * them is ever charged, and the tab would print a price nobody paid.
 *
 * WHAT IS DONE: group the merchant's rows by AMOUNT first, then read the rhythm
 * inside each group. Three guards keep that from becoming a subscription
 * factory — groceries at one supermarket repeat amounts too:
 *
 *  1. THE WHOLE GROUP GETS THE FIRST WORD. The split is only used when it
 *     explains STRICTLY MORE charges than reading the merchant as one stream
 *     does. So every merchant that already read as one subscription is
 *     untouched, and a stream whose amount alternates between two figures
 *     (2,50 / 2,55) stays ONE monthly stream instead of being halved into two
 *     two-monthly ones — the same mistake the alternating spellings made, in
 *     the amount dimension.
 *  2. A PRICE RISE IS NOT A SECOND STREAM. Two amount groups are put back
 *     together when the older one has finished before the newer one starts
 *     (they never interleave) and the step between them is at most
 *     `MAX_PRICE_STEP`. Netflix 13,99 x3 then 15,99 x2 is one subscription that
 *     got 14% more expensive, and `subscriptionPriceIncreases` has to keep
 *     seeing it. Merging can only ever move BACK toward the old whole-merchant
 *     group, so it cannot introduce anything the detector did not already
 *     accept yesterday.
 *  3. THE STRAY BUDGET IS READ OVER THE WHOLE MERCHANT, not per amount. This is
 *     the one that matters: `strays <= floor(claimed / 3)` counts every row at
 *     that merchant that no stream claimed. Twelve weekly groceries around
 *     three monthly charges of EUR 42,50 do carve out a clean amount group —
 *     and two more, because the weekly amounts repeat every five visits — but
 *     they claim 9 of 15 rows and leave 6 strays against a budget of 3, so the
 *     merchant is refused whole. The surrounding rows are the proof that this
 *     is a shop and not a biller, and that proof is lost the moment the budget
 *     is read per amount group. Series H leaves 0 strays out of 8.
 *
 * KNOWN MISS, stated rather than hidden: two streams at the same merchant for
 * the SAME amount (two gym passes at EUR 24,99) still read as one busy
 * merchant and yield nothing. Splitting those would mean peeling parallel
 * chains out of one pile of identical charges, and twenty weekly coffees of
 * EUR 5,00 peel into four "monthly subscriptions" that way. A miss costs an
 * insight; that would cost the tab.
 * ========================================================================= */

/** The largest step between two consecutive prices that still reads as the same
 *  subscription getting more (or less) expensive rather than a different
 *  charge. Measured against the real ones this has to survive: Netflix
 *  13,99 -> 15,99 is 0.143, his Simyo 11,89 -> 12,49 is 0.050. It is set well
 *  above those and still far below the case it must refuse — a EUR 500 one-off
 *  next to a EUR 10 monthly charge would drag the one-off back into the stream
 *  and its amount spread would then refuse the whole thing. */
const MAX_PRICE_STEP = 0.5;

/** The step allowed when the older group is a SINGLE charge. Measured why it has
 *  to be tighter than `MAX_PRICE_STEP`: five unrelated app purchases at one
 *  merchant (1,50 / 2,50 / 3,50 / 4,50 / 5,50, each on its own date) are all
 *  single charges and all time-disjoint, and every step between them is under
 *  0.5 — so the wide limit chained four of them into one "group" and the cycle
 *  fitter carved a three-charge monthly stream out of it. Downstream refused
 *  that stream (no amount in it repeats twice), but it had already counted 3
 *  rows as CLAIMED, and the stray budget is read on that number: the merchant
 *  passed a budget it had not earned. With the tight limit those five stay five
 *  strays and the merchant is refused whole.
 *
 *  What the tight limit still lets through, measured on his own shape: the
 *  FIRST charge of a stream at the old price. Simyo 11,89 once and then 12,49
 *  three times, next to the device credit, keeps all four charges in the stream
 *  (occurrences 4, not 3). The reported price change stays 0 there, and that is
 *  right — 11,89 was billed once, which is not an old price, it is a first
 *  invoice. */
const TIGHT_PRICE_STEP = 0.1;

/** The merchant's rows, indexed into the day/amount arrays, grouped by amount,
 *  with consecutive price steps put back together. Groups come out ordered by
 *  their first charge; indices inside a group stay ascending (= date order). */
function amountGroups(days: number[], amountsCents: number[]): number[][] {
  const byAmount = new Map<number, number[]>();
  for (let i = 0; i < amountsCents.length; i++) {
    const g = byAmount.get(amountsCents[i]);
    if (g) g.push(i);
    else byAmount.set(amountsCents[i], [i]);
  }
  /* First charge, then amount: two groups starting on the same day must still
   * come out in the same order on every machine. */
  const bare = [...byAmount.values()].sort(
    (x, y) => days[x[0]] - days[y[0]] || amountsCents[x[0]] - amountsCents[y[0]],
  );

  const merged: number[][] = [];
  for (const g of bare) {
    let into: number[] | null = null;
    let bestStep = Infinity;
    for (const open of merged) {
      /* Interleaving is the whole signal: a device credit runs ALONGSIDE the
       * subscription, a new price runs AFTER the old one. Same-day counts as
       * alongside — two amounts charged on one day are two things. */
      if (days[open[open.length - 1]] >= days[g[0]]) continue;
      const from = amountsCents[open[open.length - 1]];
      const step = Math.abs(amountsCents[g[0]] - from) / from;
      // A group that has already repeated may take a real price step; a lone
      // charge may only be joined by something within a hair of it.
      if (step > (open.length >= 2 ? MAX_PRICE_STEP : TIGHT_PRICE_STEP)) continue;
      if (step < bestStep) {
        bestStep = step;
        into = open;
      }
    }
    if (into) {
      into.push(...g);
      into.sort((a, b) => a - b);
    } else merged.push([...g]);
  }
  return merged;
}

/** The amount guard failing, reported with the actual number instead of just a
 *  boolean — `amountsCoherent` still only returns pass/fail, this is what a
 *  diagnosis needs on top of that. */
export type AmountSpreadFailure = { kind: "amount-spread"; cv: number; max: number };

/** The single most useful explanation for why a merchant's `streams` came back
 *  empty — see the selection order in `fitMerchantStreams`, which is
 *  deliberate and evaluated top to bottom, not "whichever is easiest to
 *  compute". Each source names WHICH reading was closest and WHY it still
 *  lost: the whole-merchant chain, the amount split, the bundle-month rescue,
 *  the merchant-wide stray budget, a same-day pile with no rhythm at all, or —
 *  should none of those apply — the plain "too few rows" the true fallback
 *  reports rather than throw. */
export type MerchantDiagnosis =
  | { source: "whole"; amountCents?: number; failure: ChainFailure | AmountSpreadFailure }
  | { source: "split"; amountCents: number; failure: ChainFailure | AmountSpreadFailure }
  | { source: "rescue"; failure: ChainFailure }
  | { source: "merchant-budget"; strays: number; claimed: number; budget: number }
  | { source: "same-day"; count: number }
  | { source: "none"; failure: { kind: "too-few"; got: number; needed: number } };

export type MerchantStreams = {
  /** The rhythms found at this merchant, most charges first. `members` index
   *  into the `sortedDates` that was passed in, not into an amount group. */
  streams: CadenceFit[];
  /** Rows at this merchant that no stream claimed. */
  strays: number;
  /** Whether the amount split was used at all — false means the merchant read
   *  as one stream and nothing about it changed. Reported so a test can pin
   *  WHICH mechanism produced the answer instead of only the answer. */
  splitByAmount: boolean;
  /** True only for the third reading (see `dominantPriceMembers`): `whole`'s
   *  own date chain, re-read with a bounded-outlier price tolerance. Absent
   *  (not `false`) for the other two — a test pinning the mechanism should be
   *  able to tell "not this one" from "explicitly no". */
  rescued?: true;
  /** Set only when `streams` is empty: the one explanation `explainMerchant`
   *  turns into a Dutch sentence. Computed on the failure path only — a
   *  merchant that DID become a stream pays nothing extra for this. */
  diagnostics?: MerchantDiagnosis;
};

/** Every subscription-shaped stream one merchant is billing, read amount-first.
 *  `sortedDates` must be ascending and `amountsCents` positive and aligned to
 *  it. Returns no streams at all when the merchant looks like a shop — see the
 *  budget in the comment above; it is a whole-merchant veto on purpose. */
/** The coefficient of variation of these members' amounts. `Infinity` for a
 *  non-positive mean, so a plain `<= maxCv` comparison refuses it the same way
 *  `amountsCoherent` always did — pulled out on its own because the diagnostics
 *  below need the actual number, not just whether it passed. */
function amountCv(members: number[], amountsCents: number[]): number {
  const xs = members.map((i) => amountsCents[i]);
  const m = xs.reduce((a, b) => a + b, 0) / xs.length;
  if (m <= 0) return Infinity;
  const sd = Math.sqrt(xs.reduce((a, c) => a + (c - m) ** 2, 0) / xs.length);
  return sd / m;
}

/** Houden de bedragen van deze leden genoeg verband om samen ÉÉN stroom te zijn?
 *
 *  Dezelfde toets die `detectSubscriptions` verderop doet, maar hier al nodig —
 *  zie de uitleg bij `useSplit` hieronder. De drempel wordt meegegeven zodat er
 *  geen tweede getal ontstaat dat op een dag afwijkt van het eerste. */
function amountsCoherent(members: number[], amountsCents: number[], maxCv: number): boolean {
  if (members.length < 2) return true;
  return amountCv(members, amountsCents) <= maxCv;
}

/* ===========================================================================
 * THE THIRD READING — a run of bundle months back to back.
 *
 * `whole` and `split` both look at ONE thing: whole reads the dates and ignores
 * price, split reads the price and re-derives the dates per amount. A phone bill
 * that adds a bundle for three months IN A ROW defeats both. Whole sees a clean,
 * ungapped monthly rhythm across all twelve rows and then fails on price spread
 * (0,366 against a 0,35 ceiling). Split carves out the nine EUR 11,89 rows
 * correctly, but on their OWN calendar those three bundle months are a single
 * 120-day hole — four cycles in one jump, and `MAX_SKIPPED_CYCLES` (2) calls
 * that a stopped stream, not a bumpy one. Rightly so for real silence (see
 * "twee gemiste incasso's..."): there the merchant billed NOTHING for three
 * months. Here it billed every month without fail, just not always EUR 11,89.
 *
 * The dates already answer that question, and `whole` already asked it: a
 * chain across every row, no skips, is exactly "billed every cycle". So when
 * neither the amount-blind nor the amount-first reading finds anything, take
 * `whole`'s already-proven cadence and re-read its price with the SAME bounded
 * tolerance the stray budget already uses elsewhere in this file: a minority
 * (at most a third) may sit off the dominant price and still be a subscription
 * with an occasional bundle or catch-up month, not a series of purchases. */
// Coupled with MAX_SKIPPED_CYCLES below by nothing but arithmetic: today's floor
// (kept >= 9, budget = 3) is exactly wide enough for a 3-row run and no wider —
// the majority-cycle check enforced below is what keeps a looser retuning of
// either constant from silently widening this past a real gap.
const OUTLIER_BUDGET = 3;

/** How far a member's price may sit from the mode and still count as "the same
 *  charge with a few cents of extras" rather than a different one. Measured
 *  against his real Simyo series (12 rows, mode 1189): the Dec row at 1210 and
 *  the May row at 1235 are a data-bundle rounding and a text message, 1.8% and
 *  3.9% over the mode — while the three real bundle months (2403/2734/2189)
 *  are 66-130% over. An exact-match test threw the small overages in with the
 *  real outliers: five of twelve read as "off-price", over the merchant's own
 *  third-budget, so the whole series was refused even with the outlier budget
 *  below. 5% keeps the phone bill's rounding in and the bundle months out. */
const DOMINANT_PRICE_TOLERANCE = 0.05;

/** The members that share the merchant's most-charged price (mode), or within
 *  `DOMINANT_PRICE_TOLERANCE` of it, or null when the mode never repeats (one
 *  busy month is not "occasional"). The mode itself is still the exact-count
 *  winner — only membership is widened, not which price wins. How MANY may be
 *  left out is not this function's call — the caller checks that the same way
 *  it already checks `wholeClaimed` and `splitClaimed`, against `claimed`, not
 *  against the count before filtering; a second budget here, on a different
 *  base, would only disagree with that one. */
function dominantPriceMembers(members: number[], amountsCents: number[]): number[] | null {
  const counts = new Map<number, number>();
  for (const i of members) counts.set(amountsCents[i], (counts.get(amountsCents[i]) ?? 0) + 1);
  let modeCents = -1;
  let modeCount = 0;
  for (const [cents, count] of counts) {
    if (count > modeCount || (count === modeCount && cents < modeCents)) {
      modeCents = cents;
      modeCount = count;
    }
  }
  if (modeCount < 2) return null;
  const tol = modeCents * DOMINANT_PRICE_TOLERANCE;
  return members.filter((i) => Math.abs(amountsCents[i] - modeCents) <= tol);
}

/** Gaps, skipped cycles and residual for an already-decided member list — the
 *  bookkeeping half of `chainFrom`, without its anchor search: the members are
 *  fixed here, only their stats are read off. `onCycle` is exposed too, because
 *  the third reading below has to apply `chainFrom`'s OWN majority-cycle rule
 *  by hand — nothing else here re-derives that invariant, so a fixed member
 *  list is not a substitute for it. */
function chainStats(days: number[], members: number[], cadenceDays: number) {
  const gaps: number[] = [];
  let skippedCycles = 0;
  let residual = 0;
  let onCycle = 0;
  for (let i = 1; i < members.length; i++) {
    const g = days[members[i]] - days[members[i - 1]];
    gaps.push(g);
    const k = Math.round(g / cadenceDays);
    skippedCycles += Math.max(0, k - 1);
    residual += Math.abs(g - k * cadenceDays);
    if (k === 1) onCycle++;
  }
  return { gaps, skippedCycles, residual, onCycle };
}

/** The diagnosis for an empty `fitMerchantStreams` result — cases 2 through 7
 *  of the selection order documented on `MerchantDiagnosis`. Case 1 (the
 *  merchant-budget veto on an otherwise-successful reading) and case 4's
 *  rescue attempt are both decided by the caller, which already holds the
 *  state they need; this only covers the cases that need nothing more than
 *  what it is handed. Evaluated top to bottom — the first case whose
 *  condition holds wins, and that order is deliberate (see the comment on
 *  `MerchantDiagnosis`), not "whichever is cheapest to compute". */
function diagnoseEmpty(
  days: number[],
  amountsCents: number[],
  maxAmountCv: number,
  whole: CadenceFit | null,
  wholeResult: CadenceDaysResult,
  splitAttempts: { idx: number[]; result: CadenceDaysResult }[],
  rescueDiagnosis: MerchantDiagnosis | null,
  merchantBudgetFailure: { strays: number; claimed: number; budget: number } | null,
): MerchantDiagnosis {
  // 1: an otherwise-successful reading (whole or split) that only lost on the
  // merchant-wide stray budget, and the rescue — already tried by the caller —
  // did not find a stream of its own either.
  if (merchantBudgetFailure !== null) {
    return { source: "merchant-budget", ...merchantBudgetFailure };
  }

  /* 4, checked here rather than after 2/3: `dominantPriceMembers` (rescue's
   * precondition) only ever fires on a price that already repeats exactly
   * `>= 2` times — and `amountGroups` always turns that same exact price into
   * its own group of `>= 2`, which unconditionally produces a case-2 or
   * case-3 candidate too (every group that size either succeeds, becomes a
   * `merchant-budget` case above, or leaves a `bestFailure` — see
   * `fitCadenceDays`). So whenever the rescue is even attempted, cases 2/3
   * ALWAYS also have something to say, and checking them first would make the
   * rescue's own verdict — the more specific of the two, since it is the read
   * that actually ran with the 5%-tolerant price band — unreachable. The
   * numbered list stays the intended reading order; only the code order moves,
   * for a `rescueDiagnosis` that exists precisely when the rescue was tried
   * and lost. */
  if (rescueDiagnosis !== null) return rescueDiagnosis;

  // 2: the whole-merchant chain found a rhythm, but its own amounts don't
  // agree closely enough.
  if (whole !== null && !amountsCoherent(whole.members, amountsCents, maxAmountCv)) {
    return {
      source: "whole",
      failure: {
        kind: "amount-spread",
        cv: amountCv(whole.members, amountsCents),
        max: maxAmountCv,
      },
    };
  }

  // 3: the best amount-group candidate — one that chained but drifted on
  // price, or one whose chain attempt failed outright. "Best" by the same
  // member-count heuristic `fitCadenceDays` already used for its own
  // `bestFailure`.
  let bestSplit: { members: number; diagnosis: MerchantDiagnosis } | null = null;
  for (const { idx, result } of splitAttempts) {
    const repCents = amountsCents[idx[0]];
    if (result.fit !== null) {
      const members = result.fit.members.map((i) => idx[i]);
      if (amountsCoherent(members, amountsCents, maxAmountCv)) continue; // claimed already, not a candidate
      const diagnosis: MerchantDiagnosis = {
        source: "split",
        amountCents: repCents,
        failure: { kind: "amount-spread", cv: amountCv(members, amountsCents), max: maxAmountCv },
      };
      if (bestSplit === null || members.length > bestSplit.members) {
        bestSplit = { members: members.length, diagnosis };
      }
      continue;
    }
    if (result.bestFailure === null) continue; // group too small for any band to even try
    const { failure, band, members: attempted } = result.bestFailure;
    // A `too-many-extras` failure reads as a run-of-the-mill scatter of
    // strays UNLESS one single hole in the group's own calendar is what
    // actually drove it — a bundle-month run like the one `dominantPriceMembers`
    // exists for, just too big for that rescue's own budget. Reported as the
    // gap itself then, not as an extras count nobody could picture.
    let diagnosis: MerchantDiagnosis = { source: "split", amountCents: repCents, failure };
    if (failure.kind === "too-many-extras") {
      const groupDays = idx.map((i) => days[i]);
      let maxGap = 0;
      for (let i = 1; i < groupDays.length; i++) {
        maxGap = Math.max(maxGap, groupDays[i] - groupDays[i - 1]);
      }
      if (maxGap >= band.cadenceDays * (MAX_SKIPPED_CYCLES + 2)) {
        diagnosis = {
          source: "split",
          amountCents: repCents,
          failure: { kind: "gap", gapDays: maxGap },
        };
      }
    }
    if (bestSplit === null || attempted > bestSplit.members) {
      bestSplit = { members: attempted, diagnosis };
    }
  }
  if (bestSplit !== null) return bestSplit.diagnosis;

  // 5: nothing chained anywhere, not even partially — the only rhythm left
  // to name is "these landed on the same day".
  if (whole === null && splitAttempts.every(({ result }) => result.fit === null)) {
    const dateCounts = new Map<number, number>();
    for (const d of days) dateCounts.set(d, (dateCounts.get(d) ?? 0) + 1);
    let maxSameDay = 0;
    for (const c of dateCounts.values()) maxSameDay = Math.max(maxSameDay, c);
    if (maxSameDay >= 2) return { source: "same-day", count: maxSameDay };
  }

  // 6: whichever bare failed attempt — the whole-merchant chain or the best
  // split group — got furthest, in that priority order.
  if (wholeResult.bestFailure !== null) {
    return { source: "whole", failure: wholeResult.bestFailure.failure };
  }
  let bestSplitFailure: { members: number; amountCents: number; failure: ChainFailure } | null =
    null;
  for (const { idx, result } of splitAttempts) {
    if (result.bestFailure === null) continue;
    if (bestSplitFailure === null || result.bestFailure.members > bestSplitFailure.members) {
      bestSplitFailure = {
        members: result.bestFailure.members,
        amountCents: amountsCents[idx[0]],
        failure: result.bestFailure.failure,
      };
    }
  }
  if (bestSplitFailure !== null) {
    return {
      source: "split",
      amountCents: bestSplitFailure.amountCents,
      failure: bestSplitFailure.failure,
    };
  }

  // 7: true fallback — should be unreachable given the merchant already has
  // at least 2 rows by the time `detectSubscriptions` calls in, but a
  // diagnosis function does not get to throw.
  return {
    source: "none",
    failure: {
      kind: "too-few",
      got: days.length,
      needed: Math.min(...CADENCE_BANDS.map((b) => b.minOcc)),
    },
  };
}

export function fitMerchantStreams(
  sortedDates: string[],
  amountsCents: number[],
  maxAmountCv = 0.35,
): MerchantStreams {
  const days = sortedDates.map(dayNumber);
  const wholeResult = fitCadenceDays(days);
  const whole = wholeResult.fit;

  /* WAT "VERKLAREN" BETEKENT, en hier zat de fout die zijn Simyo twaalf keer op
   * rij onzichtbaar hield.
   *
   * Zijn eigen cijfers: 12 afschrijvingen, ritme 29 dagen, bedragspreiding 0,36
   * tegen een grens van 0,35. Negen keer het abonnement en drie keer met een
   * bundel erbij — twee keurige maandstromen. De splitsing verklaarde 9 + 3 = 12
   * en de hele winkel ook 12, dus "strikt meer" was onwaar en de hele winkel won.
   * Waarna diezelfde hele winkel verderop op de bedragspreiding sneuvelde en er
   * NIETS overbleef. De lezing die het wél zou halen verloor van een lezing die
   * daarna zelf werd afgekeurd.
   *
   * Een stroom waarvan de bedragen niet bij elkaar horen verklaart die
   * afschrijvingen dus niet, en telt hier niet mee. De grendel zelf blijft staan:
   * een splitsing moet nog steeds strikt meer verklaren, alleen meet dat nu het
   * juiste. Er komt hierdoor niets nieuws binnen dat niet ook op eigen kracht door
   * de bedragstoets komt — een restaurant met wisselende rekeningen faalt in
   * beide lezingen. */
  const wholeClaimed =
    whole === null || !amountsCoherent(whole.members, amountsCents, maxAmountCv)
      ? 0
      : whole.members.length;

  const split: CadenceFit[] = [];
  // Kept alongside `split`, not just folded into it: the diagnostics path
  // below reads `result.bestFailure` off every attempt, including the ones
  // that never became a stream — data `fitCadenceDays` already computed, so
  // retaining it here costs nothing extra on the success path.
  const splitAttempts: { idx: number[]; result: CadenceDaysResult }[] = [];
  let splitClaimed = 0;
  for (const idx of amountGroups(days, amountsCents)) {
    const result = fitCadenceDays(idx.map((i) => days[i]));
    splitAttempts.push({ idx, result });
    const fit = result.fit;
    if (fit === null) continue;
    // Back to the merchant's own indices; everything downstream reads rows, not
    // amount groups.
    const members = fit.members.map((i) => idx[i]);
    if (!amountsCoherent(members, amountsCents, maxAmountCv)) continue;
    split.push({ ...fit, members });
    splitClaimed += fit.members.length;
  }

  const useSplit = splitClaimed > wholeClaimed;
  const streams = useSplit ? split : whole === null ? [] : [whole];
  const claimed = useSplit ? splitClaimed : wholeClaimed;
  const strays = sortedDates.length - claimed;
  const budget = Math.floor(claimed / 3);
  if (streams.length > 0 && strays <= budget) {
    streams.sort((a, b) => b.members.length - a.members.length || a.members[0] - b.members[0]);
    return { streams, strays, splitByAmount: useSplit };
  }

  /* Selection 1 (see `MerchantDiagnosis`) applies exactly when this first pass
   * had an OTHERWISE-SUCCESSFUL reading that only lost on the merchant-wide
   * stray budget — gated on `claimed > 0`, not the raw `streams.length > 0`:
   * `streams` itself is `[whole]` the moment `whole !== null`, even when
   * `whole`'s own amounts are incoherent and `wholeClaimed` is 0 — a quirk the
   * pre-existing code carried harmlessly (the `strays <= budget` check right
   * below always failed for it anyway) but that would wrongly swallow case 2
   * (an incoherent `whole`) if used here as its literal length. `claimed > 0`
   * is what "otherwise-successful" actually means: something really did chain
   * AND agree on price, and only the whole-merchant total sank it.
   *
   * It is not returned here, though: the rescue below must still get its turn
   * even when this holds, precisely as it always did — the rescue can only
   * find a stream where the first two came up empty, and "over budget" is
   * empty for this purpose too. Carried into `diagnoseEmpty` instead, where
   * it is checked first, ahead of every other case, but only once rescue has
   * also had its shot. */
  const merchantBudgetFailure = claimed > 0 ? { strays, claimed, budget } : null;

  // The third reading — see the block comment above `dominantPriceMembers`.
  // Only tried once the first two have nothing: it can never take a stream away
  // from either, only find one where both came up empty. It is not `split` —
  // no amount-grouping ran to produce it — so it is reported as
  // `splitByAmount: false, rescued: true`, a mechanism of its own.
  let rescueDiagnosis: MerchantDiagnosis | null = null;
  if (whole !== null) {
    const kept = dominantPriceMembers(whole.members, amountsCents);
    if (kept !== null && kept.length >= whole.band.minOcc) {
      const rescueStrays = sortedDates.length - kept.length;
      const stats = chainStats(days, kept, whole.band.cadenceDays);
      // `chainStats` only tallies; it applies none of `chainFrom`'s sanity
      // checks. Enforce the one that matters by hand: a majority of the KEPT
      // sequence's own gaps must be single-cycle, same as `chainFrom` requires
      // of any chain it builds. Without this, `kept` could be a scatter of
      // rows that only individually happen to share a price, held together by
      // nothing — the outlier-count budget above bounds how MANY are missing,
      // not how they are arranged, and a widened `OUTLIER_BUDGET` or
      // `MAX_SKIPPED_CYCLES` must not be able to smuggle that scatter through.
      const majorityOnCycle = stats.onCycle >= Math.ceil(stats.gaps.length / 2);
      const rescueBudget = Math.floor(kept.length / OUTLIER_BUDGET);
      if (rescueStrays <= rescueBudget && majorityOnCycle) {
        const fit: CadenceFit = {
          band: whole.band,
          members: kept,
          extras: whole.members.length - kept.length,
          gaps: stats.gaps,
          skippedCycles: stats.skippedCycles,
          residual: stats.residual,
        };
        return { streams: [fit], strays: rescueStrays, splitByAmount: false, rescued: true };
      }
      rescueDiagnosis = {
        source: "rescue",
        failure: !majorityOnCycle
          ? { kind: "majority-multi-cycle", onCycle: stats.onCycle, totalGaps: stats.gaps.length }
          : {
              kind: "too-many-extras",
              extras: rescueStrays,
              budget: rescueBudget,
              totalMembers: kept.length,
            },
      };
    }
  }

  return {
    streams: [],
    strays,
    splitByAmount: useSplit,
    diagnostics: diagnoseEmpty(
      days,
      amountsCents,
      maxAmountCv,
      whole,
      wholeResult,
      splitAttempts,
      rescueDiagnosis,
      merchantBudgetFailure,
    ),
  };
}

/** Euro's op de Nederlandse manier — een eigen kopie van de formatter die
 *  netBenefit.ts en travel.ts allebei al privé hebben, om dezelfde reden: dit
 *  bestand importeren zou daar een cirkel maken, en een gedeelde module met
 *  één functie erin is meer machinerie dan twee regels dubbel. */
function euro(cents: number): string {
  return `€ ${(Math.round(cents) / 100).toFixed(2).replace(".", ",")}`;
}

/** One `ChainFailure` in Dutch. Shared by `whole`/`split` diagnoses (which
 *  carry the group's own representative price for the `"gap"` case) and, as a
 *  defensive fallback, by `"rescue"` (which in practice only ever constructs
 *  `majority-multi-cycle` or `too-many-extras` — see `fitMerchantStreams` —
 *  but its type is the general `ChainFailure`, so this stays exhaustive rather
 *  than assumed). */
function chainFailureText(f: ChainFailure, amountCents: number | undefined): string {
  switch (f.kind) {
    case "too-few":
      return `te weinig afschrijvingen (${f.got} < ${f.needed})`;
    case "majority-multi-cycle":
      return "meerderheid van de gaten is meercyclus";
    case "too-many-extras":
      return `te veel afwijkende afschrijvingen (${f.extras} van ${f.totalMembers}, max ${f.budget})`;
    case "gap":
      return `gat van ${f.gapDays} dagen in de reeks van ${euro(amountCents ?? 0)}`;
  }
}

/** A `MerchantDiagnosis` in one Dutch sentence — the vocabulary `explainMerchant`
 *  reads off `fitMerchantStreams`'s empty-path diagnosis. Exact strings match
 *  what the coordinator asked for; tests assert against them verbatim. */
function diagnosisText(d: MerchantDiagnosis): string {
  switch (d.source) {
    case "merchant-budget":
      return `${d.strays} van ${d.claimed + d.strays} afschrijvingen horen nergens bij (max ${d.budget} toegestaan)`;
    case "same-day":
      return `${d.count} afschrijvingen op één dag`;
    case "none":
      return "geen ritme herkend";
    case "rescue": {
      const f = d.failure;
      if (f.kind === "majority-multi-cycle")
        return "reddingslezing: meerderheid van de gaten is meercyclus";
      if (f.kind === "too-many-extras")
        return `reddingslezing: ${f.extras} van ${f.totalMembers} maanden wijken af (max ${f.budget} toegestaan)`;
      return `reddingslezing: ${chainFailureText(f, undefined)}`;
    }
    case "whole":
    case "split": {
      const f = d.failure;
      if (f.kind === "amount-spread")
        return `prijsspreiding ${f.cv.toFixed(2)} boven ${f.max.toFixed(2)}`;
      return chainFailureText(f, d.amountCents);
    }
  }
}

/** Waarom deze reeks GEEN abonnement opleverde, in één Nederlandse zin — of
 *  `null` als hij dat wél zou doen, want dan is er niets te verklaren.
 *
 *  Leest de echte detector, niet een tweede afgeleide versie ervan: eerst
 *  `fitMerchantStreams` zelf (dezelfde cadans-/bedraggrendels als
 *  `detectSubscriptions`), en als die WEL een stroom vond, dezelfde drie
 *  na-controles die `detectSubscriptions` op zijn beste stroom loslaat
 *  (nog lopend, herhaalt het bedrag, bedragspreiding) — hier herhaald in
 *  plaats van herschreven, om precies de reden die dit bestand al vijf keer
 *  citeert: een kopie loopt op den duur op precies dezelfde manier uit elkaar. */
export function explainMerchant(
  sortedDates: string[],
  amountsCents: number[],
  maxAmountCv: number,
  asOf: string,
): string | null {
  const result = fitMerchantStreams(sortedDates, amountsCents, maxAmountCv);
  if (result.streams.length === 0) {
    return result.diagnostics ? diagnosisText(result.diagnostics) : "geen ritme herkend";
  }

  let best = result.streams[0];
  for (const s of result.streams) {
    if (s.members.length > best.members.length) best = s;
    else if (s.members.length === best.members.length && s.members[0] < best.members[0]) best = s;
  }
  const band = best.band;
  const streamAmounts = best.members.map((i) => amountsCents[i]);
  const lastDate = sortedDates[best.members[best.members.length - 1]];

  // Nog lopend? Zelfde grens als `detectSubscriptions`: twee overgeslagen
  // cycli plus wat speling.
  const daysAgo = daysBetween(lastDate, asOf);
  if (daysAgo > band.cadenceDays * 2 + 5) return `laatste afschrijving ${daysAgo} dagen geleden`;

  // Herhaalt het bedrag zich? Eén keer is een prijs die nooit is bevestigd.
  const timesCharged = new Map<number, number>();
  for (const c of streamAmounts) timesCharged.set(c, (timesCharged.get(c) ?? 0) + 1);
  if (Math.max(...timesCharged.values()) < 2) return "geen enkel bedrag komt twee keer voor";

  // Laatste bedragspreiding-controle: `amountsCoherent` heeft dit al bovenstrooms
  // gecheckt, maar de reddingslezing controleert `kept` daar zelf niet op — dus
  // deze grendel blijft staan, ook al vuurt hij zelden.
  const amtMean = mean(streamAmounts);
  if (streamAmounts.length >= 2 && amtMean > 0) {
    const cv = std(streamAmounts) / amtMean;
    if (cv > maxAmountCv) return `prijsspreiding ${cv.toFixed(2)} boven ${maxAmountCv.toFixed(2)}`;
  }

  return null;
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
/** Wat de detector ZAG, per ontvanger, met de grondslag die hij zelf gebruikt.
 *
 *  WAAROM DIT BESTAAT. Op 22 augustus meldde de eigenaar: 382 dagen afschrift,
 *  813 uitgaande transacties, 286 ontvangers, 85 daarvan minstens twee keer
 *  betaald — en NUL abonnementen. Dat is geen randgeval, en het scherm kon niet
 *  zeggen waarom, want het lijstje regels eronder is een samenvatting en geen
 *  meting.
 *
 *  Erger nog: die 286 en 85 werden geteld op de RUWE tegenpartijtekst
 *  (`counterparty.trim().toLowerCase()`), terwijl deze detector groepeert op
 *  `merchantKey` NA `norm`, en daarvoor rijen weggooit die op een overboeking,
 *  een persoon of een woonlast lijken. Twee verschillende groeperingen, dus het
 *  getal op het scherm beschreef een andere vraag dan de zin eronder suggereerde.
 *
 *  Deze functie staat daarom IN dit bestand: ze deelt de norm, de merchantKey en
 *  de uitsluitingen met de detector. Een kopie in de UI zou op precies dezelfde
 *  manier uit elkaar lopen — en dat is in deze repo al vijf keer gebeurd.
 *
 *  Ze geeft GEEN oordeel over waarom iets afvalt; ze geeft de cijfers waarmee de
 *  eigenaar dat zelf kan zien: hoeveel afschrijvingen, over welke periode, wat de
 *  mediaan van de gaten is en hoe wild het bedrag springt. Dat is genoeg om in
 *  één blik te zien of iets een ritme HEEFT. */
export type MerchantTally = {
  merchant: string;
  /** De tegenpartij zoals de bank hem schreef, van de laatste afschrijving. */
  label: string;
  charges: number;
  totalCents: number;
  firstDate: string;
  lastDate: string;
  /** Mediaan van de gaten in dagen, of null bij één afschrijving. */
  medianGapDays: number | null;
  /** Spreiding van de bedragen (variatiecoefficient), of null bij één. */
  amountCv: number | null;
  /** Waarom deze ontvanger de detector niet eens haalt, of null. */
  excluded: "overboeking-of-persoon" | "woonlast" | "geen-naam" | null;
  /** Waarom deze ontvanger, ondanks een naam die de detector wél accepteert,
   *  geen abonnement opleverde — of null als hij dat wel deed, of als
   *  `excluded` de vraag al beantwoordt. */
  reason: string | null;
};

export function merchantTallies(txs: Tx[]): MerchantTally[] {
  // Zelfde grondslag als `detectSubscriptions`'s "nog lopend"-controle: per
  // rekening het laatste afschrift, niet het laatste in de hele kluis — anders
  // zou een oudere ING-export elk Simyo-abonnement als opgezegd verklaren
  // terwijl er gewoon een verser Amex-bestand naast ligt.
  const accountEnd = new Map<string, string>();
  for (const t of txs) {
    if (!t.date) continue;
    const cur = accountEnd.get(t.accountKey);
    if (cur === undefined || t.date > cur) accountEnd.set(t.accountKey, t.date);
  }

  const groups = new Map<
    string,
    { label: string; rows: Tx[]; excluded: MerchantTally["excluded"] }
  >();
  for (const t of txs) {
    if (t.amount >= 0) continue;
    const h = norm(t.counterparty);
    let excluded: MerchantTally["excluded"] = null;
    if (knownMerchant(h) === null) {
      if (looksLikeTransfer(h)) excluded = "overboeking-of-persoon";
      else if (looksLikeHousing(h)) excluded = "woonlast";
    }
    const merchant = merchantKey(h);
    // Een lege sleutel is geen ontvanger; hij zou alle naamloze rijen tot één
    // spookontvanger smeden. Wel apart geteld, want "geen naam" is een antwoord.
    const key = merchant === "" ? "\u0000geen-naam" : merchant;
    const g = groups.get(key);
    if (g) {
      g.rows.push(t);
      g.label = t.counterparty || g.label;
    } else {
      groups.set(key, {
        label: t.counterparty,
        rows: [t],
        excluded: merchant === "" ? "geen-naam" : excluded,
      });
    }
  }

  const out: MerchantTally[] = [];
  for (const [key, g] of groups) {
    const sorted = [...g.rows].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
    const cents = sorted.map((t) => Math.round(Math.abs(t.amount) * 100));
    const gaps: number[] = [];
    for (let i = 1; i < sorted.length; i++) {
      gaps.push(
        Math.round((Date.parse(sorted[i].date) - Date.parse(sorted[i - 1].date)) / 86400000),
      );
    }
    const med = (xs: number[]): number | null => {
      if (xs.length === 0) return null;
      const s = [...xs].sort((a, b) => a - b);
      const m = Math.floor(s.length / 2);
      return s.length % 2 === 1 ? s[m] : Math.round((s[m - 1] + s[m]) / 2);
    };
    const mean = cents.reduce((a, b) => a + b, 0) / cents.length;
    const sd = Math.sqrt(cents.reduce((a, c) => a + (c - mean) ** 2, 0) / cents.length);
    // `asOf` per merchant, niet globaal: het maximum van de accounts die deze
    // ontvanger zelf raakt, dezelfde grondslag als hierboven — een ontvanger die
    // alleen op de oude ING-export voorkomt hoort niet "nog lopend" getoetst te
    // worden tegen de datum van een Amex-bestand waar hij nooit in stond.
    let asOf = "";
    for (const t of sorted) {
      const end = accountEnd.get(t.accountKey) ?? "";
      if (end > asOf) asOf = end;
    }
    out.push({
      merchant: key.startsWith("\u0000") ? "" : key,
      label: g.label,
      charges: sorted.length,
      totalCents: cents.reduce((a, b) => a + b, 0),
      firstDate: sorted[0].date,
      lastDate: sorted[sorted.length - 1].date,
      medianGapDays: med(gaps),
      amountCv: cents.length > 1 && mean > 0 ? Math.round((sd / mean) * 1000) / 1000 : null,
      excluded: g.excluded,
      reason:
        g.excluded === null
          ? explainMerchant(
              sorted.map((t) => t.date),
              cents,
              0.35,
              asOf,
            )
          : null,
    });
  }
  /* GESORTEERD OP HOE ABONNEMENT-ACHTIG iets is, niet op bedrag. Dat was mijn
   * eerste keuze en die was fout: op totaalbedrag komen huur, verzekeringen en de
   * supermarkt bovenaan, en een telefoonabonnement van 11,89 per maand — 143 euro
   * over een jaar — haalt de eerste vijftien nooit. Terwijl dat precies is waar
   * iemand naar zoekt als hij deze tabel opent.
   *
   * De score is bewust grof en gaat over VORM: ligt de mediaan van de gaten bij
   * een van de banden, en springt het bedrag weinig. Dat zijn de twee dingen die
   * een abonnement van een reeks losse aankopen scheiden. Bij gelijke score wint
   * het aantal afschrijvingen, en pas daarna het bedrag. */
  const bandAfstand = (gap: number | null): number => {
    if (gap === null) return 999;
    let best = 999;
    for (const b of CADENCE_BANDS)
      best = Math.min(best, Math.abs(gap - b.cadenceDays) / b.cadenceDays);
    return best;
  };
  return out.sort((a, b) => {
    const sa = bandAfstand(a.medianGapDays) + (a.amountCv ?? 1);
    const sb = bandAfstand(b.medianGapDays) + (b.amountCv ?? 1);
    if (Math.abs(sa - sb) > 1e-9) return sa - sb;
    if (a.charges !== b.charges) return b.charges - a.charges;
    return b.totalCents - a.totalCents;
  });
}

export function detectSubscriptions(
  txs: Tx[],
  opts: DetectSubscriptionOptions = {},
): Subscription[] {
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

  const groups = new Map<string, { merchant: string; txs: Tx[] }>();
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
    const g = groups.get(merchant);
    if (g) g.txs.push(t);
    else groups.set(merchant, { merchant, txs: [t] });
  }

  const subs: Subscription[] = [];
  for (const [merchant, group] of groups) {
    if (group.txs.length < 2) continue;
    const sorted = [...group.txs].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

    /* The rhythms, read by the same function the Betaalagenda uses, and read
     * per AMOUNT rather than over the whole merchant — see the block comment at
     * `fitMerchantStreams`. Two things follow from that. One merchant can now
     * produce more than one subscription (his Simyo bill and the device credit
     * next to it, which together gave NOTHING before). And everything below
     * this line looks at `stream` — the charges that ARE this subscription —
     * not at every row the merchant produced, so the price is read off the
     * stream and `occurrences` counts what was actually billed on the cadence. */
    const groupAmounts = sorted.map((t) => Math.round(Math.abs(t.amount) * 100));
    const { streams } = fitMerchantStreams(
      sorted.map((t) => t.date),
      groupAmounts,
      maxAmountCv,
    );

    for (const fit of streams) {
      const band = fit.band;
      const stream = fit.members.map((i) => sorted[i]);

      // Still being paid? A cancelled stream keeps its cadence and its history
      // forever, so without this the tab lists what he USED to pay as what he
      // pays. Two missed cycles (plus a few days' slack for a weekend shift) is
      // the line: one skipped charge is a billing hiccup, two is a cancellation.
      const lastDate = stream[stream.length - 1].date;
      let asOf = opts.asOf ?? "";
      if (asOf === "")
        for (const t of stream) {
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
          if (repeats(amountsCents[i])) {
            lastAmountCents = amountsCents[i];
            break;
          }
        }
      }
      const changePct =
        firstAmountCents > 0
          ? Math.round(((lastAmountCents - firstAmountCents) / firstAmountCents) * 1000) / 1000
          : 0;
      const monthlyCents = Math.round((lastAmountCents * 30) / band.cadenceDays);

      subs.push({
        // The price is part of the identity now: one merchant, two streams, and
        // a shared key would have collapsed them into one row on screen.
        key: `${merchant}|out|${lastAmountCents}`,
        merchant,
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
  }

  // Key as the tie-breaker: a merchant can now contribute more than one row, and
  // two rows at the same monthly cost must not swap places between renders.
  return subs.sort((a, b) => b.monthlyCents - a.monthlyCents || a.key.localeCompare(b.key));
}

export type PriceIncrease = {
  sub: Subscription;
  fromCents: number;
  toCents: number;
  changePct: number;
};

/** Subscriptions whose price rose meaningfully (>= 3% AND >= €0.50), so a
 *  one-cent rounding wobble isn't reported. */
export function subscriptionPriceIncreases(subs: Subscription[]): PriceIncrease[] {
  return subs
    .filter((s) => s.changePct >= 0.03 && s.lastAmountCents - s.firstAmountCents >= 50)
    .map((s) => ({
      sub: s,
      fromCents: s.firstAmountCents,
      toCents: s.lastAmountCents,
      changePct: s.changePct,
    }))
    .sort((a, b) => b.toCents - a.toCents);
}

/** Groups of >= 2 subscriptions sharing a known function (candidate duplicates,
 *  e.g. two videostreaming services). "Overig" is never grouped. Sorted by
 *  combined monthly cost, descending.
 *
 *  ONE STREAM PER MERCHANT COUNTS. Since a merchant can bill two streams (the
 *  Simyo subscription and the Simyo device credit), a plain grouping by function
 *  would print "2 x Mobiel abonnement: Simyo + Simyo — cancel one and save EUR
 *  300 a year". Both halves of that are false: they are not two services, and
 *  the device credit cannot be cancelled. So one stream represents its merchant
 *  and it takes two DIFFERENT merchants to make an overlap.
 *
 *  Which one represents it: the SMALLEST. This block prints a saving, and when
 *  a merchant runs two streams nothing in the data says which of them is the
 *  cancellable service — the device credit is often the bigger figure. Taking
 *  the smallest under-claims the saving instead of promising money he cannot
 *  free up by cancelling. */
export function subscriptionOverlaps(subs: Subscription[]): SubscriptionOverlap[] {
  const byFn = new Map<string, Map<string, Subscription>>();
  for (const s of subs) {
    if (s.function === "Overig") continue;
    let perMerchant = byFn.get(s.function);
    if (!perMerchant) {
      perMerchant = new Map();
      byFn.set(s.function, perMerchant);
    }
    const held = perMerchant.get(s.merchant);
    if (
      held === undefined ||
      s.monthlyCents < held.monthlyCents ||
      (s.monthlyCents === held.monthlyCents && s.key < held.key)
    )
      perMerchant.set(s.merchant, s);
  }
  const out: SubscriptionOverlap[] = [];
  for (const [fn, perMerchant] of byFn) {
    if (perMerchant.size < 2) continue;
    const group = [...perMerchant.values()];
    out.push({
      function: fn,
      subs: group,
      monthlyCents: group.reduce((s, x) => s + x.monthlyCents, 0),
    });
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
  /** Stable identity: payer/payee key + "|in" / "|out" + the repeating amount
   *  in cents. The amount is in there because one party can run two streams
   *  (a subscription and a device credit at the same provider) and the agenda
   *  keys its rows on this. */
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
const INSTITUTIONS: ReadonlyArray<{ id: string; label: string; any: string[]; needs?: string[] }> =
  [
    { id: "duo", label: "DUO", any: ["duo", "dienst uitvoering onderwijs", "studiefinanciering"] },
    {
      id: "gemeentebelasting",
      label: "Gemeentebelasting",
      any: ["gemeente", "gem"],
      needs: [
        "belasting",
        "aanslag",
        "woz",
        "afvalstoffen",
        "rioolheffing",
        "hondenbelasting",
        "ozb",
      ],
    },
    {
      id: "waterschapsbelasting",
      label: "Waterschapsbelasting",
      any: ["waterschap", "hoogheemraadschap"],
    },
    { id: "belastingdienst", label: "Belastingdienst", any: ["belastingdienst"] },
    { id: "cjib", label: "CJIB", any: ["cjib", "centraal justitieel"] },
    { id: "uwv", label: "UWV", any: ["uwv"] },
    { id: "svb", label: "SVB", any: ["sociale verzekeringsbank"] },
  ];

const INSTITUTION_MATCHERS = INSTITUTIONS.map((i) => ({
  ...i,
  res: i.any.map(
    (a) => new RegExp(`(^|[^a-z0-9])${a.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^a-z0-9]|$)`),
  ),
}));

/* Counterparties that are the owner's own money moving between his own places.
 * Matched on the COUNTERPARTY only: a rent payment often carries
 * "overschrijving" in its description while the counterparty is the landlord. */
const OWN_MONEY_HINTS = [
  "spaarrekening",
  "geld toegevoegd",
  "geld toevoegen",
  "eigen rekening",
  "overschrijving",
  "overboeking",
  "naar creditcard",
  "incasso ing creditcard",
];

/** The identity of the party on the other side of a recurring flow, and the name
 *  to show for it. Institution first (it collapses the most spellings), then the
 *  merchant key the subscription detector already uses. `key` is "" when the row
 *  carries no name at all — those are refused rather than shown nameless. */
export function scheduleParty(
  counterparty: string,
  description = "",
): { key: string; label: string } {
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
export function detectScheduleStreams(
  txs: Tx[],
  opts: DetectScheduleOptions = {},
): ScheduleStream[] {
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

    /* Amount-first, exactly like Optimalisatie — `fitMerchantStreams`, not a
     * second copy of it. If the agenda kept reading a party as one stream, the
     * two would disagree again on the very series that prompted the split:
     * Simyo's EUR 11,89 subscription plus the EUR 25,00 device credit is two
     * dates on the agenda, not none. The device credit ends one day and its row
     * stops with it — that is what the asOf check below is for. */
    const groupAmounts = sorted.map((t) => Math.round(Math.abs(t.amount) * 100));
    const { streams } = fitMerchantStreams(
      sorted.map((t) => t.date),
      groupAmounts,
    );

    for (const fit of streams) {
      const band = fit.band;
      const stream = fit.members.map((i) => sorted[i]);

      // Still running? A stopped stream keeps its cadence forever, and rolling it
      // forward would put a payment on the agenda that nobody is going to make.
      const lastDate = stream[stream.length - 1].date;
      let asOf = opts.asOf ?? "";
      if (asOf === "")
        for (const t of stream) {
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
          if (repeats(amountsCents[i])) {
            amountCents = amountsCents[i];
            break;
          }
        }
      }

      out.push({
        // Same reason as the subscription key: one party, two streams, and the
        // agenda would have rendered them over each other.
        key: `${key}|${amountCents}`,
        label: group.label,
        sign: stream[0].amount >= 0 ? 1 : -1,
        cadenceDays: band.cadenceDays,
        amountCents,
        occurrences: stream.length,
        lastDate,
        skippedCycles: fit.skippedCycles,
      });
    }
  }

  return out.sort((a, b) => b.amountCents - a.amountCents || a.key.localeCompare(b.key));
}
