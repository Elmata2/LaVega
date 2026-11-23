# Catalogue Safety Net (slice 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The weekly catalogue sweep publishes a changed figure only when automatic checks pass, records when each figure was last confirmed, and opens one weekly report issue.

**Architecture:** Three small pure modules sit between the sweep's ladder and the existing `mergeCatalogEntries`: a per-field guard, a run-level function that turns guard verdicts into merge rows plus pending state, and a report builder. The sweep script only wires them and writes a run summary file; a second tiny script turns that file into a GitHub issue so the report still appears when the sweep exits red.

**Tech Stack:** TypeScript, vitest, tsx, `gh` CLI in GitHub Actions. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-11-21-weekly-data-refresh-design.md` (section "Slice 1 — safety net"). Read it with this plan.

## Global Constraints

- Work in a new worktree on branch `feat/catalog-safety-net` cut from `origin/master`. The main checkout holds unrelated staged work; do not touch it.
- **Never commit or push.** Each task ends by staging its files (`git add`). The owner commits.
- Rules that stay: "unknown is never zero"; "a field a run did not measure is not refuted"; a run that could not do its work must not make the catalogue worse.
- The guard judges _changes_ only. No figure already in `docs/catalog/catalog.json` may be removed or altered by this slice except to gain `confirmedAt`.
- Schema changes are additive optional fields. Server (`apps/server/src/catalogFile.ts`), web (`apps/web/src/catalogue-rates.ts`) and extension (`apps/extension/scripts/bundle-catalog.ts`) must read a file with and without them.
- New modules are pure: no clock, no I/O; `today` is an input as `YYYY-MM-DD` (same pattern as `scripts/catalog/businessSavingsWatch.ts`). No `Date.now` / `new Date()` in new modules.
- The 12-month removal is OFF for every field in this slice.
- No model calls are added. The slice must run in the free sweep (`--no-agent`).
- Lint `pnpm run lint`, format `pnpm run format`, types `pnpm run typecheck` must pass at the end of every task.
- Do not edit `repos/`.

## Review Focus

1. Same number, different float (`1.4` vs `1.4000000001`) must be "confirmed", not "changed" — compare after rounding to 4 decimals. (Task 1)
2. A malformed or empty `sourceUrl` must give a hold with reason `bad-source-url`, never a throw that kills the weekly run. (Task 1)
3. A large jump whose second read differs from the first (2,0 then 2,5) must stay pending with the new value; only two equal reads in different runs publish. Two runs on the same day (manual dispatch plus cron) do not count as two reads. (Task 1)
4. A current value of 0 for a ratio-limited field (`pointsPerEuro`, `accountFee`) must not divide by zero; 0 to non-zero is a large jump. (Task 1)
5. A sweep that exits red (blackout guards) or crashes before writing a summary must still produce a report issue that says so and lists nothing as published. (Tasks 3 and 4)

## File Structure

| File                                                                           | Responsibility                                       |
| ------------------------------------------------------------------------------ | ---------------------------------------------------- |
| `packages/core/src/catalog.ts` (modify)                                        | `confirmedAt?: string` on `CatalogValue`             |
| `packages/core/src/catalogGuard.ts` (create)                                   | per-field verdict, known hosts, limits               |
| `packages/core/src/catalogGuardRun.ts` (create)                                | verdicts for a whole run → merge rows + pending      |
| `packages/core/src/catalogAge.ts` (create)                                     | last-confirmed date, 12-month test, per-field switch |
| `packages/core/src/index.ts` (modify)                                          | export the three                                     |
| `scripts/catalog/catalogReport.ts` (create)                                    | run summary → issue title and body                   |
| `scripts/catalog-report.ts` (create)                                           | read summary file, open issue through `gh`           |
| `scripts/catalog-sweep.ts` (modify)                                            | call guard run, persist pending, write summary       |
| `.github/workflows/catalog-sweep.yml`, `railway.json`, `package.json` (modify) | permissions, report step, deploy trigger, npm script |

---

### Task 1: Publish guard

**Files:**

- Create: `packages/core/src/catalogGuard.ts`
- Test: `packages/core/src/catalogGuard.test.ts`
- Modify: `packages/core/src/catalog.ts` (add `confirmedAt?: string` to `CatalogValue`, doc comment: "last date a run read this same value from the source; `checkedAt` stays the date the source states"), `packages/core/src/index.ts`

**Interfaces — Produces:**

```ts
export type PendingFigure = { value: number; seenAt: string }; // seenAt = YYYY-MM-DD of first read

