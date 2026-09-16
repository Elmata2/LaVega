# Investing frontend improvement specifications

Baseline: `master` at `7a566c4`. Evidence below is static source inspection. Parent review reports investing-web baseline tests: 85 passing. Tailwind v4, theme-token wiring and lint ratchet already exist on `719773f`; implement on top of that work and do not repeat it. All paths below are relative to repository root.

| ID | Priority | Finding | Status | Recommendation |
| --- | --- | --- | --- | --- |
| UI-01 | P1 | Dashboard request ownership and payload validation | Confirmed failure paths | Strong |
| UI-02 | P1 | Agent selection and catalog failure states | Confirmed defects | Strong |
| UI-03 | P1/P2 | Sync lifecycle and polling ownership | Confirmed failure paths | Strong |
| UI-04 | P2 | Chart-window transitions and pointer ownership | Confirmed wheel defect; gesture robustness gaps | Strong |
| UI-05 | P3 | Risk-summary resource ownership | Architecture opportunity; manual refresh intentional | Worth exploring |

## UI-01 — Own dashboard requests behind one resource interface

### Evidence and problem

- `apps/investing-web/src/app.tsx:182`: `useDashboard()` starts requests on mount and refresh events. Its `current` flag guards effect lifetime, not request order. Request A can overwrite newer B when A resolves last.
- `app.tsx:101`: `isDashboardData()` accepts empty nested portfolio/allocation objects and missing `benchmarks`.
- `app.tsx:1992`: overview calls `data.benchmarks.map()` unconditionally; accepted malformed payload can crash rendering.
- `app.tsx:2014` and `app.tsx:2321`: positions and detail routes suppress `refreshError`, unlike overview.
- `app.tsx:186`: prior ready state survives symbol change, allowing a false not-found display before the next instrument finishes loading.

### Implementation

Create a dashboard resource module with an interface equivalent to `useDashboard(symbol?) -> { status, data?, refreshError?, refresh() }`. Own query identity, HTTP adapter, decoding, request cancellation/generation and refresh subscription behind this seam. Use an existing shared contract decoder if backend work introduces one; otherwise define the decoder beside the transport adapter, not in rendering code.

Invariants:

1. Only the latest request for the current query may update state.
2. Retain prior valid data only for the same query identity.
3. All dashboard consumers expose refresh failures while retaining valid same-query data.
4. Decode required fields before rendering; normalize genuinely optional contract fields consistently.
5. Financial calculations remain in core. No browser persistence is introduced.

### Acceptance

- Resolve two refresh requests in reverse order; newest requested data remains displayed.
- Navigate between instruments while requests are pending; old instrument data cannot become current, and loading does not show a false not-found result.
- Fail refresh after a valid response; overview, positions and detail retain data and show a warning.
- Missing benchmarks, malformed range series and malformed positions are rejected or normalized according to the documented contract; none cause a rendering exception.
- Unmount removes subscriptions and prevents stale completions from updating state.

Dependencies: coordinate with shared transport/contract work. No mandatory query-library migration. Fix ordering and route error behavior first, then move those rules into the module. Deletion test: moving fetch functions alone merely relocates complexity; removing request rules from all callers concentrates complexity and earns depth. Locality improves around request identity; leverage reaches every dashboard route.

## UI-02 — Make portfolio-agent selection and failures explicit

### Evidence and problem

- `apps/investing-web/src/app.tsx:554`: selection initializes to the first agent.
- `app.tsx:624`: persona buttons only open a window; they do not change selection.
- `app.tsx:568`: Analyse uses selection, therefore remains tied to the initial persona.
- `app.tsx:621`: `radiogroup` contains buttons without radio selection semantics.
- `app.tsx:689` and `app.tsx:740`: catalog failure sets error, but an empty catalog returns loading before error can render.
- `app.tsx:686`: messages are persona-keyed while sending/error state is shared between personas.

### Implementation

