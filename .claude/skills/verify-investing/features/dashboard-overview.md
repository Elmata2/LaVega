# Dashboard overview

The landing view: portfolio value over time, key figures, allocation, risk summary, the
investor lens, operational status, the positions table and net worth.

## Sub-features

- portfolio chart. Eyebrow `Portfolio value` or `Indexed return`, title `Portfolio` or
  `Comparison`. Periods: `1 month`, `6 months`, `1 year`, `YTD`, `All`, plus `+ Compare` for the benchmark
  overlay. Empty copy: `No portfolio data`.
- key figures (`Key figures`, aria-label `Portfolio KPIs`) — portfolio value, daily change,
  total return. These come from the dashboard payload, not from the summary route.
  Unknown numbers read `Value unknown` or `Return unknown`.
- allocation card, title `Portfolio`, grouped by `Holding` or `Entity`. Empty copy:
  `No positions` / `Your allocation appears after the first broker sync.`
- risk summary (`Risk & composition` / `Summary`) — annual volatility, beta, regression
  alpha, maximum drawdown, from `/api/investing/summary`. Period select is `Risk period`.
  `Refresh risk` reloads it. Empty copy includes `Historical account risk · Unavailable`.
- net worth chart, title `Investments and cash`. Empty copy: `No net worth history`.
- operational status (heading `Status`, aria-label `Operational status`) — `Brokers`,
  `Price history`, `Vault`, `Cache`. Vault values are `Open`, `Locked`, `Not set up`
  for API statuses `unlocked`, `locked`, `empty`.
- investor lens — see [portfolio-agents.md](portfolio-agents.md).
- shell chrome: `Overview` in the main navigation, page title `Overview`,
  `Your financial overview`, and `Connect broker`.
- degraded and empty states: `Loading dashboard…`, `Dashboard unavailable`,
  `Refresh failed` with `Cached data remains visible.`, `Reading problems`,
  `No positions loaded`, `Still loading your history` while the first broker history is
  incomplete.

## How to get to it (user POV)

`https://www.lavega.dev/investing` after signing in. It is the first screen. `Overview` in
the main navigation returns to it. On the standalone server the same screen is `/` and the
auth gate is open.

## Driving it with control-investing

```bash
C=".claude/skills/verify-investing/control-investing.mjs"
node $C dashboard --target local                # summarized: problems, counts, shape
node $C dashboard --target local --raw          # the exact payload the SPA receives
node $C summary --target local                  # the risk block
node $C api GET /api/investing/dashboard --target local
```

Proof that a filled overview works: `status: 200`, an empty `problems` array, `positions`
and `portfolioPoints` non-zero, and `shape: "normal"`.

A fresh local server is a different honest state: `status: 200`, `problems: []`,
`positions: 0`, `portfolioPoints: 0`, `shape: "normal"`. The rendered page shows
`No portfolio data`, `Value unknown` and `No positions loaded`. That is not
`shape: "degraded (empty + problems)"`.

## Gotchas

- `/api/investing/dashboard` no longer answers `503` when the read model fails. It returns an
  empty-but-valid dashboard plus a `problems` list so reconnect and resync stay reachable,
  and logs the redacted cause as `investing.dashboard_read.problems`. A `200` is therefore
  not a pass — read the problems array. `dashboard` flags the empty-plus-problems case as
  `shape: "degraded (empty + problems)"`.
- `/api/investing/summary` still answers `503` on failure, so an overview can render with a
  working chart and a broken risk block. The key-figures card does not use that route.
- A dashboard with zero positions and no problems is honest: nothing has synced yet. Check
  `sync-status` before calling it a bug.
- Sector rows on the summary card come from the summary payload. The first request after a
  price purge is slow and depends on market-data consent.
- `?verify=1` stops the automatic broker and price sync. It does not hide the Yahoo Finance
  consent panel when consent is still missing.
