# Catalogue Sweep: Model On (slice 2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The weekly sweep reads every FX and interest figure with a Mistral model, gives every catalogue figure a status each run, and reports every figure it could not check.

**Architecture:** The sweep's three Anthropic call sites are replaced by one small Mistral client module. A rendering-reader rung and a confirm step raise how many figures a run can settle. The guard gains one rule (an equal number re-read from a known host confirms). The run summary carries a status for every catalogue figure, and the report lists what was not checked.

**Tech Stack:** TypeScript, tsx, vitest, plain `fetch` to `https://api.mistral.ai/v1/chat/completions`, `gh` CLI in GitHub Actions. No new dependencies; `@anthropic-ai/sdk` is removed from the sweep.

**Spec:** `docs/superpowers/specs/2026-11-21-weekly-data-refresh-design.md` (sections "Coverage contract", "Slice 2", owner decisions 5 and 7). Evidence for the choices: `docs/research/2026-11-22-catalog-model-bakeoff.md`.

## Global Constraints

- Work in the worktree `.worktrees/catalog-bakeoff`, branch `feat/catalog-model-on`. **Never commit or push.** Each task ends by staging its files (`git add`). The owner commits.
- Mistral only. No Anthropic call may remain reachable from the sweep. Model default `mistral-large-latest`, overridable with `CATALOG_MODEL`.
- The key is `MISTRAL_API_KEY`. Local runs load it with `--env-file=/Users/alexandersteunenberg/Desktop/My_Code/LaVega/apps/server/.env` (the worktree has no `.env`). Never print, log, copy or commit a key. Never run `gh secret set`.
- Spend: every paid local run passes `CATALOG_MAX_USD` (2 for partial runs, 5 for a full run). Total for this plan stays under $10.
- Rules that stay: "unknown is never zero"; "a field a run did not measure is not refuted"; a run that could not do its work must not make the catalogue worse; the `REFUSING TO WRITE` exits keep their behaviour.
- Every write still goes through `guardRun` and `mergeCatalogEntries`. No figure is published without a guard verdict.
- A model answer counts only with a verbatim quote found in the fetched text (the existing parser rule). The confirm step obeys the same rule.
- Pure modules stay pure (no clock, no I/O; `today` is an input). The sweep script may use the clock.
- Never run `gh issue create`, `gh label create` or other `gh` writes for real; `--dry` only.
- `docs/catalog/catalog.json` and `state.json` change only in Task 6, by a real sweep run.
- `pnpm run test`, `pnpm run typecheck`, `pnpm run lint` pass at the end of every task; format only changed files (the root format check fails on about 211 unrelated files).
- Do not edit `repos/`.

## Review Focus

1. Anchoring: the confirm step tells the model the stored value. A model that answers "still stated" without a quote that is really in the text, or with a quote that does not contain the value, must not confirm anything. (Task 3)
2. A reader (`r.jina.ai`) answer that is an error page, a captcha page or an empty shell must not be read as a document. (Task 2)
3. HTTP 429 and 5xx from Mistral must retry with backoff and then fail that one product, not the run; a billing or auth failure (401, 402, 403) must stop the run with a refused summary. (Task 1)
4. An equal-number read from an unknown host must not confirm. An equal-number uncovered read must never change stored conditions. (Task 3)
5. A figure the run never looked at (field not swept, product filtered by `--only`) must appear as "not checked" with its cause, not as confirmed and not be missing from the list. (Task 4)

## File Structure

| File                                                                                      | Responsibility                                                     |
| ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| `scripts/catalog/mistralClient.ts` (create)                                               | one chat-completions call with a tool, retries, usage, price table |
| `scripts/catalog/readerFetch.ts` (create)                                                 | fetch a page through the rendering reader; reject non-documents    |
| `scripts/catalog/catalogConfirm.ts` (create)                                              | confirm prompt, tool schema, reply parser                          |
| `packages/core/src/catalogGuard.ts` (modify)                                              | equal-number confirm rule                                          |
| `packages/core/src/catalogCoverage.ts` (create)                                           | status for every catalogue figure; unchecked-weeks counter         |
| `scripts/catalog/catalogReport.ts` (modify)                                               | "Not checked" section, always-on weekly report                     |
| `scripts/catalog-sweep.ts` (modify)                                                       | wire the above; remove Anthropic                                   |
| `scripts/catalog-report.ts`, workflow, `package.json`, a scripts tsconfig (modify/create) | weekly issue handling, secret, timeout, typecheck                  |

---

### Task 1: Mistral client and Anthropic removal

