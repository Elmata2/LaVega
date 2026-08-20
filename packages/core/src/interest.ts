import type { Account, Tx } from "./model.js";
import { norm } from "./hash.js";
import { accountType } from "./balance.js";

/* Interest optimisation for the Optimisatie tab. Pure + deterministic. Own
 * account rates are derived locally (from "rente" bijschrijvingen) or set by the
 * user — they never leave the device. The benchmark rates of OTHER banks are
 * public/generic data: a bundled offline table here, which the app layer may
 * override with a fetched, cached list (see adapters). */

export type RateBenchmark = {
  bank: string;
  product: string;
  ratePct: number; // headline rate shown to the saver — the action rate when there is a promo
  freeWithdrawal: boolean;
  standardRatePct?: number; // the standard ("nominale") rate after the promo ends
  promoNote?: string; // e.g. "Actierente 6 mnd, daarna 2,10%"
  /** TRUE WHEN `ratePct` IS A TEASER, so the absence of `standardRatePct` means
   *  "what you keep here is UNKNOWN" rather than "there is nothing after it".
   *
   *  Without this flag the two cases are indistinguishable: a permanent 2,50%
   *  and a new-customer 3,00% whose standing rate nobody established both read as
   *  "ratePct with no standardRatePct", so the teaser ranks as if it were
   *  permanent. That is not hypothetical — Trade Republic's catalogue row says in
   *  its own conditions "NOT THE STANDING RATE — do not serve 3% bare", and it
   *  ranked first of all 48 merged rows and priced the yearly gain at 3%. */
  promo?: boolean;
  /** WHERE THIS RATE CAME FROM, and WHEN IT WAS TRUE — per rate, not per table.
   *
   *  The bundled table below shares one RATES_AS_OF for all nineteen rows, which
   *  was fine while every row came from the same scrape on the same day. It stops
   *  being fine once rates arrive from the product catalogue, where each one is
   *  read from its own bank's own document and carries that document's own date:
   *  ABN's Direct Sparen ladder is stated "vanaf 1 mei 2025" and is fifteen months
   *  old, while a Tarievenwijzer read the same morning may be a fortnight old. One
   *  shared date would present both as equally fresh, and the older one is exactly
   *  the figure a saver should be warned about.
   *
   *  Absent means "covered by the table's own asOf", so the bundled rows need no
   *  change. */
  sourceUrl?: string;
  asOf?: string;
  /** The bands and restrictions, in the document's words, when a rate is not flat. */
  conditions?: string;
};

/** Where a rate came from, most trustworthy first. A bank stating its own rate in
 *  its own document beats a comparison site reading it second-hand, which beats a
 *  figure compiled into this repo months ago. */
export type RateProvenance = "catalogue" | "comparison" | "bundled";

const PROVENANCE_RANK: Record<RateProvenance, number> = { catalogue: 3, comparison: 2, bundled: 1 };

/** Key a product across sources. Bank and product names are written differently by
 *  every source ("ABN AMRO"/"ABN Amro", "Spaarrekening"/"Direct Sparen"), so this
 *  is deliberately loose — and deliberately NOT loose enough to merge two products
 *  of the same bank, since a bank's flexible and fixed accounts pay differently. */
function rateKey(r: RateBenchmark): string {
  const flat = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
  return `${flat(r.bank)}|${flat(r.product)}`;
}

/** MERGE RATE SOURCES BY PROVENANCE, keeping each rate's own date and source.
 *
 *  Not a concatenation and not a replacement: the catalogue covers a different set
 *  of products than the comparison scrape, so replacing one with the other would
 *  drop every bank the winner happens to miss. Each product takes its best-sourced
 *  figure and the rest are left where they are.
 *
 *  Ties go to the EARLIER argument, so callers pass sources most-trusted-first and
 *  a same-provenance duplicate does not flap between runs. */
export function mergeRateSources(
  ...sources: { rates: readonly RateBenchmark[]; provenance: RateProvenance }[]
): RateBenchmark[] {
  const best = new Map<string, { rate: RateBenchmark; rank: number }>();
  for (const src of sources) {
    const rank = PROVENANCE_RANK[src.provenance];
    for (const rate of src.rates) {
      const key = rateKey(rate);
      const held = best.get(key);
      if (!held || rank > held.rank) best.set(key, { rate, rank });
    }
  }
  return [...best.values()].map((v) => v.rate);
}

