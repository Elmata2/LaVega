# Plan 001: Skip the inter-symbol pace wait on price-sync cache hits

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat 39889b2..HEAD -- apps/investing-server/src/priceOrchestrator.ts apps/investing-server/src/priceOrchestrator.test.ts`
> If either file changed since this plan was written, compare the "Current
> state" excerpts below against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: perf
- **Planned at**: commit `39889b2`, 2026-09-10

## Why this matters

Every time the `/investing` dashboard loads, the browser calls
`POST /api/prices/sync` in a loop until the run reports a terminal status
(`apps/investing-web/src/lib/priceSync.ts`). Server-side, `createPriceOrchestrator`
(`apps/investing-server/src/priceOrchestrator.ts`) walks every current position,
closed position, and benchmark symbol one at a time and sleeps a fixed
`paceMs` (default 300ms) between every symbol, unconditionally — even when
the symbol's price was already cached for today and no Yahoo Finance request
was made at all.

`syncPrices` (`packages/adapters/src/market-data/priceSync.ts`) already
computes this: it returns `{ ..., fetched: false }` whenever the cached price
range already covers today's date, and skips calling any provider in that
case (`packages/adapters/src/market-data/priceSync.ts:32` — `if (from && from
> today) return { bars: await cached(), problems: [], fetched: false };`).
The orchestrator receives this `fetched` flag on its `PriceSyncResult` but
never reads it before deciding whether to pace.

The pace exists to stay polite to Yahoo Finance's servers between real
requests — it is meaningless when no request was made. On a warm day (which
is most days: the same tenant loading the dashboard more than once, or
loading it after prices were already synced earlier that session), a
portfolio with N symbols burns `(N-1) * paceMs` — roughly 300ms per symbol —
in pure `setTimeout` sleeps for zero benefit. For a 60-symbol portfolio
that's ~18 seconds added to every warm-cache dashboard load, on top of
whatever the broker sync step already took.

Skipping the pace wait when nothing was fetched removes that dead time with
no change to the actual Yahoo Finance request rate — the fix only touches
what happens *between* requests, not the requests themselves.

## Current state

- `apps/investing-server/src/priceOrchestrator.ts` — runs the price-sync
  queue. The per-symbol loop (inside `createPriceOrchestrator`'s `execute`)
  is the file to change.
- `apps/investing-server/src/priceOrchestrator.test.ts` — existing vitest
  suite for this file; add the new test(s) here, following the existing
  style (see below).
- `packages/adapters/src/market-data/priceSync.ts` — defines `PriceSyncResult`
  (via its `fetched: boolean` field) and is where `fetched: false` is
  produced on a cache hit. **Do not modify this file** — it is already
  correct; the orchestrator just isn't using what it returns.

The exact block to change, `apps/investing-server/src/priceOrchestrator.ts`
(current line numbers — confirm against the drift check above before
editing):

```ts
        try {
          const result = await input.sync(target, tenantId);
          problems.push(...result.problems.map((problem) => `${target.symbol}: ${problem}`));
        } catch (error) {
          problems.push(
            `${target.symbol}: ${error instanceof Error ? error.message : "Price synchronization failed"}`,
          );
        }
        if (index < queue.length - 1) {
          if (deadline !== undefined && now().getTime() + paceMs + pauseMarginMs >= deadline)
            return pause(index + 1);
          const waitUntil = new Date(now().getTime() + paceMs).toISOString();
          await update(
            tenantId,
            {
              status: "waiting",
              total,
              completed: done + index + 1,
              remainingSymbols: remainingFrom(index + 1),
              currentSymbol: null,
              waitUntil,
              message: "Waiting before next price request",
              problems: [...problems],
              leaseId,
            },
            leaseId,
          );
          await wait(paceMs);
        }
