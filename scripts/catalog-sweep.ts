/**
 * Refresh the product catalogue.
 *
 * Runs on a schedule and OUTSIDE the app: it writes a file that gets committed,
 * and the server only ever reads that file. So no scraper, no PDF parser and no
 * flaky network call lives in the running product, and every changed figure
 * arrives as a reviewable git diff — the same discipline as the competitor
 * tracker's state.json, which is where this whole approach comes from.
 *
 * It is TypeScript run through tsx, not a plain .mjs, because it imports
 * packages/core/src/*.ts — node cannot load those directly and the existing
 * sync-n8n-code.mjs only works because the n8n modules really are .js.
 *
 *   bun run catalog:sweep                          # every product
 *   bun run catalog:sweep -- --only ing-betaalpas  # one, while iterating
 *   bun run catalog:sweep -- --dry                 # report, write nothing
 *   bun run catalog:sweep -- --no-agent            # free tiers only, no model calls
 *
 * Five rungs (the reader rung comes last), tried in ladder order, first COVERED answer wins:
 *
 *   provider-page  the provider's own HTML, plain fetch + regex        free
 *   provider-pdf   the provider's own tariff PDF, pdftotext + parser   free
 *   wayback        the provider's own page from the archive + model    a model call
 *   agent          the page or PDF we already hold + model             a model call
 *   reader         the same document through r.jina.ai + model            a model call
 *
 * The model is Mistral (MISTRAL_API_KEY, default mistral-large-latest, override with
 * CATALOG_MODEL) and runs only here, as the last rung: a regex reads a number, a
 * model reading the same page can also say what the number depends on, and that is
 * what makes `conditionsKnown` true honestly. It runs only when the key is in the
 * environment (the npm script reads apps/server/.env if it exists) and not with
 * --no-agent, so a run without a key is the free sweep. There is no discovery
 * search: a `foundUrl` already in state.json is still read like any other source.
 *
 * NOTE on --only: it is a plain substring match on the product id, so `--only ing`
 * also selects every *spaarrekening* (the word "rekening" ends in "ing"). Name the
 * id you actually mean.
 */
import { existsSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { mkdirSync } from "node:fs";
import { AsyncLocalStorage } from "node:async_hooks";
import {
  readIngTariffs,
  readDocumentDate,
  coverage,
  isCovered,
  mergeCatalogEntries,
  guardRun,
  knownHostsByIssuer,
  isOlderThanMaxAge,
  coverageForRun,
  sweptFieldFor,
  nextHeldSince,
  NO_ROUTE_PREFIX,
  type ConfirmedBy,
  type CatalogValue,
  type CatalogRoute,
  type CatalogField,
  type FieldVerdict,
} from "@lavega/core";
import { runLadder, type RouteAttempt } from "./catalog/catalogRoutes.js";
import {
  BREAKER_LIMIT,
  firstDocument,
  looksLikeDocument,
  nextBreakerState,
  readerCandidates,
  readThroughReader,
  resolveDocKind,
  type BreakerState,
} from "./catalog/readerFetch.js";
import {
  buildExtractPrompt,
  capConditions,
  EXTRACT_TOOL,
  parseExtractReply,
  type ExtractedFigure,
} from "./catalog/catalogExtract.js";
import {
  buildInterestPrompt,
  INTEREST_TOOL,
  parseInterestReply,
  type ExtractedRate,
} from "./catalog/catalogInterest.js";
import { sliceForExtraction } from "./catalog/catalogSlice.js";
import {
  buildConfirmPrompt,
  CONFIRM_TOOL,
  confirmRead,
  sameDocument,
  storedCheckOf,
  type ConfirmOutcome,
  parseConfirmReply,
  type ConfirmReply,
} from "./catalog/catalogConfirm.js";
import type { RunSummary } from "./catalog/catalogReport.js";
import { runPool, stopReason } from "./catalog/pool.js";
import {
  cacheKey,
  cachedCall,
  confirmAccepted,
  mergeHeld,
  openAnswerAccepted,
  modelHealth,
  parseCache,
  prune,
  type ReplyCache,
} from "./catalog/replyCache.js";
import {
  callWithTool,
  DEFAULT_CATALOG_MODEL,
  MISTRAL_PRICES,
  MistralCallError,
  MistralFatalError,
  REQUEST_CONFIG,
  isFallbackWorthy,
  usdFor,
  type ModelUsage,
  type ToolSpec,
} from "./catalog/mistralClient.js";

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36";
const STATE = "docs/catalog/state.json";
const CATALOG = "docs/catalog/catalog.json";
const today = new Date().toISOString().slice(0, 10);
/** A host that never answers must not hold the sweep open. Without this one
 *  hanging socket stalls a scheduled run for its whole six-hour budget. */
const TIMEOUT_MS = 20_000;

const args = process.argv.slice(2);
// A COMMA-SEPARATED LIST, not one substring. Targeting a scattered set is the
// normal case once discovery pins documents to some products and not others:
// `--only ics-` would drag back in the four ICS business cards whose consumer
// document was deliberately unpinned, and pay Opus to re-read a marketing page
// nobody wanted read. Any token matching as a substring is enough.
const onlyList = (args.includes("--only") ? args[args.indexOf("--only") + 1] : "")
  .split(",")
  .map((t) => t.trim())
  .filter(Boolean);
const only = onlyList.length ? onlyList.join(",") : null;
const matchesOnly = (id: string) => onlyList.some((t) => id.includes(t));
const dry = args.includes("--dry");
/** Where to leave a RunSummary for scripts/catalog-report.ts. Absent = no summary. */
const summaryOut = args.includes("--summary-out") ? args[args.indexOf("--summary-out") + 1] : null;
/** The extractor model. The 2026-11-22 model test chose mistral-large-latest; see
 *  docs/research/2026-11-22-catalog-model-bakeoff.md. */
const EXTRACT_MODEL = process.env.CATALOG_MODEL?.trim() || DEFAULT_CATALOG_MODEL;
/** A HARD CEILING, in dollars, because a projection is not a promise. Mine ran
 *  2.8x low on the 81-product sweep — slicing cut the input as measured, but the
 *  fallback made 119 calls for 81 products and output tokens ran double what I
 *  assumed. An estimate that can be wrong needs a stop, not more confidence. */
const MAX_USD = Number(process.env.CATALOG_MAX_USD ?? "0") || null;
/** Slowness is free here, hanging is not: one wedged request must not eat the
 *  sweep's time. Generous, because the model is allowed to think. */
const MODEL_TIMEOUT_MS = 120_000;
/** After a timeout or a cut-off reply one call goes to this faster model. Empty = no fallback. */
const FALLBACK_MODEL = (() => {
  const raw = process.env.CATALOG_FALLBACK_MODEL;
  const m = raw === undefined ? "mistral-medium-latest" : raw.trim();
  return m && m !== EXTRACT_MODEL ? m : null;
})();
const FALLBACK_TIMEOUT_MS = 60_000;
/** Products read at the same time. 1 to 8, anything else means 4. The first full run
 *  took about 4 hours one at a time; the model calls and the fetches are waits. */
const concurrency = /^[1-8]$/.test(process.env.CATALOG_CONCURRENCY?.trim() ?? "")
  ? Number(process.env.CATALOG_CONCURRENCY!.trim())
  : 4;
/** Minutes after which no new product starts (the ones running finish). 0 = off, default 150. */
const DEADLINE_MIN = (() => {
  const raw = process.env.CATALOG_DEADLINE_MIN?.trim();
  if (!raw) return 150;
  if (/^\d+$/.test(raw)) return Number(raw);
  console.log(`CATALOG_DEADLINE_MIN="${raw}" is not a whole number of minutes: using 150.`);
  return 150;
})();
/** Spend at this multiple of the ceiling, with products still running, is a hard stop. */
const HARD_STOP_FACTOR = 1.5;
const startedAt = Date.now();
const minutesSinceStart = () => Math.round((Date.now() - startedAt) / 6_000) / 10;
/** Set by the first exit path that runs. Each exit path ends in process.exit with no
 *  await in between, so a second one cannot run; the flag makes that explicit. */
let exiting = false;
function claimExit(): boolean {
  if (exiting) return false;
  exiting = true;
  flushOpenBuffers();
  return true;
}
/** The log buffers of products still running. process.exit skips their `finally`, so
 *  the exit path prints what they hold. */
const openBuffers = new Set<{ product: string; lines: string[] }>();
function flushOpenBuffers(): void {
  for (const b of openBuffers) {
    if (b.lines.length) console.log(`(unfinished) ${b.product}\n${b.lines.join("\n")}`);
  }
  openBuffers.clear();
}
/** Model calls sent and not yet answered. Their cost is not in the spend until they return. */
let modelInFlight = 0;
const modelRetries = { rateLimited: 0, serverError: 0 };
/** Said on every exit that happens mid-run: calls still running were sent and are billed
 *  but never counted, so the ceiling can be crossed by up to that many calls. */
function inFlightNote(): string {
  return modelInFlight > 0
    ? ` Up to ${modelInFlight} model call(s) were still running and are not counted.`
    : "";
}
/** One product's log lines. With concurrency above 1 they are held and printed together. */
type Log = (line: string) => void;
/** Above this the page is refused rather than trimmed. Silently truncating the
 *  text would hand the model a document whose tariff table may have been cut off
 *  and take its answer as if it had read the whole thing. */
const MAX_MODEL_CHARS = 200_000;
/** Never printed, never written to either artifact. Absent = the free sweep. */
const apiKey = process.env.MISTRAL_API_KEY?.trim() || null;
const useAgent = !args.includes("--no-agent") && !!apiKey;
if (["--search", "--search-all", "--max-search"].some((f) => args.includes(f))) {
  console.error("discovery search is not available on Mistral yet");
  process.exit(2);
}
/** Calls sent to the model this run. A reply reused from the cache is NOT one of these. */
let modelCalls = 0;
/** Replies reused because the whole request was identical to one already answered. */
let modelReused = 0;
/** Requests sent to a model (fresh attempts, fallback calls included) and calls answered by the fallback. */
let freshAttempts = 0;
let modelFallbacks = 0;
/** The product the running code belongs to, so `ask` knows whose reply it is handling. */
const productContext = new AsyncLocalStorage<string>();

/** What this run spent, per model, from the API's own usage numbers rather than a
 *  guess. Printed at the end: a rung that costs money and reports only coverage
 *  is a rung nobody can decide the cadence for. */
type Spend = { calls: number; input: number; output: number };
const spend = new Map<string, Spend>();

/** Charged AFTER a call, so the ceiling can be crossed by the call that tripped it plus
 *  the calls already in flight (up to the concurrency) — you cannot know a reply's
 *  output tokens before you have it, and calls in flight are billed when the process
 *  exits but never recorded. The stop says how many there were. */
function stopIfOverBudget(): void {
  if (!MAX_USD) return;
  const spent = spendTotalUsd();
  // Reaching the ceiling only stops NEW products (stopReason, used by the pool call below);
  // the products already running may finish their calls. This is the hard stop on top of it.
  if (spent < MAX_USD * HARD_STOP_FACTOR) return;
  if (!claimExit()) return;
  console.error(
    `\nSTOPPING: spend ≈ $${spent.toFixed(2)} reached ${HARD_STOP_FACTOR} × the $${MAX_USD.toFixed(2)} ceiling (CATALOG_MAX_USD) while products were still running.${inFlightNote()}`,
  );
  if (onFatal) {
    try {
      onFatal();
    } catch (e) {
      console.error(`  (could not save partial results: ${(e as Error).message})`);
    }
  }
  console.error(`${keptNote()} Raise CATALOG_MAX_USD to continue.`);
  writeEarlyRefusal(
    `STOPPING: spend reached ${HARD_STOP_FACTOR} × the $${MAX_USD.toFixed(2)} ceiling (CATALOG_MAX_USD).${inFlightNote()}`,
  );
  process.exit(1);
}

/** What happened to the products read before an early exit. True in each case: --dry writes
 *  nothing, a local run saved them to the catalogue files, and in CI a failed run commits nothing. */
function keptNote(): string {
  return dry
    ? "--dry: nothing was written."
    : "Products already read were saved to the local catalogue files; in CI a failed run commits nothing, so the week's work is lost there. The rest are untouched.";
}

/** The billing and budget exits happen mid-loop. The summary carries the verdicts of the
 *  products read so far (set by onFatal); products the loop did not reach are "stopped-early". */
function writeEarlyRefusal(reason: string): void {
  if (!summaryOut) return;
  const { GITHUB_SERVER_URL: server, GITHUB_REPOSITORY: repo, GITHUB_RUN_ID: runId } = process.env;
  const summary: RunSummary = {
    today,
    status: "refused",
    refusedReason: reason,
    verdicts: earlyVerdicts,
    kept: [],
    failures: [],
    crossedAgeLine: [],
    spendLines: spendLines(),
    runUrl: server && repo && runId ? `${server}/${repo}/actions/runs/${runId}` : null,
    coverage: buildCoverage(earlyVerdicts, true).figures,
    durationMinutes: minutesSinceStart(),
    concurrency,
    modelRetries: { ...modelRetries },
    ...(useAgent
      ? { modelCallsNew: modelCalls, modelCallsReused: modelReused, modelFallbacks }
      : {}),
  };
  writeFileSync(summaryOut, JSON.stringify(summary, null, 2) + "\n");
}

function recordSpend(model: string, usage: ModelUsage): void {
  const s = spend.get(model) ?? { calls: 0, input: 0, output: 0 };
  s.calls++;
  s.input += usage.inputTokens;
  s.output += usage.outputTokens;
  spend.set(model, s);
}

/** One implementation of the price arithmetic. The ceiling and the report must
 *  never be able to disagree about what has been spent. */
function modelUsd(model: string, s: Spend): number {
  return usdFor(model, { inputTokens: s.input, outputTokens: s.output });
}

function spendTotalUsd(): number {
  let t = 0;
  for (const [model, s] of spend) t += modelUsd(model, s);
  return t;
}

function spendLines(): string[] {
  const out: string[] = [];
  let total = 0;
  for (const [model, s] of spend) {
    const usd = modelUsd(model, s);
    total += usd;
    out.push(
      `  ${model.padEnd(22)} ${String(s.calls).padStart(3)} call(s)  ${s.input} in / ${s.output} out  ≈ $${usd.toFixed(2)}${MISTRAL_PRICES[model] ? "" : " (unknown model, priced at 10/10)"}`,
    );
  }
  if (out.length)
    out.push(`  ${"total".padEnd(22)} ≈ $${total.toFixed(2)} (list prices, estimate)`);
  return out;
}

/** How many of this run's fetches got an answer of ANY kind, 403s included.
 *  Zero, with attempts made, means the machine had no network — see the guard at
 *  the bottom, which is the difference between "nothing is readable today" and
 *  "committing an empty catalogue at 05:00 on a Monday". */
let httpResponses = 0;

/** pdftotext exists on the sweep machine. It is deliberately NOT a runtime
 *  dependency of the server. */
function pdfToText(bytes: ArrayBuffer): string {
  // One file per call: products read PDFs at the same time.
  const file = join(tmpdir(), `catalog-${process.pid}-${randomUUID()}.pdf`);
  try {
    writeFileSync(file, Buffer.from(bytes));
    return execFileSync("pdftotext", ["-layout", file, "-"], { encoding: "utf8" });
  } finally {
    try {
      unlinkSync(file);
    } catch {
      // already gone
    }
  }
}

async function getPdfText(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: { "User-Agent": UA },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  httpResponses++;
  if (!res.ok) throw new Error(`${res.status}`);
  return pdfToText(await res.arrayBuffer());
}

/** HTML with its tags gone, which is what both the regex rung and the model read. */
function strip(html: string): string {
  return html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/[ \t]+/g, " ");
}