/** Turn a covered catalogue savings figure into a benchmark the app already knows
 *  how to rank. `ratePct` stays the HEADLINE the saver sees today — the promo when
 *  one runs — while `standardRatePct` carries what they keep, which is the figure
 *  the catalogue decided `interestPct` should hold. That way a six-month teaser is
 *  visible without being what the ranking is built on. */
export function benchmarkFromCatalogue(input: {
  bank: string;
  product: string;
  standardPct: number;
  promoPct?: number | null;
  promoNote?: string | null;
  freeWithdrawal?: boolean | null;
  conditions?: string | null;
  sourceUrl: string;
  asOf: string;
}): RateBenchmark {
  const promo = typeof input.promoPct === "number" ? input.promoPct : null;
  return {
    bank: input.bank,
    product: input.product,
    ratePct: promo ?? input.standardPct,
    ...(promo !== null ? { standardRatePct: input.standardPct } : {}),
    ...(input.promoNote ? { promoNote: input.promoNote } : {}),
    // Unknown is not free. A product whose document never says becomes
    // withdrawal-restricted here, which keeps it out of bestRate's default pool
    // rather than letting it win a comparison it may not qualify for.
    freeWithdrawal: input.freeWithdrawal === true,
    ...(input.conditions ? { conditions: input.conditions } : {}),
    sourceUrl: input.sourceUrl,
    asOf: input.asOf,
  };
}

/** Peildatum of the bundled table below. Shown in the UI so a stale figure is
 *  never presented as live. The app can replace this table via a fetch. */
export const RATES_AS_OF = "2026-08-03";

/* Bundled OFFLINE fallback: standard variable ("vrij opneembaar") savings rates
 * for the Dutch consumer market. INDICATIVE snapshot (verified against geld.nl,
 * Aug 2026); the live fetch from /api/rates overrides it when reachable. These
 * are STANDARD variable rates — several banks run higher promo/actierentes for
 * new customers. Robinhood is excluded on purpose: its cash sweep (~3.35%) is
 * USD/US-only and not NL-DGS-protected. */
export const NL_SAVINGS_RATES: readonly RateBenchmark[] = [
  { bank: "Bigbank", product: "Flexibel Sparen", ratePct: 3.1, standardRatePct: 2.1, promoNote: "Actierente 6 mnd, daarna 2,10%", freeWithdrawal: true },
  { bank: "bunq", product: "Spaarrekening", ratePct: 3.01, standardRatePct: 1.5, promoNote: "Actierente t/m 01-01-2027, daarna 1,50%", freeWithdrawal: true },
  { bank: "Santander Consumer Bank", product: "Spaarrekening", ratePct: 3.01, standardRatePct: 2.1, promoNote: "Actierente 6 mnd, daarna 2,10%", freeWithdrawal: true },
  { bank: "Garanti BBVA International", product: "Spaarrekening", ratePct: 3.0, standardRatePct: 1.55, promoNote: "Actierente 6 mnd, daarna 1,55%", freeWithdrawal: true },
  { bank: "DHB Bank", product: "Combispaarrekening", ratePct: 3.0, standardRatePct: 1.85, promoNote: "Actierente 6 mnd, daarna 1,85%", freeWithdrawal: true },
  { bank: "Anadolubank", product: "Spaarrekening", ratePct: 3.0, standardRatePct: 1.9, promoNote: "Actierente 6 mnd, daarna 1,90%", freeWithdrawal: true },
  { bank: "Trade Republic", product: "Cash", ratePct: 3.0, standardRatePct: 2.25, promoNote: "Introrente, daarna 2,25%", freeWithdrawal: true },
  { bank: "Scalable Capital", product: "Cash", ratePct: 2.5, freeWithdrawal: true },
  { bank: "Klarna", product: "Spaarrekening", ratePct: 1.95, freeWithdrawal: true },
  { bank: "Openbank", product: "Spaarrekening", ratePct: 1.8, freeWithdrawal: true },
  { bank: "NIBC", product: "Spaarrekening", ratePct: 1.44, freeWithdrawal: true },
  { bank: "Rabobank", product: "Spaarrekening", ratePct: 1.4, freeWithdrawal: true },
  { bank: "ASN Bank", product: "Spaarrekening", ratePct: 1.3, freeWithdrawal: true },
  { bank: "Nationale-Nederlanden", product: "Spaarrekening", ratePct: 1.3, freeWithdrawal: true },
  { bank: "Knab", product: "Spaarrekening", ratePct: 1.25, freeWithdrawal: true },
  { bank: "ABN AMRO", product: "Spaarrekening", ratePct: 1.25, freeWithdrawal: true },
  { bank: "ING", product: "Oranje Spaarrekening", ratePct: 1.25, freeWithdrawal: true },
  { bank: "Triodos Bank", product: "Spaarrekening", ratePct: 1.15, freeWithdrawal: true },
  { bank: "Revolut", product: "Flexibel sparen", ratePct: 1.0, freeWithdrawal: true },
];

