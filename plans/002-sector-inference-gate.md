# Plan 002: Honour the sector-inference setting in the sector read

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**:
> `git diff --stat 2cd8f1ea1..HEAD -- apps/investing-server/src/sectorRead.ts apps/investing-server/src/sectorRead.test.ts apps/investing-server/src/sectorResolution.ts`
> If any of those changed since this plan was written, compare the "Current
> state" excerpts against the live code before proceeding; on a mismatch,
> treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW — the cache key already computes the correct visibility flag
- **Depends on**: plans/001-remove-clone-files.md
- **Category**: bug
- **Planned at**: commit `2cd8f1ea1`, 2026-11-10

## Why this matters

The investing app has a per-tenant setting that turns AI sector inference off,
and a separate market-data consent gate. `docs/investing/DASHBOARD.md` and the
module's own docstring (`sectorRead.ts:35-41`) say the sector read applies both
gates exactly as the `/api/investing/summary` route does, so an inferred sector
a tenant may not see reads as `Unknown`.

The read does not do that. It computes the correct flag:

```ts
const showInferred = consented && inferenceEnabled;   // sectorRead.ts:156
```

but never passes it to the resolver, which receives the raw consent flag instead
(`sectorRead.ts:143`). So a tenant who gave market-data consent and later turned
sector inference **off** still gets cached System One sector labels. That is a
privacy/settings leak: the user switched a feature off and it keeps showing.

The regression is invisible to the suite because both sector-read tests that are
supposed to prove the gate assert on a symbol (`MYST`) that is not in the
position list they hand the reader — the harness default positions are `AAPL`.
They pass for the wrong reason. A direct probe at the planned commit
(inference off, consent given, one stored inferred profile) returned
`{"sector":"Healthcare","weight":1}` instead of `Unknown`.

After this plan: the setting is honoured, and the tests actually test it.

## Current state

`apps/investing-server/src/sectorRead.ts` — the module docstring already states the intent:

```ts
/**
 * ...
 * The gates — market-data consent, the inference
 * setting and the correction precedence — are applied here exactly as the
 * summary route applies them, so an inferred profile a tenant may not see still
 * reads as Unknown.
 */
```

Lines 136-148, the client-side resolver inside the Effect layer:

```ts
      const resolveWeights = async (
        tenantId: string,
        positions: readonly { symbol: string; marketValue: number | null; description?: string }[],
        gates: { consented: boolean; corrections: Record<string, string> },
      ): Promise<Map<string, SectorWeight[]>> => {
        const result = await resolvePortfolioSectors(positions, {
          store,
          correction: async (symbol) => gates.corrections[symbol.toUpperCase()] ?? null,
          showInferred: gates.consented,
          resolveListing: (symbol) => resolveListing(tenantId, symbol),
          ...(gates.consented ? { fetchProfile } : {}),
        });
        return result.weightsBySymbol;
      };
```

Lines 150-158, the caller that already knows the right value:

```ts
      const executeRead = async ({ tenantId }: SectorReadInput): Promise<SectorReadResult> => {
        const data = await dashboard(tenantId);
        const positions = data.positions;
        const current = await revision(tenantId);
        const consented = (await consent.get(tenantId)).accepted;
        const inferenceEnabled = await inferenceSetting.get(tenantId);
        const showInferred = consented && inferenceEnabled;
        const key = `${current}:${showInferred ? "1" : "0"}`;
```

Both call sites of `resolveWeights` (lines ~171-186, one for the cached-unseen
symbols branch and one for the full branch) pass `{ consented, corrections }`.

The resolver's option that matters, from `apps/investing-server/src/sectorResolution.ts:60-70`:

```ts
  /** Whether an already-cached `source: "inferred"` profile may be shown to
   *  this tenant. ... `false` degrades the profile to Unknown for display and
   *  coverage alike — the profile itself is never touched. */
  showInferred?: boolean;
```

`apps/investing-server/src/sectorRead.test.ts:183-202`, the two vacuous tests:

```ts
test("an unconsented tenant sees no inferred sector, counting it as unknown", async () => {
  const h = harness({ consented: false });
  await h.store.set("MYST", { ... source: "inferred", sector: "Healthcare" ... });
  const result = await h.reader({ tenantId: "local" });
  expect(result.sectors).toEqual([{ sector: "Unknown", weight: 1 }]);
  expect(result.sectorCoverage).toEqual({ provider: 0, inferred: 0, correction: 0, unknown: 1 });
});

test("inference off hides a cached inferred sector even with consent", async () => {
  const h = harness({ consented: true, inferenceEnabled: false });
  await h.store.set("MYST", { ... source: "inferred", sector: "Healthcare" ... });
  const result = await h.reader({ tenantId: "local" });
  expect(result.sectors).toEqual([{ sector: "Unknown", weight: 1 }]);
});
```

The harness (`sectorRead.test.ts:45-96`) defaults `positions` to
`[position("AAPL", 100)]`, so `MYST` is never resolved and both assertions hold
vacuously.

Conventions: tests use `vitest` with `test(...)` at top level (no `describe`),
in-memory stores from sibling `*.ts` modules, and `harness({...})` helpers — match
the surrounding file. Code identifiers are English; comments English.

## Commands you will need

| Purpose | Command | Expected on success |
|---------|---------|---------------------|
| Server typecheck | `pnpm --filter @lavega/investing-server typecheck` | exit 0 |
| Sector read tests | `pnpm --filter @lavega/investing-server exec vitest run src/sectorRead.test.ts` | all pass |
| Server tests | `pnpm --filter @lavega/investing-server test` | exit 0 |
| Full typecheck (after 001) | `pnpm typecheck` | exit 0 |
| Lint (after 001) | `pnpm lint` | exit 0 |

## Scope

**In scope** (the only files you may modify):
- `apps/investing-server/src/sectorRead.ts`
- `apps/investing-server/src/sectorRead.test.ts`

**Out of scope** (do NOT touch, even though they look related):
- `apps/investing-server/src/sectorResolution.ts` — its `showInferred` contract
  is already correct; do not change the resolver.
- `apps/investing-server/src/app.ts` routes (`/api/investing/sectors`,
  `/api/investing/summary`) — they already apply both gates; this plan only
  brings the `sectorRead.ts` reader in line.
- `apps/investing-server/src/sectorClassifier.ts`,
  `sectorInferenceBatch.ts`, `sectorRevision.ts` — no behaviour change needed.
- Any change to response shapes (`sectors`, `sectorCoverage`, `revision`).

## Git workflow

- Branch: `advisor/002-sector-inference-gate`
- Commits: `test(investing): make the sector-read gate tests resolve the symbol under test`,
  then `fix(investing): honour the sector-inference setting in the sector read`
- Do NOT push or open a PR unless the operator instructed it.
- Test-first: commit the red test before the fix if you use two commits.

## Steps

### Step 1: Make the two gate tests resolve `MYST`

In `apps/investing-server/src/sectorRead.test.ts`, pass positions explicitly in
both tests:

```ts
const h = harness({ consented: false, positions: [position("MYST", 100)] });
```

and

```ts
const h = harness({ consented: true, inferenceEnabled: false, positions: [position("MYST", 100)] });
```

Leave the assertions unchanged.

**Verify**: `pnpm --filter @lavega/investing-server exec vitest run src/sectorRead.test.ts`
→ the test `inference off hides a cached inferred sector even with consent`
**fails** with an actual `[{ sector: "Healthcare", weight: 1 }]`. That red run is
the proof the bug is real. If both tests still pass, STOP — you are not looking
at the code this plan describes.

### Step 2: Add the positive case as a third test

Append after the inference-off test:

```ts
test("consent and inference on shows the cached inferred sector", async () => {
  const h = harness({ consented: true, inferenceEnabled: true, positions: [position("MYST", 100)] });
  await h.store.set("MYST", {
    kind: "stock",
    sector: "Healthcare",
    industry: "Unknown",
    source: "inferred",
    specificity: "sector",
    confidence: 0.82,
    inferredAt: "2026-09-01T00:00:00.000Z",
  });

  const result = await h.reader({ tenantId: "local" });

  expect(result.sectors).toEqual([{ sector: "Healthcare", weight: 1 }]);
  expect(result.sectorCoverage).toEqual({ provider: 0, inferred: 1, correction: 0, unknown: 0 });
});
```

