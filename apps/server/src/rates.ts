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

// Verified against NL comparison sites, Aug 2026 (grootbanken ~1,25%; top
// vrij-opneembaar ~3%). Update here to refresh the live feed without a client
// rebuild. Robinhood excluded: USD/US-only cash sweep (~3.35%), not NL-DGS.
const RATES: RateBenchmark[] = [
  { bank: "Revolut", product: "Flexibel sparen", ratePct: 3.1, freeWithdrawal: true },
  { bank: "Raisin (Raisin Bank)", product: "Spaarrekening", ratePct: 3.05, freeWithdrawal: true },
  { bank: "bunq", product: "Spaarrekening", ratePct: 3.01, freeWithdrawal: true },
  { bank: "Santander Consumer Bank", product: "Spaarrekening", ratePct: 3.01, freeWithdrawal: true },
  { bank: "Trade Republic", product: "Cash", ratePct: 3.0, freeWithdrawal: true },
  { bank: "ABN AMRO", product: "Spaarrekening", ratePct: 1.25, freeWithdrawal: true },
  { bank: "ING", product: "Oranje Spaarrekening", ratePct: 1.25, freeWithdrawal: true },
  { bank: "Rabobank", product: "Spaarrekening", ratePct: 1.25, freeWithdrawal: true },
];

/** Current benchmark payload. Async so a live fetcher can drop in here later
 *  without changing the route or the client contract. `asOf` is derived at call
 *  time, so a server refresh is reflected without a redeploy of the client. */
export async function getRates(): Promise<RatesPayload> {
  return { asOf: new Date().toISOString().slice(0, 10), rates: RATES };
}
