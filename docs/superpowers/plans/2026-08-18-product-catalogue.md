# Product Catalogue Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the 124-product watchlist into a live catalogue where every product carries a value, its source, the date it was true, and its conditions — refreshed on a schedule, read by every agent.

**Architecture:** The sweep is a **scheduled job that produces a committed artifact**; the server only ever reads that artifact. So no PDF parser, no scraper and no network fragility enters the running app, and every changed figure arrives as a reviewable git diff — which is the same discipline as the competitor tracker's `state.json`, where this whole approach comes from.

**Tech Stack:** TypeScript, pnpm workspaces + turbo, vitest, Node 22 (`--env-file-if-exists`, `fetch`), plain `.mjs` scripts under `scripts/`.

**Spec:** `docs/superpowers/specs/2026-08-18-catalog-coverage-design.md`

## Global Constraints

- Dutch in the UI, English in code identifiers.
- `packages/core` is PURE: no I/O, no `Date.now()` inside functions, `asOf` passed in. The sweep script does the I/O.
- **A catalogue entry is `{value, source, checkedAt, conditions}`. All four, or it is not covered.** 104 of 124 rates are conditional; Revolut's 0% ranked first in the shipped app on a rate that expires €1.000 into the month.
- **Unknown is never zero, a default, or a comparison.**
- **Never overwrite the owner's own correction.** `upsertFacts` already enforces this; nothing here may route around it.
- A figure keeps the date of the SOURCE that stated it, never the date we fetched it.
- Integer cents for money; percentages stay numbers (`1.4` means 1,4%).
- The catalogue holds PUBLIC product data only — no user data ever enters it. That is why it may live on the server at all.
- Run only the package you touch: `pnpm --filter @lavega/core test` / `@lavega/server`.

---

### Task 1: The catalogue entry, and what "covered" means

**Files:**
- Create: `packages/core/src/catalog.ts`
- Create: `packages/core/src/catalog.test.ts`
- Modify: `packages/core/src/index.ts` (add `export * from "./catalog.js";` after the `./bankNl.js` line)

**Interfaces:**
- Consumes: nothing
- Produces:
  ```ts
  export type CatalogRoute = "provider-page" | "provider-pdf" | "wayback" | "comparison" | "agent";
  export type CatalogValue = {
    value: number;
    route: CatalogRoute;
    sourceUrl: string;
    checkedAt: string;            // ISO date the SOURCE stated, or the sweep date
    conditions: string | null;    // null means "unconditional", NOT "unknown"
    conditionsKnown: boolean;     // false means we did not establish them
  };
  export type CatalogEntry = {
    id: string;                   // "ing-betaalpas", matching docs/catalog/state.json
    product: string;              // "ING betaalpas", matching productOf()
    fields: Partial<Record<CatalogField, CatalogValue>>;
  };
  export type CatalogField = "fxFeePct" | "convertFeePct" | "cashbackPct" | "pointsPerEuro" | "interestPct";
  export function isCovered(v: CatalogValue | undefined): boolean;
  export function coverage(entries: readonly CatalogEntry[], field: CatalogField):
    { covered: number; total: number; byRoute: Record<CatalogRoute, number> };
  ```

- [ ] **Step 1: Write the failing test**

