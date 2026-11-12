# Plan 003: Clamp month arithmetic so range windows stop rolling over

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**:
> `git diff --stat 2cd8f1ea1..HEAD -- packages/core/src/investing/portfolio.ts packages/core/src/investing/portfolio.test.ts`
> If either file changed since this plan was written, compare the "Current
> state" excerpts against the live code before proceeding; on a mismatch,
> treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW — pure function, one consumer, existing tests constrain it
- **Depends on**: plans/001-remove-clone-files.md
- **Category**: bug
- **Planned at**: commit `2cd8f1ea1`, 2026-11-10

## Why this matters

Every portfolio chart range and every risk window is computed by subtracting
calendar months from the latest data date. `subtractMonths` uses
`Date.setUTCMonth`, which rolls a day that does not exist in the target month
into the next month instead of clamping.

Concrete wrong windows (evaluated at the planned commit):

| latest data date | range | produced start | intended start |
|---|---|---|---|
| 2026-03-31 | 1M | 2026-03-03 | 2026-02-28 |
| 2026-05-31 | 6M | 2025-12-01 | 2025-11-30 |
| 2024-03-31 | 1Y | 2024-03-02 | 2023-03-31 |

The visible damage: on and after a month-end trading day, the 1M/6M/1Y charts
and the risk numbers cover a window one to three days short or long — silently,
because nothing in the UI says which dates were used. The error also lands on
the 6M/1Y risk projection, which reads the already-filtered series in
`dashboard.ts:435-437`.

After this plan: range starts are clamped to the last day of the target month,
and the boundary cases are covered by tests.

## Current state

`packages/core/src/investing/portfolio.ts:843-860`:

```ts
function subtractMonths(date: string, months: number): string {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCMonth(value.getUTCMonth() - months);
  return value.toISOString().slice(0, 10);
}

export function filterPortfolioValueRange<T extends { date: string }>(
  points: T[],
  range: PortfolioRange,
): T[] {
  if (points.length === 0 || range === "All") return [...points];
  const latest = [...points].sort((a, b) => a.date.localeCompare(b.date)).at(-1)!.date;
  const start =
    range === "YTD"
      ? `${latest.slice(0, 4)}-01-01`
      : subtractMonths(latest, range === "1M" ? 1 : range === "6M" ? 6 : 12);
  return points.filter((point) => point.date >= start);
}
```

The only production consumer is `packages/core/src/investing/dashboard.ts:435-437`:

```ts
  const portfolio = Object.fromEntries(
    PORTFOLIO_RANGES.map((range) => [range, filterPortfolioValueRange(portfolioValues, range)]),
  ) as Record<PortfolioRange, PortfolioValuePoint[]>;
```

`PORTFOLIO_RANGES` (`dashboard.ts:37-43`) is `["1M", "6M", "1Y", "YTD", "All"]`.
The risk projection receives these filtered arrays, so both the chart ranges and
the `6M`/`1Y` risk windows inherit the bug.

Existing test to extend — `packages/core/src/investing/portfolio.test.ts:1213-1223`:

```ts
test.each([
  ["1M", "2026-01-02"],
  ["6M", "2025-08-02"],
  ["1Y", "2025-02-02"],
  ["YTD", "2026-01-01"],
  ["All", "0000-01-01"],
] as const)("filters %s from latest data date", (range, start) => {
  const points = [point("2025-01-01", 1), point("2026-01-01", 2), point("2026-02-02", 3)];
  expect(filterPortfolioValueRange(points, range).map(({ date }) => date)).toEqual(
    points.filter(({ date }) => date >= start).map(({ date }) => date),
  );
});
```

That test uses the 2nd of a month throughout, so it never reaches the rollover.
`point(date, value)` is the local fixture helper in that file.

Conventions: pure core module, no I/O, no `Date` outside this helper's UTC
arithmetic; tests are `vitest` `test(...)`/`test.each(...)` at top level.
`docs/CONTEXT.md` requires dates to be `YYYY-MM-DD` strings.

## Commands you will need

| Purpose | Command | Expected on success |
|---------|---------|---------------------|
| Core typecheck | `pnpm --filter @lavega/core typecheck` | exit 0 |
| Targeted tests | `pnpm --filter @lavega/core exec vitest run src/investing/portfolio.test.ts` | all pass |
| Core tests | `pnpm --filter @lavega/core test` | exit 0 |
| Investing server tests | `pnpm --filter @lavega/investing-server test` | exit 0 (dashboard builds on this helper) |
| Full typecheck (after 001) | `pnpm typecheck` | exit 0 |

## Scope

**In scope** (the only files you may modify):
- `packages/core/src/investing/portfolio.ts`
- `packages/core/src/investing/portfolio.test.ts`

**Out of scope** (do NOT touch, even though they look related):
- `packages/core/src/investing/dashboard.ts` — the consumer is correct; only the
  helper changes. `PORTFOLIO_RANGES` must not change.
- `packages/core/src/investing/risk.ts` — it consumes the filtered series; no change.
- `apps/investing-web/src/components/useChartWindow.ts` and the typed
  `from`/`to` date inputs — those are user-chosen absolute dates, not month math.
- `YTD` and `All` semantics — unchanged.
- Any "date" handling elsewhere (`today`, `new Date()`) — separate concern.

## Git workflow

- Branch: `advisor/003-clamp-month-windows`
- Commits: `test(investing): cover month-end range windows`, then
  `fix(investing): clamp range windows to the target month's last day`
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Add failing month-end cases

Append to `packages/core/src/investing/portfolio.test.ts`, after the existing
`test.each` block at lines 1213-1223:

```ts
test.each([
  ["2026-03-31", "1M", "2026-02-28"],
  ["2026-01-31", "1M", "2025-12-31"],
  ["2026-05-31", "6M", "2025-11-30"],
  ["2024-03-31", "1Y", "2023-03-31"],
  ["2024-02-29", "1Y", "2023-02-28"],
] as const)("clamps %s minus %s to %s", (latest, range, expectedStart) => {
  const points = [
    point("2000-01-01", 1),
    point(latest, 2),
  ];
  expect(filterPortfolioValueRange(points, range).map(({ date }) => date)).toEqual([latest]);
  // The start date is observable through the filter boundary: a point placed
  // on the expected start must be kept, and one day earlier dropped.
  const boundary = [
    point("1999-01-01", 1),
    point(expectedStart, 2),
    point(latest, 3),
  ];
  expect(filterPortfolioValueRange(boundary, range).map(({ date }) => date)).toEqual([
    expectedStart,
    latest,
  ]);
});
```

Adjust the two fixture dates at the top of the test only if `point()` requires
different arguments; `point` is the local helper used throughout that file.

**Verify**: `pnpm --filter @lavega/core exec vitest run src/investing/portfolio.test.ts`
→ exactly **three** of the five new cases fail (`2026-03-31` minus `1M`,
`2026-05-31` minus `6M`, `2024-02-29` minus `1Y`). The other two target 31-day
months, where `setUTCMonth` happens to be correct, so they pass from the start —
that is expected, not a broken test. If the three rollover cases pass, STOP —
the helper already clamps and this plan does not apply.

### Step 2: Clamp the day to the target month

Replace `subtractMonths` in `packages/core/src/investing/portfolio.ts` with a
clamping implementation that keeps the `YYYY-MM-DD` string contract:

```ts
/** Calendar-month arithmetic for range windows. `setUTCMonth` rolls a day that
 *  the target month does not have into the next month (31 March minus one month
 *  became 3 March), which silently shortened or lengthened the window. Clamp to
 *  the target month's last day instead. */
function subtractMonths(date: string, months: number): string {
  const [year, month, day] = date.split("-").map(Number);
  const target = new Date(Date.UTC(year!, month! - 1 - months, 1));
  const lastDay = new Date(
    Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0),
  ).getUTCDate();
  const clampedDay = Math.min(day!, lastDay);
  const targetMonth = String(target.getUTCMonth() + 1).padStart(2, "0");
  return `${target.getUTCFullYear()}-${targetMonth}-${String(clampedDay).padStart(2, "0")}`;
}
```

Do not export it; keep it module-private. `filterPortfolioValueRange` and the
`YTD` branch stay exactly as they are.

**Verify**: `pnpm --filter @lavega/core exec vitest run src/investing/portfolio.test.ts`
→ all cases pass, including the five new ones.

### Step 3: Confirm no second month-math site

```bash
grep -rn "setUTCMonth\|setMonth(" --include="*.ts" packages/core/src/investing apps/investing-server/src | grep -v "\.test\."
```

**Verify**: only the new `subtractMonths` body (and no scoring/other range code)
matches. If another production site does month arithmetic for windows, STOP and
report it — it needs a second decision.

### Step 4: Run the wider gates

```bash
pnpm --filter @lavega/core test
pnpm --filter @lavega/investing-server test
```

**Verify**: both exit 0. The server suite builds dashboards from this helper;
a failure there means a fixture encoded the old rollover window — report it
before changing any fixture.

## Test plan

- New: five `test.each` month-end cases in `portfolio.test.ts` (March 31 → Feb 28,
  Jan 31 → Dec 31, May 31 → Nov 30, leap-year Feb 29 → Feb 28, leap-year Mar 31
  minus a year).
- Existing: the `filters %s from latest data date` table must keep passing
  unchanged; it is the guard that normal mid-month behaviour did not move.
- Structural pattern: use `point(date, value)` fixtures like the neighbouring
  tests in the same file.
- Verification: `pnpm --filter @lavega/core exec vitest run src/investing/portfolio.test.ts`
  → all pass; no existing case changed.

## Done criteria

ALL must hold:

- [ ] `grep -n "setUTCMonth" packages/core/src/investing/portfolio.ts` shows no rollover-based arithmetic (only the clamped helper)
- [ ] The five new month-end cases pass
- [ ] The existing `filters %s from latest data date` table passes unchanged (`git diff` shows no edit to it)
- [ ] `pnpm --filter @lavega/core test` exits 0
- [ ] `pnpm --filter @lavega/investing-server test` exits 0
- [ ] No file outside the in-scope list modified (`git status`)
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report (do not improvise) if:

- The new cases pass before the fix (no bug to fix).
- `point()` in the test file has a different signature than `(date, value)`.
- A core or server test fails after the fix and the failing fixture encodes the
  old rollover behaviour (e.g. an expected window start of the 3rd of a month).
- Another production month-arithmetic site turns up (step 3).
- `PortfolioRange` gains or loses a value, or `PORTFOLIO_RANGES` changes.

## Maintenance notes

- Range semantics are now "same day in the target month, clamped to its last
  day". If a range is ever defined as "trailing N days" instead of calendar
  months, it needs its own function — do not bend this one.
- `YTD` (`${latest.slice(0,4)}-01-01`) is a separate branch and stays
  untouched; a test for it already exists.
- Reviewer: the interesting edge is **2024-02-29 minus 12 months** → 2023-02-28,
  and **31st minus 1 month** in any 30-day month. Check those two first.