```

Notes for the executor:

- `result` here is `PriceSyncResult` (imported at the top of the file:
  `import type { PriceSyncInput, PriceSyncResult } from "@lavega/adapters";`).
  It already has a `fetched: boolean` field — no type changes needed anywhere.
- The `catch` block means `input.sync` threw. Treat that case as "a fetch was
  attempted" (i.e. still pace) — we cannot know from an exception whether a
  provider request actually went out, and erring toward pacing on failure is
  the safe default (avoids hammering a provider that's already erroring).
- The comment style in this file is dense, present-tense, explains *why* not
  *what* (see the existing block comments above `update`, `start`, etc.).
  Match it for the new comment.
- The top-of-loop deadline check (a few lines above this block —
  `if (deadline !== undefined && now().getTime() + pauseMarginMs >= deadline)
  return pause(index);`) already guards host-time-budget overruns on every
  iteration regardless of this change. You do not need to add any additional
  deadline handling for the skipped-pace path — the existing per-iteration
  check covers it on the next loop turn.

## Commands you will need

| Purpose   | Command                                                                 | Expected on success |
|-----------|--------------------------------------------------------------------------|---------------------|
| Install   | `pnpm install`                                                          | exit 0              |
| Typecheck | `pnpm --filter @lavega/investing-server typecheck`                      | exit 0, no errors   |
| Tests     | `pnpm --filter @lavega/investing-server test -- priceOrchestrator`      | all pass            |
| Lint      | `pnpm lint` (repo root; runs `oxlint .`)                                | exit 0              |

Run tests from the repo root — `pnpm --filter <pkg> test` uses turbo/vitest
as configured in that package's `package.json` (`"test": "vitest run"`).

## Scope

**In scope** (the only files you should modify):
- `apps/investing-server/src/priceOrchestrator.ts`
- `apps/investing-server/src/priceOrchestrator.test.ts`

**Out of scope** (do NOT touch, even though they look related):
- `packages/adapters/src/market-data/priceSync.ts` — already correct, produces
  the `fetched` flag this plan consumes.
- `packages/adapters/src/market-data/yahoo/*` — the Yahoo HTTP client and its
  retry/backoff behavior are a separate concern (tracked as a follow-up, see
  Maintenance notes).
- `apps/investing-web/src/lib/priceSync.ts` and any frontend polling code —
  this plan is server-side only; the frontend's polling loop behavior is
  unaffected by (and should not be touched for) this change.
- `apps/investing-server/src/app.ts` — no wiring changes needed; `paceMs` and
  `sync` are already passed through correctly.

## Git workflow

- Branch: `perf/skip-price-sync-pace-on-cache-hit`
- Single commit for this change is fine given its size. Message style
  (conventional commits, matches repo history, e.g.
  `fix(investing): persist broker sync before state advance`):
  `perf(investing): skip pace wait when price sync hits cache`
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Track whether the sync actually fetched, and gate the pace on it

In the per-symbol loop, before the `try`, declare `let fetched = true;`. Inside
the `try`, after `const result = await input.sync(target, tenantId);`, add
`fetched = result.fetched;` before the `problems.push(...)` line. Leave the
`catch` block untouched (so `fetched` stays at its default `true` on error).

Then change the guard on the pacing block from `if (index < queue.length - 1)`
to `if (fetched && index < queue.length - 1)`, and add a short comment above
it explaining why (a cache hit made no provider request, so there is nothing
to pace for).

The resulting block should look like:

```ts
        let fetched = true;
        try {
          const result = await input.sync(target, tenantId);
          fetched = result.fetched;
          problems.push(...result.problems.map((problem) => `${target.symbol}: ${problem}`));
        } catch (error) {
          problems.push(
            `${target.symbol}: ${error instanceof Error ? error.message : "Price synchronization failed"}`,
          );
        }
        /* A cache hit made no provider request, so there is nothing to pace
         * for — sleeping paceMs anyway just slows a warm-cache run down for
         * no reason. An error stays paced: we can't tell whether it reached
         * the provider, and pacing is the safe default when one errored. */
        if (fetched && index < queue.length - 1) {
          if (deadline !== undefined && now().getTime() + paceMs + pauseMarginMs >= deadline)
            return pause(index + 1);
          const waitUntil = new Date(now().getTime() + paceMs).toISOString();
          await update(
            tenantId,
            {
              status: "waiting",
              total,
              completed: done + index + 1,
              remainingSymbols: remainingFrom(index + 1),
              currentSymbol: null,
              waitUntil,
              message: "Waiting before next price request",
              problems: [...problems],
              leaseId,
            },
            leaseId,
          );
          await wait(paceMs);
        }