/** Two rungs now read the same URL — the regex and the model — and 82 URLs serve
 *  124 products, so without this the sweep fetches some pages five times and the
 *  providers see a burst that looks like scraping. One fetch per URL per run,
 *  failures cached too so a dead host is not retried per product. */
const pageCache = new Map<string, Promise<string>>();
/** URLs plain fetch could not read (network error, non-200, or a body pdftotext
 *  rejects). Only these PDFs are offered to the reader rung. */
const plainFailed = new Set<string>();
function readPage(url: string, kind: "html" | "pdf"): Promise<string> {
  const key = `${kind}:${url}`;
  let hit = pageCache.get(key);
  if (!hit) {
    hit = (kind === "pdf" ? getPdfText(url) : getHtmlOrPdfText(url)).catch((e) => {
      plainFailed.add(url);
      throw e;
    });
    pageCache.set(key, hit);
  }
  return hit;
}

/** A URL'S EXTENSION IS NOT ITS CONTENT TYPE. de Volksbank publishes its
 *  tarievenwijzer at paths ending in `.html` that return application/pdf —
 *  measured: 200 application/pdf, 73.996 bytes, for
 *  snsbank.nl/downloads/tarievenwijzer-betalen.html. Stripping tags off a PDF
 *  yields binary noise, and the model would then be asked to find a tariff in it
 *  and would correctly find nothing. So sniff the body: %PDF- decides, whatever
 *  the path says. */
async function getHtmlOrPdfText(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: { "User-Agent": UA, "Accept-Language": "nl-NL,nl;q=0.9" },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  httpResponses++;
  if (!res.ok) throw new Error(`${res.status}`);
  const bytes = await res.arrayBuffer();
  if (Buffer.from(bytes.slice(0, 5)).toString() === "%PDF-") return pdfToText(bytes);
  return strip(new TextDecoder("utf-8").decode(bytes));
}

/** One reader fetch per URL per run, like pageCache. Throws with the reason so a
 *  failed read becomes a recorded reason rather than a silent blank. */
const readerCache = new Map<string, Promise<string>>();
let readerBreaker: BreakerState = { consecutive: 0, open: false };
function readViaReader(url: string): Promise<string> {
  let hit = readerCache.get(url);
  if (!hit) {
    hit = readThroughReader(url).then((r) => {
      const was = readerBreaker.open;
      if (!r.ok) {
        readerBreaker = nextBreakerState(
          readerBreaker,
          r.kind === "http" || !r.kind ? "http-error" : r.kind,
        );
      }
      if (r.ok) {
        const doc = looksLikeDocument(r.text);
        readerBreaker = nextBreakerState(readerBreaker, doc.ok ? "success" : "not-document");
        if (!doc.ok) throw new Error(`reader gave no document: ${doc.reason}`);
      }
      if (!was && readerBreaker.open) {
        console.log(
          `  reader: ${BREAKER_LIMIT} network failures or timeouts in a row; skipping the reader rung for the rest of this run`,
        );
      }
      if (!r.ok) throw new Error(r.reason);
      return r.text;
    });
    readerCache.set(url, hit);
  }
  return hit;
}

// ────────────────────────────────────────────────────────────── the wayback rung

/** For a provider whose own host refuses us but whose page is server-rendered.
 *
 *  Proved on Rabobank, whose live page kills the connection: the archive served
 *  437 kB carrying the real tariff table — "betalen met je betaalpas geen extra
 *  kosten 1,4% koersopslag", the credit card's 2%, and the withdrawal rows the
 *  comparison tables fold away.
 *
 *  The snapshot's own timestamp becomes `checkedAt`, and that is not a compromise
 *  but the correct date: it is when that text was true. A figure read out of an
 *  April snapshot and stamped with today's date is the exact bug this project has
 *  shipped twice — the source's date, never the date we happened to read it.
 */
const ARCHIVE_GAP_MS = 1_500;
const ARCHIVE_TIMEOUT_MS = 60_000;
/** 429 means "slow down", NOT "there is no snapshot", and treating the two the
 *  same would quietly mark a whole run's worth of products unarchived. Back off,
 *  then give up LOUDLY — a throw becomes a recorded reason, a null becomes a lie. */