export type HoldReason = "out-of-range" | "unknown-host" | "comparison-route" | "bad-source-url";

export type GuardVerdict =
  | { kind: "unjudged" } // found is not covered: merge decides, as today
  | { kind: "confirm" } // same value as current covered figure
  | { kind: "publish"; viaPending: boolean }
  | { kind: "pending"; pending: PendingFigure } // large jump, waits for a second read
  | { kind: "hold"; reason: HoldReason };

export const FIELD_LIMITS: Readonly<
  Record<
    CatalogField,
    {
      min: number;
      max: number;
      jump:
        { kind: "points"; max: number; zeroIsJump: boolean } | { kind: "ratio"; factor: number };
    }
  >
>;

export function judgeField(input: {
  field: CatalogField;
  current: CatalogValue | undefined;
  found: CatalogValue;
  knownHosts: ReadonlySet<string>;
  pending: PendingFigure | undefined;
  today: string;
}): GuardVerdict;

/** Host of the page a figure came from; for a web.archive.org snapshot, the host of the archived page. null when unparseable. */
export function sourceHost(sourceUrl: string): string | null;

export function knownHostsByIssuer(
  products: Readonly<
    Record<
      string,
      {
        issuer?: string;
        termsUrl?: string | null;
        pdfUrl?: string | null;
        foundUrl?: string | null;
      }
    >
  >,
  entries: readonly MergeEntry[],
): Map<string, Set<string>>;
```

`FIELD_LIMITS` values (from the spec table):

| Field                       | min–max | jump                        |
| --------------------------- | ------- | --------------------------- |
| `fxFeePct`, `convertFeePct` | 0–5     | points 1, zeroIsJump true   |
| `interestPct`               | 0–10    | points 1.5, zeroIsJump true |
| `cashbackPct`               | 0–10    | points 1, zeroIsJump false  |
| `pointsPerEuro`             | 0–10    | ratio 2                     |
| `accountFee`                | 0–1000  | ratio 2                     |

Decision order inside `judgeField` (the tests pin it):

1. `found` not covered → `unjudged`.
2. `current` covered and values equal after rounding to 4 decimals → `confirm` (checked before the host and range rules: an existing figure is never re-judged).
3. `found.route === "comparison"` → hold `comparison-route`.
4. `sourceHost` null → hold `bad-source-url`; host not in `knownHosts` → hold `unknown-host`.
5. Value outside min–max → hold `out-of-range`.
6. No covered `current` → `publish` (no baseline, so no jump test).
7. Large jump (points: `|Δ| > max`, or `zeroIsJump` and found is 0 from non-zero; ratio: found > current×factor or found < current÷factor, and any move from or to 0): if `pending` has the same rounded value and `pending.seenAt < today` → `publish` with `viaPending: true`; else → `pending` with `seenAt` = existing `seenAt` when the value is the same, else `today`.
8. Otherwise → `publish`.

`knownHostsByIssuer`: key is `issuer` (products without an issuer use their id); hosts come from `termsUrl`, `pdfUrl`, `foundUrl` of every product of that issuer and from `sourceHost` of every `sourceUrl` already in `entries` for that issuer. Hosts are compared exactly, lower-cased.

- [ ] **Step 1: Write failing tests** in `catalogGuard.test.ts` (vitest, same helper style as `catalogMerge.test.ts`). One test per line:

```ts
// helpers: val(value, over?) → covered CatalogValue on https://www.bank.test/tarieven ; hosts = new Set(["www.bank.test"])
"uncovered found is unjudged"; // conditionsKnown:false → {kind:"unjudged"}
"same value confirms"; // current 1.4, found 1.4000000001 → confirm
"same value confirms even from an unknown host"; // found on other.test, equal value → confirm
"small change publishes"; // fxFeePct 1.4 → 1.5 → {kind:"publish", viaPending:false}
"comparison route is held"; // route:"comparison", 1.4 → 1.5 → hold comparison-route
"unknown host is held"; // sourceUrl https://vergelijk.test/x → hold unknown-host
"archive snapshot of a known host passes"; // https://web.archive.org/web/20260101000000/https://www.bank.test/t → publish
"malformed source url is held, not thrown"; // sourceUrl "not a url" → hold bad-source-url
"out of range is held"; // interestPct found 25 → hold out-of-range; fxFeePct -1 → same
"first figure publishes without a jump test"; // current undefined, interestPct 4.25 → publish
"large jump goes pending"; // interestPct 2 → 4, no pending, today 2026-11-23 → pending {value:4, seenAt:"2026-11-23"}
"exactly at the limit is not a jump"; // interestPct 2 → 3.5 → publish
"drop to zero is a jump for fx and interest"; // fxFeePct 1.4 → 0 → pending ; cashbackPct 0.5 → 0 → publish
"second equal read in a later run publishes"; // pending {4,"2026-11-23"}, today "2026-11-30" → publish viaPending:true
"second read on the same day stays pending"; // pending {4,"2026-11-23"}, today "2026-11-23" → pending, seenAt unchanged
"second read with another value restarts pending"; // pending {4,"2026-11-23"}, found 4.5, today "2026-11-30" → pending {4.5,"2026-11-30"}
"ratio jump"; // accountFee 24 → 60 → pending ; 24 → 40 → publish ; 24 → 10 → pending
"zero baseline on a ratio field is a jump"; // accountFee 0 → 24 → pending ; pointsPerEuro 0 → 1 → pending
"knownHostsByIssuer gathers state urls and catalogue sources per issuer";
"sourceHost reads plain and archived urls, null on rubbish";
```

- [ ] **Step 2:** Run `pnpm --filter @lavega/core test -- catalogGuard` → FAIL (module missing).
- [ ] **Step 3:** Implement `catalogGuard.ts` per the interfaces and decision order; add `confirmedAt`; export from `index.ts`.
- [ ] **Step 4:** Run the same command → PASS. Run `pnpm run typecheck`.
- [ ] **Step 5:** `git add` the four files.

### Task 2: Run-level guard and age

**Files:**

- Create: `packages/core/src/catalogGuardRun.ts`, `packages/core/src/catalogAge.ts`
- Test: `packages/core/src/catalogGuardRun.test.ts`, `packages/core/src/catalogAge.test.ts`
- Modify: `packages/core/src/index.ts`, `packages/core/src/catalogRates.ts`

**Interfaces — Consumes:** `judgeField`, `knownHostsByIssuer`, `GuardVerdict`, `PendingFigure` (Task 1); `MergeEntry` (`catalogMerge.ts`).

**Interfaces — Produces:**

```ts
// catalogGuardRun.ts
export type FieldVerdict = {
  id: string;
  product: string;
  field: CatalogField;
  verdict: GuardVerdict;
  before: CatalogValue | undefined; // what the catalogue held
  found: CatalogValue; // what the run read
};
export type PendingMap = Record<string, PendingFigure>; // key "productId.field"

