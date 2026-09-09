/* FX conversion (deterministic). Realtime ECB mid-market cross-rate only —
 * provider-fee comparison lives in the chat assistant, which web-searches
 * live fees instead of relying on a static, staleness-prone table. */

import { isEurCurrency } from "./model.js";

export type FxRate = { base: string; date: string; rates: Record<string, number> };

/* London quotes several instruments in pence under GBp (Yahoo) or GBX (brokers).
 * No FX table lists them, so resolve them to their major unit before crossing. */
const MINOR_UNITS: Record<string, { major: string; perMajor: number }> = {
  GBp: { major: "GBP", perMajor: 100 },
  GBX: { major: "GBP", perMajor: 100 },
};

/** Canonical spelling of a currency code from a broker or price provider.
 *  `GBp` differs from `GBP` by case alone and by a factor of 100, so anything
 *  that stores or compares a code has to canonicalise here rather than
 *  uppercase, which silently reprices pence as pounds. */
export function normalizeCurrencyCode(currency: string): string {
  const trimmed = currency.trim();
  /* This one comparison stays case-sensitive on purpose: `GBp` is pence and
   * `GBP` is pounds, and nothing but case tells them apart. `GBX` needs no
   * branch because uppercasing already leaves it alone. */
  if (trimmed === "GBp") return "GBX";
  return trimmed.toUpperCase();
}

function majorUnit(currency: string): { code: string; perMajor: number } {
  const minor = MINOR_UNITS[currency];
  return minor ? { code: minor.major, perMajor: minor.perMajor } : { code: currency, perMajor: 1 };
}

/** Cross rate from->to via the payload's base. `rates` are base->ccy multipliers
 *  (1 base = rates[ccy] ccy). Throws on an unknown currency. */
export function crossRate(from: string, to: string, rate: FxRate): number {
  if (from === to) return 1;
  const source = majorUnit(from);
  const target = majorUnit(to);
  const perBase = (ccy: string): number => {
    if (ccy === rate.base) return 1;
    const v = rate.rates[ccy];
    if (typeof v !== "number" || !(v > 0)) throw new Error(`onbekende valuta: ${ccy}`);
    return v;
  };
  return (perBase(target.code) * target.perMajor) / (perBase(source.code) * source.perMajor);
}

/** Validate an external rate payload (e.g. Frankfurter's `{amount,base,date,rates}`)
 *  into an FxRate, or null on any shape problem. `amount` is ignored. */
export function parseFxRatePayload(raw: unknown): FxRate | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  if (
    typeof o.base !== "string" ||
    typeof o.date !== "string" ||
    !o.rates ||
    typeof o.rates !== "object"
  )
    return null;
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(o.rates as Record<string, unknown>)) {
    if (typeof v !== "number" || !Number.isFinite(v) || v <= 0) return null;
    out[k] = v;
  }
  if (Object.keys(out).length === 0) return null;
  return { base: o.base, date: o.date, rates: out };
}

export type ConversionMode = "convert" | "separate";

/** Most recent rate for `currency` on or before `date`, from a per-currency
 *  isoDate->rate history (ECB convention: units of currency per 1 EUR). ECB
 *  publishes no Sat/Sun rate and skips holidays, so an exact miss walks
 *  backward up to 10 calendar days rather than inventing a rate; it never
 *  looks past `date`. `currency` is normalized the same way `isEurCurrency`
 *  is (trim + uppercase) so a code read anywhere in this codebase — a CSV
 *  import lowercases nothing — resolves the same regardless of case; `history`
 *  itself is not renormalized, keying it uppercase stays the caller's job.
 *  A non-positive stored value (a corrupted history entry) is treated as "no
 *  rate here", not "return it" — same guard as `parseFxRatePayload`. */
export function rateOn(
  history: Record<string, Record<string, number>>,
  currency: string,
  date: string,
): number | null {
  const byDate = history[currency.trim().toUpperCase()];
  if (!byDate) return null;
  const exact = byDate[date];
  if (typeof exact === "number" && exact > 0) return exact;
  const cursor = new Date(`${date}T00:00:00Z`);
  for (let i = 0; i < 10; i++) {
    cursor.setUTCDate(cursor.getUTCDate() - 1);
    const iso = cursor.toISOString().slice(0, 10);
    const v = byDate[iso];
    if (typeof v === "number" && v > 0) return v;
  }
  return null;
}

/** Convert a signed amount into EUR as of `date`. EUR short-circuits to the
 *  amount unchanged (rate 1) without touching `history` at all. Division by
 *  the ECB per-EUR rate keeps the sign of a negative (outgoing) amount. The
 *  `rate <= 0` check is defence in depth on top of `rateOn`'s own guard — this
 *  function never divides by a non-positive rate regardless of how one could
 *  reach it. */
export function toEur(
  amount: number,
  currency: string,
  date: string,
  history: Record<string, Record<string, number>>,
): number | null {
  if (isEurCurrency(currency)) return amount;
  const rate = rateOn(history, currency, date);
  return rate === null || rate <= 0 ? null : amount / rate;
}

/* Offline fallback (ECB via Frankfurter, verified 2026-08-04). Majors only. */
export const FX_RATE_FALLBACK: FxRate = {
  base: "EUR",
  date: "2026-08-04",
  rates: {
    USD: 1.1515,
    GBP: 0.85639,
    CHF: 0.9319,
    JPY: 170.0,
    SEK: 11.2,
    NOK: 11.6,
    DKK: 7.46,
    PLN: 4.27,
    CAD: 1.58,
    AUD: 1.74,
  },
};
