import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import type { CatalogEntry } from "@lavega/core";
import { ingestCatalogue } from "./cardTerms.js";

/* The committed catalogue, read ONCE when the server boots.
 *
 * Why at boot and not per request: the file is the cheap half of the ladder —
 * a figure already established by the scheduled sweep, with its source, its
 * date and its conditions. Reading it once puts those answers in the same cache
 * the travel block already reads, so the block is answered from a file instead
 * of waiting 40s-5min on a lookup. Reading it per request would put a disk hit
 * on the hot path to learn something that cannot have changed since boot.
 *
 * THE SWEEP IS NOT THE APP: nothing here fetches, parses a PDF or calls a model.
 * It reads one local file that a scheduled job committed. */

/** Absolute path to the committed catalogue, derived from THIS file
 *  (apps/server/src) rather than from the working directory — the same trick,
 *  for the same reason, as `WEB_DIST` in index.ts: `pnpm --filter` runs in the
 *  package dir while Railway runs from the repo root, and a cwd-relative path
 *  would silently find nothing in one of them. Overridable via env. */
export const CATALOG_FILE = process.env.CATALOG_FILE
  || resolve(dirname(fileURLToPath(import.meta.url)), "../../../docs/catalog/catalog.json");

/** The market the committed catalogue is loaded for.
 *
 *  The cache is keyed by home country + destination currency because the same
 *  brand charges differently per market, so the catalogue has to land in ONE of
 *  them. NL -> USD is the trip the endgoal is written about ("je gaat naar de
 *  VS"), and it is the market the travel block is exercised in. Another market
 *  still works exactly as it does today — it just gets there by lookup rather
 *  than from the file. */
const DEFAULT_HOME = process.env.CATALOG_HOME || "NL";
const DEFAULT_CURRENCY = process.env.CATALOG_CURRENCY || "USD";

export type CatalogueLoad = {
  /** The file was found, parsed, and was a catalogue. Says nothing about how
   *  many figures it held — see `accepted`. */
  loaded: boolean;
  /** Figures now in the cache. */
  accepted: number;
  /** Products the catalogue named but could not answer for: no figure, or one
   *  whose conditions were never established, or one the precedence ladder
   *  refused. A refusal with a reason is a correct outcome, not a failure. */
  refused: number;
  total: number;
  /** Why nothing was loaded, when nothing was. */
  reason?: string;
};

/** Is this thing shaped like a catalogue entry? `ingestCatalogue` reads
 *  `entry.fields.fxFeePct`, so a row without a `fields` object would throw and
 *  take the boot down with it. Rows that fail this are COUNTED as refused
 *  rather than dropped in silence — a half-written sweep should be visible. */
function isEntry(x: unknown): x is CatalogEntry {
  if (!x || typeof x !== "object") return false;
  const e = x as Record<string, unknown>;
  return typeof e.product === "string" && e.product.trim() !== ""
    && typeof e.fields === "object" && e.fields !== null;
}

/* eslint-disable-next-line no-console */
const defaultLog = (m: string) => console.log(m);

/**
 * Read the committed catalogue into the card-terms cache.
 *
 * NEVER THROWS. A fresh clone has no catalogue, and a sweep that died halfway
 * leaves a half-written one; neither is a reason for the server not to start.
 * The travel block simply falls back to the lookups it used before this file
 * existed — the same way the AI features degrade when no key is configured.
 *
 * The outcome is always logged, both halves of it. "Accepted 0" is a legitimate
 * state (today the sweep can establish the conditions of almost nothing) and it
 * is indistinguishable from a broken loader unless the refusals are printed
 * next to it, which is a mistake this project has already made twice.
 */
export function loadCatalogue(opts: {
  file?: string;
  homeCountry?: string;
  currency?: string;
  log?: (message: string) => void;
} = {}): CatalogueLoad {
  const path = opts.file ?? CATALOG_FILE;
  const homeCountry = opts.homeCountry ?? DEFAULT_HOME;
  const currency = opts.currency ?? DEFAULT_CURRENCY;
  const log = opts.log ?? defaultLog;
  const market = `${homeCountry}|${currency}`;

  const fail = (reason: string): CatalogueLoad => {
    log(`catalogue: not loaded — ${reason} (${path}). Card terms fall back to lookups.`);
    return { loaded: false, accepted: 0, refused: 0, total: 0, reason };
  };

  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch (e) {
    return fail(e instanceof Error ? e.message : "unreadable");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    return fail(`not valid JSON: ${e instanceof Error ? e.message : "parse failed"}`);
  }

  const entries = (parsed as { entries?: unknown } | null)?.entries;
  if (!Array.isArray(entries)) return fail("no `entries` array");

  const usable = entries.filter(isEntry);
  const malformed = entries.length - usable.length;

  try {
    const { accepted, rejected } = ingestCatalogue(usable, homeCountry, currency);
    const refused = rejected.length + malformed;
    log(
      `catalogue: ${accepted} accepted, ${refused} refused of ${entries.length} for ${market}`
      + `${malformed > 0 ? ` (${malformed} malformed)` : ""} — ${path}`,
    );
    return { loaded: true, accepted, refused, total: entries.length };
  } catch (e) {
    return fail(e instanceof Error ? e.message : "ingest failed");
  }
}