const ARCHIVE_BACKOFF_MS = [5_000, 15_000, 45_000];
/** Below this the snapshot is an error page, a redirect stub or a JS shell that
 *  archived as empty as it renders. Not worth a model call. */
const MIN_ARCHIVE_CHARS = 800;
let archiveLastHit = 0;
let waybackReads = 0;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function archiveFetch(url: string): Promise<Response> {
  for (let attempt = 0; ; attempt++) {
    // Claim the slot before waiting: with several products in flight, two callers
    // must not both see the same gap and hit the archive together.
    const slot = Math.max(Date.now(), archiveLastHit + ARCHIVE_GAP_MS);
    archiveLastHit = slot;
    const gap = slot - Date.now();
    if (gap > 0) await sleep(gap);
    let res: Response;
    try {
      res = await fetch(url, {
        headers: { "User-Agent": UA },
        signal: AbortSignal.timeout(ARCHIVE_TIMEOUT_MS),
      });
    } catch (e) {
      if (attempt >= ARCHIVE_BACKOFF_MS.length) throw e;
      await sleep(ARCHIVE_BACKOFF_MS[attempt]);
      continue;
    }
    httpResponses++;
    if (res.status !== 429 && res.status !== 503) return res;
    if (attempt >= ARCHIVE_BACKOFF_MS.length) {
      throw new Error(
        `web.archive.org ${res.status} after ${attempt + 1} tries — rate limited, not "not archived"`,
      );
    }
    await sleep(ARCHIVE_BACKOFF_MS[attempt]);
  }
}

type Snapshot = { stamp: string; date: string; original: string; mime: string };

/** The CDX index gives us the snapshot AND its date in one call. `limit=-4` asks
 *  for the LAST four rather than the first four — the default order is oldest
 *  first, and Rabobank's index starts in 2022. */
async function cdxSnapshots(url: string): Promise<Snapshot[]> {
  const q = new URLSearchParams({
    url,
    output: "json",
    limit: "-4",
    fl: "timestamp,original,mimetype",
  });
  q.append("filter", "statuscode:200");
  // A revisit record is a pointer to an identical earlier capture, not a body.
  q.append("filter", "!mimetype:warc/revisit");
  const res = await archiveFetch(`https://web.archive.org/cdx/search/cdx?${q}`);
  if (!res.ok) throw new Error(`cdx ${res.status}`);
  const body = (await res.text()).trim();
  if (!body) return []; // genuinely nothing archived — an empty body, not an error
  const rows = JSON.parse(body) as string[][];
  return rows
    .slice(1) // header row
    .map(([stamp, original, mime]) => ({
      stamp,
      date: `${stamp.slice(0, 4)}-${stamp.slice(4, 6)}-${stamp.slice(6, 8)}`,
      original,
      mime: mime ?? "",
    }))
    .filter((s) => /^\d{14}$/.test(s.stamp));
}

/** Newest usable snapshot as text, or null for "nothing archived / nothing in it".
 *  `id_` asks for the original bytes without the archive's own banner and script,
 *  so the text handed to the model is the page as the provider served it. */
async function readArchived(
  url: string,
): Promise<{ text: string; url: string; date: string } | null> {
  const snaps = (await cdxSnapshots(url)).reverse();
  for (const s of snaps.slice(0, 2)) {
    const archiveUrl = `https://web.archive.org/web/${s.stamp}id_/${s.original}`;
    let text: string;
    try {
      const res = await archiveFetch(archiveUrl);
      if (!res.ok) continue;
      text = s.mime.includes("pdf") ? pdfToText(await res.arrayBuffer()) : strip(await res.text());
    } catch {
      continue; // this capture is broken; the one before it may not be
    }
    if (text.replace(/\s+/g, " ").trim().length < MIN_ARCHIVE_CHARS) continue;
    waybackReads++;
    return { text, url: archiveUrl, date: s.date };
  }
  return null;
}

/** One product, one page, one question, through the tool in packages/core.
 *
 *  Everything model-shaped that could be pure IS pure and lives in
 *  catalogExtract.ts — the prompt, the schema, and every check on the reply. What
 *  is left here is the call itself, because that is I/O and packages/core stays
 *  clean of it. The reply is parsed by parseExtractReply or discarded; there is
 *  no path from a model's output into the catalogue that skips those checks. */
/** A key that is out of credit, revoked or simply wrong is NOT a per-product route
 *  failure, and swallowing it as one is exactly how a sweep produces a full
 *  artifact that no model ever read: every model rung fails, the free regex rungs
 *  keep returning figures, the blackout guard at the bottom sees a healthy
 *  httpResponses count, and the run commits. Die on the FIRST one instead (the
 *  client raises MistralFatalError for 401, 402 and 403). */
/** Set by the main loop so the fatal guard can flush what has been read so far.
 *  A function rather than a direct call because the guard lives above `entries`. */
let onFatal: (() => void) | null = null;
let earlyVerdicts: FieldVerdict[] = [];

function abortIfKeyUnusable(e: unknown): void {
  if (!(e instanceof MistralFatalError)) return;
  if (!claimExit()) return;
  console.error(`\nFATAL - the Mistral key cannot be used: ${e.message}`);
  // SAVE WHAT WAS ALREADY READ, then die. The first version of this guard wrote
  // NOTHING, and on 2026-08-19 that discarded 40 covered figures from 66 products
  // the model had genuinely read before the balance ran out — work already paid
  // for, thrown away to avoid a problem it did not have. The thing worth refusing
  // is an artifact whose figures came only from the free rungs; a product the
  // model actually read is a real result whether or not the run finished.
  //
  // Products still unswept keep their previous entry, because this merges rather
  // than replaces. The run still exits RED so nobody mistakes it for complete.
  if (onFatal) {
    try {
      onFatal();
    } catch (err) {
      console.error(`  (could not save partial results: ${(err as Error).message})`);
    }
  }
  console.error(`Exiting red. Top up and re-run. ${keptNote()}`);
  writeEarlyRefusal(`FATAL - the Mistral key cannot be used: ${e.message}${inFlightNote()}`);
  process.exit(1);
}

/** One request to one model, with the spend, the in-flight count and the key check. No cache here. */
async function callOnce(model: string, system: string, user: string, tool: ToolSpec) {
  freshAttempts++;
  try {
    modelInFlight++;
    let res: Awaited<ReturnType<typeof callWithTool>>;
    try {
      res = await callWithTool({
        apiKey: apiKey ?? "",
        model,
        system,
        user,
        tool,
        timeoutMs: model === EXTRACT_MODEL ? MODEL_TIMEOUT_MS : FALLBACK_TIMEOUT_MS,
        onRetry: (status) => {
          if (status === 429) modelRetries.rateLimited++;
          else modelRetries.serverError++;
        },
      });
    } finally {
      modelInFlight--;
    }
    modelCalls++;
    recordSpend(model, res.usage);
    return res;
  } catch (e) {
    // A reply that arrived but could not be parsed (often a truncated tool call)
    // was still billed: count it and check the ceiling like a successful call.
    if (e instanceof MistralCallError && e.usage) {
      recordSpend(model, e.usage);
      stopIfOverBudget();
    }
    abortIfKeyUnusable(e);
    throw e;
  }
}

/** Every model call in this script goes through here, so a new call site cannot
 *  forget the guard. A timeout is not retried against the same model (billed again for the
 *  same wait); after a timeout or a cut-off reply ONE call goes to the fallback model.
 *  The cache decision lives in cachedCall (replyCache.ts). */
async function ask(system: string, user: string, tool: ToolSpec) {
  const key = cacheOn
    ? cacheKey({ model: EXTRACT_MODEL, system, user, tool, request: REQUEST_CONFIG })
    : null;
  try {
    const out = await cachedCall({
      store: {
        get: () => replyCache,
        set: (c) => {
          replyCache = c;
        },
      },
      key,
      productId: productContext.getStore(),
      pendingKeys: pendingAtStart,
      heldKeys: heldAtStart,
      today,
      maxAgeDays: CACHE_DAYS,
      primaryModel: EXTRACT_MODEL,
      fallbackModel: FALLBACK_MODEL,
      isFallbackWorthy,
      call: (model) => callOnce(model, system, user, tool),
    });
    if (out.outcome === "reused") modelReused++;
    if (out.fallbackUsed) modelFallbacks++;
    // Spend is recorded. The caller decides whether the reply settled something (accept) and
    // then calls settle, which stores an accepted reply BEFORE the budget stop is evaluated.
    return { res: out.res, accept: out.accept };
  } catch (e) {
    // Spend is already recorded; name the cause so the reason does not read as a refusal.
    if (e instanceof MistralCallError && e.message.includes("truncated")) {
      throw new Error("model reply truncated");
    }
    throw e;
  }
}

/** After the caller's accept decision: an accepted reply is stored first, so stopping here
 *  does not lose a reply that settled something. */
function settle(accept: () => void, accepted: boolean): void {
  if (accepted) accept();
  stopIfOverBudget();
}

async function askModel(
  product: string,
  sourceUrl: string,
  text: string,
  log: Log,
): Promise<ExtractedFigure | null> {
  if (text.length > MAX_MODEL_CHARS) {
    throw new Error(
      `page is ${Math.round(text.length / 1000)}k chars — refusing to send a truncated document`,
    );
  }
  // Send the relevant regions, not the whole document. Measured: 39% of a tariff
  // document sits near a currency term, and Amex's agreement is 12%. The slice
  // deliberately also carries cap language from ANYWHERE in the document, because
  // the exhaustive-document rule earns `conditions: null` only from a cap priced
  // on some OTHER row — slicing that away would have quietly reverted every such
  // figure to refused with no error to show for it.
  const cut = sliceForExtraction(text);
  if (!cut.whole) {
    log(
      `    sliced ${Math.round(text.length / 1000)}k -> ${Math.round(cut.text.length / 1000)}k chars (${cut.regions} regions)`,
    );
  }
  const req = { product, sourceUrl, text: cut.text };
  const { system, user } = buildExtractPrompt(req);
  // Deliberately NOT a forced tool call (see callWithTool). "This page does not
  // state it for this product" has to remain sayable.
  const { res, accept } = await ask(system, user, EXTRACT_TOOL);
  if (res.kind === "declined") {
    settle(accept, false); // a decline settles nothing: asked again next run
    return null; // the model declined — a real answer
  }
  const figure = parseExtractReply(res.input, req, today);
  settle(
    accept,
    openAnswerAccepted(figure ? toValue(figure, "agent", sourceUrl, cut.text, today) : null),
  );
  return figure;
}

