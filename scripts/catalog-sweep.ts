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
 *   pnpm catalog:sweep                          # every product
 *   pnpm catalog:sweep -- --only ing-betaalpas  # one, while iterating
 *   pnpm catalog:sweep -- --dry                 # report, write nothing
 *   pnpm catalog:sweep -- --no-agent            # free tiers only, no model calls
 *   pnpm catalog:sweep -- --search              # ALSO let the model go LOOKING for sources (≈$0.55 each)
 *   pnpm catalog:sweep -- --search --max-search 3   # ...at most 3 of them
 *   pnpm catalog:sweep -- --search --search-all     # ...for ANY uncovered product, not just unreachable ones
 *
 * Five rungs, tried in ladder order, first COVERED answer wins:
 *
 *   provider-page  the provider's own HTML, plain fetch + regex        free
 *   provider-pdf   the provider's own tariff PDF, pdftotext + parser   free
 *   wayback        the provider's own page from the archive + model    a model call
 *   agent          the page or PDF we already hold + model             a model call
 *   agent          a document the model FOUND by searching + model     a search + a model call
 *
 * The model runs HERE and only here. It is the sweep's last rung, and it is what
 * makes `conditionsKnown` true honestly: a regex reads a number, a model reading
 * the same page can also say what the number depends on. The agent was rejected
 * for the running app because it takes 40 seconds to five minutes — in a
 * scheduled offline sweep that slowness is free. It runs only when
 * ANTHROPIC_API_KEY is in the environment (the npm script reads apps/server/.env
 * if it exists), so a run without a key is the old free sweep, unchanged.
 *
 * NOTE on --only: it is a plain substring match on the product id, so `--only ing`
 * also selects every *spaarrekening* (the word "rekening" ends in "ing"). Name the
 * id you actually mean.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import Anthropic from "@anthropic-ai/sdk";
import { runLadder, type RouteAttempt, type CatalogValue, type CatalogRoute } from "@lavega/core";
import { readIngTariffs, readDocumentDate, coverage, isCovered } from "@lavega/core";
import { buildExtractPrompt, EXTRACT_TOOL, parseExtractReply, type ExtractedFigure } from "@lavega/core";

const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36";
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
  .split(",").map((t) => t.trim()).filter(Boolean);
