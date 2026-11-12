# Plan 005: Stop invalidating the dashboard on every price-sync poll

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**:
> `git diff --stat 2cd8f1ea1..HEAD -- apps/investing-web/src/lib/syncSession.ts apps/investing-web/src/lib/syncSession.test.ts apps/investing-web/src/lib/priceSync.ts`
> If any of those changed since this plan was written, compare the "Current
> state" excerpts against the live code before proceeding; on a mismatch,
> treat it as a STOP condition.

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: MED — the chart stops updating mid-sync; the progress rail already shows progress, but this is a visible behaviour change
- **Depends on**: plans/001-remove-clone-files.md
- **Category**: perf
- **Planned at**: commit `2cd8f1ea1`, 2026-11-10

## Why this matters

While a price sync runs, the browser polls `GET /api/prices/sync/status` once
per second. Each poll publishes the new progress snapshot and — because of one
line — dispatches the dashboard-refresh event, so the dashboard refetches the
whole read model **once per second per tab**:

- `GET /api/investing/dashboard` on the hosted tier builds a request-scoped
  runtime and Neon pool (documented invariant in `docs/investing/STACK.md`), so
  each of these is a full read-model assembly, not a cheap cache hit.
- A long backfill (many rounds, minutes) therefore costs hundreds of full
  dashboard builds, and the user's CPU/network on the client.
- It contradicts the intent stated in the same file: `publish()` documents that
  it invalidates "when a channel this page saw unfinished reaches a final state",
  and already does that itself. The extra line re-adds the invalidation for every
  non-terminal tick.

After this plan: the dashboard refreshes once when a sync finishes (as
`publish` already implements) and not on intermediate polls. The progress rail
keeps updating live from the `useSyncExternalStore` snapshot, which does not
need a dashboard refetch.

## Current state

`apps/investing-web/src/lib/syncSession.ts:87-105` — the refresh contract:

```ts
function dispatchDashboardRefresh() {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(DASHBOARD_REFRESH_EVENT));
}

/* Invalidates the dashboard when a channel this page saw unfinished reaches a
 * final state, so a sync that finished in the background still shows up.
 * Returns whether it did. */
function publish(next: Partial<SyncSnapshot>): boolean {
  const finished = Boolean(
    (next.broker && brokerActive(snapshot.broker?.status) && terminal(next.broker.status)) ||
    (next.price && priceUnfinished(snapshot.price?.status) && terminal(next.price.status)),
  );
  snapshot = { ...snapshot, ...next };
  listeners.forEach((listener) => listener());
  if (finished) dispatchDashboardRefresh();
  return finished;
}
```

`apps/investing-web/src/lib/syncSession.ts:196-215` — the offending caller:

```ts
export function continuePriceSync(): Promise<PriceSyncOutcome> {
  if (!priceRun) {
    publish({ priceProblem: null });
    priceRun = runPriceSyncUntilComplete((progress) => {
      const refreshed = isPrice(progress) && publish({ price: progress });
      if (!refreshed) dispatchDashboardRefresh();
    })
      .then((outcome) => {
        if (outcome.kind === "incomplete") publish({ priceProblem: outcome.message });
        return outcome;
      })
      .finally(() => {
        priceRun = null;
        wakeSyncSession();
      });
    wakeSyncSession();
  }
  return priceRun;
}
```

`apps/investing-web/src/lib/priceSync.ts:63-78` — where the 1 Hz ticks come from:

```ts
    if (progress?.status === "paused") continue;
    if (progress?.status === "running" || progress?.status === "waiting") {
      let active = true;
      while (activePolls < MAX_ACTIVE_POLLS) {
        activePolls += 1;
        await new Promise((resolve) => setTimeout(resolve, 1_000));
        const statusResponse = await fetch("/api/prices/sync/status").catch(() => null);
        ...
        if (status) onProgress(status);
```

(`onProgress` is the callback above.)

Existing test that encodes today's behaviour — `apps/investing-web/src/lib/syncSession.test.ts:278-293`:

```ts
test("each price round invalidates the dashboard once, including the final one", async () => {
  statusServer({
    [BROKER]: [broker("idle")],
    [PRICE]: [price("idle")],
    [VAULT]: [{ status: "unlocked" }],
    "/api/prices/sync": [price("paused"), price("paused"), price("completed")],
  });
  const refreshes = vi.fn();
  window.addEventListener("lavega:dashboard-refresh", refreshes);

  const outcome = await session.continuePriceSync();

  expect(outcome.kind).toBe("finished");
  expect(refreshes).toHaveBeenCalledTimes(3);
  window.removeEventListener("lavega:dashboard-refresh", refreshes);
});
```

The test file already sets up fake timers, a `statusServer(queues)` fetch stub,
and `beforeEach`/`afterEach` that reset modules and listeners (lines 37-64).

## Commands you will need

| Purpose | Command | Expected on success |
|---------|---------|---------------------|
| Web typecheck | `pnpm --filter @lavega/investing-web typecheck` | exit 0 |
| Sync tests | `pnpm --filter @lavega/investing-web exec vitest run src/lib/syncSession.test.ts` | all pass |
| Web tests | `pnpm --filter @lavega/investing-web test` | exit 0 |
| Full typecheck (after 001) | `pnpm typecheck` | exit 0 |

## Scope

**In scope** (the only files you may modify):
- `apps/investing-web/src/lib/syncSession.ts`
- `apps/investing-web/src/lib/syncSession.test.ts`

**Out of scope** (do NOT touch, even though they look related):
- `apps/investing-web/src/lib/priceSync.ts` — the 1 Hz polling is intended (the
  rail shows live progress); only the dashboard invalidation is wrong.
- `apps/investing-web/src/lib/dashboardResource.ts` — refresh handling is correct.
- `startBrokerSync`'s own `dispatchDashboardRefresh()` after the broker POST
  (`syncSession.ts:236`) — that fires once per sync start and must stay.
- `publish()`'s terminal invalidation — that is the behaviour this plan keeps.
- Server-side dashboard caching, snapshot writes, or `dataVersion` handling.

## Git workflow

- Branch: `advisor/005-price-sync-refresh`
- Commits: `test(investing-web): pin dashboard invalidation to terminal sync state`,
  then `perf(investing-web): drop the per-poll dashboard invalidation`
- Do NOT push or open a PR unless the operator instructed it.
- Test-first: the updated expectations must go red before the source change.

## Steps

### Step 1: Pin the new expectation in the existing test

In `apps/investing-web/src/lib/syncSession.test.ts:278-293`, rename the test and
change the expectation:

```ts
test("price sync invalidates the dashboard once, when it finishes", async () => {
  statusServer({
    [BROKER]: [broker("idle")],
    [PRICE]: [price("idle")],
    [VAULT]: [{ status: "unlocked" }],
    "/api/prices/sync": [price("paused"), price("paused"), price("completed")],
  });
  const refreshes = vi.fn();
  window.addEventListener("lavega:dashboard-refresh", refreshes);

  const outcome = await session.continuePriceSync();

  expect(outcome.kind).toBe("finished");
  expect(refreshes).toHaveBeenCalledTimes(1);
  window.removeEventListener("lavega:dashboard-refresh", refreshes);
});
```

Rationale to keep in the report: three rounds, two non-terminal (`paused`) and
one terminal (`completed`); only the terminal transition may invalidate.

**Verify**: `pnpm --filter @lavega/investing-web exec vitest run src/lib/syncSession.test.ts`
→ this test **fails** with `expected 1, received 3`. That red run is the proof.

### Step 2: Add the all-non-terminal case

Append after it:

```ts
test("a price sync that never finishes invalidates nothing", async () => {
  statusServer({
    [BROKER]: [broker("idle")],
    [PRICE]: [price("idle")],
    [VAULT]: [{ status: "unlocked" }],
    "/api/prices/sync": [price("paused")],
  });
  const refreshes = vi.fn();
  window.addEventListener("lavega:dashboard-refresh", refreshes);

  const outcome = await session.continuePriceSync();

  expect(outcome.kind).toBe("incomplete");
  expect(refreshes).toHaveBeenCalledTimes(0);
  window.removeEventListener("lavega:dashboard-refresh", refreshes);
});
```