/** The best benchmark (highest ratePct); by default only free-withdrawal
 *  products. Returns null for an empty list. */
/** THE RATE A SAVER ACTUALLY KEEPS, which is what a comparison should rank on.
 *
 *  `ratePct` is the headline — the actierente when one runs. Ranking on it puts a
 *  six-month teaser above a permanently better account, and the saver who moves
 *  their money is worse off in month seven. Where a benchmark knows its standard
 *  rate, that is the number to compare.
 *
 *  NULL means the kept rate is UNKNOWN: the headline is flagged as a teaser and
 *  nobody established what follows it. Unknown is not the headline and it is not
 *  zero — it is a row that cannot be ranked, only shown. */
export function keptRate(r: RateBenchmark): number | null {
  if (r.standardRatePct !== undefined) return r.standardRatePct;
  return r.promo ? null : r.ratePct;
}

/** The best benchmark for a saver to move to. Ranked on what they KEEP, not on
 *  the headline — see keptRate. The returned benchmark still carries its promo, so
 *  the UI can show "3,01% nu, 1,50% daarna" without having ranked on the 3,01%.
 *
 *  A teaser with no known standing rate is not ranked at all: there is no honest
 *  number to rank it by. `bestPromoRate` is how it still reaches the screen. */
export function bestRate(rates: readonly RateBenchmark[], freeOnly = true): RateBenchmark | null {
  const pool = (freeOnly ? rates.filter((r) => r.freeWithdrawal) : rates).filter((r) => keptRate(r) !== null);
  if (pool.length === 0) return null;
  return pool.reduce((best, r) => (keptRate(r)! > keptRate(best)! ? r : best));
}

/** WHAT YOU COULD GET NOW: the highest headline in the pool, returned only when
 *  it beats the best rate you'd KEEP.
 *
 *  His words, and the reason ranking on the standard rate alone was one step too
 *  far: "for a user who doesn't have bunq, if they can use the promo for a month
 *  it's still a month of 3,01% over the 2,5% of Scalable Capital." A promo is real
 *  money for the months it runs and a trap after them, so the answer is not to
 *  pick one of the two numbers — it is to carry both and let the screen say which
 *  is which.
 *
 *  Null when no headline beats the best kept rate: then there is nothing extra to
 *  be had today and a promo line would be noise. Ties keep the earlier row, so
 *  the same list always names the same bank. */
export function bestPromoRate(rates: readonly RateBenchmark[], freeOnly = true): RateBenchmark | null {
  const pool = freeOnly ? rates.filter((r) => r.freeWithdrawal) : rates;
  const keep = bestRate(rates, freeOnly);
  const floor = keep === null ? -Infinity : keptRate(keep)!;
  let top: RateBenchmark | null = null;
  for (const r of pool) if (r.ratePct > floor && (top === null || r.ratePct > top.ratePct)) top = r;
  return top;
}

/** Whole days between two ISO dates via Date.UTC (locale/TZ-safe). */
function daysBetween(a: string, b: string): number {
  const [ay, am, ad] = a.split("-").map(Number);
  const [by, bm, bd] = b.split("-").map(Number);
  return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86_400_000);
}

/** A detected rate above this (%) is treated as implausible for a savings
 *  account and discarded — it means the current balance is a poor proxy for the
 *  balance that actually earned the interest (e.g. a small/shrunk saldo with a
 *  normal "rente" credit gives hundreds of percent). Callers then fall back to
 *  the bank-benchmark estimate. */
const MAX_PLAUSIBLE_RATE = 15;

/** Estimate an account's annual interest rate (%) from its "rente"
 *  bijschrijvingen in the trailing 365 days, annualized against the current
 *  balance. Rough (current balance as the base) and only a suggestion — returns
 *  null when there's no positive balance, no interest found, or the result is
 *  implausible (<=0 or > MAX_PLAUSIBLE_RATE). */