export function guardRun(input: {
  prev: readonly MergeEntry[];
  rows: readonly MergeEntry[];
  knownHosts: ReadonlyMap<string, ReadonlySet<string>>; // by issuer, from knownHostsByIssuer
  pending: PendingMap;
  today: string;
}): { rows: MergeEntry[]; verdicts: FieldVerdict[]; pending: PendingMap };

// catalogAge.ts
export const MAX_FIGURE_AGE_MONTHS = 12;
/** Fields for which an aged-out figure leaves the ranking. Empty in slice 1 (spec: staged). */
export const AGE_REMOVAL_FIELDS: ReadonlySet<CatalogField>;
export function lastConfirmed(v: CatalogValue): string; // confirmedAt ?? checkedAt
export function isOlderThanMaxAge(v: CatalogValue, today: string): boolean; // calendar months, >= 12
export function isAgedOut(
  field: CatalogField,
  v: CatalogValue,
  today: string,
  enabled?: ReadonlySet<CatalogField>,
): boolean; // default enabled = AGE_REMOVAL_FIELDS
```

What `guardRun` does with each verdict for a row's field:

- `unjudged` → field passed through unchanged (existing merge rule decides).
- `confirm` → field = the _previous_ value with `confirmedAt: today` (previous `conditions`, `sourceUrl`, `checkedAt` kept, so weekly model wording does not churn the file).
- `publish` → field = found value with `confirmedAt: today`.
- `pending`, `hold` → field omitted from the row (merge then keeps the old value by its "not measured" rule).
- Returned `pending`: starts from the input map; an entry is set on `pending`, deleted on `publish`, `confirm` and `hold` for that key; keys the run did not measure are kept.
- A row with no fields left is still returned (with `fields: {}`) so the product stays in the artefact.

`catalogRates.ts`: every `asOf: v.checkedAt` becomes `asOf: lastConfirmed(v)`; `lastTermsCheckedAt` and `issuerConsensus` compare `lastConfirmed(v)` instead of `v.checkedAt`. Nothing is filtered out (removal is off).

- [ ] **Step 1: Write failing tests.**

```ts
// catalogGuardRun.test.ts
"confirm keeps the old value and stamps confirmedAt"; // prev 1.4 (checkedAt 2026-06-15, conditions "A"); found 1.4 conditions "B" → row field value 1.4, conditions "A", checkedAt "2026-06-15", confirmedAt today
"publish writes the found value with confirmedAt";
"hold omits the field and merge keeps the old value"; // feed result.rows to mergeCatalogEntries → old value still there, no confirmedAt added
"pending omits the field and records productId.field";
"publish via pending clears the pending key";
"hold clears a pending key for that field";
"pending for a product this run did not sweep is kept";
"unjudged field passes through untouched";
"every measured field yields one FieldVerdict with before and found";
"a row left with no fields is still returned";
"hosts are looked up by the row's issuer, falling back to its id";