```ts
// packages/core/src/catalog.test.ts
import { expect, test } from "vitest";
import { coverage, isCovered, type CatalogEntry, type CatalogValue } from "./catalog.js";

const value = (over: Partial<CatalogValue> = {}): CatalogValue => ({
  value: 1.4,
  route: "provider-pdf",
  sourceUrl: "https://assets.ing.com/…/kostenoverzicht.pdf",
  checkedAt: "2026-06-15",
  conditions: null,
  conditionsKnown: true,
  ...over,
});

test("a rate whose conditions were never established is NOT covered", () => {
  // 104 of 124 rates are conditional. Revolut's 0% holds only inside a EUR 1.000
  // monthly limit, and shipped as unconditional it ranked first and said the
  // trip would cost nothing. A rate without its conditions is not an answer.
  expect(isCovered(value())).toBe(true);
  expect(isCovered(value({ conditions: "0% tot € 1.000 p/m, daarna 1%" }))).toBe(true);
  expect(isCovered(value({ conditionsKnown: false }))).toBe(false);
  expect(isCovered(undefined)).toBe(false);
});

test("a value with no source is a rumour and does not count", () => {
  expect(isCovered(value({ sourceUrl: "" }))).toBe(false);
});

test("coverage reports the tier as well as the total, because 99% model-derived is a different product", () => {
  const entries: CatalogEntry[] = [
    { id: "a", product: "A", fields: { fxFeePct: value({ route: "provider-pdf" }) } },
    { id: "b", product: "B", fields: { fxFeePct: value({ route: "agent" }) } },
    { id: "c", product: "C", fields: { fxFeePct: value({ conditionsKnown: false }) } },
    { id: "d", product: "D", fields: {} },
  ];
  const c = coverage(entries, "fxFeePct");

  expect(c.total).toBe(4);
  expect(c.covered).toBe(2); // c has no conditions, d has nothing
  expect(c.byRoute["provider-pdf"]).toBe(1);
  expect(c.byRoute.agent).toBe(1);
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm --filter @lavega/core test -- catalog`
Expected: FAIL — `Failed to load url ./catalog.js`.

- [ ] **Step 3: Write the implementation**

```ts
// packages/core/src/catalog.ts

/** How a figure was obtained, best first. The tier travels WITH the value
 *  because "99% covered" that is half model-derived is a different product from
 *  99% primary, and one number would hide that. */
export type CatalogRoute = "provider-page" | "provider-pdf" | "wayback" | "comparison" | "agent";

export type CatalogField = "fxFeePct" | "convertFeePct" | "cashbackPct" | "pointsPerEuro" | "interestPct";

export type CatalogValue = {
  value: number;
  route: CatalogRoute;
  /** Where it came from. A number without one is a rumour. */
  sourceUrl: string;
  /** The date the SOURCE stated, else the sweep date. Never the date we fetched
   *  it under a different source's stamp — that shipped twice. */
  checkedAt: string;
  /** null means genuinely unconditional. It does NOT mean unknown; that is what
   *  `conditionsKnown` is for, and conflating the two is the whole reason this
   *  field exists. */
  conditions: string | null;
  conditionsKnown: boolean;
};

export type CatalogEntry = {
  id: string;
  product: string;
  fields: Partial<Record<CatalogField, CatalogValue>>;
};

/** Covered = a value, a source, a date, AND its conditions. All four.
 *  Revolut is the standing example of what the fourth one costs. */
export function isCovered(v: CatalogValue | undefined): boolean {
  if (!v) return false;
  if (!Number.isFinite(v.value)) return false;
  if (!v.sourceUrl.trim()) return false;
  if (!v.checkedAt.trim()) return false;
  return v.conditionsKnown;
}

const ROUTES: CatalogRoute[] = ["provider-page", "provider-pdf", "wayback", "comparison", "agent"];

export function coverage(
  entries: readonly CatalogEntry[],
  field: CatalogField,
): { covered: number; total: number; byRoute: Record<CatalogRoute, number> } {
  const byRoute = Object.fromEntries(ROUTES.map((r) => [r, 0])) as Record<CatalogRoute, number>;
  let covered = 0;
  for (const e of entries) {
    const v = e.fields[field];
    if (!isCovered(v)) continue;
    covered++;
    byRoute[(v as CatalogValue).route]++;
  }
  return { covered, total: entries.length, byRoute };
}
```

- [ ] **Step 4: Export and run**

Add `export * from "./catalog.js";` to `packages/core/src/index.ts` after the `./bankNl.js` line.

Run: `pnpm --filter @lavega/core test -- catalog` then `pnpm --filter @lavega/core typecheck`
Expected: 3 passing, no type errors.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/catalog.ts packages/core/src/catalog.test.ts packages/core/src/index.ts
git commit -m "feat(core): a catalogue entry is value, source, date AND conditions