export function detectInterestRate(account: Account, txs: Tx[], asOf: string): number | null {
  if (account.balance === null || account.balance <= 0) return null;
  let interestCents = 0;
  let found = false;
  for (const t of txs) {
    if (t.accountKey !== account.key || t.amount <= 0) continue;
    if (!norm(t.counterparty + " " + t.description).includes("rente")) continue;
    const age = daysBetween(t.date, asOf); // days from the tx to asOf
    if (age < 0 || age > 365) continue; // trailing 12 months only
    interestCents += Math.round(t.amount * 100);
    found = true;
  }
  if (!found) return null;
  const balanceCents = Math.round(account.balance * 100);
  const rate = Math.round((interestCents / balanceCents) * 100 * 100) / 100; // % with 2 decimals
  if (rate <= 0 || rate > MAX_PLAUSIBLE_RATE) return null; // implausible -> use the benchmark instead
  return rate;
}

export type RateSource = "manual" | "detected" | "benchmark" | "assumed" | "unknown";

/** A bank name reduced to comparable words: accents folded, punctuation and case
 *  dropped, so "ABN-Amro Bank N.V." and "ABN AMRO Bank" become the same list. */
function bankWords(bank: string): string[] {
  return bank
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean);
}

/** DO THESE TWO NAMES NAME THE SAME BANK, beyond reasonable doubt?
 *
 *  True when one name IS the other, or is the other's leading run of whole words.
 *  Both halves of that sentence are load-bearing:
 *
 *   - It has to be loose enough for "ING" to meet "ING Bank". The catalogue keys
 *     its rows off the issuer ("ING Bank N.V.", "ABN AMRO Bank N.V.") while an
 *     import keys the account off the bank ("ING", "ABN AMRO"), and the old
 *     matcher gave up on any name shorter than four characters — so "ING" could
 *     only ever match a row spelled exactly "ING", and the one ING rate the
 *     catalogue holds was unreachable. That is the whole of "that ING is 0%".
 *
 *   - It has to be tight enough that a wrong bank never matches, which is worse
 *     than the 0% it replaces: it puts another bank's rate on your account. The
 *     substring test this replaces did exactly that — "trading 212" contains
 *     "ing", so a Trading 212 balance was paid ING's rate. Whole words only, from
 *     the front, in either direction; genuinely ambiguous pairs stay unmatched. */
function sameBank(a: string, b: string): boolean {
  const aw = bankWords(a);
  const bw = bankWords(b);
  if (aw.length === 0 || bw.length === 0) return false;
  const ag = aw.join("");
  const bg = bw.join("");
  // Glued, so "Openbank" and "Open Bank" are one bank written two ways.
  if (ag === bg) return true;
  const [short, long] = ag.length <= bg.length ? [ag, bw] : [bg, aw];
  let run = "";
  for (const w of long) {
    run += w;
    if (run === short) return true; // a leading run of WHOLE words, never mid-word
    if (run.length >= short.length) break;
  }
  return false;
}

/** THE ROW THAT ANSWERS FOR AN ACCOUNT'S OWN BANK, or null.
 *
 *  Exported because two screens need the same answer: the rate itself, and the
 *  sentence that says where it came from. A row carries its product, source URL
 *  and its document's own date, so "geschat via banktarief" can name the tariff
 *  it was read from instead of asking to be believed.
 *
 *  Rows whose kept rate is unknown are skipped: what an existing customer earns
 *  cannot be a new-customer teaser, and it cannot be a guess either.
 *
 *  Choosing between several products of one bank, in order:
 *    1. a product the ACCOUNT ITSELF names — "ING Oranje Spaarrekening" is not a
 *       guess, it is the owner having already told us;
 *    2. otherwise the first matching row, because callers pass their rate sources
 *       most-trustworthy-first (see mergeRateSources) — so this is the bank's own
 *       document ahead of a comparison site ahead of the compiled-in table.
 *  When the account says nothing, the choice IS a guess — which is why the screen
 *  names the product it used and the rate stays editable. */
export function matchBankBenchmark(
  bank: string,
  rates: readonly RateBenchmark[],
  accountName = "",
): RateBenchmark | null {
  if (bankWords(bank).length === 0) return null;
  const candidates = rates.filter((r) => keptRate(r) !== null && sameBank(bank, r.bank));
  if (candidates.length === 0) return null;
  const named = norm(accountName);
  return candidates.find((r) => r.product.length >= 4 && named.includes(norm(r.product))) ?? candidates[0];
}

/** Estimate a bank's current rate for an EXISTING customer: the STANDARD
 *  (post-promo) rate of that bank's own product, never the new-customer action
 *  rate. Null when no bank matches. */
