# Dashboard overview

The landing view: portfolio value over time, KPIs, allocation, and the operational panels.

## Sub-features

- portfolio chart (`Portefeuilleoverzicht`) with window modes and a benchmark overlay.
- KPI block (`Portefeuille-KPI's`) — volatility, beta, alpha, max drawdown, from
  `/api/investing/summary`.
- allocation donut and sector exposure.
- net-worth chart.
- operational status (`Operationele status`) — key configuration, vault state, sync progress.
- degraded and empty states: `Dashboard laden mislukt`, `Dashboard niet beschikbaar`,
  `Geen posities geladen`, `Gecachete gegevens blijven zichtbaar`.

## How to get to it (user POV)

`https://www.lavega.dev/investing` after signing in. It is the first screen; `Overzicht` in
the main navigation returns to it.

## Driving it with control-investing

```bash
C=".claude/skills/verify-investing/control-investing.mjs"
node $C dashboard --target prod                 # summarized: problems, counts, shape
node $C dashboard --target prod --raw           # the exact payload the SPA receives
node $C summary --target prod                   # the KPI block
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
