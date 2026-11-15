# Plan 004: Stop rebuilding chart series on every pointer move

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**:
> `git diff --stat 2cd8f1ea1..HEAD -- apps/investing-web/src/components/PortfolioBenchmarkChart.tsx apps/investing-web/src/components/PortfolioBenchmarkChart.test.tsx packages/core/src/investing/benchmarks.ts`
> If any of those changed since this plan was written, compare the "Current
> state" excerpts against the live code before proceeding; on a mismatch,
> treat it as a STOP condition.

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: LOW — same outputs, fewer computations; the existing chart tests cover behaviour
- **Depends on**: plans/001-remove-clone-files.md
- **Category**: perf
- **Planned at**: commit `2cd8f1ea1`, 2026-11-10

## Why this matters

`buildIndexedSeries` (from `@lavega/core`) is the expensive part of the
portfolio chart: it computes the time-weighted return series, an XIRR solve per
portfolio date, and an XIRR solve per benchmark date. The component memoizes it,
but the dependency is rebuilt on every render:

```ts
const selectedSeries = useMemo(...);                       // stable
const loadedSeries = selectedSeries.filter(...);           // NEW array every render
const indexed = useMemo(
  () => buildIndexedSeries(points, loadedSeries, externalCashFlows),
  [points, loadedSeries, externalCashFlows],               // never stable
);
```

`useChartWindow` re-renders the chart component on **every pointer move**
(`useChartWindow.ts:338-345` calls `setPointerRatio` and dispatches `focus` /
`dragMove`), because the crosshair and zoom pill follow the pointer. So a user
hovering a five-year chart for a few seconds triggers hundreds of full TWR +
XIRR rebuilds, each allocating arrays and solving hundreds of XIRR problems per
benchmark. The chart should only recompute when the data or the visible mode
changes, not when the pointer moves.

After this plan: derived chart arrays are stable across pointer moves; the same
data still renders the same numbers.

## Current state

`apps/investing-web/src/components/PortfolioBenchmarkChart.tsx:182-224`:

```ts
  const selectedSeries = useMemo(
    () =>
      selected.map(
        (symbol) =>
          benchmarks.find((benchmark) => benchmark.symbol === symbol) ?? {
            symbol,
            name: symbol,
            exchange: "Yahoo Finance",
            currency: "EUR",
            points: [],
          },
      ),
    [selected, benchmarks],
  );
  // Saved selection can arrive before benchmark prices. Ignore placeholders.
  const loadedSeries = selectedSeries.filter((benchmark) => benchmark.points.length > 0);
  const visibleBenchmarks = selectedSeries.filter((benchmark) => visible.has(benchmark.symbol));
  const mode = deriveChartMode(selected);
  const indexed = useMemo(
    () => buildIndexedSeries(points, loadedSeries, externalCashFlows),
    [points, loadedSeries, externalCashFlows],
  );
  const chartPoints =
    mode === "euros"
      ? points
      : points.map((base, index) => {
          const point = indexed[index]!;
          return {
            ...base,
            ...point,
            ...Object.fromEntries(
              Object.entries(point.benchmarkReturns).map(([symbol, value]) => [
                `benchmark:${symbol}`,
                value,
              ]),
            ),
          };
        });
```

Cost of the recomputed call, from `packages/core/src/investing/benchmarks.ts:340-374`:
`computeTimeWeightedReturnSeries`, `computeXirrSeries`,
`computeBenchmarkXirrSeries` (each point solves XIRR), and per-benchmark
`computeReturnSeries` — all recomputed whenever the `useMemo` dependency identity
changes.

The pointer path, `apps/investing-web/src/components/useChartWindow.ts:338-345`:

```ts
      onPointerMove(event: React.PointerEvent<HTMLDivElement>) {
        const rect = event.currentTarget.getBoundingClientRect();
        setPointerRatio(clampRatio((event.clientX - rect.left) / Math.max(1, rect.width)));
        const index = indexAt(event.clientX);
        if (index === null) return;
        dispatch({ type: "focus", index });
        dispatch({ type: "dragMove", pointerId: event.pointerId, date: points[index]!.date });
      },
```