const only = onlyList.length ? onlyList.join(",") : null;
const matchesOnly = (id: string) => onlyList.some((t) => id.includes(t));
const dry = args.includes("--dry");
function numArg(flag: string, fallback: number): number {
  const i = args.indexOf(flag);
  if (i < 0) return fallback;
  const n = Number(args[i + 1]);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

/** The extractor model. Opus rather than Haiku because the job is not "find the
 *  percentage" — the crude regex already does that and gets ABN AMRO's betaalpas
 *  wrong — it is "decide which row belongs to this product and whether the page
 *  settles its conditions". That is the judgement the whole rung exists for, and
 *  a weekly offline sweep is where paying for it is cheapest. */
const EXTRACT_MODEL = "claude-opus-5";
/** Slowness is free here, hanging is not: one wedged request must not eat the
 *  Action's 45-minute budget. Generous, because the model is allowed to think. */
const MODEL_TIMEOUT_MS = 180_000;
/** Above this the page is refused rather than trimmed. Silently truncating the
 *  text would hand the model a document whose tariff table may have been cut off
 *  and take its answer as if it had read the whole thing. */
const MAX_MODEL_CHARS = 200_000;
/** The DISCOVERY model for the search rung. Sonnet 5 rather than Opus because the
 *  job here is "find the provider's own tariff document", which is search and
 *  link judgement — the reading, where the judgement that costs us money lives,
 *  is still done by EXTRACT_MODEL against text this script fetched itself. */
const FIND_MODEL = "claude-sonnet-5";
/** THREE searches, not six, and the number is measured rather than chosen. One
 *  web_search round-trip against this API takes 30–60s wall-clock (timed: a single
 *  trivial search returned in 54s). At max_uses 6 the rung could not finish inside
 *  any sane ceiling — ing-creditcard and coinbase-card BOTH hit "Request timed
 *  out" at 240s, and a hand probe of the same call with a 600s ceiling timed out
 *  too. The job here is one product and one question, so three searches is the
 *  budget that fits the clock. */
const WEB_SEARCH = { type: "web_search_20260209", name: "web_search", max_uses: 3 } as const;
/** Longer than travel.ts's 240s, because that ceiling covers a lookup a user is
 *  (indirectly) waiting on and this one is an offline sweep where slowness is
 *  free. 3 searches × ~50s + the reading turn does not fit in 240s. */
const FIND_TIMEOUT_MS = 300_000;

/** Never printed, never written to either artifact. Absent = the free sweep. */
const apiKey = process.env.ANTHROPIC_API_KEY?.trim() || null;
const useAgent = !args.includes("--no-agent") && !!apiKey;
/** DISCOVERY IS OPT-IN, and that is a price measured rather than assumed. One
 *  discovery costs ≈ $0.55, not the few cents a "search" sounds like: the search
 *  results come back into the context, and the one that completed here billed
 *  161.040 input tokens for three searches. So the default budget of 10 is ≈ $5–6
 *  a run — which is not something a routine weekly sweep should pay silently,
 *  especially as the first three live attempts produced no usable source at all
 *  (two ceilings hit, one honest "I could not find the document").
 *
 *  Reading a source discovery ALREADY found is free of search and stays on: the
 *  `foundUrl` cached in state.json is fetched and read like any other document, so
 *  a search is paid for once per product and never again. The budget buys
 *  permanent sources, not a repeated bill. */
const useSearch = useAgent && args.includes("--search");
const searchBudget = numArg("--max-search", 10);
/** By default discovery is spent only where nothing readable exists — the 27
 *  products no fetch can reach. `--search-all` opens it to every product that
 *  finished uncovered, which is the deliberate "go find the tariff PDFs" campaign
 *  for the ~90 pages that state a rate and never state its cap. */
const searchAll = args.includes("--search-all");
let searchesUsed = 0;
let modelCalls = 0;

/** What this run spent, per model, from the API's own usage numbers rather than a
 *  guess. Printed at the end: a rung that costs money and reports only coverage
 *  is a rung nobody can decide the cadence for. */
type Spend = { calls: number; input: number; output: number; cacheRead: number; cacheWrite: number; searches: number };
const spend = new Map<string, Spend>();
/** Anthropic list prices per million tokens, 2026-08. Sonnet 5's introductory
 *  $2/$10 runs to 2026-08-31, so today this OVER-states the search rung slightly.
 *  An estimate that reads high is the safe direction for a budget line. */
const PRICE: Record<string, { in: number; out: number }> = {
  "claude-opus-5": { in: 5, out: 25 },
  "claude-sonnet-5": { in: 3, out: 15 },
};
const SEARCH_PRICE_PER_1000 = 10;

function recordSpend(model: string, usage: Anthropic.Usage): void {
  const s = spend.get(model) ?? { calls: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, searches: 0 };
  s.calls++;
  s.input += usage.input_tokens ?? 0;
  s.output += usage.output_tokens ?? 0;
  s.cacheRead += usage.cache_read_input_tokens ?? 0;
  s.cacheWrite += usage.cache_creation_input_tokens ?? 0;
  s.searches += usage.server_tool_use?.web_search_requests ?? 0;
  spend.set(model, s);
}

function spendLines(): string[] {
  const out: string[] = [];
  let total = 0;
  for (const [model, s] of spend) {
    const p = PRICE[model] ?? { in: 0, out: 0 };
    const usd =
      ((s.input + s.cacheWrite * 1.25 + s.cacheRead * 0.1) / 1e6) * p.in +
      (s.output / 1e6) * p.out +
      (s.searches / 1000) * SEARCH_PRICE_PER_1000;
    total += usd;
    out.push(
      `  ${model.padEnd(16)} ${String(s.calls).padStart(3)} call(s)  ${s.input + s.cacheRead + s.cacheWrite} in / ${s.output} out` +
        `${s.searches ? ` + ${s.searches} web search(es)` : ""}  ≈ $${usd.toFixed(2)}`,
    );
  }
  if (out.length) out.push(`  ${"total".padEnd(16)} ≈ $${total.toFixed(2)} (list prices, estimate)`);
  return out;
}

/** How many of this run's fetches got an answer of ANY kind, 403s included.
 *  Zero, with attempts made, means the machine had no network — see the guard at
 *  the bottom, which is the difference between "nothing is readable today" and
 *  "committing an empty catalogue at 05:00 on a Monday". */
let httpResponses = 0;

async function getText(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: { "User-Agent": UA, "Accept-Language": "nl-NL,nl;q=0.9" },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  httpResponses++;
  if (!res.ok) throw new Error(`${res.status}`);
  return res.text();
}

/** pdftotext exists on the sweep machine. It is deliberately NOT a runtime
 *  dependency of the server. */
function pdfToText(bytes: ArrayBuffer): string {
  writeFileSync("/tmp/catalog.pdf", Buffer.from(bytes));
  return execFileSync("pdftotext", ["-layout", "/tmp/catalog.pdf", "-"], { encoding: "utf8" });
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
  return html.replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ").replace(/<[^>]+>/g, " ").replace(/[ \t]+/g, " ");
}

/** Two rungs now read the same URL — the regex and the model — and 82 URLs serve
 *  124 products, so without this the sweep fetches some pages five times and the
 *  providers see a burst that looks like scraping. One fetch per URL per run,
 *  failures cached too so a dead host is not retried per product. */
const pageCache = new Map<string, Promise<string>>();
function readPage(url: string, kind: "html" | "pdf"): Promise<string> {
  const key = `${kind}:${url}`;
  let hit = pageCache.get(key);
  if (!hit) {
    hit = kind === "pdf" ? getPdfText(url) : getText(url).then(strip);
    pageCache.set(key, hit);
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
    const gap = ARCHIVE_GAP_MS - (Date.now() - archiveLastHit);
    if (gap > 0) await sleep(gap);
    archiveLastHit = Date.now();
    let res: Response;
    try {
      res = await fetch(url, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(ARCHIVE_TIMEOUT_MS) });
    } catch (e) {
      if (attempt >= ARCHIVE_BACKOFF_MS.length) throw e;
      await sleep(ARCHIVE_BACKOFF_MS[attempt]);
      continue;
    }
    httpResponses++;
    if (res.status !== 429 && res.status !== 503) return res;
    if (attempt >= ARCHIVE_BACKOFF_MS.length) {
      throw new Error(`web.archive.org ${res.status} after ${attempt + 1} tries — rate limited, not "not archived"`);
    }
    await sleep(ARCHIVE_BACKOFF_MS[attempt]);
  }
}

