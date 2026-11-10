# Dashboard overview

The landing view: portfolio value over time, KPIs, allocation, and a status alert when sync needs attention.

## Sub-features

- headline figures widget (`Key figures`, section `aria-label="Portfolio KPIs"`,
  `data-dashboard-section="kpis"`) in the aside (`aria-label="Portfolio overview"`):
  `Portfolio value`, `Daily change`, `Total return`. `Value partly unknown` when the
  latest point has unpriced holdings (`No usable price: …`) or unknown cash
  (`Cash history unknown: …`). The same status names a wallet shortfall when movements
  do not add up. A separate line, outside that status, reads
  `Estimated cash: <names>. Walked from movements your broker reported without proving the history complete.`
  A missing amount reads `Value unknown`. A missing percent reads `Return unknown`.
- portfolio chart widget (`Performance`) in the main column
  (`data-dashboard-section="performance"`), not in the aside. With no benchmark selected
  the title is `Portfolio` and the axis is `Portfolio value` (euros). With a benchmark
  selected the title is `Comparison` and the axis is `Indexed return`; portfolio and
  benchmark are percents (`packages/core` `deriveChartMode`). Empty chart title:
  `No portfolio data`. Empty copy: `The value chart is built from your transaction history. While your broker provides no transactions for it, it stays empty.` Period group `Choose period`:
  `1 month`, `6 months`, `1 year`, `YTD`, `All`, `Custom`. `+ Compare` opens benchmark
  search.
- allocation donut widget (`data-dashboard-section="allocation"`) in that
  same main column. Eyebrow `Allocation`, title `Portfolio`. Group
  `Holding` / `Entity` (`aria-label="Group allocation"`). Empty book: title
  `No positions`, then `Your allocation appears after the first broker sync.`
- summary card widget (`Risk & composition`, `data-dashboard-section="risk"`) in the aside.
  Card `aria-label="Portfolio summary"`, title `Summary`, eyebrow `Risk & composition`.
  Metrics: `Annual volatility`, `Beta`, `Regression alpha (annual)`, `Maximum drawdown`,
  `Valid daily returns`, `Benchmark pairs`. Those figures, and the line
  `Historical account risk · …` or `Historical holdings risk · …`, come from the dashboard payload
  `risk.byBenchmark[<benchmark>][<range>]` (`6M`, `1Y`, `All`). The key is the selected
  benchmark, or `defaultBenchmark` when none is selected. An empty book has
  `defaultBenchmark: null` and the key `""`. Switching
  `Risk period` or `Risk benchmark` does not fetch. The status word is `Unavailable`
  (empty or short history), `Still loading` while a broker or price sync is in flight,
  or `Estimate, currency moves excluded` when an estimate exists. When `risk.to` is
  before today, that line appends ` (as of <date>)`. The card title stays `Summary`.
  When history is not still loading, the next line is
  `Use Refresh risk after broker or price updates.` The page never requests
  `/api/investing/summary`: the metrics, the risk basis line,
  `Current composition · …` (`priced`/`unpriced`/`estimated` counts) and the
  `Largest positions` list all read the dashboard payload's projections
  (`risk.byBenchmark` and `composition`). `Refresh risk` reloads the dashboard.
  `GET /api/investing/summary` still answers server-side with that same `risk.byBenchmark`
  entry plus `sectors`, `topPositions` and `composition`, but no component calls it.
  `summary` with no query is the `1Y` default-benchmark entry. Controls:
  `Refresh risk`, `Risk period` (`6 months`, `1 year`, `Account history`), `Risk benchmark`.
- `Sector allocation` is its own widget (`data-dashboard-section="sectors"`,
  `SectorAllocationCard`), below the two-column grid, and it can be hidden on its own.
  Eyebrow `Composition`. Empty copy: `No sector data yet.` It reads its own tenant-scoped
  endpoint, `GET /api/investing/sectors` (`{ sectors, sectorCoverage, revision }`), only
  while the widget is on screen; the resolution cache is keyed on the `revision`, so a
  correction or inference-setting write appears on the next read while a broker or price
  write does not invalidate it. The Profile switch that can
  fill missing sectors is `#data` (`Sector inference`). See
  [broker-connect-sync.md](broker-connect-sync.md).
- portfolio agents card, eyebrow `Agent`, title `Investor lens`
  (`data-dashboard-section="agent"`), below the two-column grid. The persona picker is a radio
  group with `aria-label="Choose agent"`.
  See [portfolio-agents.md](portfolio-agents.md).
