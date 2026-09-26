# R3–R7 implement-batch run — 2026-09-22

Branch: `batch/r3-r7-20260922` (worktree `/private/tmp/lavega-r3-r7-20260922`). Base: `origin/master` at `5c2901f`. Branch unpushed.

| Ticket | Outcome | Commit / branch | Findings fixed | Findings carried |
| --- | --- | --- | --- | --- |
| #116 R3 | done | `4523fa5` | Durable read propagation; memory/PGlite lease contract; slow-provider heartbeat test | Duplicate lease-renewal logic; full suite web `localStorage` environment failure |
| #117 R4 | done | `69365db` | None after first review | Duplicate vault commit flow; full suite import-boundary timeouts under load (isolated suite passes) |
| #118 R5 | done | `99c0912` | None after first review | Root suite web `localStorage` environment failure |
| #119 R6 | done | `ce9aebe` | Dashboard reconnect problem and link | Duplicate readability type; link matches English problem text; plain root suite needs Node localStorage file |
| #120 R7 | done | `c1a9903` | Cold locked/empty plaintext cleanup | Vault forwarding adapter; root tests require Node localStorage file |

# FIN-07 to UI-05 implement-batch run — 2026-09-24

Branch: `worktree-batch-fin07-ui05`. Base: `origin/master` at `2abaf8a`. Branch unpushed.
Queue: #112 FIN-07, #113 FIN-08, #123 UI-03, #124 UI-04, #125 UI-05. Blockers FIN-01/02/04 and UI-01 were closed.

Pre-flight assumptions (no user at keyboard):

- FIN-08: if no sanitized Trading 212 fixture proves settlement semantics, ship explicit unknown cash coverage, not invented cash.
- UI-05: build only if it removes code, not a forwarding layer.

| Ticket | Outcome | Commit / branch | Findings fixed | Findings carried |
| --- | --- | --- | --- | --- |
| #112 FIN-07 | done | `abc0914` | Refresh replaces window (`replaceRange`, all 4 stores); ADR-0004 lists `price_coverage`. Migration 0015 applied to prod and preview | Empty suffix re-asked until next trading day; intraday bar persists; listing flap on failed ISIN search; no IndexedDB v2 to v3 upgrade test; provider without `split` would loop |
| #113 FIN-08 | done (resumed 2026-09-26) | `e980452` + `fd3c2e0` (was `failed/113`) | Round 1 as before. Resume: N1 fixed, carried balance stops at the wallet's next cash flow, dividend or trade (a trade stops every wallet of its entity and broker); IBKR ledger row after `proven.to` now makes cash unknown. Standards and spec review: no blocking findings | `trade-settlement` unused in production; snapshot coverage keyed by broker, not entity (same as positions); IBKR ledger semantics only on synthetic fixtures; `readCash` delete branch unreached by current adapters |
| #123 UI-03 | done | `1563aaa` | Stale paused row polled forever (D1); double refresh on last price round (D2). D4 dismissed: non-JSON 5xx is proxy cutoff by design | Failed price outcome invisible outside app-open (N3); out-of-order read double refresh (N1); local broker double refresh (N2); dead running row polls every 1 s (pre-existing); paused tone; sticky Incomplete; D3 backoff not reset on stop; order-dependent app test |
| #124 UI-04 | done | `02336bd` | Round 1: oxlint memo error (`Drag.head`); wheel zoom-out out of bounds when data is smaller than wheel minimum; stale `focusIndex` after shrink; drag ends before capture release | Focus stays when drag ends outside chart; wheel step assumes preset series not denser than full series; PositionPriceChart keeps focus on pointer leave (pre-existing) |
| #125 UI-05 | done | `faac709` | Round 1: abort superseded requests; stable network and non-JSON messages; decoder checks rendered strings and numbers; out-of-order and network-error tests; `SummaryState` unexported | `isRecord` and fetch helpers duplicated with `dashboardResource.ts` (no shared transport module yet); `composition` not decoded; `refresh` not memoized; no retry button or live loading status (pre-existing) |

Verification (`/verify-investing`, local standalone on `faac709`): `up`, `doctor` (verdict ok, auth unconfigured), `probe` (all endpoints 200, no problems), `cleanup`. The vault was empty, so the dashboard showed 0 positions. This proves the API and SPA serve and the summary payload matches the new decoder; it does not prove broker data flows. A live-data check on a preview deploy is still open.

FIN-08 resume verification (`/verify-investing`, local standalone on `fd3c2e0`): `up`, `doctor` (verdict ok), `probe` (9 endpoints 200, no problems), `dashboard`/`summary` 200, `cleanup`. Vault empty, so broker cash was not exercised; the cash behaviour is proven by core tests only. A live-data check on a preview deploy is still open.
