# Investing app buildout — `apps/investing-web` + `apps/investing-server`

Implements the stack charted by [Investing stack & platform](https://github.com/Elmata2/LaVega/issues/15) and specified in [`docs/investing/STACK.md`](../../investing/STACK.md). Read `docs/CONTEXT.md`, `docs/investing/CONNECTORS.md`, `docs/investing/STACK.md`, and [ADR 0001](../../adr/0001-yahoo-finance-default-price-source.md) before starting — this spec assumes all four.

## Problem Statement

Every technology question for the investing proposition is now answered. The UI framework, the styling layer, the charting library, the price source, the price-series storage seam, the hosting target, the sync trigger, the credential and API-key seams, and the observability stance are all decided and written down. None of them exist as code.

A LaVega user who connects a broker gets positions and trades into `packages/core` and then hits a wall. There is no investing dashboard, so there is nothing to look at. There is no price series, so a holding can only ever be shown at whatever price the broker last reported in a statement — a portfolio's value over time cannot be drawn at all. There is no investing API server, so nothing fetches prices, nothing converts currencies, and nothing decides when a sync should run.

The banking side has all of this: a dashboard at `apps/web`, an API at `apps/server`, and storage behind `StorageAdapter`. The investing side has a decision document. The gap between the two is the whole of this spec.

There is a second problem, quieter but more expensive to get wrong later. The map decided several seams specifically so that a future hosted paid tier can plug in without a rewrite — `PriceStore`, `CredentialStore`, `KeySource`, a `tenantId` on every investing-side record. If the local tier is built without those seams and they are retrofitted afterwards, the cost is a migration on live user data rather than an interface implementation.

## Solution

Stand up the two missing applications, local tier first, with the hosted tier's seams cut but not implemented.

A self-hosting LaVega user gets `apps/investing-web`: a React + Vite dashboard, styled in LaVega's own visual identity re-expressed in Tailwind and shadcn/ui, that plots the three charts v1 committed to — portfolio value against a benchmark, allocation by instrument and by entity, and a per-position price line with trade and dividend markers. Nothing more, and specifically no candlestick, no zoom, and no pan.

Behind it, `apps/investing-server` is a Hono API in the same shape as `apps/server`: it fetches daily closing prices and FX rates, caches them, and triggers broker syncs when the app is opened rather than on a schedule the local tier has no scheduler for. Prices come from Yahoo Finance by default, behind the one-time consent gate ADR 0001 requires, through the priority-ordered `MarketDataRouter` that already exists — so a self-hoster who later wants a paid, terms-of-service-clean provider costs one new `Provider` implementation and no redesign.

Price series live behind a new `PriceStore` seam rather than being bolted onto `StorageAdapter`, because they are range-queried by `(symbol, date)` where accounts and transactions are CRUD-and-replace. The local implementation is IndexedDB. Broker credentials and LLM/market-data keys go behind `CredentialStore` and `KeySource`, whose local implementations are the encrypted local vault and environment variables respectively — the behaviour a self-hoster has today, unchanged, but now reachable through an interface a hosted implementation can satisfy later.

The local-first guarantee holds throughout: no LaVega account, no LaVega-operated service, and no key of ours is required to run any of it.

## User Stories

**Seeing the portfolio**

1. As a LaVega user, I want to see my portfolio's total value plotted over time, so that I can tell whether I am actually making money rather than guessing from a snapshot.
2. As a LaVega user, I want a benchmark plotted alongside my portfolio value, so that I can tell whether my return beats simply buying the index.
3. As a LaVega user, I want the portfolio chart converted to a single currency, so that holdings in dollars and euros add up to a number that means something.
4. As a LaVega user, I want to switch the portfolio chart between 1 month, 6 months, 1 year, year-to-date, and all time, so that I can look at both the last few weeks and the whole history.
5. As a LaVega user, I want to hover any point on a chart and see the exact value and date, so that I can read a specific day rather than eyeball the line.
6. As a LaVega user, I want to see how my portfolio is split across instruments, so that I can notice when one position has quietly grown into half of everything I own.
7. As a LaVega user, I want to see how my portfolio is split across entities, so that I can see concentration across my own portfolio partitions. Broker concentration waits until positions carry a real broker field.
8. As a LaVega user, I want to open a single position and see its price history as a line, so that I can see what happened to that instrument specifically.
9. As a LaVega user, I want my own buys and sells marked on that position's price line, so that I can see what I paid relative to where the price went.
10. As a LaVega user, I want dividends marked on that same line, so that I can see income events in the context of the price.
11. As a LaVega user, I want the dashboard to have several views I can navigate between, so that a single position's detail does not have to be crammed onto the overview.
12. As a LaVega user, I want charts that read correctly to a screen reader, so that the investing side is as usable as the banking side already is.
13. As a LaVega user, I want the investing dashboard to look like the rest of LaVega, so that it does not feel like a different product bolted on.
14. As a LaVega user, I want gains and losses to use the same colours everywhere in the app, so that I never have to work out what green means on this particular screen.

**Prices and currency**

15. As a LaVega user, I want daily closing prices fetched for every instrument I hold, so that my portfolio value is current without me typing anything in.
16. As a LaVega user, I want prices fetched once for my full history and then only topped up daily, so that my dashboard does not re-download five years of data every time I open it.
17. As a LaVega user, I want cached prices kept locally, so that opening the dashboard is fast and works when the price source is down.
18. As a LaVega user, I want foreign-currency holdings converted at a real exchange rate, so that a US position shows a euro value I can trust.
19. As a LaVega user, I want an instrument identified by its ISIN resolved to something the price source understands, so that I do not have to know or type ticker symbols.
20. As a LaVega user, I want to be told once, plainly, that the default price source is an undocumented Yahoo Finance endpoint and what that means, so that I can decide for myself before any request is made.
21. As a LaVega user, I want that disclosure to appear once and not on every sync, so that a real warning does not become noise I click through.
22. As a self-hosting LaVega user, I want to be able to point the price lane at a different provider without the app being rebuilt around it, so that I am not locked to one vendor's goodwill.
23. As a LaVega user, I want a price source that fails or rate-limits to leave my cached data intact and say what went wrong, so that a bad afternoon at Yahoo does not blank my dashboard.
24. As a LaVega user, I want to be able to delete all cached price data in one action, so that I can comply with a provider's licence terms or simply start clean.

**Running it myself**

25. As a self-hosting LaVega user, I want the investing side to run from a Docker image, so that I can host it the same way I host the rest of my stack.
26. As a self-hosting LaVega user, I want to run the investing side without a LaVega account, so that the local-first promise is real rather than marketing.
27. As a self-hosting LaVega user, I want to run it without any API key of the project's, so that my access cannot be revoked by us.
28. As a self-hosting LaVega user, I want my broker sync to run when I open the app, so that my data is fresh without a scheduler my laptop does not have.
29. As a self-hosting LaVega user, I want a sync to skip brokers already synced within the last day, so that opening the app four times does not fetch four times.
30. As a self-hosting LaVega user, I want to force a sync now, so that I am not stuck waiting out a cooldown after fixing a credential.
31. As a self-hosting LaVega user, I want the server's logs on stdout, so that whatever collects my container logs already collects these.
32. As a self-hosting LaVega user, I want error reporting to a third-party service to be off unless I switch it on, so that running LaVega does not quietly send my failures to someone else's cloud.
33. As a self-hosting LaVega user, I want to switch error reporting on with one environment variable, so that opting in is easy when I do want it.

**Keys and credentials**

34. As a LaVega user, I want my broker credentials stored encrypted on my own machine, so that a copy of my data directory is not a copy of my brokerage access.
35. As a LaVega user, I want my LLM and market-data keys supplied by environment variable exactly as they are today, so that upgrading does not force me to re-do my setup.
36. As a LaVega user, I want the app to tell me when a required key is missing rather than failing obscurely, so that I can fix my own configuration.
37. As a LaVega user, I want keys never sent to the browser, so that a key cannot leak through my own dashboard.

**Failure behaviour**

38. As a LaVega user, I want a broker that fails during sync to produce a readable problem rather than an exception, so that one dead connector does not take the dashboard down.
39. As a LaVega user, I want every problem reported by a sync to be visible to me, so that silent partial failure is not possible.
40. As a LaVega user, I want an instrument with no price data to be shown as unpriced rather than as zero, so that a data gap does not read as a loss.
41. As a LaVega user, I want a chart with no data to say so, so that I can tell "nothing happened" apart from "something is broken".

**Keeping the future open**

42. As a maintainer, I want price series behind their own seam rather than inside `StorageAdapter`, so that the banking side's storage contract is not reshaped by an investing-side access pattern.
43. As a maintainer, I want every investing-side record to carry a tenant field from day one, so that adding a hosted tier later is an implementation rather than a data migration.
44. As a maintainer, I want credentials and API keys behind interfaces from day one, so that a hosted implementation slots in without touching call sites.
45. As a maintainer, I want the investing server to avoid Node-only APIs, so that the decided Cloudflare Workers deployment does not require a rewrite when it is built.
46. As a maintainer, I want the value, allocation, and conversion maths to live in `packages/core` as pure functions, so that it can be tested without a browser, a server, or a network.
47. As a maintainer, I want import boundaries enforced by a test, so that `core` cannot acquire a dependency on I/O by accident.

## Implementation Decisions

### New workspaces

Two new pnpm workspace packages, `apps/investing-web` and `apps/investing-server`, alongside the existing `apps/web` and `apps/server`. Workspace dependencies use the `@lavega/*` convention resolved via `moduleResolution: bundler`, matching the rest of the repo. The existing `apps/investing-chart-prototype` is prototype output and is not promoted; its findings are already captured in the charting decision.

### `apps/investing-web`

React + Vite, no SSR. React Router in library mode, decided now because the dashboard has multiple views. TanStack Query is deliberately not added: local reads go through the storage seams directly, and there is no remote server state to cache until the hosted tier introduces one.

Styling is Tailwind plus shadcn/ui with **cva** for variant-driven component styling — a deliberate divergence from `apps/web`'s hand-written CSS, and the divergence stops at the styling mechanism. LaVega's palette and type are re-expressed as a `tokens.css` CSS-variable layer that shadcn consumes, including the `--pos`/`--neg` semantic pair and the data-visualisation ramp. The frame language keeps LaVega's own radius and shadow scale rather than shadcn's tighter, flatter defaults.

### Charts

**shadcn/ui Charts on Recharts** — one integration layer over one chart engine, not a second engine. Exactly three charts ship:

- **Portfolio value vs. benchmark** — line, presented in EUR, default S&P 500 overlay, range switcher for 1M / 6M / 1Y / YTD / All.
- **Allocation donut** — current snapshot only, switchable between grouping by instrument and grouping by entity. Broker grouping waits until positions carry a real broker field.
- **Per-position price line** — one instrument, with trade and dividend markers.

No candlestick or OHLC anywhere, since the pipeline carries daily EOD data only. No zoom, pan, or brush; the range switcher and hover tooltips are the whole interaction surface. Charts stay SVG/DOM so the app's existing `aria-label` accessibility convention continues to apply.

All series-shaping — joining positions and trades to price series, FX conversion, benchmark normalisation, allocation bucketing, range filtering — happens in `packages/core/src/investing/` as pure functions returning plain arrays. Chart components receive finished data and choose only how to draw it.

### `PriceStore` seam

A new seam in `packages/adapters`, distinct from `StorageAdapter`. `StorageAdapter` is CRUD-and-replace-all shaped for accounts, transactions, rules, and maps; price series need date-range reads. The shape is small and deliberately not generic:

```ts
export type PriceBar = { symbol: string; date: string; close: number; currency: string };

export interface PriceStore {
  getRange(symbol: string, from: string, to: string): Promise<PriceBar[]>;
  lastDate(symbol: string): Promise<string | null>;
  upsert(bars: PriceBar[]): Promise<void>;
  purgeAll(): Promise<void>;
}
```

`lastDate` is what makes the caching policy incremental: one backfill per symbol, then daily top-ups that request only what is missing. `purgeAll` exists so a licence requiring deletion of cached data after cancellation can be honoured.

Local implementation is IndexedDB with a `(symbol, date)` composite index and a hand-rolled range scan. The data volume is trivial — roughly 41 series over five daily years, about 51,660 rows — so no second local storage engine (SQLite-wasm, DuckDB-wasm) is introduced. The hosted implementation is plain Postgres with the same composite index; TimescaleDB is not needed at this scale and is not used.

`Position` and `Trade` in `packages/core/src/investing/model.ts` are untouched. Price series are stored entirely separately and joined to holdings by symbol or ISIN in the view layer.

### Market data

The existing `MarketDataRouter` and `Provider` shape in `packages/adapters/src/market-data/providerRouter.ts` are the seam; no new routing abstraction. The local tier registers:

- **price** — the existing Yahoo Finance client in `packages/adapters/src/market-data/yahoo/`.
- **fx** — Frankfurter/ECB, reusing the pattern already in `apps/server/src/fx.ts`.
- **identifier** — OpenFIGI for ISIN-to-symbol resolution, free key, unchanged across tiers.

The `identifier` lane stays its own provider list, independent of `price`, so swapping the price vendor never disturbs ISIN resolution.

Yahoo is gated by a one-time, per-installation opt-in consent as ADR 0001 requires; the disclosure is shown once and recorded, and no Yahoo request is made before consent. A rate-limited or blocked response is a `problems[]` entry and a fall-through in the router, never a thrown error and never a cache wipe.

EODHD stays documented in `STACK.md` as a paid local alternative; no adapter is built until a self-hoster asks for one. Adding it later costs one `Provider` implementation.

### `apps/investing-server`

Hono, mirroring `apps/server`'s structure and its server-side-secret pattern: no API key ever reaches the browser. Routes cover triggering a sync, fetching and refreshing price and FX data, and reading back what the dashboard needs.

**Sync trigger, local tier: app-open, no cron.** The self-hosted Docker image has no scheduler behind it. On app open, the server runs the brokers that support scheduled sync (IBKR and Trading 212 per `CONNECTORS.md`; DeGiro is manual CSV import and is never triggered this way), gated by a per-adapter `lastSyncedAt` that skips any broker successfully synced within 24 hours. An explicit "sync now" bypasses the gate. The hosted tier's single shared Cron Trigger looping both adapters is decided but not built here.

**Runtime portability.** The hosted target is Cloudflare Workers, so `investing-server` and any adapter it imports avoid Node-only APIs — no `node:crypto`, no `node:fs` on the request path. Web Crypto and `fetch` only. This is enforced by extending the existing import-boundary test rather than by convention.

**Artifact shape.** One codebase, and for this spec one deploy target: a Docker image. The Workers deployment is left buildable, not built.

### Hosted-tier seams, cut but not implemented

- **`tenantId`** on every investing-side record, including `PriceStore` rows. Local tier writes the sentinel `LOCAL_TENANT_ID = "local"`, exported from `packages/core`. This is a different axis from `entity`: `entity` partitions one user's own legal entities, `tenantId` partitions between hosted customers. The personal side's `account` and `tx` schemas are not touched.
- **`CredentialStore`** — holds broker credentials. Local implementation goes through the existing encrypted local vault (`packages/adapters/src/crypto/vaultCrypto.ts`, `encryptedStorage.ts`), preserving today's behaviour. The hosted implementation (Cloudflare D1 with AES-GCM column encryption under a single Workers Secret) is specified in the map and not built here.
- **`KeySource`** — generalises `apps/server/src/config.ts`'s `loadLlmConfig()` into an interface with a `configured` boolean and key retrieval, covering LLM and market-data keys. Local implementation reads environment variables, behaviour-identical to today. The hosted per-tenant implementation is not built.

### Observability

Local tier logs to stdout only. Every non-empty `problems[]` returned by a `BrokerAccessAdapter` is logged, not only thrown exceptions — the adapters are contractually non-throwing, so exception capture alone would miss the failures that matter most. Sentry is opt-in via an environment variable holding a DSN; absent that variable, no third-party reporting code path runs.

### Vendoring

Any third-party source copied in follows the adoption policy already recorded: MIT-licensed and self-contained only, under `vendor/<upstream-project>/` inside the owning package, with the upstream `LICENSE` verbatim, a `README.md` naming project and commit and changes, an entry in the root `NOTICE`, and user-visible credit in the product README.

## Testing Decisions

A good test here asserts behaviour a user or a caller could observe, and nothing else. It goes through the outermost seam that still makes the assertion cheap, uses fakes only where I/O would otherwise be real, and does not name private functions, internal state, or DOM structure. A test that would fail on a rename but not on a wrong number is not a test worth having.

**Seams tested, outermost first:**

1. **`packages/core/src/investing/` pure functions** — the highest seam and where most coverage belongs. Portfolio value series, benchmark normalisation, FX conversion, allocation bucketing by instrument and by entity, trade and dividend marker placement, range filtering. Input is plain arrays of `Position`, `Trade`, and `PriceBar`; output is plain arrays. No fakes needed at all.
2. **`PriceStore` contract** — one shared contract test run against both an in-memory fake and the IndexedDB implementation, covering range boundaries (inclusive ends, empty range, single day), `lastDate` on an empty store, upsert-as-update rather than duplicate, and `purgeAll` leaving the store readable and empty.
3. **`MarketDataRouter` wiring** — stub `Provider` implementations already have prior art in `packages/adapters/src/market-data/providerRouter.test.ts`. Assert that a failing price provider falls through rather than throwing, that a null result is not treated as a value, and that the `identifier` lane is unaffected by the `price` lane's outcome.
4. **Yahoo client** — extend the existing tests in `packages/adapters/src/market-data/yahoo/` with fixture-backed responses, covering the rate-limited and blocked cases as `problems[]` rather than exceptions, and asserting no request is issued before consent is recorded.
5. **`apps/investing-server` routes** — Hono's `app.request()` against the app instance, following `apps/server/src/index.test.ts`. Assert the 24-hour `lastSyncedAt` gate skips, that "sync now" bypasses it, that a broker returning `problems[]` yields a successful response carrying those problems, and that no key value appears in any response body.
6. **Import boundaries** — extend the existing architecture test from [#39](https://github.com/Elmata2/LaVega/issues/39) so `core` still cannot import I/O, and so `investing-server` and its transitive adapter imports cannot import `node:` builtins.

**Not tested:** chart rendering. The three chart components receive finished data and are thin wrappers over shadcn/ui Charts; asserting on their SVG output tests Recharts, not LaVega. The data handed to each chart is asserted at seam 1 instead. Visual snapshot testing is explicitly deferred — the map lists testing shape for the investing side as unspecified, and this spec deliberately does not resolve it beyond the above.

**Fixtures:** synthetic price series and holdings, checked in beside the code that consumes them, following the per-bank parser fixture convention in `packages/core/src/__fixtures__/`. No recorded live responses containing real account data.

Tests run under Vitest, as everywhere else in the repo.

## Out of Scope

- **Broker adapters.** DeGiro, IBKR, and Trading 212 are [#14](https://github.com/Elmata2/LaVega/issues/14) and `docs/investing/CONNECTORS.md`. This spec consumes `BrokerAccessAdapter`; it does not implement one.
- **Dashboard UI/UX design.** Layout, information hierarchy, and what the overview page actually looks like are a separate effort. This spec fixes the visual identity's tokens and the three charts' contents, not the composition around them.
- **Hosted tier implementation.** The Workers deployment, D1, the marketstack adapter, Sentry wiring, signup, and tenant provisioning are all decided and none are built here. Only the seams they will plug into are.
- **Instrument enrichment** — industry, sub-industry, company size, fundamentals. Carried forward unchanged as future work.
- **EODHD adapter.** Built only if a self-hoster requests it ([#37](https://github.com/Elmata2/LaVega/issues/37)).
- **DeGiro browser automation.** Deferred ([#33](https://github.com/Elmata2/LaVega/issues/33)); v1 DeGiro is CSV import through the existing `FileImport` seam.
- **Pricing, billing, plan tiers, go-to-market.** Product decisions that do not constrain this code.
- **The personal/banking side.** `apps/web` and `apps/server` are not re-architected. `StorageAdapter`, `account`, and `tx` are untouched.
- **Payment initiation.** A whole-app hard constraint, never in scope.

## Further Notes

**Why the hosted tier is seams-only.** The map decided the hosted tier in full, which makes building it now tempting. It is excluded because the standing constraint is that the local tier must never require a LaVega account, a LaVega-operated service, or a key of ours — and the cheapest way to be sure of that is to make the local tier work first, in full, with nothing hosted behind it. The seams are cut now rather than later because retrofitting `tenantId` onto stored records is a data migration, while implementing an interface is not.

**Known risks carried in, not resolved here.** Yahoo Finance is an undocumented, reverse-engineered endpoint that can rate-limit or block by IP; the mitigation is the router's fall-through, the local cache, and the one-time disclosure, not a guarantee. marketstack's EU exchange coverage is claimed but not itemised and its ISIN support is unconfirmed; this only bites the hosted tier, and EODHD Professional is the recorded fallback.

**Deferrals worth revisiting during implementation.** TanStack Query was deferred on the grounds that there is no remote server state yet. If the price-fetch routes end up needing client-side caching, staleness, or retry behaviour of their own, that reasoning has expired and the decision should be reopened rather than worked around.

**Provenance.** Every decision above traces to a closed ticket under [#15](https://github.com/Elmata2/LaVega/issues/15) and is recorded with its rationale in `docs/investing/STACK.md`. Where this spec and `STACK.md` disagree, `STACK.md` is the source of truth and this file is the bug.