Create a portfolio-agent workspace module owning catalog state, selected persona and persona-scoped request/message state. Share its HTTP adapter between overview and conversation routes. Persona selection changes the selected agent; a separately labeled conversation action opens that persona. Analyse always uses the displayed selected persona. Retain existing popup fallback if that affordance remains.

Invariants: catalog states are loading, ready, empty and error; failures expose retry. Requests and errors belong to a persona and request identity. Navigating away cannot attach one persona's completion to another. Unknown IDs become not-found only after catalog resolution.

### Acceptance

- Select the second persona; style text, conversation target and POST agent ID all match it.
- Catalog HTTP/network failure and empty catalog never produce permanent loading; retry works.
- Navigate A to B while A sends; A's response/error stays with A and B remains usable.
- Keyboard selection follows valid native/radio semantics.
- Preserve `/investing` routing and any retained popup fallback.

Non-goals: durable chat history, streaming, provider/model changes and multi-turn model context. Dependencies: shared agent transport contract, if planned. First fix selection and catalog states in place; then consolidate their ownership. Deletion test: remove duplicated catalog/request rules, not simply JSX. The module gains depth through persona lifecycle ownership; locality and leverage improve for overview and conversation together.

## UI-03 — Give sync polling one lifecycle owner

### Evidence and problem

- `apps/investing-web/src/app.tsx:925`: overview polling schedules its next read only after a valid active status; transient failures can stop polling permanently.
- `app.tsx:1360`: broker progress polling also returns after failed reads without recovery.
- `app.tsx:974` and `app.tsx:1380`: wake clears a timer but not an in-flight request; repeated wake events can create overlapping loops.
- Sync start behavior appears in AppOpenSync (`app.tsx:1085`), BrokerSyncAction (`app.tsx:1291`), vault unlock (`app.tsx:1494`) and credential save (`app.tsx:1616`).
- `apps/investing-web/src/lib/priceSync.ts:24`: orchestration returns an empty problem list on maximum-round exhaustion, indistinguishable from success.

### Implementation

Introduce a sync-session module exposing a snapshot, `start({ force })` command and subscription interface. Its HTTP adapter owns broker/price polling, active-operation identity, retry policy, dashboard invalidation and terminal outcomes. Credential save/unlock remains a separate module and invokes this interface after success.

Invariants: at most one status read per channel; wake coalesces; transient failure during a known active run retries with bounded backoff and visible connection state; terminal outcomes stop polling. Price-round exhaustion becomes explicit incomplete/paused outcome. Preserve resumable backend behavior, credential/vault distinctions and existing consent behavior; reconcile conflicting docs separately.

### Acceptance

- Running, HTTP 503, running, completed sequence recovers without reload.
- Repeated wake during a pending read creates no parallel poll/timer loops.
- Idle/completed/problem stops polling; no permanent one-second idle loop.
- Subscriber unmount removes its listener without duplicating or unexpectedly terminating other subscribers' operation.
- Maximum price rounds returns a visible incomplete result.
- Save, unlock, manual start and app-open start share invalidation and lifecycle rules.

Dependencies: backend sync outcome/operation contract; UI-01 invalidation interface. First fix recovery and coalescing with tests, then migrate start callers incrementally. Do not introduce a generic scheduler or event-bus framework. Deletion test: removing duplicate polling/start rules concentrates lifecycle complexity behind one seam. This supplies depth, locality and test leverage across real callers.

## UI-04 — Make chart-window transitions safe and monotonic

### Evidence and problem

- `apps/investing-web/src/components/useChartWindow.ts:133`: zoom-out reaching full history calls `clearZoom()`.
- `useChartWindow.ts:95`: clearZoom restores the original preset; repeated outward zoom from 1M eventually jumps back to 1M.
- `useChartWindow.ts:203`: a second pointer can replace active drag ownership.
- `useChartWindow.ts:224`: drag indices access current points unchecked; replacing the dataset during drag can invalidate those indices.
- `useChartWindow.ts:235`: interface exposes raw setters/internal gesture details alongside semantic commands.

### Implementation