All four or it is not covered. 104 of 124 rates are conditional, and Revolut
shipped as an unconditional 0% - ranked first, told him the trip would cost
nothing, and the 0% expired EUR 1.000 into the month.

conditions: null means unconditional. conditionsKnown: false means we never
established them. Conflating those two is the failure this type exists to stop.

Coverage reports the route as well as the total, because 99% that is half
model-derived is a different product from 99% primary."
```

---

### Task 2: Reading a provider PDF

The route that dissolved both ceilings. It runs in the SWEEP, never in the server, so no PDF dependency enters the running app.

**Files:**
- Create: `packages/core/src/pdfText.ts`
- Create: `packages/core/src/pdfText.test.ts`
- Create: `packages/core/src/__fixtures__/ingKostenoverzicht.txt` (the extracted text, committed — see Step 1)

**Interfaces:**
- Consumes: nothing
- Produces:
  ```ts
  export type PdfFigure = { field: "fxFeePct"; value: number; line: string; conditions: string | null };
  export function readIngTariffs(text: string): PdfFigure[];
  ```

- [ ] **Step 1: Build the fixture from the real document**

The parser is pure and tested against committed text, so the test never touches the network.

```bash
mkdir -p packages/core/src/__fixtures__
curl -sSL -o /tmp/ing.pdf --max-time 40 \
  "https://assets.ing.com/m/21a7a55ed70382ab/original/ING_Kostenoverzicht-betaalproducten-particulieren_2023.pdf"
pdftotext -layout /tmp/ing.pdf /tmp/ing.txt
# Keep only the tariff pages; the fixture is evidence, not the whole brochure.
sed -n '90,300p' /tmp/ing.txt > packages/core/src/__fixtures__/ingKostenoverzicht.txt
grep -c koersopslag packages/core/src/__fixtures__/ingKostenoverzicht.txt   # expect >= 5
```

- [ ] **Step 2: Write the failing test**

```ts
// packages/core/src/pdfText.test.ts
import { readFileSync } from "node:fs";
import { expect, test } from "vitest";
import { readIngTariffs } from "./pdfText.js";

const TEXT = readFileSync(new URL("./__fixtures__/ingKostenoverzicht.txt", import.meta.url), "utf8");

test("the ING tariff sheet yields the debit-card koersopslag", () => {
  const figures = readIngTariffs(TEXT);
  const debit = figures.find((f) => /betaalpas/i.test(f.line) && !/opnemen|opname/i.test(f.line));

  expect(debit?.value).toBe(1.4);
  expect(debit?.line).toContain("koersopslag");
});

test("a tiered credit-card rate carries its threshold as a condition, not as a bare number", () => {
  // "tot € 500 per creditcardperiode 0,00%" and "boven € 500 2,00%" are one
  // product with a cap. Reported as a bare 0% it is the Revolut mistake again.
  const figures = readIngTariffs(TEXT);
  const tiered = figures.filter((f) => f.conditions !== null);

  expect(tiered.length).toBeGreaterThan(0);
  expect(tiered.some((f) => /€\s?\d/.test(f.conditions as string))).toBe(true);
});

test("a line with no percentage yields nothing rather than a zero", () => {
  expect(readIngTariffs("Overschrijvingen via Mijn ING   € 0,00")).toEqual([]);
});
```

- [ ] **Step 3: Run it and watch it fail**

Run: `pnpm --filter @lavega/core test -- pdfText`
Expected: FAIL — `Failed to load url ./pdfText.js`.

- [ ] **Step 4: Write the implementation**

```ts
// packages/core/src/pdfText.ts

/** A figure read out of a provider's own tariff document.
 *
 *  This route exists because testing ing.nl and concluding "ING is unreachable"
 *  was wrong: the block is on the HTML host, and the tariff sheet sits on
 *  assets.ing.com with no protection at all — it fetches with no User-Agent.
 *  These documents are legally required, stable across editions, and carry the
 *  CONDITIONS as well as the rates, which is the half that is otherwise hardest
 *  to get. */
export type PdfFigure = { field: "fxFeePct"; value: number; line: string; conditions: string | null };