**Files:**

- Create: `scripts/catalog/mistralClient.ts`, `scripts/catalog/mistralClient.test.ts`
- Modify: `scripts/catalog-sweep.ts` (`askModel` ~505, `askRateModel` ~620, `findSource` ~854, spend table ~176, `apiKey` ~136, `useAgent`/`useSearch` ~143–156, `abortIfKeyUnusable` ~449, `createGuarded` ~492), root `package.json` (drop `@anthropic-ai/sdk` if nothing else imports it; check with `git grep`), `pnpm-lock.yaml` if the dependency goes

**Interfaces — Produces:**

```ts
export const DEFAULT_CATALOG_MODEL = "mistral-large-latest";
export const MISTRAL_PRICES: Readonly<Record<string, { inPerM: number; outPerM: number }>>;
// "mistral-large-latest": 0.7 / 2.1, "mistral-medium-latest": 1.5 / 7.5, "mistral-small-latest": 0.15 / 0.6
export type ToolSpec = { name: string; description: string; input_schema: object };
export type ModelUsage = { inputTokens: number; outputTokens: number };
export type ToolCallResult =
  | { kind: "tool"; input: unknown; usage: ModelUsage }
  | { kind: "declined"; text: string; usage: ModelUsage }; // model answered in text: a real answer
export class MistralFatalError extends Error {} // 401, 402, 403: stop the run
export class MistralCallError extends Error {} // this call failed after retries
export function usdFor(model: string, usage: ModelUsage): number; // unknown model → priced at 10 / 10 per million
export async function callWithTool(req: {
  apiKey: string;
  model: string;
  system: string;
  user: string;
  tool: ToolSpec;
  maxTokens?: number; // default 8192
  timeoutMs?: number; // default 180_000
  fetchImpl?: typeof fetch; // injected in tests
  sleep?: (ms: number) => Promise<void>; // injected in tests
}): Promise<ToolCallResult>;
```

Request: `temperature: 0`, `top_p: 1` (the large model rejects greedy sampling without it), `tool_choice: "auto"`, tools as `{type:"function", function:{name, description, parameters: input_schema}}`. Reply: `choices[0].message.tool_calls[0].function.arguments` is a JSON string; unparseable JSON → `MistralCallError`. 429 and 5xx: up to 3 retries, backoff 2 s, 6 s, 18 s. A timeout is not retried.

Sweep changes: `askModel` and `askRateModel` call `callWithTool` and keep everything else (slice step, 200 000-character refusal, parsers, spend recording, budget stop). The key is `MISTRAL_API_KEY`; `EXTRACT_MODEL` defaults to `DEFAULT_CATALOG_MODEL`. The search rung (`findSource`, `--search`) used Anthropic's web search: `--search` now exits at start-up with "discovery search is not available on Mistral yet" and exit code 2; the rung's code is deleted, `foundUrl` values already in `state.json` keep working. `MistralFatalError` takes the path the billing failure took. The billing-failure and budget-ceiling exits write a `refused` summary (`--summary-out`) with the reason; today they write none.

- [ ] **Step 1: failing tests** (`mistralClient.test.ts`, injected `fetchImpl` and `sleep`): `"sends tool in function format with temperature 0 and top_p 1"`, `"returns tool input parsed from the arguments string"`, `"text answer without a tool call is declined, with the text"`, `"unparseable arguments throw MistralCallError"`, `"429 then 200 retries and succeeds"`, `"four 500s throw MistralCallError after three retries"`, `"401 throws MistralFatalError without retry"`, `"usage is read from the reply"`, `"usdFor prices a known model and falls back to 10 per million"`.
- [ ] **Step 2:** `pnpm --filter @lavega/catalog-sweep test` → FAIL.
- [ ] **Step 3:** Implement the client; rewire the sweep; remove Anthropic.
- [ ] **Step 4:** Tests PASS. `git grep -n "anthropic" -- scripts package.json` shows no import or dependency left for the sweep.
- [ ] **Step 5: live proof.** `CATALOG_MAX_USD=2 pnpm exec tsx --env-file=<env> scripts/catalog-sweep.ts --dry --only ing-betaalpas,sns-internet-sparen --summary-out <scratch>` → both products end with a covered figure equal to the catalogue (1.4 and 1.3), verdict `confirm`, spend line printed. Save the output.
- [ ] **Step 6:** root test, typecheck, lint; strict `tsc` over the scripts; `git add`.

### Task 2: Rendering-reader rung

**Files:**