// catalogAge.test.ts
"lastConfirmed prefers confirmedAt, falls back to checkedAt";
"isOlderThanMaxAge: 2025-11-21 vs today 2026-11-21 is true; 2025-11-22 is false";
"isAgedOut is false for every field with the default switch"; // AGE_REMOVAL_FIELDS.size === 0
"isAgedOut is true for an old figure when its field is enabled";
"malformed date counts as old"; // checkedAt "" or "2023" → isOlderThanMaxAge true
```

- [ ] **Step 2:** `pnpm --filter @lavega/core test -- catalogGuardRun catalogAge` → FAIL.
- [ ] **Step 3:** Implement both modules; change `catalogRates.ts` as above; export from `index.ts`.
- [ ] **Step 4:** `pnpm --filter @lavega/core test` → all PASS (existing `catalogRates.test.ts` must stay green: fixtures have no `confirmedAt`, so `asOf` is unchanged). Add one test to `catalogRates.test.ts`: `"asOf shows confirmedAt when present"`.
- [ ] **Step 5:** `pnpm run test` at the root (web and extension tests read the same types) → PASS. `git add`.

### Task 3: Report builder

**Files:**

- Create: `scripts/catalog/catalogReport.ts`
- Test: `scripts/catalog/catalogReport.test.ts`

**Interfaces — Consumes:** `FieldVerdict`, `PendingMap` (Task 2).

**Interfaces — Produces:**

```ts
export type RunSummary = {
  today: string;
  status: "written" | "refused" | "dry";
  refusedReason: string | null; // the REFUSING TO WRITE line, when refused
  verdicts: FieldVerdict[];
  kept: string[]; // from mergeCatalogEntries
  failures: { product: string; reason: string }[]; // products with no figure this run
  crossedAgeLine: { product: string; field: string; lastConfirmed: string }[];
  spendLines: string[];
  runUrl: string | null;
};