/** The verified quote behind each value the open question produced; the report shows it on Changed and Waiting lines. */
const valueQuotes = new WeakMap<CatalogValue, string>();

/** A verified figure plus the text it came out of, turned into a catalogue value.
 *
 *  `fallbackDate` is what the date falls back to when the document does not state
 *  its own: today for something fetched live, the SNAPSHOT's date for something
 *  read out of the archive. Never today for an archived page. */
function toValue(
  figure: ExtractedFigure,
  route: CatalogRoute,
  sourceUrl: string,
  text: string,
  fallbackDate: string,
): CatalogValue {
  const v: CatalogValue = {
    value: figure.value,
    route,
    sourceUrl,
    checkedAt: readDocumentDate(text) ?? fallbackDate,
    conditions: capConditions(figure.conditions),
    conditionsKnown: figure.conditionsKnown,
  };
  valueQuotes.set(v, figure.quote);
  return v;
}

/** A SAVINGS RATE AS A CATALOGUE FIGURE.
 *
 *  `value` is the STANDARD rate — what the saver keeps once a promotion ends — and
 *  the promo is folded into `conditions` alongside the bands. Decided 2026-08-19:
 *  ranking on the headline would put a six-month teaser above a permanently better
 *  account, and the saver who followed it is worse off in month seven.
 *
 *  A promo that the reply reported but could not describe is downgraded here as
 *  well as in the parser, because a rate that silently changes is exactly the
 *  shape of the Revolut bug. */
function rateToValue(
  rate: ExtractedRate,
  route: CatalogRoute,
  sourceUrl: string,
  text: string,
  fallbackDate: string,
): CatalogValue {
  const promo =
    rate.promoPct !== null
      ? `Actierente ${String(rate.promoPct).replace(".", ",")}%${rate.promoUntil ? ` ${rate.promoUntil}` : ""}, daarna ${String(rate.standardPct).replace(".", ",")}%.`
      : null;
  const withdrawal =
    rate.freeWithdrawal === false
      ? "Niet vrij opneembaar."
      : rate.freeWithdrawal === null
        ? "Opnamevoorwaarden niet vermeld."
        : null;
  const parts = [rate.conditions, promo, withdrawal].filter(Boolean);
  const v: CatalogValue = {
    value: rate.standardPct,
    route,
    sourceUrl,
    checkedAt: readDocumentDate(text) ?? fallbackDate,
    conditions: capConditions(parts.length ? parts.join(" ") : null),
    conditionsKnown: rate.conditionsKnown,
  };
  valueQuotes.set(v, rate.quote);
  return v;
}

/** The savings question. Separate model call, separate tool, same discipline: the
 *  quote is checked against the text we sent and a rate outside a plausible range
 *  is refused. */
async function askRateModel(
  product: string,
  sourceUrl: string,
  text: string,
  log: Log,
): Promise<ExtractedRate | null> {
  if (text.length > MAX_MODEL_CHARS) {
    throw new Error(
      `document is ${Math.round(text.length / 1000)}k chars — refusing to send a truncated one`,
    );
  }
  const cut = sliceForExtraction(text);
  if (!cut.whole) {
    log(
      `    sliced ${Math.round(text.length / 1000)}k -> ${Math.round(cut.text.length / 1000)}k chars (${cut.regions} regions)`,
    );
  }
  const req = { product, sourceUrl, text: cut.text };
  const { system, user } = buildInterestPrompt(req);
  const { res, accept } = await ask(system, user, INTEREST_TOOL);
  if (res.kind === "declined") {
    settle(accept, false);
    return null;
  }
  const rate = parseInterestReply(res.input, req);
  settle(
    accept,
    openAnswerAccepted(rate ? rateToValue(rate, "agent", sourceUrl, cut.text, today) : null),
  );
  return rate;
}

/** THE CONFIRM STEP, one closed question on a document the run already holds. It fetches
 *  nothing. Same size refusal, same slice and same `ask` wrapper as the open question, so
 *  spend, the ceiling, truncation and a dead key behave identically. A declined or
 *  malformed reply is a rejection, not a confirmation. */
async function askConfirm(
  product: string,
  field: "fxFeePct" | "interestPct",
  stored: CatalogValue,
  text: string,
  log: Log,
): Promise<
  | { reply: ConfirmReply; accept: () => void }
  | { rejected: string; raw: unknown; accept: () => void }
> {
  if (text.length > MAX_MODEL_CHARS) {
    throw new Error(
      `document is ${Math.round(text.length / 1000)}k chars — refusing to send a truncated one`,
    );
  }
  const cut = sliceForExtraction(text);
  const req = {
    product,
    field,
    storedValue: stored.value,
    storedConditions: stored.conditions,
    text: cut.text,
  };
  const { system, user } = buildConfirmPrompt(req);
  const { res, accept } = await ask(system, user, CONFIRM_TOOL);
  if (res.kind === "declined") return { rejected: "model declined", raw: null, accept };
  const reply = parseConfirmReply(res.input, req);
  if (!reply) log(`    rejected reply: ${JSON.stringify(res.input).slice(0, 300)}`);
  return reply
    ? { reply, accept }
    : {
        rejected: "malformed reply, quote not in the page, or quote lacks the stored figure",
        raw: res.input,
        accept,
      };
}

const state = JSON.parse(readFileSync(STATE, "utf8"));

// REUSE OF MODEL REPLIES. See scripts/catalog/replyCache.ts and "How a change gets published"
// in docs/catalog/watchlist.md.
const CACHE_PATH = process.env.CATALOG_MODEL_CACHE?.trim() || "docs/catalog/model-cache.json";
const CACHE_DAYS = (() => {
  const raw = process.env.CATALOG_CACHE_DAYS?.trim();
  if (!raw) return 28;
  if (/^(\d|[1-8]\d|90)$/.test(raw)) return Number(raw);
  console.log(`CATALOG_CACHE_DAYS="${raw}" is not an integer from 0 to 90: using 28.`);
  return 28;
})();
const CACHE_UNUSED_DAYS = 42;
const cacheOn = !args.includes("--no-cache");
/** A dry run writes the cache only when it was pointed at a scratch file outside the repo's catalogue folder. */
const cacheOutsideCatalogDir = (() => {
  const rel = relative(resolve("docs/catalog"), resolve(CACHE_PATH));
  return rel.startsWith("..") || resolve(rel) === rel;
})();
let replyCache: ReplyCache = { version: 1, entries: {} };
if (cacheOn && existsSync(CACHE_PATH)) {
  try {
    replyCache = parseCache(JSON.parse(readFileSync(CACHE_PATH, "utf8")));
  } catch {
    // an unreadable cache file is an empty cache
  }
}
/** Figures waiting for a second read at the start of the run, "productId.field". */
const pendingAtStart = new Set<string>(Object.keys(state.pending ?? {}));
/** Figures the last persisted run held, "productId.field". */
const heldAtStart = new Set<string>((state.heldLastRun as string[] | undefined) ?? []);
function saveCache(): void {
  if (!cacheOn || (dry && !cacheOutsideCatalogDir)) return;
  try {
    mkdirSync(dirname(resolve(CACHE_PATH)), { recursive: true });
    writeFileSync(
      CACHE_PATH,
      JSON.stringify(prune(replyCache, today, CACHE_UNUSED_DAYS), null, 2) + "\n",
    );
  } catch (e) {
    console.error(`  (could not save the model reply cache: ${(e as Error).message})`);
  }
}
/** Hosts the guard trusts come from this snapshot: a host that appears during the run
 *  must not vouch for itself. */
/** Figures a person must decide, from docs/catalog/manual-hold.json: "productId.field" to the reason.
 *  A missing or malformed file means no holds; it never stops the run. */
const MANUAL_HOLD = "docs/catalog/manual-hold.json";
const manualHoldReasons: Record<string, string> = (() => {
  try {
    const raw: unknown = JSON.parse(readFileSync(MANUAL_HOLD, "utf8"));
    const holds = (raw as { holds?: unknown } | null)?.holds;
    if (!Array.isArray(holds)) throw new Error('no "holds" list');
    const out: Record<string, string> = {};
    for (const h of holds as { key?: unknown; reason?: unknown }[]) {
      if (typeof h?.key === "string" && h.key.includes(".")) {
        out[h.key] = typeof h.reason === "string" ? h.reason : "";
      }
    }
    return out;
  } catch (e) {
    console.log(
      `manual hold list not used (${(e as Error).message}): no figure is held for a person.`,
    );
    return {};
  }
})();
const manualHolds: ReadonlySet<string> = new Set(Object.keys(manualHoldReasons));
if (manualHolds.size) console.log(`manual holds: ${[...manualHolds].join(", ")}`);
const productsAtStart: typeof state.products = structuredClone(state.products);
const ids: string[] = Object.keys(state.products).filter((id) => !only || matchesOnly(id));
/** How many products the PREVIOUS run found any figure for — covered or not.
 *  Snapshotted before the loop overwrites it, because it is half of the guard at
 *  the bottom. */
const figuresBefore = ids.filter((id) => state.products[id].lastValue != null).length;
let attemptsMade = 0;

type Entry = {
  id: string;
  product: string;
  issuer?: string;
  kind?: string;
  fields: Partial<Record<CatalogField, CatalogValue>>;
};
/** Products finish in any order; each lands in the slot of its place in `ids`. */
const entrySlots: (Entry | undefined)[] = Array.from({ length: ids.length }, () => undefined);
/** The finished products in `ids` order. Rebuilt from the slots by syncEntries. */
const entries: Entry[] = [];
function syncEntries(): void {
  entries.length = 0;
  for (const e of entrySlots) if (e) entries.push(e);
}