type Snapshot = { stamp: string; date: string; original: string; mime: string };

/** The CDX index gives us the snapshot AND its date in one call. `limit=-4` asks
 *  for the LAST four rather than the first four — the default order is oldest
 *  first, and Rabobank's index starts in 2022. */
async function cdxSnapshots(url: string): Promise<Snapshot[]> {
  const q = new URLSearchParams({ url, output: "json", limit: "-4", fl: "timestamp,original,mimetype" });
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
async function readArchived(url: string): Promise<{ text: string; url: string; date: string } | null> {
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
 *  httpResponses count, and the run commits. Measured on 2026-08-18 — a 400 "Your
 *  credit balance is too low" landed in lastReason indistinguishable from a bank's
 *  403, and the run carried on fetching for twenty minutes. Die on the FIRST one
 *  instead, before a single byte is written. */
function abortIfKeyUnusable(e: unknown): void {
  const status = (e as { status?: number } | null)?.status;
  if (status !== 400 && status !== 401 && status !== 403) return;
  const raw = String((e as Error | null)?.message ?? e);
  const msg = raw.toLowerCase();
  // Matched on the MESSAGE, not the status: the API answers billing failures with
  // 400 invalid_request_error, the same status as a genuinely malformed request,
  // and only the text separates "top up your account" from "this page was too big".
  const fatal = ["credit balance", "billing", "quota", "authentication", "invalid x-api-key", "permission", "disabled"];
  if (!fatal.some((f) => msg.includes(f))) return;
  console.error(`\nFATAL - the Anthropic key cannot be used: ${raw}`);
  console.error("Nothing was written. A sweep whose model rungs all fail still produces figures from");
  console.error("the free rungs, and committing that artifact would claim a reading nobody did.");
  process.exit(1);
}

/** Every model call in this script goes through here, so a new call site cannot
 *  forget the guard. */
async function createGuarded(
  client: Anthropic,
  body: Anthropic.MessageCreateParamsNonStreaming,
  options?: { timeout?: number; maxRetries?: number },
): Promise<Anthropic.Message> {
  try {
    return await client.messages.create(body, options as never);
  } catch (e) {
    abortIfKeyUnusable(e);
    throw e;
  }
}

async function askModel(product: string, sourceUrl: string, text: string): Promise<ExtractedFigure | null> {
  if (text.length > MAX_MODEL_CHARS) {
    throw new Error(`page is ${Math.round(text.length / 1000)}k chars — refusing to send a truncated document`);
  }
  const req = { product, sourceUrl, text };
  const { system, user } = buildExtractPrompt(req);
  const client = new Anthropic({ apiKey: apiKey ?? undefined });
  const res = await createGuarded(client, 
    {
      model: EXTRACT_MODEL,
      max_tokens: 8192,
      system,
      tools: [EXTRACT_TOOL as unknown as Anthropic.Tool],
      // Deliberately NOT a forced tool call. "This page does not state it for this
      // product" has to remain sayable, and forcing the tool turns that answer
      // into a fabricated one.
      messages: [{ role: "user", content: user }],
    },
    // maxRetries: 0, carried over from travel.ts and then MEASURED here. The SDK
    // retries a timeout twice by default, so a call that runs out its ceiling is
    // billed three times and takes three times as long — one ING creditcard probe
    // spent twelve minutes to report "Request timed out". A rung with a budget
    // must not be able to spend it three times over on one product.
    { timeout: MODEL_TIMEOUT_MS, maxRetries: 0 },
  );
  modelCalls++;
  recordSpend(EXTRACT_MODEL, res.usage);
  const block = res.content.find((b) => b.type === "tool_use");
  if (!block || block.type !== "tool_use") return null; // the model declined — a real answer
  return parseExtractReply(block.input, req, today);
}

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
  return {
    value: figure.value,
    route,
    sourceUrl,
    checkedAt: readDocumentDate(text) ?? fallbackDate,
    conditions: figure.conditions,
    conditionsKnown: figure.conditionsKnown,
  };
}

// ─────────────────────────────────────────────────────────────── the search rung

/** What the search rung is asked for: a URL, not a number.
 *
 *  This is the whole reason the rung is shaped in two stages. Web-search results
 *  come back encrypted — the script cannot read the pages the model read — so a
 *  figure reported straight out of a search has no receipt, and the quote check
 *  that every other model figure has to pass could not run on it. So the model is
 *  asked only to FIND the provider's own document; this script then fetches that
 *  document itself and reads it with the same verified extractor as routes 1–3.
 *  A search answer that is wrong now fails on the fetch or on the quote, instead
 *  of arriving as an unverifiable number.
 *
 *  It also attacks the actual coverage problem. Most Dutch pages state a rate and
 *  say nothing about its cap, so conditionsKnown stays false however good the
 *  extractor is; the missing half lives in the tariff PDF, and finding that PDF is
 *  a search problem. ING is the standing proof: ing.nl kills the connection, and
 *  its tariff sheet sits on assets.ing.com and fetches with no User-Agent at all. */
const FIND_TOOL: { name: string; description: string; input_schema: object } = {
  name: "record_source_document",
  description:
    "Record the URL of the document, published by the provider itself, that states this product's surcharge on a foreign-currency payment. We fetch and read this document ourselves — do not report the number here, and do not call this tool for a page you have not confirmed exists.",
  input_schema: {
    type: "object",
    properties: {
      product: {
        type: "string",
        description: "The product you were asked about, copied back exactly. The reply is discarded if it names a different one.",
      },
      url: {
        type: "string",
        description:
          "Absolute https URL of the provider's own page or PDF. Its own site, its own asset/CDN host, or the issuer that runs the card for it. Never a comparison site, blog, forum, news article or summary.",
      },
      kind: { type: "string", enum: ["html", "pdf"], description: "Whether that URL serves HTML or a PDF." },
      publisher: { type: "string", description: "The organisation that publishes that URL." },
      why: { type: "string", description: "One sentence: what makes this the document that states the surcharge." },
    },
    required: ["product", "url", "kind", "publisher"],
    additionalProperties: false,
  },
};

function buildFindPrompt(product: string, issuer: string, knownUrl: string | null): { system: string; user: string } {
  const system = [
    "You are looking for ONE document: the page or PDF, published by the provider itself, that states what this",
    "product charges as a surcharge on a foreign-currency payment — koersopslag, wisselkoersopslag,",
    "valutakoersopslag or valutatoeslag.",
    "",
    `Search the web, then report the URL by calling the ${FIND_TOOL.name} tool. You are NOT being asked for the`,
    "number. We fetch the document and read it ourselves, so a URL that does not actually contain the figure is",
    "worse than no answer at all: it costs us a fetch and teaches us nothing.",
    "",
    "It must be the provider's OWN document — its own website, its own asset or CDN host, or the issuer that runs",
    "the card for it (International Card Services publishes the terms for several Dutch banks' credit cards). A",
    "comparison site, a blog, a forum, a news article or another model's summary is not acceptable however right",
    "the number in it looks: we refuse figures whose conditions nobody established, and a third party cannot",
    "establish them.",
    "",
    "Prefer the tariff sheet, the fee information document ('Informatiedocument betreffende de vergoedingen'), the",
    "cardmember agreement or the terms PDF over a marketing page. Those carry the caps, tiers, packages and promo",
    "windows the rate depends on, and the conditions are the half we are short of. A provider whose website blocks",
    "robots usually still publishes that PDF on an unprotected host: ING's rate is on assets.ing.com, not ing.nl.",
    "",
    "If you cannot find such a document, do NOT call the tool — say in one sentence what you looked for and what",
    "you found instead. An unanswered product is a fine outcome; a confidently wrong URL is not.",
  ].join("\n");
  const user = [
    `Product: ${product}`,
    `Aanbieder: ${issuer}`,
    knownUrl ? `Page we already know about (we may be unable to read it): ${knownUrl}` : "We have no URL for this product at all.",
  ].join("\n");
  return { system, user };
}

/** Words that say what KIND of product this is, or what kind of company sells it.
 *  They are in every product name and in no useful host, so they must not be what
 *  a host is matched on — otherwise "bank" matches every bank on earth. */
const NOT_A_BRAND = new Set([
  "betaalpas", "creditcard", "card", "kaart", "spaarrekening", "beleggingsrekening", "rekening", "prepaid",
  "bank", "banking", "bankieren", "nederland", "netherlands", "international", "group", "holding",
  "the", "van", "een", "and", "der", "nv", "bv", "sa", "plc", "ltd", "gmbh", "inc", "com",
  "gold", "gouden", "goud", "platinum", "premium", "standard", "plus", "metal", "classic", "basis",
  "sparen", "spaar", "rente", "internet", "direct", "online", "flex", "vrij", "pay", "cash", "credit", "debit",
]);

/** Does this URL plausibly belong to the provider we asked about?
 *
 *  The rung's one structural weakness is that the model chooses the URL, and the
 *  cheapest wrong answer is a comparison site that has the number in a neat table.
 *  So the host must carry the brand: a label of the host equals a brand word from
 *  the product or issuer name, or contains one. Matching on host LABELS rather
 *  than the whole string is what lets "ING" (three letters) match assets.ing.com
 *  without also matching every host with "ing" somewhere in it — which is most of
 *  them, "spaarrekening" included. */
function looksLikeProvider(url: string, product: string, issuer: string, knownUrl: string | null): boolean {
  let host: string;
  try {
    const u = new URL(url);
    if (u.protocol !== "https:" && u.protocol !== "http:") return false;
    host = u.hostname.toLowerCase();
  } catch {
    return false;
  }
  const labels = host.split(".").map((l) => l.replace(/[^a-z0-9]/g, ""));
  // Same registrable-looking domain as the URL we already had is always fine: a
  // provider moving its own page is the ordinary case, not an impersonation.
  if (knownUrl) {
    try {
      const known = new URL(knownUrl).hostname.toLowerCase().split(".");
      const core = known.slice(-2).join(".");
      if (host === core || host.endsWith(`.${core}`)) return true;
    } catch {
      /* a broken URL in state.json is not a reason to accept a strange host */
    }
  }
  const words = `${product} ${issuer}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .split(" ")
    .filter((w) => w.length >= 3 && !NOT_A_BRAND.has(w));
  // "Trade Republic" is traderepublic.com and "Trading 212" is trading212.com, so
  // adjacent words joined are brands too.
  const joined = words.slice(0, -1).map((w, i) => w + words[i + 1]);
  const brands = [...new Set([...words, ...joined])];
  return brands.some((b) => labels.some((l) => l === b || (b.length >= 4 && l.includes(b))));
}

/** Ask the model to find the provider's own document. Returns null when it
 *  declines, when the reply is about another product, or when the URL is not on a
 *  host that plausibly belongs to the provider. */
async function findSource(
  product: string,
  issuer: string,
  knownUrl: string | null,
): Promise<{ url: string; kind: "html" | "pdf" } | null> {
  const { system, user } = buildFindPrompt(product, issuer, knownUrl);
  const client = new Anthropic({ apiKey: apiKey ?? undefined });
  // Charged to the budget BEFORE the call, not after. A search that times out has
  // already run its searches and burned its tokens; counting only the ones that
  // came back made the expensive failures free, which is the wrong way round —
  // ing-creditcard timed out and left the counter reading "0/10 searches".
  searchesUsed++;
  const res = await createGuarded(client, 
    {
      model: FIND_MODEL,
      max_tokens: 2048,
      system,
      tools: [WEB_SEARCH as never, FIND_TOOL as unknown as Anthropic.Tool],
      // AUTO, never forced — carried over from travel.ts, where it was measured:
      // forcing the tool makes the model answer on its first turn, before it has
      // run a single search, and it then reports whatever it can assemble without
      // one. Forced => zero searches; auto => it searches, then answers or says
      // it could not find the document.
      tool_choice: { type: "auto" },
      messages: [{ role: "user", content: user }],
    },
    // maxRetries: 0 for the same measured reason as askModel: the SDK's default
    // two retries turn a four-minute ceiling into a twelve-minute one at three
    // times the bill, which is the opposite of a cap.
    { timeout: FIND_TIMEOUT_MS, maxRetries: 0 },
  );
  recordSpend(FIND_MODEL, res.usage);
  const block = res.content.find((b) => b.type === "tool_use" && b.name === FIND_TOOL.name);
  if (!block || block.type !== "tool_use") return null; // "I could not find it" — a real answer
  const r = block.input as Record<string, unknown>;

  // Pinned to the product asked about, the second finding travel.ts paid for: a
  // reply is only usable if it is about the row we asked for.
  const norm = (s: unknown) => String(s ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const said = norm(r.product);
  const asked = norm(product);
  if (!said || (!said.includes(asked) && !asked.includes(said))) return null;

  const url = typeof r.url === "string" ? r.url.trim() : "";
  if (!url) return null;
  if (!looksLikeProvider(url, product, issuer, knownUrl)) {
    let host = url;
    try {
      host = new URL(url).hostname;
    } catch {
      /* an unparseable URL is refused with the string it gave us */
    }
    throw new Error(`found ${host}, which is not ${issuer || product}'s own host`);
  }
  const kind: "html" | "pdf" = r.kind === "pdf" || /\.pdf(\?|#|$)/i.test(url) ? "pdf" : "html";
  return { url, kind };
}

const state = JSON.parse(readFileSync(STATE, "utf8"));
const ids: string[] = Object.keys(state.products).filter((id) => !only || matchesOnly(id));
/** How many products the PREVIOUS run found any figure for — covered or not.
 *  Snapshotted before the loop overwrites it, because it is half of the guard at
 *  the bottom. */
const figuresBefore = ids.filter((id) => state.products[id].lastValue != null).length;
let attemptsMade = 0;

const entries: { id: string; product: string; fields: { fxFeePct?: CatalogValue } }[] = [];
const changes: string[] = [];
/** Sources the search rung found this run. Worth their own block in the output:
 *  a new primary source is a permanent gain, unlike a figure, and it is the thing
 *  a reviewer should check before the next sweep trusts it without asking. */
const discovered: string[] = [];
for (const id of ids) {
  const p = state.products[id];
  const attempts: RouteAttempt[] = [];

  if (p.pdfUrl) {
    attempts.push({
      route: "provider-pdf",
      run: async () => {
        const text = await readPage(p.pdfUrl, "pdf");
        const figures = readIngTariffs(text);
        const f = figures.find((x) => x.field === "fxFeePct");
        if (!f) return null;
        return {
          value: f.value, route: "provider-pdf", sourceUrl: p.pdfUrl,
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
          conditions: f.conditions, conditionsKnown: f.conditionsKnown,
        };
      },
    });
  }
  if (p.termsUrl && p.readable === "yes") {
    attempts.push({
      route: "provider-page",
      run: async () => {
        // The cache hands back tag-stripped text with its line breaks intact (the
        // model rung needs them to see headings); this rung wants one flat line.
        const text = (await readPage(p.termsUrl, "html")).replace(/\s+/g, " ");
        const m = /(\d{1,2})[,.](\d{1,2})\s*%[^.]{0,40}koersopslag|koersopslag[^.]{0,40}?(\d{1,2})[,.](\d{1,2})\s*%/i.exec(text);
        if (!m) return null;
        const value = Number(`${m[1] ?? m[3]}.${m[2] ?? m[4]}`);
        if (!Number.isFinite(value)) return null;
        // Conditions are NOT established by this crude read, and saying so is the
        // point: an unconditional-looking rate that was never checked for a cap
        // is exactly how Revolut shipped at 0%.
        return { value, route: "provider-page", sourceUrl: p.termsUrl, checkedAt: today,
                 conditions: null, conditionsKnown: false };
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
        const figure = await askModel(p.product, snap.url, snap.text);
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
  if (useAgent && (p.pdfUrl || (p.termsUrl && p.readable === "yes"))) {
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
        const sources: { url: string; kind: "pdf" | "html" }[] = [];
        if (p.pdfUrl) sources.push({ url: p.pdfUrl, kind: "pdf" });
        if (p.termsUrl && p.readable === "yes") sources.push({ url: p.termsUrl, kind: "html" });
        let best: CatalogValue | null = null;
        for (const src of sources) {
          const text = await readPage(src.url, src.kind);
          const figure = await askModel(p.product, src.url, text);
          const value = figure ? toValue(figure, "agent", src.url, text, today) : null;
          if (value && isCovered(value)) return value;
          best = best ?? value;
        }
        return best;
      },
    });
  }

  // THE SEARCH RUNG, and the last one. Two stages: the model finds the provider's
  // own document, then THIS script fetches it and reads it with the same verified
  // extractor as every other rung — see findSource for why the search is not
  // allowed to report the number itself.
  //
  // Where the budget goes when `--search` turns discovery on: only to products no
  // fetch can reach, which is where the design put route 5 and is about 27 of the
  // 124. `--search-all` opens it to every product that finished uncovered — the
  // deliberate campaign to find the ~90 tariff PDFs that would settle the
  // conditions the marketing pages leave open. A discovered source is written back
  // to state.json, and reading it back needs NO search, so discovery is paid for
  // once per product and every later sweep reads that document for free.
  const searchable = searchAll || !!only || (p.readable !== "yes" && !p.pdfUrl);
  if (useAgent && (p.foundUrl || (useSearch && searchable && searchesUsed < searchBudget))) {
    attempts.push({
      route: "agent",
      run: async () => {
        let found: { url: string; kind: "html" | "pdf" } | null = p.foundUrl
          ? { url: p.foundUrl, kind: p.foundKind === "pdf" ? "pdf" : "html" }
          : null;
        if (!found) {
          if (searchesUsed >= searchBudget) {
            throw new Error(`search budget spent (${searchBudget}) — raise with --max-search`);
          }
          found = await findSource(p.product, p.issuer ?? "", p.termsUrl ?? null);
        }
        if (!found) return null;

        // Fetch it ourselves. If the provider blocks us on this host too, the
        // archive is tried for the discovered URL as well — the two new rungs
        // compose, and that is how a blocked host with an archived tariff sheet
        // still lands.
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
        const figure = await askModel(p.product, sourceUrl, text);
        if (!figure) return null;
        // Only a source that actually produced a VERIFIED figure is remembered.
        // Caching a URL that read as nothing would bake a dead end into the
        // watchlist and stop the next sweep from looking again.
        if (!p.foundUrl) {
          state.products[id].foundUrl = found.url;
          state.products[id].foundKind = found.kind;
          state.products[id].foundAt = today;
          state.products[id].foundVia = "agent-search";
          discovered.push(`${p.product}: ${found.url} (${found.kind})`);
        }
        return toValue(figure, "agent", sourceUrl, text, fallbackDate);
      },
    });
  }

  attemptsMade += attempts.length;
  const { value, tried, reason: ladderReason } = await runLadder(attempts);
  // The spec's honest floor is "unknown, WITH the reason named". runLadder returns
  // null for an empty attempt list, which would record a blank against a product
  // nobody has wired a route for — indistinguishable from one that was tried and
  // came back empty.
  const reason =
    ladderReason ??
    (attempts.length ? null : `no route wired (readable=${p.readable}, pdfUrl=${p.pdfUrl ? "yes" : "none"})`);
  const prev = state.products[id].lastValue ?? null;
  if (value && prev !== null && prev !== value.value) {
    changes.push(`${p.product}: ${prev} → ${value.value} (${value.route})`);
  }
  state.products[id].lastChecked = today;
  state.products[id].lastValue = value ? value.value : null;
  state.products[id].lastRoute = value ? value.route : null;
  // The reason is kept even when a figure came back, because runLadder returns the
  // best PARTIAL along with what kept it from counting. Blanking it on `value`
  // would throw the reason away exactly when it explains why the product is still
  // uncovered.
  state.products[id].lastReason = reason;
  entries.push({ id, product: p.product, fields: value ? { fxFeePct: value } : {} });
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
  console.log(
    `${isCovered(value ?? undefined) ? "✓" : "·"} ${p.product.slice(0, 40).padEnd(42)} ${(tried.join(">") || "-").padEnd(26)} ${shown}`,
  );
}

const c = coverage(entries, "fxFeePct");
console.log(`\ncovered ${c.covered}/${c.total}  by route: ${JSON.stringify(c.byRoute)}`);
if (changes.length) console.log(`\nCHANGED:\n  ${changes.join("\n  ")}`);
if (discovered.length) console.log(`\nDISCOVERED SOURCES (cached in ${STATE}, free from now on):\n  ${discovered.join("\n  ")}`);

const figuresFound = entries.filter((e) => e.fields.fxFeePct).length;
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
    ? `model: ${EXTRACT_MODEL}, ${modelCalls} call(s)`
    : `model: not run (${apiKey ? "--no-agent" : "no ANTHROPIC_API_KEY in the environment"})`,
);
console.log(
  useSearch
    ? `search: ${searchesUsed}/${searchBudget} discovery search(es)${searchAll ? " (--search-all)" : ""}`
    : `search: not run (${!useAgent ? (apiKey ? "--no-agent" : "no ANTHROPIC_API_KEY") : "discovery is opt-in — pass --search"})`,
);
// What the run cost, from the API's own usage numbers. A rung that spends money
// and reports only coverage is a rung nobody can set a cadence for.
if (spend.size) console.log(`spend:\n${spendLines().join("\n")}`);

if (dry) { console.log("\n--dry: nothing written"); process.exit(0); }

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
  console.error(`\nREFUSING TO WRITE: ${attemptsMade} routes attempted, not one fetch answered. That is this machine's network, not the providers'.`);
  process.exit(1);
}
// The same failure one layer out: the model was ASKED for and never once answered
// (all timed out, all refused, the rung threw every time). The figures that remain
// are the regex's, and the regex is the thing the model exists to correct - ABN
// AMRO's betaalpas reads 2% there when the page says 1,2%.
if (useAgent && modelCalls === 0) {
  console.error(`\nREFUSING TO WRITE: the model rung was enabled and not one of its calls came back.`);
  process.exit(1);
}
if (figuresBefore > 0 && figuresFound === 0) {
  console.error(`\nREFUSING TO WRITE: the previous run held ${figuresBefore} figures and this one found none. Something broke between here and the sources; an empty catalogue is not a finding.`);
  process.exit(1);
}
// A --only run swept a SUBSET, so `entries` is a subset. Writing it to CATALOG
// would delete every product it did not look at — a committed artifact truncated
// by a debugging flag. The per-product state is still refreshed, since that is
// keyed by id and only touches what was swept.
if (only) {
  // MERGE, do not refuse. Writing `entries` wholesale would delete every product
  // the subset did not look at; refusing to write at all was the first fix and it
  // turned out to be its own trap — eight Amex figures were paid for and then
  // stranded in state.json, because the only way to reach the artifact was a $6
  // full sweep. Replace what was swept, keep the rest untouched.
  const prev: { generatedAt?: string; entries: typeof entries } = existsSync(CATALOG)
    ? JSON.parse(readFileSync(CATALOG, "utf8"))
    : { entries: [] };
  const swept = new Set(entries.map((e) => e.id));
  const merged = [...prev.entries.filter((e) => !swept.has(e.id)), ...entries];
  // Keep the artifact in watchlist order rather than "everything else, then the
  // subset" — a diff is only reviewable if the file does not reshuffle.
  const order = Object.keys(state.products);
  merged.sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
  writeFileSync(CATALOG, JSON.stringify({ generatedAt: today, entries: merged }, null, 2) + "\n");
  writeFileSync(STATE, JSON.stringify(state, null, 2) + "\n");
  console.log(`\nwrote ${STATE} and merged ${entries.length} swept product(s) into ${CATALOG} (${merged.length} total).`);
  process.exit(0);
}
state.lastRun = today;
writeFileSync(CATALOG, JSON.stringify({ generatedAt: today, entries }, null, 2) + "\n");
writeFileSync(STATE, JSON.stringify(state, null, 2) + "\n");
console.log(`\nwrote ${CATALOG} and ${STATE}`);
