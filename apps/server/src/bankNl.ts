/* The bank.nl comparison source — ONE fetch instead of thirty tariff pages.
 *
 * Measured 2026-08-16: of the card tariff pages the travel ranking wants, only
 * three answer a plain fetch. Revolut and Trading 212 return 403 behind a
 * Cloudflare interstitial, ING drops the connection on HTTP/2 and on HTTP/1.1,
 * and Rabobank 403s. This page returns 200 (96 kB) and carries the koersopslag
 * for seven Dutch banks in the RAW HTML — ABN AMRO, ING, Rabobank, ASN Bank,
 * Triodos Bank, Knab and Bunq — including ING and Rabobank, which block us
 * directly. It stamps its own "laatst gecontroleerd" date next to every table.
 *
 * Same shape as rates.ts, deliberately: browser User-Agent, parse, fall back to
 * a bundled snapshot, never let a failure take the caller down. The User-Agent
 * is not decoration — it is what decides access on these sites (ABN AMRO's own
 * page times out without one and returns 200 with one).
 *
 * The parsing itself lives in packages/core (pure, tested against a saved copy
 * of the real page); this file only does the I/O and the caching. */

import { parseBankNlPage, type BankNlTable } from "@lavega/core";

const SOURCE_URL = "https://www.bank.nl/kennisbank/betalen-in-buitenland/";

/* A real browser UA. See the header comment: this is the access decision, not a
 * politeness gesture. Kept identical to what was measured returning 200. */
const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

/* A week, like the card-terms cache: the page itself is only re-checked by its
 * editors every few months (every table on it is stamped 15-1-2026), so anything
 * shorter would be re-fetching a file that cannot have changed. */
const TTL_MS = 7 * 24 * 60 * 60 * 1000;
const TIMEOUT_MS = 10_000;

/** Below this the parse is broken, not the page — bank.nl has carried at least
 *  seven banks throughout. Serving two rows would quietly shrink the comparison
 *  instead of falling back to a snapshot that is whole. */
const MIN_ROWS = 8;

export type Deps = { fetchImpl?: typeof fetch };

/** Fetch and parse the live page. Returns null on ANY failure so the caller
 *  falls back — a comparison source that can take the travel route down with it
 *  is worse than no comparison source. */
export async function fetchBankNl(deps: Deps = {}): Promise<BankNlTable | null> {
  const doFetch = deps.fetchImpl ?? fetch;
  try {
    const res = await doFetch(SOURCE_URL, {
      headers: { "User-Agent": USER_AGENT, Accept: "text/html" },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) return null;
    const table = parseBankNlPage(await res.text());
    if (table.rows.length < MIN_ROWS) return null; // parse likely broke -> fall back
    return table;
  } catch {
    return null;
  }
}

/* Bundled snapshot — the real page as parsed on 2026-08-16, every table on it
 * stamped "laatst gecontroleerd 15-1-2026". Used only when a live fetch and the
 * in-memory cache are both unavailable. Notes are shortened to the figure and
 * its source; the live parse carries the page's full footnotes. */
const STATIC: BankNlTable = {
  checkedAt: "2026-01-15",
  rows: [
    {
      bank: "ABN AMRO",
      card: "betaalpas",
      fxFeePct: 1.2,
      checkedAt: "2026-01-15",
      note: "€0,15 en 1,2% valutakoersopslag per keer. Bron: bank.nl-vergelijking, laatst gecontroleerd 2026-01-15.",
    },
    {
      bank: "ABN AMRO",
      card: "creditcard",
      fxFeePct: 2,
      checkedAt: "2026-01-15",
      note: "Gratis + 2,0% valutakoersopslag per keer. Bron: bank.nl-vergelijking, laatst gecontroleerd 2026-01-15.",
    },
    {
      bank: "ING",
      card: "betaalpas",
      fxFeePct: 1.4,
      checkedAt: "2026-01-15",
      note: "1,4% koersopslag. Bron: bank.nl-vergelijking, laatst gecontroleerd 2026-01-15.",
    },
    {
      bank: "ING",
      card: "creditcard",
      fxFeePct: 2,
      checkedAt: "2026-01-15",
      note: "2,0% koersopslag. Bron: bank.nl-vergelijking, laatst gecontroleerd 2026-01-15.",
    },
    {
      bank: "Rabobank",
      card: "betaalpas",
      fxFeePct: 1.4,
      checkedAt: "2026-01-15",
      note: "1,4% koersopslag. Bron: bank.nl-vergelijking, laatst gecontroleerd 2026-01-15.",
    },
    {
      bank: "Rabobank",
      card: "creditcard",
      fxFeePct: 2,
      checkedAt: "2026-01-15",
      note: "2,0% koersopslag. Bron: bank.nl-vergelijking, laatst gecontroleerd 2026-01-15.",
    },
    {
      bank: "ASN Bank",
      card: "betaalpas",
      fxFeePct: 1.4,
      checkedAt: "2026-01-15",
      note: "1,4% koersopslag. Bron: bank.nl-vergelijking, laatst gecontroleerd 2026-01-15.",
    },
    {
      bank: "ASN Bank",
      card: "creditcard",
      fxFeePct: 2,
      checkedAt: "2026-01-15",
      note: "2,0% koersopslag. Bron: bank.nl-vergelijking, laatst gecontroleerd 2026-01-15.",
    },
    {
      bank: "Triodos Bank",
      card: "betaalpas",
      fxFeePct: 1,
      checkedAt: "2026-01-15",
      note: "1,0% koersopslag; de buitenlandse bank kan hier nog kosten bovenop rekenen. Bron: bank.nl-vergelijking, laatst gecontroleerd 2026-01-15.",
    },
    {
      bank: "Knab",
      card: "betaalpas",
      fxFeePct: 1.4,
      checkedAt: "2026-01-15",
      note: "1,4% koersopslag. Bron: bank.nl-vergelijking, laatst gecontroleerd 2026-01-15.",
    },
    {
      bank: "Knab",
      card: "creditcard",
      fxFeePct: 2,
      checkedAt: "2026-01-15",
      note: "2,0% koersopslag. Bron: bank.nl-vergelijking, laatst gecontroleerd 2026-01-15.",
    },
    {
      bank: "Bunq",
      card: "betaalpas",
      fxFeePct: 2,
      checkedAt: "2026-01-15",
      note: "Per abonnement — Bunq Core: 1,5% + 0,5% netwerkkosten; Bunq Pro: 0,5% netwerkkosten; Bunq Elite: 0,5% netwerkkosten. Hier is het duurste aangehouden (2%); corrigeer dit als je een ander abonnement hebt. Bron: bank.nl-vergelijking, laatst gecontroleerd 2026-01-15.",
    },
  ],
};

let cache: { table: BankNlTable; at: number } | null = null;

/** Current comparison table: fresh cache → live fetch → last good cache → the
 *  bundled snapshot. Exactly the ladder rates.ts uses, for the same reason. */
export async function getBankNlTable(deps: Deps = {}): Promise<BankNlTable> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.table;
  const live = await fetchBankNl(deps);
  if (live) {
    cache = { table: live, at: Date.now() };
    return live;
  }
  if (cache) return cache.table; // stale but real, better than the snapshot
  return STATIC;
}

/** Test seam: drop the cache (there is no cross-request state to preserve). */
export function resetBankNl(): void {
  cache = null;
}

/** The snapshot, for tests and for anyone asking what ships in the box. */
export const BANK_NL_SNAPSHOT: BankNlTable = STATIC;