/** "1,40 %" and "2,00%" both appear in the same document. */
const PCT = /(\d{1,2})[,.](\d{1,2})\s*%/;
/** A threshold that makes the rate conditional: "tot € 500 per creditcardperiode". */
const THRESHOLD = /\b(tot|boven|vanaf)\b[^%]{0,60}?€\s?[\d.]+[^%]{0,40}/i;

export function readIngTariffs(text: string): PdfFigure[] {
  const out: PdfFigure[] = [];
  for (const raw of text.split("\n")) {
    const line = raw.replace(/\s+/g, " ").trim();
    if (!/koersopslag/i.test(line)) continue;
    const m = PCT.exec(line);
    if (!m) continue; // a line about koersopslag with no number states nothing
    const value = Number(`${m[1]}.${m[2]}`);
    if (!Number.isFinite(value)) continue;
    const cond = THRESHOLD.exec(line);
    out.push({ field: "fxFeePct", value, line, conditions: cond ? cond[0].trim() : null });
  }
  return out;
}
```

- [ ] **Step 5: Run the tests and commit**

Run: `pnpm --filter @lavega/core test -- pdfText` then `pnpm --filter @lavega/core typecheck`
Expected: 3 passing, no type errors.

```bash
git add packages/core/src/pdfText.ts packages/core/src/pdfText.test.ts packages/core/src/__fixtures__/ingKostenoverzicht.txt
git commit -m "feat(core): read a provider's own tariff PDF

The route that dissolved both ceilings. Testing ing.nl and concluding 'ING is
unreachable' was wrong: the block is on the HTML host, while the tariff sheet
sits on assets.ing.com and fetches with no User-Agent at all.

Parses koersopslag lines and, critically, carries a tier threshold as a CONDITION
rather than reporting the inside-the-cap rate as a bare number - which is the
Revolut mistake in a different document.

Pure, tested against committed text extracted from the real PDF, so the suite
never touches the network."
```

---

### Task 3: The route ladder

**Files:**
- Create: `packages/core/src/catalogRoutes.ts`
- Create: `packages/core/src/catalogRoutes.test.ts`

**Interfaces:**
- Consumes: `CatalogRoute`, `CatalogValue` from Task 1
- Produces:
  ```ts
  export type RouteAttempt = { route: CatalogRoute; run: () => Promise<CatalogValue | null> };
  export type LadderResult = { value: CatalogValue | null; tried: CatalogRoute[]; reason: string | null };
  export function ladderOrder(): CatalogRoute[];
  export async function runLadder(attempts: readonly RouteAttempt[]): Promise<LadderResult>;
  ```

- [ ] **Step 1: Write the failing test**

```ts
// packages/core/src/catalogRoutes.test.ts
import { expect, test } from "vitest";
import { ladderOrder, runLadder, type RouteAttempt } from "./catalogRoutes.js";
import type { CatalogValue } from "./catalog.js";

const value = (route: CatalogValue["route"]): CatalogValue => ({
  value: 1.4, route, sourceUrl: "https://x", checkedAt: "2026-08-18",
  conditions: null, conditionsKnown: true,
});

test("the ladder prefers the provider's own document over anything derived", () => {
  expect(ladderOrder()).toEqual(["provider-page", "provider-pdf", "wayback", "comparison", "agent"]);
});

test("the first route that answers wins, and later ones are not run", async () => {
  let agentRan = false;
  const attempts: RouteAttempt[] = [
    { route: "provider-page", run: async () => null },
    { route: "provider-pdf", run: async () => value("provider-pdf") },
    { route: "agent", run: async () => { agentRan = true; return value("agent"); } },
  ];
  const out = await runLadder(attempts);

  expect(out.value?.route).toBe("provider-pdf");
  expect(agentRan).toBe(false); // the expensive route is not paid for unnecessarily
  expect(out.tried).toEqual(["provider-page", "provider-pdf"]);
});

