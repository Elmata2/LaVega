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
 *
 * NOTE on --only: it is a plain substring match on the product id, so `--only ing`
 * also selects every *spaarrekening* (the word "rekening" ends in "ing"). Name the
 * id you actually mean.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { runLadder, type RouteAttempt, type CatalogValue } from "@lavega/core";
import { readIngTariffs, coverage, isCovered } from "@lavega/core";

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

async function getText(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: { "User-Agent": UA, "Accept-Language": "nl-NL,nl;q=0.9" },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
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
  if (!res.ok) throw new Error(`${res.status}`);
  writeFileSync("/tmp/catalog.pdf", Buffer.from(await res.arrayBuffer()));
  return execFileSync("pdftotext", ["-layout", "/tmp/catalog.pdf", "-"], { encoding: "utf8" });
}

const state = JSON.parse(readFileSync(STATE, "utf8"));
const ids: string[] = Object.keys(state.products).filter((id) => !only || id.includes(only));

const entries: { id: string; product: string; fields: { fxFeePct?: CatalogValue } }[] = [];
const changes: string[] = [];
for (const id of ids) {
  const p = state.products[id];
  const attempts: RouteAttempt[] = [];

  if (p.pdfUrl) {
    attempts.push({
      route: "provider-pdf",
      run: async () => {
        const figures = readIngTariffs(await getPdfText(p.pdfUrl));
        const f = figures.find((x) => x.field === "fxFeePct");
        if (!f) return null;
        return {
          value: f.value, route: "provider-pdf", sourceUrl: p.pdfUrl,
          checkedAt: p.pdfCheckedAt ?? today,
          conditions: f.conditions, conditionsKnown: true,
        };
      },
    });
  }
  if (p.termsUrl && p.readable === "yes") {
    attempts.push({
      route: "provider-page",
      run: async () => {
        const text = (await getText(p.termsUrl)).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
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
  const shown = value
    ? `${value.value}%${value.conditions ? ` [${value.conditions}]` : ""}`
    : (reason ?? "no route wired");
  console.log(
    `${isCovered(value ?? undefined) ? "✓" : "·"} ${p.product.slice(0, 40).padEnd(42)} ${(tried.join(">") || "-").padEnd(26)} ${shown}`,
  );
}

const c = coverage(entries, "fxFeePct");
console.log(`\ncovered ${c.covered}/${c.total}  by route: ${JSON.stringify(c.byRoute)}`);
if (changes.length) console.log(`\nCHANGED:\n  ${changes.join("\n  ")}`);

if (dry) { console.log("\n--dry: nothing written"); process.exit(0); }
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