export const REPORT_LABEL = "catalog-report";
/** null = nothing to report this week. */
export function buildReport(summary: RunSummary): { title: string; body: string } | null;
/** For a run that left no summary file at all. */
export function buildCrashReport(
  today: string,
  runUrl: string | null,
): { title: string; body: string };
```

Report rules:

- Title: `Catalogue report <today>: <n> changed, <m> held`; for a refused run `Catalogue report <today>: run refused, nothing published`.
- Sections in this order, each omitted when empty: **Changed** (product, field, old → new, route, source link; mark "after second read" when `viaPending`), **Waiting for a second read** (pending), **Held back** (with reason in plain words), **Older than 12 months** (`crossedAgeLine`), **Not reachable** (`failures`, capped at 30 lines plus "and N more"), **Spend**.
- Returns `null` when status is `written` and Changed, Waiting, Held and Older-than-12-months are all empty (failures alone do not open an issue; they are the weekly normal for the free sweep).
- Status `dry` → always `null`. Status `refused` → always a report; it lists no Changed section.
- First-time figures (`before` undefined, verdict publish) are listed under Changed as `— → value`.
- Body is cut at 60 000 characters with a final line "report cut, see the run log".

- [ ] **Step 1: Write failing tests:** `"nothing to say returns null"`, `"failures alone return null"`, `"a changed figure lists old, new, route and source"`, `"publish after pending is marked as second read"`, `"held figures carry a plain reason for each HoldReason"`, `"refused run always reports and lists nothing as changed"`, `"dry run returns null"`, `"more than 30 failures are capped with a count"`, `"body over 60 000 characters is cut with the notice"`, `"crash report names the run url"`.
- [ ] **Step 2:** `pnpm --filter @lavega/catalog-sweep test -- catalogReport` → FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Same command → PASS. `git add`.

### Task 4: Wire the sweep, the report script and the workflow

**Files:**

- Modify: `scripts/catalog-sweep.ts` (`mergeSubset` near line 946; the dry exit and the three `REFUSING TO WRITE` exits near lines 1322–1360), `package.json`, `.github/workflows/catalog-sweep.yml`, `railway.json`
- Create: `scripts/catalog-report.ts`

**Interfaces — Consumes:** `guardRun`, `knownHostsByIssuer`, `isOlderThanMaxAge` (core); `RunSummary`, `buildReport`, `buildCrashReport`, `REPORT_LABEL` (Task 3).

Sweep changes:

- New flag `--summary-out <path>`. When given, the sweep writes a `RunSummary` JSON there on every exit path it controls: `dry`, each `REFUSING TO WRITE` exit (`status: "refused"`, `refusedReason` = the printed line), and the two write paths. `runUrl` comes from `GITHUB_SERVER_URL`/`GITHUB_REPOSITORY`/`GITHUB_RUN_ID` when set.
- The guard runs once, before the dry exit, so `--dry` prints the verdicts too: `const guarded = guardRun({ prev, rows: entries, knownHosts: knownHostsByIssuer(state.products, prev), pending: state.pending ?? {}, today })`. One console line per verdict that is not `confirm` or `unjudged`.
- `mergeSubset` passes `guarded.rows` to `mergeCatalogEntries` instead of the raw rows and sets `state.pending = guarded.pending` before writing `state.json`. `pending` lives at the top level of `state.json` next to `lastRun`.
- `crossedAgeLine`: figures in the merged catalogue for which `isOlderThanMaxAge` is true today and was false seven days earlier (so each figure is reported once, in the week it crosses).
- The existing `changes` array and its `CHANGED:` console block stay.

`scripts/catalog-report.ts` (same `gh` wrapper style as `scripts/business-savings-watch.ts`): args `--summary <path>`, `--dry` and `--push-failed` (forces the refused title with reason "the commit or push failed" and drops the Changed section). Missing or unparseable file → `buildCrashReport`. `buildReport` null → print "nothing to report" and exit 0. Otherwise `gh label create catalog-report --force --description "Weekly catalogue changes"`, then `gh issue create --title … --body-file … --label catalog-report`. `--dry` prints the title and body, calls no `gh`.

`package.json`: add `"catalog:report": "tsx scripts/catalog-report.ts"`.

Workflow (`sweep` job): permissions `contents: write` and `issues: write`; the sweep step becomes `pnpm catalog:sweep -- --summary-out "$RUNNER_TEMP/catalog-summary.json"`; after "Commit whatever changed" add a step `Report` with `if: always()`, `env: GH_TOKEN: ${{ github.token }}`, running `pnpm catalog:report -- --summary "$RUNNER_TEMP/catalog-summary.json"`. If the commit step failed, the report step must say so: pass `--push-failed` when `steps.commit.outcome == 'failure'` (give the commit step `id: commit`); the script then reports with the refused title and reason "the commit or push failed".

`railway.json`: add `"docs/catalog/**"` to `watchPatterns`. Today a sweep commit touches only `docs/catalog/`, which is outside the watched paths, so the server never redeploys for it and keeps serving the catalogue it booted with.

- [ ] **Step 1:** Make the sweep changes. `pnpm run typecheck` → PASS.
- [ ] **Step 2: Prove a normal run.** In the worktree: `pnpm catalog:sweep -- --no-agent --dry --summary-out /tmp/…/summary.json` (use a scratch path). Expected: exit 0, the verdict lines print, the summary file exists with `status: "dry"` and one verdict per measured field, `git status` shows no change under `docs/catalog/`.
- [ ] **Step 3: Prove a written run changes only what it should.** `pnpm catalog:sweep -- --no-agent --summary-out <scratch>/summary.json`, then `git diff --stat docs/catalog/` and a script check: every field present before the run is still present; every value that differs has a `publish` verdict in the summary; fields with verdict `confirm` gained `confirmedAt` equal to today and nothing else. Save the check output as evidence. Then `git checkout docs/catalog/` (the weekly job owns those files; this slice ships code only).
- [ ] **Step 4: Prove the guard holds a bad read.** In `docs/catalog/catalog.json`, change one FX figure the free sweep can read (pick one with verdict `confirm` in step 3) to its value plus 3. Run `pnpm catalog:sweep -- --no-agent --dry --only <that id>`. Restore with `git checkout docs/catalog/`. Expected verdict line for that product: `pending` (large jump), not `publish`.
- [ ] **Step 5: Prove the report script.** `pnpm catalog:report -- --summary <scratch>/summary.json --dry` → prints title and body or "nothing to report". `pnpm catalog:report -- --summary /nonexistent --dry` → prints the crash report.
- [ ] **Step 6:** Edit workflow, `railway.json`, `package.json`. Validate the workflow file parses: `gh workflow view catalog-sweep.yml` is not possible before merge, so run `python3 -c "import yaml,sys; yaml.safe_load(open('.github/workflows/catalog-sweep.yml'))"`.
- [ ] **Step 7:** `pnpm run lint && pnpm run format && pnpm run typecheck && pnpm run test` → PASS. `git add` everything.

### Task 5: Docs and handoff

**Files:**

- Modify: `docs/catalog/watchlist.md` (section "How a change gets published": guard rules, pending, the report issue, `confirmedAt`), `docs/superpowers/specs/2026-11-21-weekly-data-refresh-design.md` (mark slice 1 built; correct anything the build proved wrong)

- [ ] **Step 1:** Update both docs.
- [ ] **Step 2:** Check whether a push by the workflow triggers the web deploy: read the Vercel project's Git settings (`vercel.json` has no `ignoreCommand`; confirm in the dashboard or with `gh api repos/Elmata2/lavega/deployments --jq '.[0:5]'` after the next Monday sweep commit). Record the answer in the spec. Not verifiable before merge; state that plainly in the handoff.
- [ ] **Step 3:** Write the "read this before committing" block for the owner: what changed, evidence paths from Task 4 steps 2–5, reviewer findings and how each was resolved, what is left (first real report arrives the Monday after merge; removal rule is off until slice 2).
- [ ] **Step 4:** After the owner commits and merges: comment on issue #371 with a short summary of slice 1.

## Not in this plan

Model switch-on and the Mistral or open-model bake-off (slice 2), sweeping fee, points and cashback (slice 3), promo shape (slice 4), business products (slice 5), turning the 12-month removal on.