/** THE FIGURE A PRODUCT ANSWERS WITH, whichever question it was asked. Counting
 *  fxFeePct alone made a savings sweep report "covered 0/3" while printing three
 *  ticks — the extraction had worked and the counter had not caught up. A number
 *  that disagrees with the lines above it is worse than no number. */
function figureOf(e: {
  fields: Partial<Record<CatalogField, CatalogValue>>;
}): CatalogValue | undefined {
  return e.fields.fxFeePct ?? e.fields.interestPct;
}

const readPrevCatalog = (): { entries: typeof entries } =>
  existsSync(CATALOG) ? JSON.parse(readFileSync(CATALOG, "utf8")) : { entries: [] };

/** The guard judges this run's rows against the catalogue on disk. It changes
 *  nothing on disk: the verdicts and the new pending map travel with the result. */
function guard(rows: typeof entries) {
  const prev = readPrevCatalog();
  return guardRun({
    prev: prev.entries,
    rows,
    knownHosts: knownHostsByIssuer(productsAtStart, prev.entries),
    pending: state.pending ?? {},
    storedChecks,
    manualHolds,
    today,
  });
}

/** ONE merge, used by the normal --only exit AND by the fatal-key guard. Two
 *  implementations of "merge a subset into the artifact" would drift, and the one
 *  that drifted would be the error path nobody exercises. */
function mergeSubset(
  rows: typeof entries,
  guarded: ReturnType<typeof guard> = guard(rows),
  counters?: Pick<ReturnType<typeof coverageForRun>, "uncheckedSince">,
): { total: number; kept: string[]; merged: typeof entries } {
  const prev = readPrevCatalog();
  // De samenvoeging zelf staat in packages/core/src/catalogMerge.ts: puur en
  // getoetst, want hier was hij niet te testen zonder de sweep te draaien. Twee
  // regels zitten erin — een veld dat deze run niet mat is geen veld dat hij
  // heeft weerlegd, en een geweigerd cijfer verdringt geen gedekt cijfer — en
  // die tweede geldt PER VELD. Op entry-niveau hield één zwak veld het hele
  // product tegen, inclusief een goed cijfer ernaast.
  const { entries: merged, kept } = mergeCatalogEntries(
    prev.entries,
    guarded.rows,
    Object.keys(state.products),
  );
  if (kept.length) {
    console.log(
      `  kept ${kept.length} existing covered figure(s) rather than demote them: ${kept.join(", ")}`,
    );
  }
  // Pending lives next to lastRun, and only the two write paths persist it.
  state.pending = guarded.pending;
  // Held figures of the products this write covers are replaced; other products keep theirs.
  const swept = new Set(rows.map((r) => r.id));
  state.heldLastRun = mergeHeld(state.heldLastRun as string[] | undefined, swept, guarded.verdicts);
  state.heldSince = nextHeldSince(state.heldSince ?? {}, state.heldLastRun as string[], today);
  // The first date each figure went unchecked rides along on the two write paths only;
  // the early exits pass none, so a refused run changes no date.
  if (counters) state.uncheckedSince = counters.uncheckedSince;
  writeFileSync(CATALOG, JSON.stringify({ generatedAt: today, entries: merged }, null, 2) + "\n");
  writeFileSync(STATE, JSON.stringify(state, null, 2) + "\n");
  saveCache();
  return { total: merged.length, kept, merged };
}

// From here on a billing failure keeps what has been read rather than discarding it.
onFatal = () => {
  syncEntries();
  saveCache();
  if (!entries.length) {
    console.error("  (nothing had been read yet, so nothing to save)");
    return;
  }
  let early: ReturnType<typeof guard> | undefined;
  try {
    early = guard(entries);
    earlyVerdicts = early.verdicts;
  } catch (e) {
    console.error(`  (guard failed on the partial results: ${(e as Error).message})`);
  }
  const covered = entries.filter((e) => isCovered(figureOf(e))).length;
  if (dry) {
    console.error(
      `  --dry: would have saved ${entries.length} product(s) read before the failure (${covered} covered); nothing written.`,
    );
    return;
  }
  const { total } = mergeSubset(entries, early);
  console.error(
    `  SAVED ${entries.length} product(s) read before the failure (${covered} covered) into ${CATALOG} (${total} total).`,
  );
};
/** What the catalogue held when the run started: the confirm step asks about these figures. */
const catalogAtStart = structuredClone(readPrevCatalog().entries);
/** Per product the loop got to: did any document get read, and why no figure came out. */
const reached = new Map<string, { fetched: boolean; reason: string | null }>();
/** How each stored figure that the run read again was confirmed, keyed "productId.field". */
const confirmedBy = new Map<string, ConfirmedBy>();

/** The one question a product is asked, or null when none applies (see sweptFieldFor).
 *  Decided from the catalogue as it was at the start of the run. */
const fieldPlan = new Map<string, "fxFeePct" | "interestPct" | null>(
  Object.entries(state.products).map(([id, p]) => [
    id,
    sweptFieldFor(
      (p as { kind?: string }).kind,
      new Set(
        Object.entries(catalogAtStart.find((e) => e.id === id)?.fields ?? {})
          .filter(([, v]) => v)
          .map(([f]) => f as CatalogField),
      ),
    ),
  ]),
);
/** Products on this run's list that a question applies to. */
const sweptList = ids.filter((id) => fieldPlan.get(id));
const skippedCount = ids.length - sweptList.length;

/** The coverage contract: every catalogue figure gets a status. `early` marks a run that stopped
 *  before the loop finished, so unreached products are "stopped-early". */
function buildCoverage(verdicts: readonly FieldVerdict[], early: boolean) {
  // The held-since dates as this run's write will persist them (same rule as mergeSubset).
  const heldKeys = mergeHeld(
    state.heldLastRun as string[] | undefined,
    new Set(entries.map((e) => e.id)),
    verdicts,
  );
  return coverageForRun({
    heldSince: nextHeldSince(state.heldSince ?? {}, heldKeys, today),
    entries: catalogAtStart,
    verdicts,
    expected: Object.entries(state.products).flatMap(([id, p]) => {
      const field = fieldPlan.get(id);
      return field ? [{ id, product: (p as { product: string }).product, field }] : [];
    }),
    sweptFields: new Set<CatalogField>(["fxFeePct", "interestPct"]),
    watchedIds: new Set(Object.keys(state.products)),
    sweptIds: new Set(sweptList),
    reached,
    stoppedEarlyIds: new Set(early ? sweptList.filter((id) => !reached.has(id)) : []),
    uncheckedSince: state.uncheckedSince ?? {},
    confirmedBy,
    modelOn: useAgent,
    today,
    fullRun: !only,
  });
}
const changes: string[] = [];
const changeSlots: (string | undefined)[] = Array.from({ length: ids.length }, () => undefined);
/** The verified quote of the open question's read, per "productId.field". */
const readQuotes = new Map<string, string>();
/** Cross-check of the stored figure, per "productId.field", when the run read a different covered figure. */
const storedChecks = new Map<string, "still-stated" | "gone" | "unresolved">();
/** Full accepted quotes, up to 1000 characters, for the run summary. */
type ConfirmQuote = { id: string; field: string; status: string; quote: string };
const confirmQuotes: ConfirmQuote[] = [];
const quoteSlots: (ConfirmQuote | undefined)[] = Array.from(
  { length: ids.length },
  () => undefined,
);
/** One product, start to finish. Everything it keeps for itself is declared in here;
 *  what it shares is keyed by product id or written to its own slot (`index`). */
