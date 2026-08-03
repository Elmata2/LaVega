/* Rente-service data. This module is the SERVER-side source of truth for the
 * public NL savings-rate benchmark the web app fetches from GET /api/rates.
 * Keeping it here (not in the client bundle) means rates can be refreshed
 * server-side without shipping a new client — the first step toward real-time.
 *
 * These are still a maintained snapshot (INDICATIVE — verify against the banks).
 * A real fetcher (per-source parsers / a rates API) can replace `getRates()`
 * later without changing the endpoint or the client. */

export type RateBenchmark = { bank: string; product: string; ratePct: number; freeWithdrawal: boolean };
export type RatesPayload = { asOf: string; rates: RateBenchmark[] };

// Full NL-consumer savings market, standard variable ("vrij opneembaar") rates,
// verified against geld.nl (Aug 2026). Several banks run higher promo rates for
// new customers. Update here to refresh the live feed without a client rebuild.
// Robinhood excluded: USD/US-only cash sweep (~3.35%), not NL-DGS.
const RATES: RateBenchmark[] = [
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

/** Current benchmark payload. Async so a live fetcher can drop in here later
 *  without changing the route or the client contract. `asOf` is derived at call
 *  time, so a server refresh is reflected without a redeploy of the client. */
export async function getRates(): Promise<RatesPayload> {
  return { asOf: new Date().toISOString().slice(0, 10), rates: RATES };
}
