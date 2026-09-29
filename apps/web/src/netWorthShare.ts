import { consolidate, type Account, type ConversionMode, type Tx } from "@lavega/core";

/**
 * The owner's opt-in share of Personal's own "Totale positie" into LaVega
 * Investing's net worth (docs/investing/DASHBOARD.md). Everything here is the
 * boundary: the ONE number that is allowed to leave the browser, and nothing
 * else — no transaction, no account, no entity name.
 */

/** Today's consolidated total, in integer EUR cents, using the SAME function
 *  Overzicht's "Totale positie" is built from (`consolidate`, ingest.ts). Null
 *  whenever any entity's balance is unknown — a partial sum would misstate the
 *  owner's net worth on Investing's side, so on that day nothing is sent at
 *  all rather than an incomplete figure. */
export function computeShareableTotalCents(
  accounts: Account[],
  txs: Tx[],
  asOf: string,
  conversion: { fxHistory: Record<string, Record<string, number>>; mode: ConversionMode },
): number | null {
  const { totalBalance } = consolidate(accounts, txs, asOf, conversion);
  return totalBalance === null ? null : Math.round(totalBalance * 100);
}

export type NetWorthShareOutcome = "stored" | "signed-out" | "error";

/** PUTs exactly `{ date, totalCents, currency: "EUR" }` — no other field ever
 *  goes in this body. */
export async function putNetWorthTotal(
  date: string,
  totalCents: number,
): Promise<NetWorthShareOutcome> {
  try {
    const response = await fetch("/api/personal/net-worth-total", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ date, totalCents, currency: "EUR" }),
    });
    if (response.status === 401) return "signed-out";
    return response.ok ? "stored" : "error";
  } catch {
    /* A network hiccup here must never surface as a broken sync — the next
     * effect run (the next import, the next unlock) tries again. */
    return "error";
  }
}

export type NetWorthDeleteOutcome = "deleted" | "signed-out" | "error";

/** Turning the share switch off: removes every total this account ever sent. */
export async function deleteNetWorthTotal(): Promise<NetWorthDeleteOutcome> {
  try {
    const response = await fetch("/api/personal/net-worth-total", { method: "DELETE" });
    if (response.status === 401) return "signed-out";
    return response.ok ? "deleted" : "error";
  } catch {
    return "error";
  }
}
