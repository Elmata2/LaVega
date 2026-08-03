import type { Account, Tx } from "./model.js";
import { norm } from "./hash.js";
import { accountType } from "./balance.js";

/* Interest optimisation for the Optimisatie tab. Pure + deterministic. Own
 * account rates are derived locally (from "rente" bijschrijvingen) or set by the
 * user — they never leave the device. The benchmark rates of OTHER banks are
 * public/generic data: a bundled offline table here, which the app layer may
 * override with a fetched, cached list (see adapters). */

export type RateBenchmark = { bank: string; product: string; ratePct: number; freeWithdrawal: boolean };

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
  { bank: "Bigbank", product: "Spaarrekening", ratePct: 3.1, freeWithdrawal: true },
  { bank: "bunq", product: "Spaarrekening", ratePct: 3.01, freeWithdrawal: true },
  { bank: "Santander Consumer Bank", product: "Spaarrekening", ratePct: 3.01, freeWithdrawal: true },
  { bank: "Garanti BBVA International", product: "Spaarrekening", ratePct: 3.0, freeWithdrawal: true },
  { bank: "DHB Bank", product: "Combispaarrekening", ratePct: 3.0, freeWithdrawal: true },
  { bank: "Anadolubank", product: "Spaarrekening", ratePct: 3.0, freeWithdrawal: true },
  { bank: "Trade Republic", product: "Cash", ratePct: 3.0, freeWithdrawal: true },
  { bank: "Scalable Capital", product: "Cash", ratePct: 2.5, freeWithdrawal: true },
  { bank: "Klarna", product: "Spaarrekening", ratePct: 1.95, freeWithdrawal: true },
  { bank: "Ayvens Bank", product: "Spaarrekening", ratePct: 1.85, freeWithdrawal: true },
  { bank: "Argenta", product: "Spaarrekening", ratePct: 1.8, freeWithdrawal: true },
  { bank: "Openbank", product: "Spaarrekening", ratePct: 1.8, freeWithdrawal: true },
  { bank: "Yapi Kredi Bank", product: "Spaarrekening", ratePct: 1.8, freeWithdrawal: true },
  { bank: "Lloyds Bank", product: "Spaarrekening", ratePct: 1.5, freeWithdrawal: true },
  { bank: "Centraal Beheer", product: "Spaarrekening", ratePct: 1.5, freeWithdrawal: true },
  { bank: "MeDirect", product: "Spaarrekening", ratePct: 1.5, freeWithdrawal: true },
  { bank: "NIBC", product: "Spaarrekening", ratePct: 1.44, freeWithdrawal: true },
  { bank: "Rabobank", product: "Spaarrekening", ratePct: 1.4, freeWithdrawal: true },
  { bank: "Brand New Day", product: "Spaarrekening", ratePct: 1.3, freeWithdrawal: true },
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
export function bestRate(rates: readonly RateBenchmark[], freeOnly = true): RateBenchmark | null {
  const pool = freeOnly ? rates.filter((r) => r.freeWithdrawal) : rates;
  if (pool.length === 0) return null;
  return pool.reduce((best, r) => (r.ratePct > best.ratePct ? r : best));
}

/** Whole days between two ISO dates via Date.UTC (locale/TZ-safe). */
function daysBetween(a: string, b: string): number {
  const [ay, am, ad] = a.split("-").map(Number);
  const [by, bm, bd] = b.split("-").map(Number);
  return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86_400_000);
}

/** Estimate an account's annual interest rate (%) from its "rente"
 *  bijschrijvingen in the trailing 365 days, annualized against the current
 *  balance. Rough (uses current balance as the base) and only a suggestion —
 *  returns null when there's no positive balance or no interest found. */
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
  return Math.round((interestCents / balanceCents) * 100 * 100) / 100; // % with 2 decimals
}

export type RateSource = "manual" | "detected" | "assumed" | "unknown";
export type AccountRate = { account: Account; ratePct: number | null; source: RateSource; balanceCents: number };
export type InterestSuggestion = { account: Account; ratePct: number; balanceCents: number; extraPerYearCents: number };
export type InterestAnalysis = {
  best: RateBenchmark | null;
  accountRates: AccountRate[];
  suggestions: InterestSuggestion[];
  totalExtraPerYearCents: number;
};

/** Resolve an account's rate: user-set wins, else detected from txs, else a
 *  betaal/creditcard account is assumed 0% (they typically pay nothing), else
 *  unknown. */
export function resolveAccountRate(account: Account, txs: Tx[], asOf: string): { ratePct: number | null; source: RateSource } {
  if (typeof account.interestRate === "number") return { ratePct: account.interestRate, source: "manual" };
  const detected = detectInterestRate(account, txs, asOf);
  if (detected !== null) return { ratePct: detected, source: "detected" };
  const t = accountType(account);
  if (t === "Betaalrekening" || t === "Creditcard") return { ratePct: 0, source: "assumed" };
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
  const accountRates: AccountRate[] = accounts.map((a) => {
    const { ratePct, source } = resolveAccountRate(a, txs, asOf);
    return { account: a, ratePct, source, balanceCents: a.balance === null ? 0 : Math.round(a.balance * 100) };
  });

  const suggestions: InterestSuggestion[] = [];
  if (best) {
    for (const ar of accountRates) {
      if (ar.ratePct === null || ar.balanceCents <= 0) continue;
      const gap = best.ratePct - ar.ratePct;
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
  return {
    best,
    accountRates,
    suggestions,
    totalExtraPerYearCents: suggestions.reduce((s, x) => s + x.extraPerYearCents, 0),
  };
}