The repeating `paused` round exercises the 40-round emergency brake
(`MAX_ROUNDS`), which is fine and fast with the fake fetch; if the suite is slow,
that is a signal to STOP and report rather than to change `MAX_ROUNDS`.

**Verify**: this new test fails too under the current source (40 refreshes).

### Step 3: Remove the per-poll invalidation

In `apps/investing-web/src/lib/syncSession.ts`, delete the extra dispatch and the
now-unused local:

```ts
    priceRun = runPriceSyncUntilComplete((progress) => {
      if (isPrice(progress)) publish({ price: progress });
    })
```

Keep `publish(...)` as the single place that dispatches on terminal transitions.
Leave everything else in the function — `publish({ priceProblem: null })`,
`.then(...)`, `.finally(...)`, `wakeSyncSession()` — untouched.

Because `publish` returns a value now unused here, do not change its signature:
other callers (`wakeSyncSession` path) rely on it.

**Verify**:

```bash
pnpm --filter @lavega/investing-web exec vitest run src/lib/syncSession.test.ts
```

→ **all tests pass**, including the two changed/added ones. The existing
`running, HTTP 503, running, completed recovers without a reload` test should
still see its refresh — that test drives broker status too; if it now expects a
refresh count of 0, read it before editing and report if its contract differs.

### Step 4: Check no other caller dispatches per tick

```bash
grep -rn "dispatchDashboardRefresh" apps/investing-web/src
```

**Verify**: the only call sites are inside `publish` and `startBrokerSync`. If a
third call site fires per poll or per timer, STOP and report it.

### Step 5: Run the package gates

```bash
pnpm --filter @lavega/investing-web typecheck
pnpm --filter @lavega/investing-web test
```

**Verify**: both exit 0.

## Test plan

- Modified: `syncSession.test.ts` "price sync invalidates the dashboard once,
  when it finishes" — three rounds, exactly one refresh.
- New: "a price sync that never finishes invalidates nothing" — zero refreshes.
- Existing: the broker-status recovery test and the 1 Hz polling tests must stay
  green; they cover the loop that must not change.
- Structural pattern: `statusServer(queues)` + `vi.fn()` listener, as in the
  surrounding tests. Fake timers are already active.
- Verification: `pnpm --filter @lavega/investing-web exec vitest run src/lib/syncSession.test.ts`
  → all pass.

## Done criteria

ALL must hold:

- [ ] `grep -n "if (!refreshed) dispatchDashboardRefresh" apps/investing-web/src/lib/syncSession.ts` returns no match
- [ ] `grep -rn "dispatchDashboardRefresh" apps/investing-web/src` shows only `publish` and `startBrokerSync` call sites
- [ ] `pnpm --filter @lavega/investing-web exec vitest run src/lib/syncSession.test.ts` exits 0
- [ ] `pnpm --filter @lavega/investing-web test` exits 0
- [ ] `pnpm --filter @lavega/investing-web typecheck` exits 0
- [ ] No file outside the in-scope list modified (`git status`)
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report (do not improvise) if:

- The updated test in step 1 passes before the source change.
- Removing the line makes a broker-sync test fail for a reason other than the
  removed dispatch (that test's contract is different — report it).
- A third `dispatchDashboardRefresh` call site exists.
- You find that the dashboard is *supposed* to update live during sync (check
  `docs/investing/DASHBOARD.md` "Dashboard latency and resumed history" and the
  `dataVersion` notes) — if so, stop and report the conflict instead of choosing
  a side.

## Maintenance notes

- Visible behaviour change: during a long price backfill the chart keeps showing
  the last-built dashboard until the sync finishes; the right-rail progress still
  updates at 1 Hz. If the operator wants liveness, the correct fix is a throttled
  invalidation (e.g. at most one refresh per 10–15 s), not the per-tick dispatch —
  do that as a separate change with its own test.
- `publish()` is the single invalidation point by design. Any future caller that
  needs the dashboard to follow an event must express it as a terminal/transition
  condition inside `publish`, not as an unconditional dispatch at the call site.
- Reviewer: confirm `startBrokerSync`'s post-POST refresh is still present — that
  one is what makes a just-started sync show up at all.
