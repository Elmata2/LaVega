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
import { readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import Anthropic from "@anthropic-ai/sdk";
import { runLadder, type RouteAttempt, type CatalogValue } from "@lavega/core";
import { readIngTariffs, readDocumentDate, coverage, isCovered } from "@lavega/core";
import { buildExtractPrompt, EXTRACT_TOOL, parseExtractReply } from "@lavega/core";

const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36";
const STATE = "docs/catalog/state.json";
const CATALOG = "docs/catalog/catalog.json";
const today = new Date().toISOString().slice(0, 10);
/** A host that never answers must not hold the sweep open. Without this one
 *  hanging socket stalls a scheduled run for its whole six-hour budget. */
const TIMEOUT_MS = 20_000;

const args = process.argv.slice(2);
const only = args.includes("--only") ? args[args.indexOf("--only") + 1] : null;
const dry = args.includes("--dry");

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
/** Never printed, never written to either artifact. Absent = the free sweep. */
const apiKey = process.env.ANTHROPIC_API_KEY?.trim() || null;
const useAgent = !args.includes("--no-agent") && !!apiKey;
let modelCalls = 0;

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

/** A PDF is fetched here and turned into text with pdftotext, which exists on the
 *  sweep machine. It is deliberately NOT a runtime dependency of the server. */
async function getPdfText(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: { "User-Agent": UA },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  httpResponses++;
  if (!res.ok) throw new Error(`${res.status}`);
  writeFileSync("/tmp/catalog.pdf", Buffer.from(await res.arrayBuffer()));
  return execFileSync("pdftotext", ["-layout", "/tmp/catalog.pdf", "-"], { encoding: "utf8" });
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

/** One product, one page, one question, through the tool in packages/core.
 *
 *  Everything model-shaped that could be pure IS pure and lives in
 *  catalogExtract.ts — the prompt, the schema, and every check on the reply. What
 *  is left here is the call itself, because that is I/O and packages/core stays
 *  clean of it. The reply is parsed by parseExtractReply or discarded; there is
 *  no path from a model's output into the catalogue that skips those checks. */
async function askModel(product: string, sourceUrl: string, text: string): Promise<CatalogValue | null> {
  if (text.length > MAX_MODEL_CHARS) {
    throw new Error(`page is ${Math.round(text.length / 1000)}k chars — refusing to send a truncated document`);
  }
  const req = { product, sourceUrl, text };
  const { system, user } = buildExtractPrompt(req);
  const client = new Anthropic({ apiKey: apiKey ?? undefined });
  const res = await client.messages.create(
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
    { timeout: MODEL_TIMEOUT_MS },
  );
  modelCalls++;
  const block = res.content.find((b) => b.type === "tool_use");
  if (!block || block.type !== "tool_use") return null; // the model declined — a real answer
  const figure = parseExtractReply(block.input, req, today);
  if (!figure) return null;
  return {
    value: figure.value,
    route: "agent",
    sourceUrl,
    // The SOURCE's date when the document states one, never the sweep date
    // dressed up as it.
    checkedAt: readDocumentDate(text) ?? today,
    conditions: figure.conditions,
    conditionsKnown: figure.conditionsKnown,
  };
}

const state = JSON.parse(readFileSync(STATE, "utf8"));
const ids: string[] = Object.keys(state.products).filter((id) => !only || id.includes(only));
/** How many products the PREVIOUS run found any figure for — covered or not.
 *  Snapshotted before the loop overwrites it, because it is half of the guard at
 *  the bottom. */
const figuresBefore = ids.filter((id) => state.products[id].lastValue != null).length;
let attemptsMade = 0;

const entries: { id: string; product: string; fields: { fxFeePct?: CatalogValue } }[] = [];
const changes: string[] = [];
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
  // THE RUNG THAT CAN EARN conditionsKnown. It sorts last in the ladder, so it
  // only runs when nothing above it came back COVERED — which today is almost
  // always, because provider-page cannot establish a condition and says so. The
  // provider's own PDF is preferred over its HTML when both exist: the tariff
  // sheet is where the caps and tiers actually are.
  if (useAgent && (p.pdfUrl || (p.termsUrl && p.readable === "yes"))) {
    attempts.push({
      route: "agent",
      run: async () => {
        const url: string = p.pdfUrl ?? p.termsUrl;
        const text = await readPage(url, p.pdfUrl ? "pdf" : "html");
        return askModel(p.product, url, text);
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

const figuresFound = entries.filter((e) => e.fields.fxFeePct).length;
console.log(`figures found: ${figuresFound} (previous run: ${figuresBefore})  ·  fetches answered: ${httpResponses}/${attemptsMade}`);
// Whether the model rung ran at all is part of reading the coverage number: the
// same sweep with and without a key produces two different products, and "0
// agent" next to a low covered-count is the explanation rather than a mystery.
console.log(
  useAgent
    ? `model: ${EXTRACT_MODEL}, ${modelCalls} call(s)`
    : `model: not run (${apiKey ? "--no-agent" : "no ANTHROPIC_API_KEY in the environment"})`,
);

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
if (figuresBefore > 0 && figuresFound === 0) {
  console.error(`\nREFUSING TO WRITE: the previous run held ${figuresBefore} figures and this one found none. Something broke between here and the sources; an empty catalogue is not a finding.`);
  process.exit(1);
}
// A --only run swept a SUBSET, so `entries` is a subset. Writing it to CATALOG
// would delete every product it did not look at — a committed artifact truncated
// by a debugging flag. The per-product state is still refreshed, since that is
// keyed by id and only touches what was swept.
if (only) {
  writeFileSync(STATE, JSON.stringify(state, null, 2) + "\n");
  console.log(`\nwrote ${STATE}. ${CATALOG} NOT written: --only swept ${entries.length} of ${Object.keys(state.products).length} products and would have dropped the rest.`);
  process.exit(0);
}
state.lastRun = today;
writeFileSync(CATALOG, JSON.stringify({ generatedAt: today, entries }, null, 2) + "\n");
writeFileSync(STATE, JSON.stringify(state, null, 2) + "\n");
console.log(`\nwrote ${CATALOG} and ${STATE}`);
