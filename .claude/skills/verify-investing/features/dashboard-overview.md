# Dashboard overview

The landing view: portfolio value over time, KPIs, allocation, and a status alert when sync needs attention.

## Sub-features

- headline figures widget (`Key figures`, section `aria-label="Portfolio KPIs"`,
  `data-dashboard-section="kpis"`) in the aside (`aria-label="Portfolio overview"`):
  `Portfolio value`, `Daily change`, `Total return`. `Value partly unknown` when some
  positions are unpriced. A missing amount reads `Value unknown`. A missing percent reads
  `Return unknown`.
- portfolio chart widget (`Performance`) in the main column
  (`data-dashboard-section="performance"`), not in the aside. With no benchmark selected
  the title is `Portfolio` and the axis is `Portfolio value` (euros). With a benchmark
  selected the title is `Comparison` and the axis is `Indexed return`; portfolio and
  benchmark are percents (`packages/core` `deriveChartMode`). Period group `Choose period`:
  `1 month`, `6 months`, `1 year`, `YTD`, `All`, `Custom`. `+ Compare` opens benchmark
  search.
- allocation donut widget (`Allocation`, `data-dashboard-section="allocation"`) in that
  same main column.
- summary card widget (`Risk & composition`, `data-dashboard-section="risk"`) in the aside.
  Card `aria-label="Portfolio summary"`, title `Summary`, eyebrow `Risk & composition`.
  Metrics: `Annual volatility`, `Beta`, `Regression alpha (annual)`, `Maximum drawdown`,
  `Valid daily returns`, `Benchmark pairs`, from `GET /api/investing/summary`. When
  `risk.to` is before today, the headline appends ` (as of <date>)`. Controls:
  `Refresh risk`, `Risk period` (`6 months`, `1 year`, `Account history`), `Risk benchmark`.
- `Sector allocation` is its own widget (`data-dashboard-section="sectors"`,
  `SectorAllocationCard`), below the two-column grid, and it can be hidden on its own.
- portfolio agents card, title `Investor lens` (`data-dashboard-section="agent"`). The
  persona picker is a radio group with `aria-label="Choose agent"`. See
  [portfolio-agents.md](portfolio-agents.md).
- status alert, not a chip panel. When the connection is not `online`, broker or price
  status is `problem`, a price problem is set, or the vault is `locked`, Overview shows
  `Status needs attention` and the link `Review it in Profile` (`/profile#brokers`). The
  chips live on Profile `#status`.
  See [prices-and-market-data.md](prices-and-market-data.md).
- the Overview top bar always has `Add widget`, which opens `/profile#widgets`. Every card
  above can be switched off there. Switching off every card replaces the grid with
  `Every Overview card is switched off. Add one to see your portfolio here.` and another
  `Add widget` button.
- degraded and empty states: `Dashboard unavailable`, `Refresh failed`, `Reading problems`,
  `Cached data remains visible`, `Still loading your history`.
- the positions table and the net-worth chart are their own tabs (`/positions`, `/net-worth`),
  not part of this view.

## Net worth

Nav `Net worth`, route `/net-worth`. One card, title `Investments and cash`. An empty book
reads `No net worth history` and `Net worth appears once broker and price data are available.`

With history, the chart stacks `Investments` and `Cash`. `GET /api/investing/personal-net-worth`
returns `{ totals: [] }` when the owner has shared nothing. When `presentationCurrency` is
`EUR` and `totals` is non-empty, a third band reads `Bank accounts (Personal, as of <date>)`.
A non-EUR presentation currency skips that merge. The period group matches the performance
chart and is not synced with Overview. Returns, risk, and allocation stay portfolio-only.

## How to get to it (user POV)

`https://www.lavega.dev/investing` after signing in. It is the first screen; `Overview` in
the main navigation returns to it.

## Driving it with control-investing

```bash
C=".claude/skills/verify-investing/control-investing.mjs"
node $C dashboard --target prod                 # summarized: problems, counts, shape
node $C dashboard --target prod --raw           # the exact payload the SPA receives
node $C summary --target prod                   # the Summary card (risk metrics)
node $C api GET /api/investing/dashboard --target prod
node $C api GET /api/investing/personal-net-worth --target prod
node $C browser goto /net-worth --target local  # mounted: /investing/net-worth
```

Proof that it works: `status: 200`, an empty `problems` array, `positions` and
`portfolioPoints` non-zero, and `shape: "normal"`. `personal-net-worth` is success at
status 200 with `body.totals` an array. `[]` means the owner shared nothing.

## Gotchas

- `/api/investing/dashboard` no longer answers `503` when the read model fails. It returns an
  empty-but-valid dashboard plus a `problems` list so reconnect and resync stay reachable,
  and logs the redacted cause as `investing.dashboard_read.problems`. A `200` is therefore
  not a pass — read the problems array. `dashboard` flags this as
  `shape: "degraded (empty + problems)"`.
- `/api/investing/summary` still answers `503` on failure. The Summary card then shows
  `Failed to load summary: 503`. Key figures come from the dashboard payload, so they can
  still render.
- A dashboard with zero positions and no problems is honest: nothing has synced yet. Check
  `sync-status` before calling it a bug.
- Sector exposure calls Yahoo per symbol on a cache miss, so the first request after a purge
  is slow and depends on market-data consent.