- letter card in the aside, same Profile switch as the agent card (widget id `agent`,
  label `Portfolio agent`). There is no separate letter switch. Accessible name
  `Letter from Charlie` (`data-dashboard-section="letter"`). The page reads
  `GET /api/letters/latest` (`{ letter }` or `{ letter: null }`) and never generates one on
  load. Loading copy: `Loading letter…`. Empty copy: title `No letter yet`, then
  `Charlie writes after your broker data changes. Write the first letter now, or wait for the next sync.`
  A stored letter shows `Letter from Charlie · <date>`, the verdict as the title, the
  observations, button `Discuss`, and button `Write letter now`. `Discuss` opens
  `/agents/charlie_munger` in this tab and sends the letter as the first message.
  `Write letter now` posts `POST /api/letters/ensure`; it reads `Writing…` while the request
  is in flight. The server's gate still applies: when nothing changed the route returns the
  stored letter and the card adds `Nothing changed since the last letter.` On the local file
  server the GET is 200 with `letter: null`, so the empty card is on screen with the write
  button; it does not 503 and it does not hide. `POST /api/letters/ensure` is the writer
  (503 `Portfolio letters need a database` without a database); the cron also calls it after
  each tenant's sync. A write that fails — the model provider rate-limited or slow — answers
  502 and leaves the stored letter unchanged; the next sync retries. There is no page-load
  generation.
- status alert, not a chip panel. When the connection is not `online`, broker or price
  status is `problem`, a price problem is set, or the vault is `locked`, Overview shows
  `Status needs attention.` (period included) and the link `Review it in Profile`
  (`/profile#brokers`). The chips live on Profile `#status`.
  See [prices-and-market-data.md](prices-and-market-data.md).
- the Overview top bar always has `Add widget`, which opens `/profile#widgets`. Every card
  above can be switched off there. Switching off every card replaces the grid with
  `Every Overview card is switched off. Add one to see your portfolio here.` and another
  `Add widget` button.
- degraded and empty states: `Dashboard unavailable`, `Refresh failed`, `Reading problems`,
  `Sync problems` (with `Broker sync failed.` when Allow Yahoo Finance's broker POST
  fails), `Cached data remains visible`, `Still loading your history`.
- the positions table and the net-worth chart are their own tabs (`/positions`, `/net-worth`),
  not part of this view.

## Net worth

Nav `Net worth`, route `/net-worth`. One card, title `Investments and cash`. An empty book
reads `No net worth history` and `Net worth appears once broker and price data are available.`

With history, the chart stacks `Investments` and `Cash`. Estimated cash adds
`Cash estimated from unproven history: <n> accounts`. `GET /api/investing/personal-net-worth`
returns `{ totals: [] }` when the owner has shared nothing. When `presentationCurrency` is
`EUR` and `totals` is non-empty, a third band reads `Bank accounts (Personal, as of <date>)`.
A non-EUR presentation currency skips that merge. Preset pills use the same labels as the
performance chart (`1 month`, `6 months`, `1 year`, `YTD`, `All`) and are not synced with
Overview. There is no `Custom` pill. A custom window is the form `Choose net worth date range`
(`From`, `To`, `Apply`). Returns, risk, and allocation stay portfolio-only.

## How to get to it (user POV)

`https://www.lavega.dev/investing` after signing in. It is the first screen; `Overview` in
the main navigation returns to it.

## Driving it with control-investing

```bash
C=".claude/skills/verify-investing/control-investing.mjs"
node $C dashboard --target prod                 # summarized: problems, counts, shape
node $C dashboard --target prod --raw           # the exact payload the SPA receives
node $C summary --target prod                   # 1Y risk projection plus composition (server-side; no component calls it)
node $C api GET '/api/investing/summary?range=6M' --target local
node $C api GET /api/investing/dashboard --target prod
node $C api GET /api/investing/sectors --target local   # sector read: sectors, sectorCoverage, revision
node $C api GET /api/investing/personal-net-worth --target prod
node $C api GET /api/letters/latest --target local   # { letter: null } until a write
node $C api POST /api/letters/ensure --target preview # the card's `Write letter now`; 503 without a database
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
- `/api/investing/summary` still answers `503` with
  `Portfolio summary could not be assembled` when that route fails. No component calls it.
  A failed dashboard read shows `Dashboard unavailable` and
  `Failed to load dashboard: <status>` on the first load. A later refresh that fails shows
  `Refresh failed` and `Cached data remains visible.` The Summary card reads the dashboard
  payload, so it does not show `Failed to load summary: 503`.
- A dashboard with zero positions and no problems is honest: nothing has synced yet. Check
  `sync-status` before calling it a bug.
- Sector exposure calls Yahoo per symbol on a cache miss, so the first request after a purge
  is slow and depends on market-data consent.
