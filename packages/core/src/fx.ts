/* FX / conversion agent (deterministic). Given ECB mid-market rates and a small
 * maintained table of provider costs, rank the routes to convert an amount from
 * one currency to another by what you'd actually receive. Rates are decimal
 * (not integer cents) — FX is inherently fractional. Route costs are INDICATIVE
 * (see FX_ROUTES_AS_OF); the UI must say so. */

export type FxRate = { base: string; date: string; rates: Record<string, number> };
export type FxRoute = {
  provider: string;
  /** Markup over mid-market, in percent (0.5 = 0.5% worse than mid). */
  spreadPct: number;
  /** Fixed fee charged in the SOURCE currency (approximation for wire fees). */
  fixedFeeFrom?: number;
  note?: string;
};
export type FxRouteResult = {
  provider: string;
  netReceived: number;   // amount in `to` after this route's costs
  effectiveRate: number; // netReceived / amountFrom
  totalCostPct: number;  // % less than pure mid-market on the full amount
  note?: string;
};

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

export function routeNet(amountFrom: number, mid: number, route: FxRoute): FxRouteResult {
  const afterFee = Math.max(0, amountFrom - (route.fixedFeeFrom ?? 0));
  const applied = mid * (1 - route.spreadPct / 100);
  const netReceived = afterFee * applied;
  const idealMid = amountFrom * mid;
  const totalCostPct = idealMid > 0 ? ((idealMid - netReceived) / idealMid) * 100 : 0;
  const effectiveRate = amountFrom > 0 ? netReceived / amountFrom : 0;
  return { provider: route.provider, netReceived, effectiveRate, totalCostPct, note: route.note };
}

export function rankRoutes(
  amountFrom: number,
  from: string,
  to: string,
  rate: FxRate,
  routes: readonly FxRoute[] = FX_ROUTES,
): FxRouteResult[] {
  const mid = crossRate(from, to, rate);
  return routes.map((r) => routeNet(amountFrom, mid, r)).sort((a, b) => b.netReceived - a.netReceived);
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

/* Indicative provider costs — owner-maintained, re-verify periodically. */
export const FX_ROUTES_AS_OF = "2026-08-05";
export const FX_ROUTES: readonly FxRoute[] = [
  { provider: "Wise", spreadPct: 0.45, fixedFeeFrom: 1.0, note: "Mid-market + ~0,45% + kleine vaste fee" },
  { provider: "Revolut (weekdag, Standard)", spreadPct: 0.0, note: "Mid-market tot plan-limiet, daarna 0,5%" },
  { provider: "Revolut (weekend)", spreadPct: 1.0, note: "Weekend-opslag ~1%" },
  { provider: "bunq", spreadPct: 0.5, note: "Indicatief" },
  { provider: "Typische bank (overboeking)", spreadPct: 1.5, fixedFeeFrom: 7.0, note: "Wisselopslag ~1,5% + kosten buitenlandse overboeking" },
  { provider: "Creditcard (typisch)", spreadPct: 2.0, note: "Bij kaartbetaling in vreemde valuta" },
];

/* Offline fallback (ECB via Frankfurter, verified 2026-08-04). Majors only. */
export const FX_RATE_FALLBACK: FxRate = {
  base: "EUR",
  date: "2026-08-04",
  rates: { USD: 1.1515, GBP: 0.85639, CHF: 0.9319, JPY: 170.0, SEK: 11.2, NOK: 11.6, DKK: 7.46, PLN: 4.27, CAD: 1.58, AUD: 1.74 },
};