Deepen the existing chart-window module; retain a separate instance for each chart. Own valid window transitions, coordinate conversion, pointer identity, cancellation and dataset reconciliation. Expose semantic commands and the minimum rendering state callers require.

Invariants: outward zoom never reduces the visible interval; full history clamps to all available points; Escape restores the base preset. One pointer owns a drag; cancel/lost capture clears it. Dataset replacement reconciles or safely resets a gesture. Chart windows remain independent.

### Acceptance

- Start at 1M and repeatedly zoom outward: visible count increases monotonically and stays at full history.
- Escape restores the original preset after a custom window.
- A second pointer cannot overwrite the first pointer's gesture.
- Shrink/replace data during drag: no exception or invalid dates.
- Pointer cancel/lost capture clears the overlay.
- Exercise the shared interface through all three real charts, preserving keyboard exact-value access and reduced-motion behavior.

Non-goals: replacing Recharts, adding brush strips, synchronized windows or changing financial math. No backend dependency. Fix transition defects first, then reduce raw state exposure only where callers can migrate cleanly. Deletion test: this module has real reuse; deleting it duplicates complexity. More tiny calculation utilities would only move complexity. Depth comes from valid-transition ownership, improving locality and leverage.

## UI-05 — Separate risk-summary transport from rendering, preserve manual refresh

### Evidence and problem

- `apps/investing-web/src/app.tsx:1992`: summary revision follows benchmark selection, not dashboard dataVersion.
- `apps/investing-web/src/components/PortfolioSummaryCard.tsx:111`: range, benchmark, revision and manual refresh own requests inside the rendering module.
- `PortfolioSummaryCard.tsx:210`: UI explicitly instructs manual refresh after broker/price updates.
- `PortfolioSummaryCard.test.tsx:121`: tests intentionally preserve manual-only refresh.

This is an ownership opportunity, not a freshness defect. Keep the manual contract.

### Implementation

When adopting the UI-01 transport seam, move summary decoding/request ownership into a focused summary resource module. Its interface accepts range, benchmark and existing revision and exposes loading/data/error plus explicit refresh. Keep all automatic refresh triggers unchanged. Do not subscribe summary to every dashboard/sync event.

Acceptance: manual refresh loads new risk data; ordinary parent renders and broker/price updates do not silently trigger summary requests; range and benchmark changes retain current documented behavior; failed reads produce usable errors; response decoding rejects malformed nested fields before rendering.

Dependencies: implement only alongside UI-01 shared transport work, where duplication can actually be removed. Non-goals: automatic freshness changes, risk computation and new benchmark policy. Deletion test: extracting the module is worthwhile only if it removes duplicated decoding/request rules; do not create a one-function forwarding layer. Locality should place resource rules together; leverage comes from shared transport behavior while preserving the specific summary interface.

## UI before/after review

| Before | After | Why |
| --- | --- | --- |
| Persona button opens a window while Analyse remains on first persona | Selection changes persona; explicit conversation action opens it | Visible selection and request agree |
| Catalog failure leaves spinner | Error and retry | Failure is actionable |
| Late refresh can replace newer data | Latest request owns display | Financial display cannot regress through request order |
| Position/detail refresh failures are invisible | Valid data retained with warning | Staleness is visible |
| Outward zoom jumps back to 1M at history limit | Clamp to full history | Gesture direction stays consistent |
| Active sync stops updating after transient read failure | Coalesced polling retries with connection state | Progress recovers without reload |
| Summary resource rules share rendering file | Resource rules move behind focused interface; manual refresh remains | Better locality without changing intentional behavior |

## Delivery sequence

1. Apply behavior fixes and regression cases for UI-01 and UI-02.
2. Implement UI-03 with backend contract coordination; migrate each start caller separately.
3. Implement UI-04 independently.
4. Consolidate modules around the now-tested interfaces; avoid a wholesale app.tsx split based on file size.
5. Include UI-05 only when shared transport removal provides concrete leverage.

Existing keyboard/exact-value chart support is substantial; preserve it. Pre-existing font failures were not reverified in this review and should remain a separate follow-up rather than a newly confirmed defect.
