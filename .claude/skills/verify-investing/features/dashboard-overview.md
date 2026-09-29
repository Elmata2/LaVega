# Dashboard overview

The landing view: portfolio value over time, KPIs, allocation, and the operational panels.

## Sub-features

- headline figures in the aside section `Portfolio KPIs` (eyebrow `Key figures`):
  `Portfolio value`, `Daily change`, `Total return`. `Value partly unknown` when some
  positions are unpriced. A missing amount reads `Value unknown`. A missing percent reads
  `Return unknown`.
- portfolio chart in the main column (`data-dashboard-section="performance"`), not in the
  aside. With no benchmark selected the title is `Portfolio` and the axis is `Portfolio
  value` (euros). With a benchmark selected the title is `Comparison` and the axis is
  `Indexed return`; portfolio and benchmark are percents (`packages/core` `deriveChartMode`).
  Period group `Choose period`: `1 month`, `6 months`, `1 year`, `YTD`, `All`, `Custom`.
  `+ Compare` opens benchmark search.
- summary card in the same aside (`aria-label="Portfolio overview"` holds KPIs, this card,
  the agent card, and operational status). Card `aria-label="Portfolio summary"`, title
  `Summary`, eyebrow `Risk & composition`. Metrics: `Annual volatility`, `Beta`,
  `Regression alpha (annual)`, `Maximum drawdown`, from `GET /api/investing/summary`.
  Controls: `Refresh risk`, `Risk period` (`6 months`, `1 year`, `Account history`),
  `Risk benchmark`.
- allocation donut (`Allocation`, `Allocation details`) and `Sector allocation`.
- net-worth chart (`Net worth`, `Net worth partly unknown`).
- portfolio agents card (`Choose agent`) — see [portfolio-agents.md](portfolio-agents.md).
- operational status (`Operational status`) — chips `Connection`, `Brokers`,
  `Price history`, `Vault`, `Cache`.
- degraded and empty states: `Dashboard unavailable`, `Refresh failed`, `Reading problems`,
  `No positions loaded`, `Cached data remains visible`, `Still loading your history`.

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
```

Proof that it works: `status: 200`, an empty `problems` array, `positions` and
`portfolioPoints` non-zero, and `shape: "normal"`.

## Gotchas

- `/api/investing/dashboard` no longer answers `503` when the read model fails. It returns an
  empty-but-valid dashboard plus a `problems` list so reconnect and resync stay reachable,
  and logs the redacted cause as `investing.dashboard_read.problems`. A `200` is therefore
  not a pass — read the problems array. `dashboard` flags this as
  `shape: "degraded (empty + problems)"`.
- `/api/investing/summary` still answers `503` on failure, so an overview can render with a
  working chart and a broken KPI block.
- A dashboard with zero positions and no problems is honest: nothing has synced yet. Check
  `sync-status` before calling it a bug.
- Sector exposure calls Yahoo per symbol on a cache miss, so the first request after a purge
  is slow and depends on market-data consent.
