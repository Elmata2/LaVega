import type { Tx } from "./model.js";
import { norm } from "./hash.js";

/* Subscription detection for the Optimisatie tab. Distinct from the forecast's
 * detectRecurringStreams: that one REJECTS amount drift (to keep a clean
 * recurring signal), which would hide exactly the price increases we want to
 * surface here. This detector keeps the stream and reports its amount trend.
 * Pure + deterministic: integer cents, ISO-date day math via Date.UTC. */

export type Subscription = {
  key: string;              // norm(counterparty) + "|out"
  name: string;             // raw counterparty of the first occurrence
  function: string;         // "Videostreaming" | "Muziekstreaming" | ... | "Overig"
  cadenceDays: number;      // 30 | 91 | 365
  monthlyCents: number;     // current price normalized to per-month (positive)
  firstAmountCents: number; // magnitude of the earliest occurrence
  lastAmountCents: number;  // magnitude of the latest occurrence (current price)
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

/** The "function" of a subscription by merchant name, or "Overig" if unknown. */
export function subscriptionFunction(name: string): string {
  const h = norm(name);
  for (const f of SUBSCRIPTION_FUNCTIONS) if (h.includes(f.match)) return f.fn;
  return "Overig";
}

/* Phrases (and IBAN shape) that mark a counterparty as a transfer/settlement,
 * not a subscription — so a recurring "Overschrijving naar <persoon>" or an
 * Amex/creditcard settlement is never listed as an abonnement. */
const TRANSFER_HINTS = [
  "overschrijving", "overboeking", "spaarrekening", "tikkie", "geld toegevoegd",
  "geld toevoegen", "kosten zakelijk", "american express", "incasso ing creditcard", "naar creditcard",
];
function looksLikeTransfer(counterparty: string): boolean {
  const h = norm(counterparty);
  if (/^[a-z]{2}\d{2}[a-z0-9]{10,}$/.test(h.replace(/\s+/g, ""))) return true; // IBAN counterparty
  return TRANSFER_HINTS.some((w) => h.includes(w));
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

/* Cadence bands accepted for a subscription: monthly, quarterly, yearly. Weekly
 * is deliberately excluded — a weekly fixed outflow is rarely a "subscription". */
const CADENCE_BANDS: ReadonlyArray<{ cadenceDays: number; min: number; max: number; minOcc: number }> = [
  { cadenceDays: 30, min: 26, max: 36, minOcc: 3 },
  { cadenceDays: 91, min: 84, max: 98, minOcc: 2 },
  { cadenceDays: 365, min: 350, max: 380, minOcc: 2 },
];

export type DetectSubscriptionOptions = { maxIntervalCv?: number; maxAmountCv?: number };

/** Detect subscriptions = regular OUTflows on a monthly/quarterly/yearly
 *  cadence. Amount is allowed to drift (that's the point — price changes), but
 *  a loose amount-CV guard keeps out wildly variable payments. Returns a list
 *  sorted by monthly cost, descending. */
export function detectSubscriptions(txs: Tx[], opts: DetectSubscriptionOptions = {}): Subscription[] {
  const maxIntervalCv = opts.maxIntervalCv ?? 0.4;
  const maxAmountCv = opts.maxAmountCv ?? 0.6;

  const groups = new Map<string, Tx[]>();
  for (const t of txs) {
    if (t.amount >= 0) continue; // outflows only
    const key = norm(t.counterparty) + "|out";
    const g = groups.get(key);
    if (g) g.push(t);
    else groups.set(key, [t]);
  }

  const subs: Subscription[] = [];
  for (const [key, group] of groups) {
    if (group.length < 2) continue;
    // A merchant subscription, not a peer transfer / card settlement.
    if (looksLikeTransfer(group[0].counterparty)) continue;
    const sorted = [...group].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

    const gaps: number[] = [];
    for (let i = 1; i < sorted.length; i++) gaps.push(daysBetween(sorted[i - 1].date, sorted[i].date));
    const medGap = median(gaps);
    const band = CADENCE_BANDS.find((b) => medGap >= b.min && medGap <= b.max);
    if (!band) continue;
    if (sorted.length < band.minOcc) continue;
    if (gaps.length >= 2 && std(gaps) / mean(gaps) > maxIntervalCv) continue;

    const amountsCents = sorted.map((t) => Math.round(Math.abs(t.amount) * 100));
    const amtMean = mean(amountsCents);
    if (amtMean <= 0) continue;
    if (amountsCents.length >= 2 && std(amountsCents) / amtMean > maxAmountCv) continue;

    const firstAmountCents = amountsCents[0];
    const lastAmountCents = amountsCents[amountsCents.length - 1];
    const changePct = firstAmountCents > 0 ? Math.round(((lastAmountCents - firstAmountCents) / firstAmountCents) * 1000) / 1000 : 0;
    // With only the 2-occurrence minimum (quarterly/yearly), demand a stable
    // amount: a real subscription's price barely moves, whereas a variable
    // outflow (a fluctuating transfer) swings a lot. Skips e.g. a -41% pair.
    if (sorted.length < 3 && Math.abs(changePct) > 0.25) continue;
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
      lastDate: sorted[sorted.length - 1].date,
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