function matchBankRate(bank: string, rates: readonly RateBenchmark[], accountName = ""): number | null {
  const match = matchBankBenchmark(bank, rates, accountName);
  return match === null ? null : keptRate(match);
}
export type AccountRate = { account: Account; ratePct: number | null; source: RateSource; balanceCents: number };
export type InterestSuggestion = { account: Account; ratePct: number; balanceCents: number; extraPerYearCents: number };
export type InterestAnalysis = {
  best: RateBenchmark | null;
  /** The best headline available RIGHT NOW, when it beats `best`'s kept rate.
   *  Never what `suggestions` are priced on — see promoExtraPerMonthCents. */
  bestPromo: RateBenchmark | null;
  /** What the promo adds PER MONTH over the best kept rate, on the balances that
   *  would move. Per month because that is the honest unit for something that
   *  ends: a year of it is not on offer. */
  promoExtraPerMonthCents: number;
  accountRates: AccountRate[];
  suggestions: InterestSuggestion[];
  totalExtraPerYearCents: number;
};

/** Resolve an account's CURRENT rate, in order: user-set wins; else detected
 *  from "rente" txs; else a betaal/creditcard account is assumed 0% (they
 *  typically pay nothing); else — for a savings account at a known bank —
 *  estimated from that bank's standard tariff in `rates`; else unknown. This is
 *  what a comparison is made against, so an existing ING saldo is compared to
 *  ING's own rate, not to 0%. */
export function resolveAccountRate(
  account: Account,
  txs: Tx[],
  asOf: string,
  rates: readonly RateBenchmark[] = [],
): { ratePct: number | null; source: RateSource } {
  if (typeof account.interestRate === "number") return { ratePct: account.interestRate, source: "manual" };
  const detected = detectInterestRate(account, txs, asOf);
  if (detected !== null) return { ratePct: detected, source: "detected" };
  const t = accountType(account);
  if (t === "Betaalrekening" || t === "Creditcard") return { ratePct: 0, source: "assumed" };
  const bench = matchBankRate(account.bank, rates, account.name);
  if (bench !== null) return { ratePct: bench, source: "benchmark" };
  return { ratePct: null, source: "unknown" };
}

/** Compare each account's rate to the best available benchmark and quantify the
 *  yearly interest left on the table. `marginPct` avoids nagging over trivial
 *  gaps. Suggestions are sorted by biggest yearly gain first. */
export function analyzeInterest(
  accounts: Account[],
  txs: Tx[],
  rates: readonly RateBenchmark[],
  asOf: string,
  marginPct = 0.1,
): InterestAnalysis {
  const best = bestRate(rates);
  const bestPromo = bestPromoRate(rates);
  const accountRates: AccountRate[] = accounts.map((a) => {
    const { ratePct, source } = resolveAccountRate(a, txs, asOf, rates);
    return { account: a, ratePct, source, balanceCents: a.balance === null ? 0 : Math.round(a.balance * 100) };
  });

  const suggestions: InterestSuggestion[] = [];
  if (best) {
    for (const ar of accountRates) {
      if (ar.ratePct === null || ar.balanceCents <= 0) continue;
      // The gap is measured against what the saver KEEPS at the winning account,
      // not its headline. Using the actierente would promise a yearly gain that
      // stops in month seven — the figure most likely to be believed and the one
      // most likely to be wrong.
      const gap = keptRate(best)! - ar.ratePct; // non-null: bestRate only ranks rows whose kept rate is known
      if (gap <= marginPct) continue;
      suggestions.push({
        account: ar.account,
        ratePct: ar.ratePct,
        balanceCents: ar.balanceCents,
        extraPerYearCents: Math.round((ar.balanceCents * gap) / 100),
      });
    }
  }
  suggestions.sort((a, b) => b.extraPerYearCents - a.extraPerYearCents);

  // The promo, priced separately and PER MONTH — never folded into the yearly
  // figure above, which stays on the rate he keeps. Both numbers are true; each
  // is only true about its own period, so they are never added together.
  let promoExtraPerMonthCents = 0;
  if (best && bestPromo) {
    const lift = bestPromo.ratePct - keptRate(best)!;
    if (lift > 0) {
      for (const s of suggestions) promoExtraPerMonthCents += Math.round((s.balanceCents * lift) / 100 / 12);
    }
  }

  return {
    best,
    bestPromo,
    promoExtraPerMonthCents,
    accountRates,
    suggestions,
    totalExtraPerYearCents: suggestions.reduce((s, x) => s + x.extraPerYearCents, 0),
  };
}