async function sweepProduct(id: string, index: number, log: Log): Promise<void> {
  const p = state.products[id];
  const attempts: RouteAttempt[] = [];
  /** Every document this run read for the product, in reading order. The confirm step
   *  asks about one of them; `figure` marks one on which the open question returned a figure. */
  const held: { url: string; text: string; figure: boolean; snapshotDate: string | null }[] = [];
  const hold = (url: string, text: string, snapshotDate: string | null = null) => {
    const d = { url, text, figure: false, snapshotDate };
    held.push(d);
    return d;
  };
  // WHICH QUESTION THIS PRODUCT ANSWERS. A savings account has no foreign-currency
  // surcharge, so asking for one produced 35 guaranteed blanks every sweep and
  // made the coverage denominator dishonest. It has an interest rate instead, and
  // that is a different question with a different tool.
  const planned = fieldPlan.get(id);
  if (!planned) return;
  const savings = planned === "interestPct";

  if (savings) {
    // Only the agent rung: a rate ladder is a table, and the regex rungs were
    // written for a percentage next to the word "koersopslag".
    const src = p.docUrl ?? p.pdfUrl ?? (p.readable === "yes" ? p.termsUrl : null);
    if (useAgent && src) {
      const kind: "pdf" | "html" = p.docUrl
        ? p.docFetch === "jina"
          ? "html"
          : resolveDocKind({ url: p.docUrl, docKind: p.docKind })
        : p.pdfUrl
          ? "pdf"
          : "html";
      const url = p.docFetch === "jina" ? `https://r.jina.ai/${src}` : src;
      attempts.push({
        route: "agent",
        run: async () => {
          const text = await readPage(url, kind);
          const doc = hold(src, text);
          const rate = await askRateModel(p.product, src, text, log);
          doc.figure = rate !== null;
          return rate ? rateToValue(rate, "agent", src, text, today) : null;
        },
      });
    }
  }

  if (!savings && p.pdfUrl) {
    attempts.push({
      route: "provider-pdf",
      run: async () => {
        const text = await readPage(p.pdfUrl, "pdf");
        hold(p.pdfUrl, text);
        const figures = readIngTariffs(text);
        const f = figures.find((x) => x.field === "fxFeePct");
        if (!f) return null;
        return {
          value: f.value,
          route: "provider-pdf",
          sourceUrl: p.pdfUrl,
          // The document states its own validity date ("Deze brochure is geldig
          // vanaf 15 juni 2026"), so read it rather than trusting a constant
          // typed into state.json: ING reuses this asset URL across editions, and
          // the pinned date would have outlived the edition it describes — a
          // figure stamped with the previous edition's date, which is the exact
          // bug this project has shipped twice.
          checkedAt: readDocumentDate(text) ?? p.pdfCheckedAt ?? today,
          // The parser's OWN confidence, not a constant. Hard-coding true made
          // "my regex matched no threshold" mean "this rate has no conditions" —
          // the conflation the Revolut incident is named after, and this very
          // document contains a capped 0% that the regex cannot see (the cap is
          // in a footnote). See packages/core/src/pdfText.ts.
          conditions: f.conditions,
          conditionsKnown: f.conditionsKnown,
        };
      },
    });
  }
  if (!savings && p.termsUrl && p.readable === "yes") {
    attempts.push({
      route: "provider-page",
      run: async () => {
        // The cache hands back tag-stripped text with its line breaks intact (the
        // model rung needs them to see headings); this rung wants one flat line.
        const raw = await readPage(p.termsUrl, "html");
        hold(p.termsUrl, raw);
        const text = raw.replace(/\s+/g, " ");
        const m =
          /(\d{1,2})[,.](\d{1,2})\s*%[^.]{0,40}koersopslag|koersopslag[^.]{0,40}?(\d{1,2})[,.](\d{1,2})\s*%/i.exec(
            text,
          );
        if (!m) return null;
        const value = Number(`${m[1] ?? m[3]}.${m[2] ?? m[4]}`);
        if (!Number.isFinite(value)) return null;
        // Conditions are NOT established by this crude read, and saying so is the
        // point: an unconditional-looking rate that was never checked for a cap
        // is exactly how Revolut shipped at 0%.
        return {
          value,
          route: "provider-page",
          sourceUrl: p.termsUrl,
          checkedAt: today,
          conditions: null,
          conditionsKnown: false,
        };
      },
    });
  }
  // THE ARCHIVE. Only for a page WE cannot read live — a snapshot is by
  // definition staler than a fetch, so it must never displace a live read. That
  // is also why it is model-extracted rather than regex-extracted: the products
  // that reach this rung have no other route at all, and a regex figure with
  // conditionsKnown:false would leave them exactly as uncovered as they are now
  // while putting a number nobody checked into state.json's change detection.
  // Without a key the rung is skipped and says so, rather than guessing.
  if (useAgent && p.termsUrl && p.readable !== "yes") {
    attempts.push({
      route: "wayback",
      run: async () => {
        const snap = await readArchived(p.termsUrl);
        if (!snap) return null;
        const doc = hold(snap.url, snap.text, snap.date);
        const figure = await askModel(p.product, snap.url, snap.text, log);
        doc.figure = figure !== null;
        // The snapshot's date, not today's. It is when that text was true.
        return figure ? toValue(figure, "wayback", snap.url, snap.text, snap.date) : null;
      },
    });
  }

  // THE RUNG THAT CAN EARN conditionsKnown. It sorts last in the ladder, so it
  // only runs when nothing above it came back COVERED — which today is almost
  // always, because provider-page cannot establish a condition and says so. The
  // provider's own PDF is preferred over its HTML when both exist: the tariff
  // sheet is where the caps and tiers actually are.
  if (!savings && useAgent && (p.docUrl || p.pdfUrl || (p.termsUrl && p.readable === "yes"))) {
    attempts.push({
      route: "agent",
      run: async () => {
        // THE PDF IS TRIED FIRST BUT IS NOT ASSUMED BETTER. Measured on ICS: its
        // general terms say "de opslag is 2%" and then defer the per-card price to
        // "de Documentatie", so the model correctly refuses — while the marketing
        // page states the same 2% WITH its scope and settles. Preferring the PDF
        // unconditionally therefore LOST six covered figures the moment discovery
        // pinned that document.
        //
        // So: try the document, and when it does not settle the conditions, read
        // the HTML page too and keep whichever one did. The second call is only
        // paid for when the first came back unsettled, which is also the only time
        // it can change the answer.
        // docUrl is the per-issuer document found by the hunt and confirmed by an
        // independent skeptic. It is tried first, then any pinned PDF, then the
        // marketing page the product started with. Ordering is best-evidenced
        // first, but NOT trusted blindly — the loop below still falls through to
        // the next source whenever one fails to settle the conditions.
        const sources: { url: string; kind: "pdf" | "html" }[] = [];
        // PROVENANCE IS NOT TRANSPORT. revolut.com answers a plain fetch with 403
        // but r.jina.ai renders it and hands back the real fee page. The SOURCE is
        // still Revolut's own page — storing the proxy URL as sourceUrl would
        // credit a reader service for a disclosure Revolut published, and would
        // rot the moment the proxy changes. So docUrl stays the issuer's URL and
        // docFetch records how to reach it.
        if (p.docUrl) {
          const via = p.docFetch === "jina" ? `https://r.jina.ai/${p.docUrl}` : p.docUrl;
          sources.push({
            url: via,
            kind:
              p.docFetch === "jina"
                ? "html"
                : resolveDocKind({ url: p.docUrl, docKind: p.docKind }),
          });
        }
        if (p.pdfUrl) sources.push({ url: p.pdfUrl, kind: "pdf" });
        if (p.termsUrl && p.readable === "yes") sources.push({ url: p.termsUrl, kind: "html" });
        const seenSrc = new Set<string>();
        let best: CatalogValue | null = null;
        for (const src of sources) {
          if (seenSrc.has(src.url)) continue;
          seenSrc.add(src.url);
          const text = await readPage(src.url, src.kind);
          const doc = hold(src.url, text);
          const figure = await askModel(p.product, src.url, text, log);
          doc.figure = figure !== null;
          const value = figure ? toValue(figure, "agent", src.url, text, today) : null;
          if (value && isCovered(value)) return value;
          best = best ?? value;
        }
        return best;
      },
    });
  }

  // A source an earlier discovery search pinned in state.json (foundUrl) is still
  // fetched and read like any other document. The search that found them is gone.
  if (!savings && useAgent && p.foundUrl) {
    const found = {
      url: p.foundUrl as string,
      kind: p.foundKind === "pdf" ? "pdf" : "html",
    } as const;
    attempts.push({
      route: "agent",
      run: async () => {
        // Fetch it ourselves. If the provider blocks us on this host too, the
        // archive is tried for the URL as well.
        let text: string;
        let sourceUrl = found.url;
        let fallbackDate = today;
        try {
          text = await readPage(found.url, found.kind);
        } catch (direct) {
          const snap = await readArchived(found.url);
          if (!snap) throw direct;
          text = snap.text;
          sourceUrl = snap.url;
          fallbackDate = snap.date;
        }
        const doc = hold(sourceUrl, text, sourceUrl === found.url ? null : fallbackDate);
        const figure = await askModel(p.product, sourceUrl, text, log);
        doc.figure = figure !== null;
        return figure ? toValue(figure, "agent", sourceUrl, text, fallbackDate) : null;
      },
    });
  }

  // THE READER RUNG. Last, so it only runs when no earlier rung covered the figure:
  // plain fetch failed (bot block), the text was too short, or the model declined.
  // r.jina.ai renders the page, which recovered 19 of 30 such documents on
  // 2026-11-22. The stored sourceUrl stays the provider's own URL. Products with
  // docFetch "jina" were already read through the reader above; not asked twice.
  let readerRan = false;
  if (useAgent && p.docFetch !== "jina") {
    // Computed when the rung runs: plainFailed is only known after the earlier rungs.
    const readerUrls = () => readerCandidates(p, plainFailed);
    if (p.termsUrl || p.docUrl || p.foundUrl || p.pdfUrl) {
      attempts.push({
        route: "agent",
        run: async () => {
          if (readerBreaker.open) throw new Error("reader: skipped, reader unavailable this run");
          const urls = readerUrls();
          if (!urls.length) return null; // every PDF was read by plain fetch
          readerRan = true;
          // At most ONE reader model call per product: the first candidate that
          // yields a document gets the question, whatever the model answers.
          const doc = await firstDocument(urls, readViaReader);
          if (doc.url === null || doc.text === null) {
            throw new Error(`reader: ${doc.failures.join("; ")}`);
          }
          const held1 = hold(doc.url, doc.text);
          try {
            if (savings) {
              const rate = await askRateModel(p.product, doc.url, doc.text, log);
              held1.figure = rate !== null;
              if (rate) return rateToValue(rate, "agent", doc.url, doc.text, today);
            } else {
              const figure = await askModel(p.product, doc.url, doc.text, log);
              held1.figure = figure !== null;
              if (figure) return toValue(figure, "agent", doc.url, doc.text, today);
            }
          } catch (e) {
            throw new Error(`reader: ${e instanceof Error ? e.message : String(e)}`);
          }
          throw new Error("reader: model found no figure");
        },
      });
    }
  }

  attemptsMade += attempts.length;
  const ladder = await runLadder(attempts);
  const { tried, reason: ladderReason } = ladder;
  let value = ladder.value;
  const field = planned;
  const quoteOfRead = value ? valueQuotes.get(value) : undefined;
  if (quoteOfRead) readQuotes.set(`${id}.${field}`, quoteOfRead);
  // THE CONFIRM STEP, two cases, both for a covered figure the catalogue already holds:
  //  1. the ladder ended without a covered answer and without a read of the same number
  //     (the guard turns that read into a confirm by itself): ask whether the stored figure is
  //     still stated;
  //  2. the ladder ended COVERED on a DIFFERENT number: ask the same question for the stored
  //     figure. If it is still stated, the page shows both and the guard holds the new one.
  // One call, on a document already held; it fetches nothing.
  const stored = catalogAtStart.find((e) => e.id === id)?.fields[field];
  const same = (a: number, b: number) => Math.round(a * 1e4) === Math.round(b * 1e4);
  let confirmNote: string | null = null;
  let confirmedByQuote = false;
  const foundCovered = isCovered(value ?? undefined);
  const differs =
    foundCovered && !!stored && isCovered(stored) && !same(value!.value, stored.value);
  const needsConfirm =
    useAgent &&
    stored &&
    isCovered(stored) &&
    (differs || (!foundCovered && held.length > 0 && !(value && same(value.value, stored.value))));
  if (needsConfirm && held.length === 0) {
    // A change that cannot be cross-checked is not passed on.
    storedChecks.set(`${id}.${field}`, "unresolved");
    confirmNote = "confirm: cross-check unresolved (no document to ask on) — change held";
    log(`  confirm ${p.product}: no document to ask on`);
  } else if (needsConfirm) {
    // Document: the one the open question found a figure on, else the document of record
    // (docUrl, pdfUrl, foundUrl, termsUrl) if the run read it, else the last one read.
    const record = [p.docUrl, p.pdfUrl, p.foundUrl, p.termsUrl].filter(Boolean) as string[];
    const bare = (u: string) => u.replace(/^https:\/\/r\.jina\.ai\//, "");
    const ofRecord = record
      .map((u) => held.find((d) => bare(d.url) === u))
      .find((d) => d !== undefined);
    // A change is cross-checked on the STORED figure's own document when the new figure came
    // from another one and this run read the stored one; "not on the page" only means something there.
    const foundDoc = foundCovered ? held.find((d) => d.url === value!.sourceUrl) : undefined;
    const otherDocument = differs && !sameDocument(value!.sourceUrl, stored!.sourceUrl);
    const storedDoc = otherDocument
      ? held.find((d) => sameDocument(d.url, stored!.sourceUrl))
      : undefined;
    const doc =
      storedDoc ?? foundDoc ?? held.findLast((d) => d.figure) ?? ofRecord ?? held[held.length - 1]!;
    const onStoredDocument = !otherDocument || storedDoc !== undefined;
    let line: string;
    let status = "";
    let quote = "";
    let outcome: ConfirmOutcome;
    let why = "";
    let acceptReply = (): void => {};
    try {
      const res = await askConfirm(p.product, field, stored!, doc.text, log);
      acceptReply = res.accept;
      if ("rejected" in res) {
        outcome = { kind: "rejected", raw: res.raw };
        why = `reply rejected (${res.rejected})`;
        line = `rejected: ${res.rejected}`;
      } else {
        outcome = { kind: "reply", reply: res.reply };
        if (res.reply.status === "not_on_page") {
          status = "not_on_page";
          line = "not_on_page";
        } else {
          status = res.reply.status;
          quote = res.reply.quote;
          line =
            res.reply.status === "changed"
              ? `changed to ${res.reply.newValue}  "${quote.slice(0, 160)}"`
              : `still_stated  "${quote.slice(0, 160)}"`;
        }
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      outcome = { kind: "failed" };
      why = `call failed (${msg})`;
      line = `call failed: ${msg}`;
    }
    // The reply is kept only when it settled something (see confirmAccepted).
    settle(
      acceptReply,
      confirmAccepted(outcome, differs ? { foundValue: value!.value, onStoredDocument } : null),
    );
    if (differs) {
      const check = storedCheckOf(outcome, value!.value, onStoredDocument);
      storedChecks.set(`${id}.${field}`, check);
      confirmNote =
        check === "still-stated"
          ? "confirm: stored value still stated — conflicting read, held"
          : check === "gone"
            ? "confirm: stored value not on page, change left to the guard"
            : !onStoredDocument
              ? "confirm: cross-check unresolved (stored figure's own document was not read) — change held"
              : `confirm: cross-check unresolved (${why || `reply ${status}`}) — change held`;
    } else if (outcome.kind === "reply" && outcome.reply.status === "still_stated") {
      confirmNote = "confirm: still stated";
      confirmedByQuote = true;
      // An uncovered read of the stored number: the guard confirms it only from a known host.
      value = confirmRead({
        storedValue: stored!.value,
        url: doc.url,
        snapshotDate: doc.snapshotDate,
        today,
      });
    } else if (outcome.kind === "reply" && outcome.reply.status === "changed") {
      confirmNote = `confirm: changed to ${outcome.reply.newValue} (not published)`;
    } else if (outcome.kind === "reply") {
      confirmNote = "confirm: not on page";
    } else {
      confirmNote = `confirm: ${why}`;
    }
    if (status) quoteSlots[index] = { id, field, status, quote: quote.slice(0, 1000) };
    log(`  confirm ${p.product}: ${line}`);
  }
  // The spec's honest floor is "unknown, WITH the reason named". runLadder returns
  // null for an empty attempt list, which would record a blank against a product
  // nobody has wired a route for — indistinguishable from one that was tried and
  // came back empty.
  const baseReason =
    ladderReason?.replaceAll("agent: reader:", "reader:") ??
    (attempts.length
      ? null
      : `${NO_ROUTE_PREFIX} (readable=${p.readable}, pdfUrl=${p.pdfUrl ? "yes" : "none"})`);
  const reason = confirmNote ? [baseReason, confirmNote].filter(Boolean).join(" · ") : baseReason;
  if (stored && value && same(value.value, stored.value)) {
    confirmedBy.set(
      `${id}.${field}`,
      confirmedByQuote ? "quote-check" : isCovered(value) ? "read-again" : "same-number",
    );
  }
  reached.set(id, { fetched: held.length > 0, reason: baseReason });
  const prev = state.products[id].lastValue ?? null;
  if (value && prev !== null && prev !== value.value) {
    changeSlots[index] = `${p.product}: ${prev} → ${value.value} (${value.route})`;
  }
  state.products[id].lastChecked = today;
  state.products[id].lastValue = value ? value.value : null;
  state.products[id].lastRoute = value ? value.route : null;
  // The reason is kept even when a figure came back, because runLadder returns the
  // best PARTIAL along with what kept it from counting. Blanking it on `value`
  // would throw the reason away exactly when it explains why the product is still
  // uncovered.
  state.products[id].lastReason = reason;
  // The artifact carries the issuer and kind as well as the figure. Without them
  // it cannot be read on its own — the web app would have to bundle the 117 kB
  // state file just to learn that "ABN AMRO Direct Sparen" is ABN AMRO's, and a
  // consumer of a published catalogue should not need our working notes.
  entrySlots[index] = {
    id,
    product: p.product,
    issuer: p.issuer,
    kind: p.kind,
    fields: value ? { [field]: value } : {},
  };
  // The figure and its conditions are printed, not just a tick. --dry writes
  // nothing, so this console line is the ONLY artifact of a dry run, and
  // "✓ ING creditcard  provider-pdf" does not tell you WHICH number it believed —
  // which is how the debit card's 1,4% nearly shipped under the credit card's id.
  // A figure that is NOT covered prints its reason next to it, because after the
  // conditions fix the interesting line is exactly the one that has a number and
  // still does not count. Printing "1.4%" alone reads like a success.
  const shown = value
    ? `${value.value}%${value.conditions ? ` [${value.conditions}]` : ""}${isCovered(value) ? "" : `  — ${reason ?? "not covered"}`}`
    : (reason ?? "no route wired");
  log(
    `${isCovered(value ?? undefined) ? "✓" : "·"} ${p.product.slice(0, 40).padEnd(42)} ${(tried.join(">") + (readerRan ? "+reader" : "") || "-").padEnd(26)} ${shown}`,
  );
}

/** Set when the ceiling or the deadline stopped the run from starting more products. */
let stoppedEarlyReason: "cost ceiling" | "time limit" | null = null;
await runPool(
  ids,
  concurrency,
  async (id, index) => {
    if (concurrency === 1) {
      return productContext.run(id, () => sweepProduct(id, index, console.log));
    }
    const buffer = { product: state.products[id].product as string, lines: [] as string[] };
    openBuffers.add(buffer);
    try {
      await productContext.run(id, () => sweepProduct(id, index, (l) => buffer.lines.push(l)));
    } finally {
      // A buffer already flushed by an exit is no longer in the set.
      if (openBuffers.delete(buffer) && buffer.lines.length) console.log(buffer.lines.join("\n"));
    }
  },
  () => {
    const reason = stopReason(spendTotalUsd(), MAX_USD, minutesSinceStart(), DEADLINE_MIN);
    if (reason && !stoppedEarlyReason) {
      stoppedEarlyReason = reason;
      console.log(
        `\nSTOP STARTING: ${reason} reached (spend ≈ $${spendTotalUsd().toFixed(2)}, ${minutesSinceStart()} min). Products already running finish.`,
      );
    }
    return !stoppedEarlyReason;
  },
);
syncEntries();
changes.push(...changeSlots.filter((c): c is string => !!c));
confirmQuotes.push(...quoteSlots.filter((q): q is ConfirmQuote => !!q));

// Coverage is per FIELD, and a sweep can now mix both kinds in one run, so the
// two are counted separately and added rather than asked of one field.
const cFx = coverage(entries, "fxFeePct");
const cInt = coverage(entries, "interestPct");
const c = {
  covered: cFx.covered + cInt.covered,
  total: entries.length,
  byRoute: Object.fromEntries(
    (Object.keys(cFx.byRoute) as (keyof typeof cFx.byRoute)[]).map((k) => [
      k,
      cFx.byRoute[k] + cInt.byRoute[k],
    ]),
  ) as typeof cFx.byRoute,
};
if (skippedCount) {
  console.log(
    `\n${skippedCount} products skipped: no FX or interest figure applies (account fee, points and cashback come later)`,
  );
}
console.log(`\ncovered ${c.covered}/${c.total}  by route: ${JSON.stringify(c.byRoute)}`);
if (changes.length) console.log(`\nCHANGED:\n  ${changes.join("\n  ")}`);

const figuresFound = entries.filter((e) => figureOf(e)).length;
// Two counts, not a ratio: one route can make several requests (the archive costs
// a CDX lookup plus the snapshot itself), so responses/attempts was going above 1
// and reading like a bug.
console.log(
  `figures found: ${figuresFound} (previous run: ${figuresBefore})  ·  routes attempted: ${attemptsMade}  ·  fetches answered: ${httpResponses}`,
);
// Whether the model rung ran at all is part of reading the coverage number: the
// same sweep with and without a key produces two different products, and "0
// agent" next to a low covered-count is the explanation rather than a mystery.
console.log(`archive: ${waybackReads} snapshot(s) read`);
console.log(
  useAgent
    ? `model: ${EXTRACT_MODEL}, ${modelCalls} call(s)\nmodel calls: ${modelCalls} new (${freshAttempts} attempted), ${modelReused} reused from unchanged pages\nmodel fallbacks: ${modelFallbacks}${FALLBACK_MODEL ? ` (${FALLBACK_MODEL})` : " (off)"}`
    : `model: not run (${apiKey ? "--no-agent" : "no MISTRAL_API_KEY in the environment"})`,
);
// What the run cost, from the API's own usage numbers. A rung that spends money
// and reports only coverage is a rung nobody can set a cadence for.
if (spend.size) console.log(`spend:\n${spendLines().join("\n")}`);
console.log(`run time: ${minutesSinceStart()} minutes  ·  concurrency: ${concurrency}`);
console.log(`model retries: 429 ×${modelRetries.rateLimited}, 5xx ×${modelRetries.serverError}`);

const runWarnings: string[] = [];
{
  const notReached = sweptList.filter((id) => !reached.has(id)).length;
  if (stoppedEarlyReason && notReached > 0) {
    runWarnings.push(
      `Stopped early (${stoppedEarlyReason}): ${notReached} products were not reached this week.`,
    );
  }
}
const health = modelHealth({
  enabled: useAgent,
  attempts: freshAttempts,
  answers: modelCalls,
  reused: modelReused,
});
if (health.kind === "warn") runWarnings.push(health.text);
if (useAgent && freshAttempts === 0) {
  runWarnings.push("No fresh model call was made this run; the model key was not exercised.");
}
for (const w of runWarnings) console.log(`WARNING: ${w}`);

// The guard runs once, before the dry exit, so --dry shows the verdicts too.
const guarded = guard(entries);
const coverageResult = buildCoverage(guarded.verdicts, stoppedEarlyReason !== null);
for (const v of guarded.verdicts) {
  if (v.verdict.kind === "confirm" || v.verdict.kind === "unjudged") continue;
  const detail =
    v.verdict.kind === "hold"
      ? v.verdict.reason
      : v.verdict.kind === "publish"
        ? v.verdict.viaPending
          ? "after second read"
          : ""
        : `first read ${v.verdict.pending.seenAt}`;
  if (v.verdict.kind === "publish" && v.verdict.conditionsOnly) {
    console.log(`GUARD conditions ${v.id}.${v.field}  ${v.found.value} (conditions text updated)`);
    continue;
  }
  console.log(
    `GUARD ${v.verdict.kind.padEnd(7)} ${v.id}.${v.field}  ${v.before?.value ?? "—"} → ${v.found.value}${detail ? `  (${detail})` : ""}`,
  );
}

/** Figures that crossed the 12-month line since last week, each reported once. */
function crossedAgeLine(catalogEntries: typeof entries): RunSummary["crossedAgeLine"] {
  const weekAgo = new Date(Date.parse(`${today}T00:00:00Z`) - 7 * 86_400_000)
    .toISOString()
    .slice(0, 10);
  return catalogEntries.flatMap((e) =>
    (Object.keys(e.fields) as CatalogField[]).flatMap((field) => {
      const v = e.fields[field];
      return v && isOlderThanMaxAge(v, today) && !isOlderThanMaxAge(v, weekAgo)
        ? [{ product: e.product, field, lastConfirmed: v.confirmedAt ?? v.checkedAt }]
        : [];
    }),
  );
}

/** How much the run checked: figures in the catalogue after the run, figures the guard judged, figures past the age line. */
function figureCounts(
  catalogEntries: typeof entries,
): Pick<RunSummary, "figuresTotal" | "figuresJudged" | "figuresOlderThan12Months"> {
  const figures = catalogEntries.flatMap((e) =>
    Object.values(e.fields).filter((v): v is CatalogValue => !!v),
  );
  return {
    figuresTotal: figures.length,
    figuresJudged: guarded.verdicts.filter((v) => v.verdict.kind !== "unjudged").length,
    figuresOlderThan12Months: figures.filter((v) => isOlderThanMaxAge(v, today)).length,
  };
}

/** The verified quote of each read behind a publish (not conditions-only) or pending verdict, cut to 300 characters; the manual-hold reasons. */
function evidenceFields(): Pick<RunSummary, "evidenceQuotes" | "manualHoldReasons"> {
  const quotes = Object.fromEntries(
    guarded.verdicts.flatMap((v) => {
      const key = `${v.id}.${v.field}`;
      const q = readQuotes.get(key);
      const wanted =
        v.verdict.kind === "pending" || (v.verdict.kind === "publish" && !v.verdict.conditionsOnly);
      return wanted && q ? [[key, q.slice(0, 300)]] : [];
    }),
  );
  return {
    ...(Object.keys(quotes).length ? { evidenceQuotes: quotes } : {}),
    ...(manualHolds.size ? { manualHoldReasons: { ...manualHoldReasons } } : {}),
  };
}

function writeSummary(
  status: RunSummary["status"],
  refusedReason: string | null,
  kept: string[],
  catalogEntries: typeof entries,
) {
  if (!summaryOut) return;
  const { GITHUB_SERVER_URL: server, GITHUB_REPOSITORY: repo, GITHUB_RUN_ID: runId } = process.env;
  const summary: RunSummary = {
    today,
    status,
    refusedReason,
    verdicts: guarded.verdicts,
    kept,
    failures: entries
      .filter((e) => Object.keys(e.fields).length === 0)
      .map((e) => ({ product: e.product, reason: state.products[e.id].lastReason ?? "no reason" })),
    crossedAgeLine: crossedAgeLine(catalogEntries),
    spendLines: spendLines(),
    runUrl: server && repo && runId ? `${server}/${repo}/actions/runs/${runId}` : null,
    ...figureCounts(catalogEntries),
    confirmQuotes,
    ...evidenceFields(),
    coverage: coverageResult.figures,
    durationMinutes: minutesSinceStart(),
    concurrency,
    modelRetries: { ...modelRetries },
    ...(useAgent
      ? { modelCallsNew: modelCalls, modelCallsReused: modelReused, modelFallbacks }
      : {}),
    ...(runWarnings.length ? { warnings: [...runWarnings] } : {}),
  };
  writeFileSync(summaryOut, JSON.stringify(summary, null, 2) + "\n");
}

/** A refused run persists nothing: no catalogue, no state, no pending. */
function refuse(line: string): never {
  console.error(`\n${line}`);
  writeSummary("refused", line, [], readPrevCatalog().entries);
  process.exit(1);
}

if (dry) {
  saveCache();
  console.log("\n--dry: nothing written");
  writeSummary("dry", null, [], readPrevCatalog().entries);
  process.exit(0);
}

// THE BLACKOUT GUARD. Every network error is caught inside runLadder — correctly,
// so one dead host does not cost the other routes — which means a machine with no
// network at all still exits 0, still rewrites the catalogue with 124 empty
// `fields`, and the Action still commits and pushes it unattended at 05:00 on a
// Monday. Nothing forces a human to read that diff before the server serves it.
//
// The test is deliberately NOT "coverage dropped": coverage legitimately falls to
// zero when a parser is made stricter, and a guard that blocks an honest result is
// a guard that gets disabled. These two are unambiguous machine failures instead:
// not one fetch got an answer of any kind, or every figure the last run held has
// vanished at once. Either way the run goes RED and writes nothing, because a
// failed sweep must not be indistinguishable from a swept-and-found-nothing one.
if (attemptsMade > 0 && httpResponses === 0) {
  refuse(
    `REFUSING TO WRITE: ${attemptsMade} routes attempted, not one fetch answered. That is this machine's network, not the providers'.`,
  );
}
// The same failure one layer out: the model was ASKED for and never once answered
// (all timed out, all refused, the rung threw every time). The figures that remain
// are the regex's, and the regex is the thing the model exists to correct - ABN
// AMRO's betaalpas reads 2% there when the page says 1,2%.
// A reused reply is an answer: a week in which every page is unchanged is a normal week. But
// fresh calls that all fail are not hidden by it: see modelHealth. (Judged before the dry exit.)
if (health.kind === "refuse") {
  refuse(`REFUSING TO WRITE: ${health.text}`);
}
if (figuresBefore > 0 && figuresFound === 0) {
  refuse(
    `REFUSING TO WRITE: the previous run held ${figuresBefore} figures and this one found none. Something broke between here and the sources; an empty catalogue is not a finding.`,
  );
}
// A --only run swept a SUBSET, so `entries` is a subset. Writing it to CATALOG
// would delete every product it did not look at — a committed artifact truncated
// by a debugging flag. The per-product state is still refreshed, since that is
// keyed by id and only touches what was swept.
if (only) {
  // MERGE, do not refuse. Writing `entries` wholesale would delete every product
  // the subset did not look at; refusing to write at all was the first fix and
  // became its own trap — figures were paid for and stranded in state.json,
  // reachable only by a full sweep.
  const { total, kept, merged } = mergeSubset(entries, guarded, coverageResult);
  console.log(
    `\nwrote ${STATE} and merged ${entries.length} swept product(s) into ${CATALOG} (${total} total).`,
  );
  writeSummary("written", null, kept, merged);
  process.exit(0);
}
state.lastRun = today;
// THE SAME MERGE AS --only, and that is the whole point. A full run sweeps every
// product but asks only TWO questions of them (fxFeePct, interestPct); the other
// fields on those same products — points, cashback, what the account costs to
// keep — were gathered by other means and are not in this run's answer. Writing
// `entries` wholesale therefore deleted them. There is one merge for both paths
// because two implementations would drift, and the one that drifted would be the
// path nobody watches.
const { total, kept, merged } = mergeSubset(entries, guarded, coverageResult);
console.log(`\nwrote ${CATALOG} (${total} products) and ${STATE}`);
writeSummary("written", null, kept, merged);
