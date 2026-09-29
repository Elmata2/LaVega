import { withCurrentBalances, type Account, type ConversionMode, type Tx } from "@lavega/core";
import { positionSeries, POSITION_WINDOW_DAYS } from "./totalePositie.js";

/**
 * The owner's opt-in share of Personal's own "Totale positie" into LaVega
 * Investing's net worth (docs/investing/DASHBOARD.md). Everything here is the
 * boundary: the ONE number that is allowed to leave the browser, and nothing
 * else — no transaction, no account, no entity name.
 */

/** Today's date, computed fresh at the moment it is called rather than read
 *  from a value memoized at mount — a tab left open past midnight must share
 *  under today's date, not the day it happened to load. */
export function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Today's Totale positie, in integer EUR cents — the SAME figure Overzicht's
 *  SaldoBlock shows (`positionSeries` in totalePositie.ts), over ALL accounts
 *  regardless of the Persoonlijk/Zakelijk scope currently in view: Investing's
 *  net worth is the owner's whole position, not whichever half the tab
 *  happens to be scrolled to. `accounts`/`txs` must therefore be the full,
 *  unscoped lists — never `scopeAccounts`/`scopedAccounts`.
 *
 *  Two steps, both required to match Overzicht exactly:
 *  1. `withCurrentBalances` rolls a stored balance forward past its
 *     `balanceDate` using later transactions, the same as App.tsx does before
 *     handing accounts to Overzicht.
 *  2. `positionSeries(...).current` sums whatever balances are actually known
 *     in EUR — a PARTIAL sum, exactly like the card on screen: an account
 *     with an unknown balance is excluded, not a reason to null everything.
 *
 *  Null only when there is nothing to share at all: no accounts, or every
 *  account's balance is unknown/unresolved. Sharing a total built from zero
 *  known balances would be a false zero, not the partial sum Overzicht shows. */
export function computeShareableTotalCents(
  accounts: Account[],
  txs: Tx[],
  asOf: string,
  conversion: { fxHistory: Record<string, Record<string, number>>; mode: ConversionMode },
): number | null {
  if (accounts.length === 0) return null;
  const current = withCurrentBalances(accounts, txs, asOf);
  const series = positionSeries(current, txs, asOf, POSITION_WINDOW_DAYS, conversion);
  const knownCount = accounts.length - series.excluded;
  if (knownCount <= 0) return null;
  return Math.round(series.current * 100);
}

export type NetWorthShareOutcome = "stored" | "skipped" | "signed-out" | "error";
export type NetWorthDeleteOutcome = "deleted" | "signed-out" | "error";

/** One module-level queue: every PUT/DELETE this module sends runs in the
 *  order it was requested, each waiting for the previous to settle. Without
 *  it, a DELETE fired right after a toggle-off could reach the server before
 *  an already-in-flight PUT, leaving a stale total behind. */
let queue: Promise<unknown> = Promise.resolve();

function enqueue<T>(run: () => Promise<T>): Promise<T> {
  const result = queue.then(run, run);
  queue = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

/** The last total actually sent, so an unchanged {date, totalCents} pair
 *  (nothing moved since the last sync) never repeats a PUT the server
 *  already holds. Cleared once a DELETE succeeds, so a later PUT with the
 *  same values is not mistaken for a duplicate of a row that no longer
 *  exists. */
let lastSent: { date: string; totalCents: number } | null = null;

/** Test-only: the queue and last-sent cache are module state, shared across
 *  every test in a file unless reset between them. */
export function resetNetWorthShareStateForTests(): void {
  queue = Promise.resolve();
  lastSent = null;
}

/** PUTs exactly `{ date, totalCents, currency: "EUR" }` — no other field ever
 *  goes in this body. Serialized after any earlier PUT/DELETE via the module
 *  queue, and skipped outright when it would just repeat the last successful
 *  send. */
export async function putNetWorthTotal(
  date: string,
  totalCents: number,
): Promise<NetWorthShareOutcome> {
  if (lastSent && lastSent.date === date && lastSent.totalCents === totalCents) return "skipped";
  return enqueue(async () => {
    try {
      const response = await fetch("/api/personal/net-worth-total", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ date, totalCents, currency: "EUR" }),
      });
      if (response.status === 401) return "signed-out";
      if (!response.ok) return "error";
      lastSent = { date, totalCents };
      return "stored";
    } catch {
      /* A network hiccup here must never surface as a broken sync — the next
       * effect run (the next import, the next unlock) tries again. */
      return "error";
    }
  });
}

/** Turning the share switch off: removes every total this account ever sent.
 *  Serialized after any earlier PUT/DELETE via the module queue, so a PUT
 *  already in flight when the owner switches off still lands before this
 *  runs. */
export async function deleteNetWorthTotal(): Promise<NetWorthDeleteOutcome> {
  return enqueue(async () => {
    try {
      const response = await fetch("/api/personal/net-worth-total", { method: "DELETE" });
      if (response.status === 401) return "signed-out";
      if (!response.ok) return "error";
      lastSent = null;
      return "deleted";
    } catch {
      return "error";
    }
  });
}