```

**Verify**: `pnpm --filter @lavega/investing-server typecheck` → exit 0, no errors.

## Test plan

Add two new tests to `apps/investing-server/src/priceOrchestrator.test.ts`,
placed near the other `createPriceOrchestrator` tests. Follow the existing
file's conventions: use the `result(...)` helper for `PriceSyncResult`
values (it currently hardcodes `fetched: true` — for these tests, build the
result object inline instead of through that helper, since you need to vary
`fetched`), and the same `PriceSyncTarget` object shape used elsewhere in the
file (`kind`, `symbol`, `ticker`, `exchange`, `currency`, `backfillFrom`).

1. **`"does not pace between cache-hit syncs"`**: three targets, `sync`
   returns `{ bars: [], fetched: false, problems: [] }` for all of them, and
   pass `paceMs: 10` plus `wait: vi.fn(async () => {})` to
   `createPriceOrchestrator`. After `await orchestrator.run("local")`,
   assert `expect(wait).not.toHaveBeenCalled()`.

2. **`"paces between syncs that hit the provider"`**: three targets, `sync`
   returns `{ bars: [], fetched: true, problems: [] }` for all of them, same
   `paceMs: 10` and `wait: vi.fn(async () => {})`. After the run, assert
   `expect(wait).toHaveBeenCalledTimes(2)` (paced after target 1 and target
   2, not after the last one — matches the existing `index < queue.length -
   1` behavior).

Both tests should also assert the run's final `status` is `"completed"`, same
as the existing tests in this file, to confirm the change didn't break the
terminal-status logic.

**Verify**: `pnpm --filter @lavega/investing-server test -- priceOrchestrator`
→ all tests pass, including the 2 new ones (existing test count + 2).

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `pnpm --filter @lavega/investing-server typecheck` exits 0
- [ ] `pnpm --filter @lavega/investing-server test -- priceOrchestrator` exits 0, includes the 2 new tests passing
- [ ] `pnpm lint` exits 0
- [ ] `git status` shows only `apps/investing-server/src/priceOrchestrator.ts` and `apps/investing-server/src/priceOrchestrator.test.ts` modified
- [ ] `plans/README.md` status row for Plan 001 updated to DONE

## STOP conditions

Stop and report back (do not improvise) if:

- The code at `apps/investing-server/src/priceOrchestrator.ts` around the
  per-symbol loop doesn't match the "Current state" excerpt above (the
  codebase has drifted since this plan was written — check the drift-check
  command at the top of this file).
- `PriceSyncResult` no longer has a `fetched: boolean` field (check
  `packages/adapters/src/market-data/priceSync.ts`) — the whole premise of
  this plan depends on that field existing and meaning "a provider request
  was made."
- A verification command fails twice after a reasonable fix attempt.
- The fix appears to require touching `packages/adapters/*` or any frontend
  file — it should not; if it does, the assumption that this is a
  self-contained orchestrator-only change is wrong.

## Maintenance notes

- This plan only removes *dead* pacing time. It does not add concurrency —
  Yahoo Finance requests still happen one at a time. A follow-up worth
  considering separately: bounded concurrency (e.g. 3–5 symbols in flight)
  for the Yahoo Finance leg of price sync, since (unlike Trading 212's
  cursor-paginated order history) Yahoo symbol lookups are independent of
  each other and don't have a documented hard concurrency limit. That is a
  larger, riskier change (needs a shared rate limiter/backoff instead of a
  fixed pace) and is deliberately not part of this plan.
- If `paceMs` is ever changed to mean something other than "delay between
  provider requests" (e.g. a general between-symbols delay for some other
  reason), this `fetched` gate would need to be revisited.
- A reviewer should check: the two new tests actually exercise `paceMs > 0`
  (existing tests in this file use `paceMs: 0`, which is exactly why this gap
  existed uncaught) and that `wait` is asserted as a call count, not just
  "was awaited."