- Create: `scripts/catalog/readerFetch.ts`, `scripts/catalog/readerFetch.test.ts`
- Modify: `scripts/catalog-sweep.ts` (the per-product ladder around lines 1016–1240), `packages/core/src/catalog.ts` only if a route name must be added

**Interfaces — Produces:**

```ts
export type ReaderResult = { ok: true; text: string } | { ok: false; reason: string };
/** Fetch `url` through https://r.jina.ai/<url>. */
export async function readThroughReader(
  url: string,
  opts?: {
    fetchImpl?: typeof fetch;
    timeoutMs?: number; // default 45_000
  },
): Promise<ReaderResult>;
/** Pure: is this reader output a real document? */
export function looksLikeDocument(text: string): { ok: boolean; reason?: string };
```

`looksLikeDocument` rejects: under 400 characters; reader error bodies (JSON with `"code"` and `"message"`, or text starting with "Error"); captcha and block pages (case-insensitive match on "captcha", "access denied", "verify you are human", "enable javascript", "attention required", "just a moment") when the text is under 3 000 characters.

Ladder change: for a product whose own page (`termsUrl`, `docUrl`, `foundUrl`) was tried by plain fetch and either failed to fetch OR the model declined on its text, add one more attempt: the same URL through the reader, then the same model question. The stored `sourceUrl` is the provider's URL, not the reader URL (the guard's host rule then applies to the real host). The rung's route stays `agent`. A product with `docFetch: "jina"` already goes through the reader; do not ask twice.

- [ ] **Step 1: failing tests:** `"short text is not a document"`, `"reader error JSON is not a document"`, `"captcha page is not a document"`, `"a long page that mentions javascript is a document"`, `"readThroughReader requests r.jina.ai/<url> and returns text"`, `"non-200 returns ok false with the status"`, `"timeout returns ok false"`.
- [ ] **Step 2–4:** FAIL, implement, PASS.
- [ ] **Step 5: live proof.** `--dry --only american-express-gold-card,bigbank-flexibel-sparen,lloyds-bank-spaarrekening,asn-bank-asn-ideaalsparen` with the key and `CATALOG_MAX_USD=2`: these four failed plain fetch or had no number in the plain text on 2026-11-22 and showed the stored number through the reader. Record for each: which rung read it, the figure, the verdict. Not all four must confirm (a rate may have moved); none may end as "fetch failed".
- [ ] **Step 6:** root test, typecheck, lint, strict `tsc` over scripts; `git add`.

### Task 3: Confirm rule and confirm step

**Files:**

- Modify: `packages/core/src/catalogGuard.ts`, `catalogGuard.test.ts`, `catalogGuardRun.ts`, `catalogGuardRun.test.ts`
- Create: `scripts/catalog/catalogConfirm.ts`, `scripts/catalog/catalogConfirm.test.ts`
- Modify: `scripts/catalog-sweep.ts`

**Part A — guard rule.** In `judgeField`, before the `unjudged` return: when `found` is NOT covered, `current` IS covered, the values are equal (4 decimals), `found.value` is finite, and `sourceHost(found.sourceUrl)` is in `knownHosts` → `confirm`. Otherwise an uncovered read stays `unjudged`. `guardRun` on such a confirm keeps the stored value, conditions, `sourceUrl` and `checkedAt`, and refreshes `confirmedAt` by the existing rule (archive reads use the snapshot date).

Tests: `"uncovered read of the same number from a known host confirms"`, `"uncovered read of the same number from an unknown host is unjudged"`, `"uncovered read of a different number is unjudged"`, `"uncovered equal read keeps stored conditions and source"` (guardRun), `"uncovered equal read with a malformed source url is unjudged"`.

**Part B — confirm step.** When a product has a stored covered figure and the open question ended without a covered answer and without an equal-number read, ask once more on the same text:

```ts
export type ConfirmRequest = {
  product: string;
  field: "fxFeePct" | "interestPct";
  storedValue: number;
  storedConditions: string | null;
  text: string;
};
export function buildConfirmPrompt(req: ConfirmRequest): { system: string; user: string };
export const CONFIRM_TOOL: ToolSpec; // name "confirm_figure"
export type ConfirmReply =
  | { status: "still_stated"; quote: string }
  | { status: "changed"; quote: string; newValue: number }
  | { status: "not_on_page" };
/** null when the reply is malformed or its quote is not in the text. */
export function parseConfirmReply(raw: unknown, req: ConfirmRequest): ConfirmReply | null;
```