Existing test harness to reuse: `apps/investing-web/src/components/PortfolioBenchmarkChart.test.tsx`
is a jsdom test file with a `pointerEvent(type, clientX, pointerId)` helper
(lines 133-137), a `renderZoomableChart()` helper (line 139), and 18 tests that
already drive `pointerdown`/`pointermove`/`pointerup` on the chart container
(lines 351-364).

## Commands you will need

| Purpose | Command | Expected on success |
|---------|---------|---------------------|
| Web typecheck | `pnpm --filter @lavega/investing-web typecheck` | exit 0 |
| Chart tests | `pnpm --filter @lavega/investing-web exec vitest run src/components/PortfolioBenchmarkChart.test.tsx` | all pass |
| New memo test | `pnpm --filter @lavega/investing-web exec vitest run src/components/PortfolioBenchmarkChart.memo.test.tsx` | all pass |
| Web tests | `pnpm --filter @lavega/investing-web test` | exit 0 |
| Full typecheck (after 001) | `pnpm typecheck` | exit 0 |

## Scope

**In scope** (the only files you may modify):
- `apps/investing-web/src/components/PortfolioBenchmarkChart.tsx`
- `apps/investing-web/src/components/PortfolioBenchmarkChart.memo.test.tsx` (create)

**Out of scope** (do NOT touch, even though they look related):
- `packages/core/src/investing/benchmarks.ts` — the engine is fine; the component
  calls it too often. Do not optimize XIRR here.
- `apps/investing-web/src/components/useChartWindow.ts` — pointer handling is
  correct; it is supposed to re-render the crosshair.
- The `<ul className="sr-only">` exact-values list rendering one `<li>` per point
  — real but separate; leave it.
- Recharts props, colours, tooltips, zoom behaviour, or the `accessiblePoint`
  string format.
- `dashboardResource.ts` / data fetching — no change.

## Git workflow

- Branch: `advisor/004-chart-series-memo`
- Commits: `test(investing-web): prove chart series survive a pointer move`, then
  `perf(investing-web): memoize derived chart series`
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Write the failing memo test (new file)

Create `apps/investing-web/src/components/PortfolioBenchmarkChart.memo.test.tsx`.
Model it on the existing test file's setup (jsdom, `createRoot`, `act`,
`IS_REACT_ACT_ENVIRONMENT`, `ResizeObserver` stub, `pointerEvent` helper, and a
`fetch` stub that answers the price-sync status endpoints). Import the component
and spy on the core function through a partial module mock:

```tsx
// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, test, vi } from "vitest";

vi.mock("@lavega/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@lavega/core")>();
  return { ...actual, buildIndexedSeries: vi.fn(actual.buildIndexedSeries) };
});

import { buildIndexedSeries } from "@lavega/core";
import { PortfolioBenchmarkChart } from "./PortfolioBenchmarkChart";

/* ...same jsdom/fetch/ResizeObserver setup as PortfolioBenchmarkChart.test.tsx... */

test("a pointer move does not rebuild the indexed series", async () => {
  const spy = vi.mocked(buildIndexedSeries);
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(<PortfolioBenchmarkChart data={{ "6M": points }} benchmarks={benchmarks} />);
  });
  spy.mockClear();

  const chart = container.querySelector('[role="img"], .recharts-wrapper') as HTMLElement;
  await act(async () => {
    chart.dispatchEvent(pointerEvent("pointermove", 200));
  });
  await act(async () => {
    chart.dispatchEvent(pointerEvent("pointermove", 210));
  });

  expect(spy).toHaveBeenCalledTimes(0);
  await act(async () => root.unmount());
});
```

Use the same `points` and `benchmarks` fixtures the existing test file defines
(it already has a two-point portfolio series and two benchmarks). If the chart
does not re-render on a bare `pointermove` without a prior `pointerdown`, add a
`pointerdown` first, exactly as the existing zoom test does at lines 351-364.

**Verify**: run the new file. It **fails** with the spy called 2 times (once per
pointer move). If it passes at this point, STOP — the component already memoizes
and this plan does not apply.

### Step 2: Stabilise the derived arrays

In `PortfolioBenchmarkChart.tsx`, keep `selectedSeries` as is and memoize the
rest:

```ts
  // Saved selection can arrive before benchmark prices. Ignore placeholders.
  const loadedSeries = useMemo(
    () => selectedSeries.filter((benchmark) => benchmark.points.length > 0),
    [selectedSeries],
  );
  const visibleBenchmarks = useMemo(
    () => selectedSeries.filter((benchmark) => visible.has(benchmark.symbol)),
    [selectedSeries, visible],
  );
  const mode = deriveChartMode(selected);
  const indexed = useMemo(
    () => buildIndexedSeries(points, loadedSeries, externalCashFlows),
    [points, loadedSeries, externalCashFlows],
  );
  const chartPoints = useMemo(
    () =>
      mode === "euros"
        ? points
        : points.map((base, index) => {
            const point = indexed[index]!;
            return {
              ...base,
              ...point,
              ...Object.fromEntries(
                Object.entries(point.benchmarkReturns).map(([symbol, value]) => [
                  `benchmark:${symbol}`,
                  value,
                ]),
              ),
            };
          }),
    [mode, points, indexed],
  );
```

Do not reorder hooks, do not add new state, and keep the computation identical —
only the memoization boundaries change. `visible` is a `Set` from `useState`;
if it is recreated on every render, memoizing on it changes nothing for the
visible-series list — check how `visible` is created and depend on the same
value the existing code uses.

**Verify**: `pnpm --filter @lavega/investing-web exec vitest run src/components/PortfolioBenchmarkChart.memo.test.tsx`
→ passes with the spy called 0 times.

### Step 3: Prove the existing behaviour is unchanged

```bash
pnpm --filter @lavega/investing-web exec vitest run src/components/PortfolioBenchmarkChart.test.tsx
```

**Verify**: all 18 existing tests pass. Pay attention to the zoom, wheel,
keyboard, and tooltip tests — they assert the rendered numbers and window labels,
which must not change.

### Step 4: Typecheck the package

```bash
pnpm --filter @lavega/investing-web typecheck
```

**Verify**: exit 0. The `vi.mocked(...)` and `importOriginal` typings must compile.

## Test plan

- New file `PortfolioBenchmarkChart.memo.test.tsx`: one test asserting
  `buildIndexedSeries` is not called on pointer moves (it is called on mount).
- Existing `PortfolioBenchmarkChart.test.tsx`: unchanged, must stay green — it is
  the behavioural guard (rendered values, zoom, keyboard, tooltip).
- Why not assert render counts: render counts change for legitimate crosshair
  reasons; the contract this plan fixes is "no series rebuild", which the spy
  observes directly.
- Verification: both chart test files pass in one run.

## Done criteria

ALL must hold:

- [ ] `grep -n "const loadedSeries = selectedSeries.filter" apps/investing-web/src/components/PortfolioBenchmarkChart.tsx` returns no match (it is memoized)
- [ ] `pnpm --filter @lavega/investing-web exec vitest run src/components/PortfolioBenchmarkChart.memo.test.tsx` exits 0
- [ ] `pnpm --filter @lavega/investing-web exec vitest run src/components/PortfolioBenchmarkChart.test.tsx` exits 0, 18 tests
- [ ] `pnpm --filter @lavega/investing-web typecheck` exits 0
- [ ] No file outside the in-scope list modified (`git status`)
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report (do not improvise) if:

- The new memo test passes before step 2.
- `buildIndexedSeries` cannot be partially mocked without breaking the existing
  test file's module graph — in that case do not weaken the test; report and
  propose moving the spy test to a separate component boundary instead.
- `visible` turns out to be recreated each render in a way that makes the
  `visibleBenchmarks` memo pointless; then memoize the underlying value rather
  than the `.filter` result, and say so in the report.
- A behavioural chart test fails after step 2 (the memo changed output — it
  should not).
- The chart turns out to receive a new `data`/`benchmarks` object identity from
  its parent on every render — that is a second cause of the same recompute and
  needs its own plan; report it instead of chasing it here.

## Maintenance notes

- The chart still re-renders on every pointer move by design (crosshair), so the
  remaining per-move cost is DOM/list work. If profiling later shows the
  `sr-only` exact-values `<ul>` (one `<li>` per date) as the next hotspot,
  virtualizing or moving it behind a details toggle is a separate change.
- Any new derived array in this component must be memoized on stable identities;
  passing a freshly-built array into a `useMemo` dependency is the bug this plan
  removes.
- Reviewer: confirm the memo dependency lists contain `points`,
  `selectedSeries`/`loadedSeries`, `externalCashFlows`, `mode`, and `indexed` —
  no callback or object literal inline.
