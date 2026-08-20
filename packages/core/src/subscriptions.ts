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

function median(nums: number[]): number {
  const s = [...nums].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 === 0 ? (s[m - 1] + s[m]) / 2 : s[m];
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
 * ordinary purchases at the same shop, and a third occurrence brings the
 * interval-CV guard into play.
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
  maxIntervalCv?: number;
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
  const maxIntervalCv = opts.maxIntervalCv ?? 0.4;
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

    const gaps: number[] = [];
    for (let i = 1; i < sorted.length; i++) gaps.push(daysBetween(sorted[i - 1].date, sorted[i].date));
    const medGap = median(gaps);
    const band = CADENCE_BANDS.find((b) => medGap >= b.min && medGap <= b.max);
    if (!band) continue;
    if (sorted.length < band.minOcc) continue;
    if (gaps.length >= 2 && std(gaps) / mean(gaps) > maxIntervalCv) continue;

    // Still being paid? A cancelled stream keeps its cadence and its history
    // forever, so without this the tab lists what he USED to pay as what he
    // pays. Two missed cycles (plus a few days' slack for a weekend shift) is
    // the line: one skipped charge is a billing hiccup, two is a cancellation.
    const lastDate = sorted[sorted.length - 1].date;
    let asOf = opts.asOf ?? "";
    if (asOf === "") for (const t of sorted) {
      const end = accountEnd.get(t.accountKey) ?? "";
      if (end > asOf) asOf = end;
    }
    if (asOf !== "" && daysBetween(lastDate, asOf) > band.cadenceDays * 2 + 5) continue;

    const amountsCents = sorted.map((t) => Math.round(Math.abs(t.amount) * 100));
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
      name: sorted[0].counterparty,
      function: subscriptionFunction(sorted[0].counterparty),
      cadenceDays: band.cadenceDays,
      monthlyCents,
      firstAmountCents,
      lastAmountCents,
      changePct,
      occurrences: sorted.length,
      lastDate,
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

/** Day-of-month drift plus a weekend shift: a monthly incasso on the 4th lands
 *  anywhere from the 1st to the 6th, and February is three days short. */
const SCHEDULE_TOLERANCE_DAYS = 4;
/** How many cycles a stream may skip and still be the same stream. Three misses
 *  in a row is a stopped stream, not a bumpy one. */
const MAX_SKIPPED_CYCLES = 2;

type CycleFit = { onCycle: number; skippedCycles: number; residual: number };

/** Read the gaps of a stream as whole CYCLES of `cadence`: every gap must be a
 *  near-exact multiple, at most `MAX_SKIPPED_CYCLES + 1` of them, and the
 *  majority must be single cycles. That last rule is what stops a monthly
 *  stream being called weekly (30 ≈ 4 × 7 fits the arithmetic; nothing about it
 *  is weekly), and it is why this replaces a coefficient of variation: a CV
 *  cannot tell a skipped month from an irregular one. */
function fitCycles(gaps: number[], cadence: number): CycleFit | null {
  const tol = Math.max(SCHEDULE_TOLERANCE_DAYS, Math.round(cadence * 0.12));
  let onCycle = 0;
  let skippedCycles = 0;
  let residual = 0;
  for (const g of gaps) {
    const k = Math.round(g / cadence);
    if (k < 1 || k > MAX_SKIPPED_CYCLES + 1) return null;
    const r = Math.abs(g - k * cadence);
    if (r > tol) return null;
    if (k === 1) onCycle++;
    else skippedCycles += k - 1;
    residual += r;
  }
  if (onCycle < Math.ceil(gaps.length / 2)) return null;
  return { onCycle, skippedCycles, residual };
}

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

    const gaps: number[] = [];
    for (let i = 1; i < sorted.length; i++) gaps.push(daysBetween(sorted[i - 1].date, sorted[i].date));

    let best: { band: (typeof CADENCE_BANDS)[number]; fit: CycleFit } | null = null;
    for (const band of CADENCE_BANDS) {
      if (sorted.length < band.minOcc) continue;
      const fit = fitCycles(gaps, band.cadenceDays);
      if (fit === null) continue;
      if (
        best === null ||
        fit.onCycle > best.fit.onCycle ||
        (fit.onCycle === best.fit.onCycle && fit.residual < best.fit.residual)
      ) best = { band, fit };
    }
    if (best === null) continue;

    // Still running? A stopped stream keeps its cadence forever, and rolling it
    // forward would put a payment on the agenda that nobody is going to make.
    const lastDate = sorted[sorted.length - 1].date;
    let asOf = opts.asOf ?? "";
    if (asOf === "") for (const t of sorted) {
      const end = accountEnd.get(t.accountKey) ?? "";
      if (end > asOf) asOf = end;
    }
    if (asOf !== "" && daysBetween(lastDate, asOf) > best.band.cadenceDays * 2 + 5) continue;

    /* The amount. An agenda that prints a figure nobody was ever charged is
     * worse than an agenda with one row fewer, so a stream must either repeat a
     * figure or be tight enough that its last charge IS the figure (a yearly
     * index-linked premium). Both are then reported as what it last actually
     * charged, never as an average. */
    const amountsCents = sorted.map((t) => Math.round(Math.abs(t.amount) * 100));
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
      sign: sorted[0].amount >= 0 ? 1 : -1,
      cadenceDays: best.band.cadenceDays,
      amountCents,
      occurrences: sorted.length,
      lastDate,
      skippedCycles: best.fit.skippedCycles,
    });
  }

  return out.sort((a, b) => b.amountCents - a.amountCents || a.key.localeCompare(b.key));
}