**Verify**: this new test passes **before** the fix (the leak shows the label),
and the inference-off test from step 1 fails. Exactly one gate test should be red.

### Step 3: Pass the computed flag through

In `apps/investing-server/src/sectorRead.ts`:

1. Widen the `gates` parameter of `resolveWeights`:

```ts
        gates: { consented: boolean; showInferred: boolean; corrections: Record<string, string> },
```

2. Use it for the resolver option:

```ts
          showInferred: gates.showInferred,
```

3. Keep the provider fetch gated on consent only (a fetch is a network call, the
   display gate is separate):

```ts
          ...(gates.consented ? { fetchProfile } : {}),
```

4. Pass `showInferred` at **both** call sites (cached-unseen branch and full
   branch), keeping `consented` for the fetch spread:

```ts
            const resolved = await resolveWeights(tenantId, unseen, {
              consented,
              showInferred,
              corrections: correctionsForTenant,
            });
```

and

```ts
          weightsBySymbol = await resolveWeights(tenantId, positions, {
            consented,
            showInferred,
            corrections: correctionsForTenant,
          });
```

Do not move the `showInferred` computation out of `executeRead`; the cache key
already uses it and must stay identical.

**Verify**: `pnpm --filter @lavega/investing-server exec vitest run src/sectorRead.test.ts`
→ all tests pass, including the three gate tests.

### Step 4: Re-check the other sector paths

Read `apps/investing-server/src/app.ts` around the `/api/investing/sectors` and
`/api/investing/summary` handlers (search for `resolvePortfolioSectors(`). Both
are expected to pass `showInferred: consented && inferenceEnabled` already.

**Verify**: `grep -n "showInferred" apps/investing-server/src/app.ts` → every
call site passes an expression containing `inferenceEnabled` or a variable
derived from it. If a call site passes only `consented`, STOP and report it;
that is a second leak and a decision for the operator.

### Step 5: Run the package gates

```bash
pnpm --filter @lavega/investing-server typecheck
pnpm --filter @lavega/investing-server test
```

**Verify**: both exit 0.

## Test plan

- Modified: `sectorRead.test.ts` "an unconsented tenant sees no inferred sector" — now resolves `MYST`.
- Modified: "inference off hides a cached inferred sector even with consent" — now resolves `MYST`; was vacuous.
- New: "consent and inference on shows the cached inferred sector" — positive control, also asserts coverage counts.
- Structural pattern: follow the neighbouring tests in the same file (`harness(...)`, `position(...)`, in-memory stores); no mocking library needed.
- Verification: `pnpm --filter @lavega/investing-server exec vitest run src/sectorRead.test.ts` → 8 tests pass (7 existing + 1 new).

## Done criteria

ALL must hold:

- [ ] `grep -n "showInferred: gates.consented" apps/investing-server/src/sectorRead.ts` returns no match
- [ ] Both `resolveWeights(...)` call sites pass `showInferred`
- [ ] `pnpm --filter @lavega/investing-server exec vitest run src/sectorRead.test.ts` exits 0, 8 tests
- [ ] `pnpm --filter @lavega/investing-server typecheck` exits 0
- [ ] `pnpm --filter @lavega/investing-server test` exits 0
- [ ] No file outside the in-scope list modified (`git status`)
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report (do not improvise) if:

- After step 1, the inference-off test still passes (the code is not the code in
  "Current state").
- `resolvePortfolioSectors` no longer accepts `showInferred`, or its semantics
  changed (`sectorResolution.ts:60-70`).
- `app.ts` has a sector call site that passes only `consented`.
- Any sector-read test unrelated to the gate breaks.
- The fix appears to require changing `sectorResolution.ts`, the routes, or the
  cache key format.

## Maintenance notes

- The cache key (`${revision}:${showInferred ? "1" : "0"}`) intentionally stays
  keyed on both gates; if a third visibility flag is added later, extend the key
  in the same commit or the cache will serve the wrong visibility.
- `showInferred` and `consented` are deliberately separate: consent gates the
  provider network call, the inference setting gates display of cached labels.
  A reviewer should reject any change that collapses them back into one flag.
- Related, deliberately deferred: `GET /api/investing/sectors` still builds the
  full dashboard to obtain positions (`sectorRead.ts:151`); see
  `plans/README.md` "Not planned in this pass".