Parser rules: the quote must be found in `req.text` after the same normalisation the extract parser uses (`normalizeQuote`). For `still_stated` with a stored value other than 0, the quote must contain the stored number (comma or dot decimal). For a stored value of 0, the quote must contain one of: "0%", "0,00", "0.00", "geen", "gratis", "kosteloos", "no fee", "free", "without" (case-insensitive) — a zero is a statement, and it must be quoted. `changed` is never published from the confirm step: the sweep logs it and leaves the figure not confirmed (the open question is the only way to publish a value). The prompt states the stored value and its conditions, asks whether the page still states it for this product, and says that "not_on_page" is the right answer when the page does not show it.

Sweep: a `still_stated` reply becomes an uncovered read of the stored number with the page's URL as `sourceUrl`, so Part A's rule turns it into `confirm` only when the host is known.

Tests (`catalogConfirm.test.ts`): `"still_stated with the number in a real quote is accepted"`, `"still_stated whose quote is not in the text is rejected"`, `"still_stated whose quote lacks the stored number is rejected"`, `"zero is accepted only with a zero or free wording in the quote"`, `"changed carries the new value and a real quote"`, `"not_on_page needs no quote"`, `"malformed reply is null"`, `"prompt names the product, the stored value and the stored conditions"`.

- [ ] **Step 1–4:** failing tests, implement Part A and Part B, PASS.
- [ ] **Step 5: live proof.** `--dry --only n26-standard-betaalpas,revolut-premium-betaalpas,bunq-pro-betaalpas,ing-creditcard-extra,trade-republic-betaalpas` with the key, `CATALOG_MAX_USD=2`. On 2026-11-22 the first two (stored 0%) were declined by every model and the other three gave the right number without accepted conditions. Record per product: open answer, confirm answer with its quote, final verdict. Read the quotes yourself and state for each whether the quote really supports the stored figure for that product.
- [ ] **Step 6:** root test, typecheck, lint, strict `tsc` over scripts; `git add`.

### Task 4: Coverage status for every figure

**Files:**

- Create: `packages/core/src/catalogCoverage.ts`, `catalogCoverage.test.ts`
- Modify: `packages/core/src/index.ts`, `scripts/catalog/catalogReport.ts` + test, `scripts/catalog-sweep.ts`, `scripts/catalog-report.ts`

**Interfaces — Produces:**

```ts
export type FigureStatus = "confirmed" | "changed" | "waiting" | "held" | "not-checked";
export type NotCheckedCause =
  | "field-not-swept" // accountFee, pointsPerEuro, cashbackPct, convertFeePct until slice 3
  | "not-in-this-run" // product outside --only
  | "no-source" // figure has no http source (owner-stated)
  | "fetch-failed" // no rung could read a document
  | "not-found-on-page" // documents were read, no answer settled the figure
  | "stopped-early"; // budget ceiling or fatal error before this product
export type FigureCoverage = {
  id: string;
  product: string;
  field: CatalogField;
  status: FigureStatus;
  cause?: NotCheckedCause;
  detail?: string;
  uncheckedWeeks: number; // 0 when checked this run
};
export function coverageForRun(input: {
  entries: readonly MergeEntry[]; // the catalogue BEFORE the run
  verdicts: readonly FieldVerdict[];
  sweptFields: ReadonlySet<CatalogField>; // fxFeePct, interestPct
  sweptIds: ReadonlySet<string>; // products this run visited
  reached: ReadonlyMap<string, { fetched: boolean; reason: string | null }>; // by product id
  stoppedEarlyIds: ReadonlySet<string>;
  previousUnchecked: Readonly<Record<string, number>>; // "id.field" → weeks, from state.json
}): { figures: FigureCoverage[]; unchecked: Record<string, number> };
```

Mapping: verdict `confirm` → confirmed; `publish` → changed; `pending` → waiting; `hold` → held; `unjudged` or no verdict → not-checked with the first cause that applies in the order listed above. `uncheckedWeeks` = previous + 1 for not-checked, else 0; `waiting` and `held` count as checked (the run did look). `unchecked` is persisted in `state.json` as `unchecked` on the two write paths only, and only by a full run (an `--only` run does not advance the counter for products it skipped).

Report: `RunSummary` gains `coverage: FigureCoverage[]`. The header line becomes `Checked this run: <n> of <m> figures (<k> confirmed, <c> changed, <w> waiting, <h> held).` A new section "Not checked", grouped by cause with a plain sentence per cause, lists product, field and "<n> weeks" for each figure, capped at 40 lines per cause with "and N more"; `field-not-swept` is one summary line with a count, not a list. `buildReport` now returns a report for every `written` run (the weekly issue always opens); `dry` still returns null. `scripts/catalog-report.ts`: before creating the new issue, close open issues labelled `catalog-report` with the comment "Superseded by this week's report." (`gh issue list --label catalog-report --state open --json number`, then `gh issue close`), so one report is open at a time; `--dry` prints what it would close.

