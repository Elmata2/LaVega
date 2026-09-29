import { withCurrentBalances, type Account, type ConversionMode, type Tx } from "@lavega/core";
import { positionSeries, POSITION_WINDOW_DAYS } from "./totalePositie.js";
import { getShareNetWorthEnabled, getShareNetWorthPendingDelete } from "./settings.js";

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
 *  send.
 *
 *  Both checks below run INSIDE the queued task, not before it, for two
 *  separate reasons:
 *  1. The enabled/pending-delete re-read is this call's only defence against
 *     another browser tab switching sharing off in the meantime. React state
 *     in the tab that scheduled this PUT can be stale (it only learns of
 *     another tab's change via the `storage` event, a separate best-effort
 *     sync in App.tsx) — localStorage, read fresh at the moment this task
 *     actually runs, is the one source every tab agrees on. Checking it here
 *     rather than by the caller means a PUT already queued when another tab's
 *     DELETE lands still gets cancelled before it reaches the network,
 *     instead of resurrecting a total that tab just removed.
 *  2. The lastSent dedupe must also wait its turn in the queue: checking it
 *     before enqueueing compared it against whatever the last DELETE cleared
 *     it to at THAT DELETE's call time, not its settle time. A DELETE
 *     enqueued just ahead of this PUT has not run yet when a pre-queue check
 *     would look — so a same-values PUT immediately after a toggle off/on
 *     was wrongly skipped as "unchanged", while the DELETE still queued
 *     behind it went on to remove the total the switch shows as shared. */
export async function putNetWorthTotal(
  date: string,
  totalCents: number,
): Promise<NetWorthShareOutcome> {
  return enqueue(async () => {
    if (!getShareNetWorthEnabled() || getShareNetWorthPendingDelete()) return "skipped";
    if (lastSent && lastSent.date === date && lastSent.totalCents === totalCents) return "skipped";
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