test("a route that throws does not end the sweep — the next one is still tried", async () => {
  const attempts: RouteAttempt[] = [
    { route: "provider-page", run: async () => { throw new Error("connection killed"); } },
    { route: "comparison", run: async () => value("comparison") },
  ];
  const out = await runLadder(attempts);

  expect(out.value?.route).toBe("comparison");
  expect(out.tried).toEqual(["provider-page", "comparison"]);
});

test("when every route fails the reason is recorded, never a zero", async () => {
  const out = await runLadder([
    { route: "provider-page", run: async () => { throw new Error("403 Cloudflare"); } },
    { route: "wayback", run: async () => null },
  ]);

  expect(out.value).toBeNull();
  expect(out.reason).toContain("403");
  expect(out.tried).toEqual(["provider-page", "wayback"]);
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm --filter @lavega/core test -- catalogRoutes`
Expected: FAIL — `Failed to load url ./catalogRoutes.js`.

- [ ] **Step 3: Write the implementation**

```ts
// packages/core/src/catalogRoutes.ts
import type { CatalogRoute, CatalogValue } from "./catalog.js";

export type RouteAttempt = { route: CatalogRoute; run: () => Promise<CatalogValue | null> };
export type LadderResult = { value: CatalogValue | null; tried: CatalogRoute[]; reason: string | null };

/** Best first. The provider's own page and its own PDF outrank anything derived,
 *  and the agent is last because it costs money — not because it is inaccurate.
 *  Measured, it is accurate: it corrected bank.nl on Knab. */
const ORDER: CatalogRoute[] = ["provider-page", "provider-pdf", "wayback", "comparison", "agent"];

export function ladderOrder(): CatalogRoute[] {
  return [...ORDER];
}

/** Try routes in ladder order, first answer wins, and record what was tried.
 *
 *  A throwing route does NOT end the sweep: half these sources 403, time out or
 *  moved, and one unreachable host must not cost us the other four routes. When
 *  everything fails the reason is kept, because "we could not read it" is a
 *  useful answer and a silent zero is a wrong one. */
export async function runLadder(attempts: readonly RouteAttempt[]): Promise<LadderResult> {
  const ordered = [...attempts].sort((a, b) => ORDER.indexOf(a.route) - ORDER.indexOf(b.route));
  const tried: CatalogRoute[] = [];
  const reasons: string[] = [];

  for (const attempt of ordered) {
    tried.push(attempt.route);
    try {
      const value = await attempt.run();
      if (value) return { value, tried, reason: null };
      reasons.push(`${attempt.route}: no figure`);
    } catch (e) {
      reasons.push(`${attempt.route}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  return { value: null, tried, reason: reasons.join(" · ") || null };
}
```

- [ ] **Step 4: Run and commit**

Run: `pnpm --filter @lavega/core test -- catalogRoutes` then the typecheck.
Expected: 4 passing.

```bash
git add packages/core/src/catalogRoutes.ts packages/core/src/catalogRoutes.test.ts
git commit -m "feat(core): the route ladder, first answer wins

Provider page, then its PDF, then Wayback, then a comparison table, then the
agent. The agent is last because it costs money, not because it is inaccurate -
measured, it corrected bank.nl on Knab.

A throwing route does not end the sweep: half these sources 403, time out or
moved, and one unreachable host must not cost us the other four routes. When
every route fails the reason is kept, because 'we could not read it' is a useful
answer and a silent zero is a wrong one."
```

---

### Task 4: The sweep script

**Files:**
- Create: `scripts/catalog-sweep.ts`
- Modify: `package.json` (add `"catalog:sweep": "tsx scripts/catalog-sweep.ts"` beside `sync:n8n`)
- Modify: `package.json` devDependencies — add `"tsx": "^4"` at the root if it is not already resolvable there (it is a dependency of `apps/server`, not of the root)
- Create: `docs/catalog/catalog.json` (written by the first run)

**Interfaces:**
- Consumes: `runLadder`, `readIngTariffs`, `isCovered`, `coverage` from Tasks 1–3, and `docs/catalog/state.json` written by the discovery sweep
- Produces: `docs/catalog/catalog.json` and an updated `docs/catalog/state.json`

- [ ] **Step 1: Write the script**

```js
// scripts/catalog-sweep.ts
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
 *   pnpm catalog:sweep                 # every product
 *   pnpm catalog:sweep -- --only ing   # one, while iterating
 *   pnpm catalog:sweep -- --dry        # report, write nothing
 */
import { readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { runLadder, type RouteAttempt } from "@lavega/core";
import { readIngTariffs, coverage, isCovered } from "@lavega/core";

const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36";
const STATE = "docs/catalog/state.json";
const CATALOG = "docs/catalog/catalog.json";
const today = new Date().toISOString().slice(0, 10);

const args = process.argv.slice(2);
const only = args.includes("--only") ? args[args.indexOf("--only") + 1] : null;
const dry = args.includes("--dry");

async function getText(url) {
  const res = await fetch(url, { headers: { "User-Agent": UA, "Accept-Language": "nl-NL,nl;q=0.9" } });
  if (!res.ok) throw new Error(`${res.status}`);
  return res.text();
}

/** A PDF is fetched here and turned into text with pdftotext, which exists on the
 *  sweep machine. It is deliberately NOT a runtime dependency of the server. */
async function getPdfText(url) {
  const res = await fetch(url, { headers: { "User-Agent": UA } });
  if (!res.ok) throw new Error(`${res.status}`);
  writeFileSync("/tmp/catalog.pdf", Buffer.from(await res.arrayBuffer()));
  return execFileSync("pdftotext", ["-layout", "/tmp/catalog.pdf", "-"], { encoding: "utf8" });
}

const state = JSON.parse(readFileSync(STATE, "utf8"));
const ids = Object.keys(state.products).filter((id) => !only || id.includes(only));

const entries = [];
const changes = [];
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

  const { value, tried, reason } = await runLadder(attempts);
  const prev = state.products[id].lastValue ?? null;
  if (value && prev !== null && prev !== value.value) {
    changes.push(`${p.product}: ${prev} → ${value.value} (${value.route})`);
  }
  state.products[id].lastChecked = today;
  state.products[id].lastValue = value ? value.value : null;
  state.products[id].lastRoute = value ? value.route : null;
  state.products[id].lastReason = value ? null : reason;
  entries.push({ id, product: p.product, fields: value ? { fxFeePct: value } : {} });
  console.log(`${isCovered(value) ? "✓" : "·"} ${p.product.padEnd(34)} ${tried.join(">") || "no route"}`);
}

const c = coverage(entries, "fxFeePct");
console.log(`\ncovered ${c.covered}/${c.total}  by route: ${JSON.stringify(c.byRoute)}`);
if (changes.length) console.log(`\nCHANGED:\n  ${changes.join("\n  ")}`);

if (dry) { console.log("\n--dry: nothing written"); process.exit(0); }
state.lastRun = today;
writeFileSync(CATALOG, JSON.stringify({ generatedAt: today, entries }, null, 2) + "\n");
writeFileSync(STATE, JSON.stringify(state, null, 2) + "\n");
console.log(`\nwrote ${CATALOG} and ${STATE}`);
```

- [ ] **Step 2: Add the ING PDF to the state file**

The discovery sweep recorded ING as `route: "agent"`, which the spikes disproved. Give it its document:

```bash
python3 - <<'PY'
import json
p = 'docs/catalog/state.json'
s = json.load(open(p))
for key in ('ing-betaalpas', 'ing-creditcard'):
    if key in s['products']:
        s['products'][key]['pdfUrl'] = 'https://assets.ing.com/m/21a7a55ed70382ab/original/ING_Kostenoverzicht-betaalproducten-particulieren_2023.pdf'
        s['products'][key]['route'] = 'provider-pdf'
        s['products'][key]['readable'] = 'yes'
json.dump(s, open(p, 'w'), ensure_ascii=False, indent=2)
print('ING routed to its PDF')
PY
```

- [ ] **Step 3: Run it on ING alone and read the output**

Run: `pnpm catalog:sweep -- --only ing --dry`
Expected: a `✓` line for ING betaalpas via `provider-pdf`, and a coverage line. If it prints `·`, read the reason it recorded — do not "fix" it by loosening the parser until you know why.

- [ ] **Step 5: Put it on a schedule**

The spec asks for weekly-full plus daily-volatile. A GitHub Action is the right home: the runner has
`pdftotext` available via apt, the minutes are free, and **its output is a commit** — which is the
whole review mechanism. Create `.github/workflows/catalog-sweep.yml`:

```yaml
name: catalog sweep
on:
  schedule:
    - cron: "0 5 * * 1"        # Monday 05:00 UTC — terms move yearly, not daily
  workflow_dispatch:            # and on demand, because the first runs need watching
permissions:
  contents: write
jobs:
  sweep:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22, cache: pnpm }
      - run: sudo apt-get update && sudo apt-get install -y poppler-utils   # pdftotext
      - run: pnpm install --frozen-lockfile
      - run: pnpm catalog:sweep
      - name: Commit whatever changed
        run: |
          git config user.name  "lavega-catalog"
          git config user.email "noreply@lavega.dev"
          git add docs/catalog/catalog.json docs/catalog/state.json
          git diff --staged --quiet || git commit -m "chore(catalog): weekly sweep"
          git push
```

Run it once with **workflow_dispatch** and read the diff before trusting the schedule. A sweep that
silently commits a wrong figure every Monday is worse than no sweep, and the first run is the only
cheap moment to find that out.

- [ ] **Step 6: Run the whole sweep and commit both files**

```bash
pnpm catalog:sweep
git add scripts/catalog-sweep.ts package.json .github/workflows/catalog-sweep.yml docs/catalog/catalog.json docs/catalog/state.json
git commit -m "feat(catalog): the sweep, writing a committed artifact

Runs on a schedule and OUTSIDE the app: it writes a file that gets committed, and
the server only reads that file. No scraper, no PDF parser and no flaky network
call enters the running product, and every changed figure arrives as a reviewable
git diff.

Reports coverage BY ROUTE, not just a total, and prints what changed since the
last run rather than re-dumping. A product it could not read records the reason.

ING is routed to its PDF, correcting the discovery sweep which marked it
agent-only on the strength of a block that was only ever on the HTML host."
```

---

### Task 5: The server reads the catalogue

**Files:**
- Modify: `apps/server/src/cardTerms.ts`
- Modify: `apps/server/src/cardTerms.test.ts`

**Interfaces:**
- Consumes: `docs/catalog/catalog.json` from Task 4, `CatalogEntry`/`isCovered` from Task 1
- Produces: catalogue figures entering the existing card-terms cache at the right rung

- [ ] **Step 1: Write the failing test**

```ts
// append to apps/server/src/cardTerms.test.ts

test("a catalogue figure enters at its own route's precedence, and carries its conditions", () => {
  // The catalogue is a FILE, so it is instant and free — it should fill the cache
  // before anything is looked up, and it must not be outranked by an agent guess
  // when it came from the provider's own PDF.
  ingestCatalogue([{
    id: "ing-betaalpas",
    product: "ING betaalpas",
    fields: {
      fxFeePct: {
        value: 1.4, route: "provider-pdf",
        sourceUrl: "https://assets.ing.com/…/kostenoverzicht.pdf",
        checkedAt: "2026-06-15", conditions: null, conditionsKnown: true,
      },
    },
  }], "NL", "USD");

  const held = getCardTerms(input(["ING betaalpas"]), "k", { lookup: (async () => []) as never });
  expect(held.terms[0].fxFeePct).toBe(1.4);
  expect(held.terms[0].checkedAt).toBe("2026-06-15"); // the SOURCE's date, not today's
});

test("a catalogue figure whose conditions were never established does not enter", () => {
  // Revolut's 0% was true inside a EUR 1.000 monthly cap. A figure we never
  // checked for a cap is not an answer, and letting it in is how it shipped.
  const res = ingestCatalogue([{
    id: "revolut-betaalpas",
    product: "Revolut betaalpas",
    fields: {
      fxFeePct: {
        value: 0, route: "provider-page", sourceUrl: "https://revolut.com/x",
        checkedAt: "2026-08-18", conditions: null, conditionsKnown: false,
      },
    },
  }], "NL", "USD");

  expect(res.accepted).toBe(0);
  expect(res.rejected).toContain("Revolut betaalpas");
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm --filter @lavega/server test -- cardTerms`
Expected: FAIL — `ingestCatalogue is not exported`.

- [ ] **Step 3: Write the implementation**

Add to `apps/server/src/cardTerms.ts`:

```ts
import { isCovered, type CatalogEntry } from "@lavega/core";

/** Where a catalogue figure sits on the existing precision ladder. A provider's
 *  own page or PDF is the most precise thing there is; the agent is the least.
 *  Reusing the ladder means the catalogue cannot quietly outrank a correction. */
const ROUTE_SOURCE: Record<string, TermsSource> = {
  "provider-page": "provider",
  "provider-pdf": "provider",
  wayback: "provider",
  comparison: "comparison",
  agent: "agent",
};

/** Load the committed catalogue into the cache. Instant and free — it is a file —
 *  so the block is answered before anything is looked up.
 *
 *  A figure whose CONDITIONS were never established is refused. That is not
 *  fussiness: Revolut's 0% was true only inside a €1.000 monthly cap, and it
 *  shipped as unconditional, ranked first, and told him the trip was free. */
export function ingestCatalogue(
  entries: readonly CatalogEntry[],
  homeCountry: string,
  currency: string,
): { accepted: number; rejected: string[] } {
  const rejected: string[] = [];
  let accepted = 0;
  for (const entry of entries) {
    const fx = entry.fields.fxFeePct;
    if (!isCovered(fx)) {
      rejected.push(entry.product);
      continue;
    }
    const ok = write(
      keyOf(entry.product, homeCountry, currency),
      {
        provider: entry.product,
        fxFeePct: fx!.value,
        checkedAt: fx!.checkedAt,
        note: fx!.conditions ?? undefined,
      },
      ROUTE_SOURCE[fx!.route] ?? "agent",
    );
    if (ok) accepted++;
    else rejected.push(entry.product);
  }
  return { accepted, rejected };
}
```

- [ ] **Step 4: Run everything and commit**

```bash
pnpm turbo run typecheck --force
pnpm turbo run test --force
pnpm --filter @lavega/web build

git add apps/server/src/cardTerms.ts apps/server/src/cardTerms.test.ts
git commit -m "feat(server): read the committed catalogue into the card-terms cache

A file, so it is instant and free, and the travel block is answered before
anything is looked up.

A figure whose conditions were never established is REFUSED rather than served.
Revolut is why: its 0% was true only inside a EUR 1.000 monthly cap, it shipped
as unconditional, ranked first, and told him the trip would cost nothing.

Routes map onto the existing precision ladder, so the catalogue cannot quietly
outrank the owner's own correction."
```

---

## Notes for the executor

- **The sweep is not the app.** If you find yourself adding a PDF parser or an HTTP fetch to `apps/server` at runtime, stop — that is the thing this design exists to avoid.
- **Do not loosen a parser to make a product go green.** A product that reads `·` with a recorded reason is a correct outcome. 101 of 124 already read by plain fetch; the tail is meant to be hard.
- **`conditionsKnown: false` is not a bug to be worked around.** It is the field that would have caught Revolut. Tasks 4 and 5 both deliberately refuse such figures, and a future task raises coverage by *establishing* conditions, never by assuming them.
- **Two ladder rungs have no attempt built yet, deliberately.** `wayback` and `agent` are in the type
  and the ordering, but Task 4 only wires `provider-page` and `provider-pdf`. That is the honest
  first slice: it covers the 101 already readable plus the two products the PDF route rescued.
  Wayback (proved on Rabobank) and the agent (already running in the server) are the next slice, and
  the ladder takes them without changing shape.
- Task 2's parser is ING-shaped on purpose. Generalising it before a second document exists would be guessing at a pattern from one example — which is the error this project keeps making.