- [ ] **Step 1: failing tests** (`catalogCoverage.test.ts`): one per status mapping; one per cause, including the order when two apply; `"a figure outside --only is not-in-this-run and its counter does not advance"`; `"every catalogue figure appears exactly once"`; `"unchecked weeks add up across runs and reset when confirmed"`; `"waiting and held reset the counter"`. Report tests: `"header counts by status"`, `"not checked is grouped by cause with weeks"`, `"field-not-swept is one line"`, `"a written run with nothing changed still reports"`, `"cap of 40 per cause"`.
- [ ] **Step 2–4:** FAIL, implement, PASS.
- [ ] **Step 5:** `--no-agent --dry --summary-out <scratch>` then `pnpm catalog:report -- --summary <scratch> --dry`: dry prints nothing to report; then change `status` to `written` in a copy of the summary and run the report script with `--dry` on it: the body lists all 300 figures' statuses by count and the not-checked groups. Save the body.
- [ ] **Step 6:** root test, typecheck, lint, strict `tsc` over scripts; `git add`.

### Task 5: Workflow, typecheck, docs

**Files:**

- Modify: `.github/workflows/catalog-sweep.yml`, root `package.json`, `docs/catalog/watchlist.md`, the spec, `apps/server/.env.example` only if it documents the sweep
- Create: `scripts/tsconfig.json` (strict, `noEmit`, covering `scripts/catalog-sweep.ts`, `scripts/catalog-report.ts`, `scripts/catalog/**/*.ts`)

Workflow: the sweep step gets `env: MISTRAL_API_KEY: ${{ secrets.MISTRAL_API_KEY }}`, `CATALOG_MAX_USD: "5"`, `CATALOG_MODEL: mistral-large-latest`. `timeout-minutes: 180` (the loop is sequential and the large model takes about 30 s a figure; a full run is about 100 minutes). No other job gets the secret. Root `typecheck` also runs `tsc -p scripts/tsconfig.json` (add a `typecheck:scripts` script and call it from the root `typecheck`, or add it to the turbo pipeline — follow how the repo wires typecheck). Docs: watchlist section "How a change gets published" gains the reader rung, the confirm rule and step, the coverage statuses and the always-on weekly report; the spec's slice 2 gets a "Built" list and the measured coverage from Task 6.

- [ ] **Step 1:** Make the changes. YAML parses. `pnpm run typecheck` now fails if a type error is put in `scripts/catalog-sweep.ts` (prove it once, then remove the error).
- [ ] **Step 2:** root test, typecheck, lint; `git add`.

### Task 6: Gate and first full guarded run (controller runs this, not a subagent)

- [ ] **Step 1: gate.** In `docs/catalog/catalog.json` set `ing-betaalpas` `fxFeePct` value to 2.4. Run `CATALOG_MAX_USD=2 … scripts/catalog-sweep.ts --only ing-betaalpas --summary-out <scratch>` (not dry). Expect: verdict `pending`, `state.json` has `pending["ing-betaalpas.fxFeePct"]`, the catalogue figure is still 2.4, the report body shows "Waiting". Set that pending entry's `seenAt` to 7 days earlier, run again. Expect: `publish`, value 1.4, `confirmedAt` set, pending cleared. Then `git checkout -- docs/catalog/`.
- [ ] **Step 2: full run.** `CATALOG_MAX_USD=5 … scripts/catalog-sweep.ts --summary-out <scratch>` (not dry). Record: figures by status, the confirmed share of the 114 FX and interest figures, every `changed` figure with old and new value and quote, every `held` and `waiting`, spend, run time.
- [ ] **Step 3:** Read every `changed` figure's quote against its page text. A change that the quote does not support is reverted by hand and reported as a defect.
- [ ] **Step 4:** Stage `docs/catalog/catalog.json` and `state.json` as produced by the run. Write the coverage numbers into the spec.

## Not in this plan

Headless browser for sites that block the reader as well (Rabobank creditcard, Revolut Plus, Revolut Standard: they stay "fetch-failed" and are named in the report); discovery search on Mistral; fee, points and cashback (slice 3); turning the 12-month removal on; adding the repository secret (owner action).
