/* FX conversion (deterministic). Realtime ECB mid-market cross-rate only —
 * provider-fee comparison lives in the chat assistant, which web-searches
 * live fees instead of relying on a static, staleness-prone table. */

export type FxRate = { base: string; date: string; rates: Record<string, number> };

/** Cross rate from->to via the payload's base. `rates` are base->ccy multipliers
 *  (1 base = rates[ccy] ccy). Throws on an unknown currency. */
export function crossRate(from: string, to: string, rate: FxRate): number {
  if (from === to) return 1;
  const perBase = (ccy: string): number => {
    if (ccy === rate.base) return 1;
    const v = rate.rates[ccy];
    if (typeof v !== "number" || !(v > 0)) throw new Error(`onbekende valuta: ${ccy}`);
    return v;
  };
  return perBase(to) / perBase(from);
}

/** Validate an external rate payload (e.g. Frankfurter's `{amount,base,date,rates}`)
 *  into an FxRate, or null on any shape problem. `amount` is ignored. */
export function parseFxRatePayload(raw: unknown): FxRate | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  if (typeof o.base !== "string" || typeof o.date !== "string" || !o.rates || typeof o.rates !== "object") return null;
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(o.rates as Record<string, unknown>)) {
    if (typeof v !== "number" || !Number.isFinite(v) || v <= 0) return null;
    out[k] = v;
  }
  if (Object.keys(out).length === 0) return null;
  return { base: o.base, date: o.date, rates: out };
}

/* Offline fallback (ECB via Frankfurter, verified 2026-08-04). Majors only. */
export const FX_RATE_FALLBACK: FxRate = {
  base: "EUR",
  date: "2026-08-04",
  rates: { USD: 1.1515, GBP: 0.85639, CHF: 0.9319, JPY: 170.0, SEK: 11.2, NOK: 11.6, DKK: 7.46, PLN: 4.27, CAD: 1.58, AUD: 1.74 },
};
