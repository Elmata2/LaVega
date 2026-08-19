# LaVega — Investing Stack & Platform

_The spec for the investing proposition's technology stack. Read `docs/CONTEXT.md` and `docs/investing/CONNECTORS.md` first — this file assumes both._

Charted via the [Investing stack & platform](https://github.com/Elmata2/LaVega/issues/15) wayfinder map. Every decision below links to the ticket that made it. `apps/investing-web` UI/UX design and instrument enrichment are deliberately out of this spec — see [Future work](#future-work).

## Dashboard requirements

v1 ships three charts, no more: **portfolio value vs. benchmark** (line, EUR-converted, default S&P 500 overlay, 1M/6M/1Y/YTD/All range switcher), **allocation donut** (by instrument and by broker, current snapshot only), and **per-position price line** (single instrument, trade + dividend markers). No candlestick/OHLC anywhere — there is no intraday data in the pipeline, only daily EOD — and no zoom/pan/brush, just the range switcher and hover tooltips ([What the investing dashboard must plot](https://github.com/Elmata2/LaVega/issues/16)). This inventory is what the charting-library decision below is sized against.

## UI framework, routing, styling

`apps/investing-web` inherits the personal side's **React + Vite** pattern — no SSR; hosted-tier auth and multi-tenancy stay in the Hono API server, the same client/server split as today. Revisit only if hosting concretely needs server-rendering. Routing is **React Router**, library mode, decided now since the dashboard will have multiple views. Data fetching/caching (TanStack Query) is deliberately deferred — local reads go through `StorageAdapter`/IndexedDB, no remote server-state to cache yet; add it when hosted-tier sync introduces real remote fetching ([investing-web UI framework](https://github.com/Elmata2/LaVega/issues/17)).

Styling is **shadcn/ui (Tailwind + Radix)** — a deliberate divergence from `apps/web`'s hand-written CSS and `tokens.css`. shadcn's CSS-variable theming plays the same token-layer role `tokens.css` does, and it carries the same values: `investing-web` is the same LaVega brand, re-expressed as Tailwind/shadcn variables rather than reusing the `tokens.css` file itself (mechanically impossible once styling moved to Tailwind). Palette, type (EB Garamond / Inter), and the `--pos`/`--neg` pair carry over unchanged; the data-viz palette extends from 3 hues to ~5 to cover the allocation donut's categories. The frame/radius/shadow language carries over too — the floating rounded shell (`--r-lg`, `--shadow-float`) on a soft gutter, flat border-only cards (`--r-sm`, no shadow) — rejecting shadcn's own tighter/flatter defaults, confirmed by a side-by-side prototype. Wire it with **cva** for type-safe, variant-driven Tailwind styling ([investing-web visual identity](https://github.com/Elmata2/LaVega/issues/29)).

## Charting library

Shortlisted **Recharts** and **visx** (both MIT, SVG/DOM so they keep the app's `aria-label` accessibility convention, both cover the full v1 chart inventory with zero attribution burden). ECharts was a strong runner-up, held back by canvas accessibility and bundle weight. `lightweight-charts` was excluded outright — Apache-2.0 but carries a mandatory permanent TradingView attribution requirement, and its candlestick specialty is exactly what v1 doesn't need ([Research: charting libraries](https://github.com/Elmata2/LaVega/issues/21)).

Decision: **shadcn/ui Charts on Recharts** — an integration layer over Recharts, not a third chart engine. It gives the preferred visual design and shares Recharts' engine, at about the same measured bundle cost (~95 kB gzip) as raw Recharts, with a chart-configuration layer that gives more control over labels, series colours, and theme tokens for modest extra code. Raw Recharts used the least chart code (19 LOC vs. 37 LOC in the prototype); visx produced the smallest bundle (~35 kB gzip) and the most direct SVG control, at the cost of hand-rolled resize/scale/axis/hover/tooltip work ([Decide charting library](https://github.com/Elmata2/LaVega/issues/22)). Prototype: [`prototype/chart-library-22`](https://github.com/Elmata2/LaVega/tree/prototype-chart-library-22/apps/investing-chart-prototype).

## Market-data provider

Brokers supply positions and trades, not price series — external price and FX data is required to plot anything ([Research: market-data / price providers](https://github.com/Elmata2/LaVega/issues/18)).

**Local/self-hosted tier default: Yahoo Finance (unofficial), behind one-time consent at first use.** The user must accept plain-language risk disclosure before any Yahoo request; the decision is recorded for the installation and is not repeated on later syncs. Yahoo covers what LaVega needs — Euronext Amsterdam, XETRA, Paris, and London all reachable by ticker suffix, plus indices and FX pairs — for free, with no API key. Its endpoints are undocumented and reverse-engineered, rate-limited and IP-blocked informally, and can break without notice ([Market-data provider](https://github.com/Elmata2/LaVega/issues/34)).

**Optional local alternative: EODHD, documented but not built.** "EOD Historical Data — All World" (~€19.99/mo, self-funded, bring-your-own key) stays named in this doc as the paid alternative for a self-hoster who wants a documented, ToS-compliant, supported API instead of Yahoo's undocumented reverse-engineered one — but no adapter ships until a self-hoster actually asks for it. No demand signal exists today, Yahoo already clears the local tier's free-key bar, and `providerRouter.ts`'s priority-list `Provider` shape means adding EODHD later costs one new implementation, not a redesign ([Does EODHD remain an optional local provider?](https://github.com/Elmata2/LaVega/issues/37)).

**Hosted tier: marketstack Basic ($9.99/mo).** Yahoo is excluded from the hosted tier on licence grounds, not preference — its Terms of Service bar commercial reuse and bar using its content to build a database or data feed, and a hosted service serving many customers from one IP is exactly the traffic pattern Yahoo blocks in practice. Of the three redistribution-capable vendors found in research, marketstack is the only one whose existing licence already covers the shape LaVega needs (the licensee's own application displaying data to its own end-users, for those end-users' personal use) without a separate negotiated add-on — EODHD's Professional path and Twelve Data's Redistribution Rights add-on both require a new agreement before any code ships. marketstack is also the cheapest of the three by a wide margin. Its EU coverage is claimed but not itemised by exchange, and ISIN support isn't confirmed — accepted as a known weakness since ISIN resolution goes through the OpenFIGI layer independent of the price vendor; EODHD Professional is the fallback if coverage proves inadequate during implementation. Subject to written confirmation of the licence reading ([Hosted-tier market-data vendor](https://github.com/Elmata2/LaVega/issues/35), [Confirm marketstack redistribution licence in writing](https://github.com/Elmata2/LaVega/issues/38)).

**Unchanged across both tiers:** Frankfurter/ECB (free, keyless) for FX, OpenFIGI (free, MIT) for ISIN-to-instrument resolution.

**Ruled out at any price, any tier:** Financial Modeling Prep (personal-tier ToS arguably bars embedding its data in any third-party-accessible app, including the self-hosted OSS default); Tiingo ($499/yr commercial tier is still Internal Use Only); Finnhub (needs a written commercial agreement by default); Polygon.io/Massive.com (no European coverage at any tier).

## Storage seams

**`PriceStore`** is a separate seam, not an extension of `StorageAdapter` — `StorageAdapter` is CRUD/replace-all shaped (accounts/txs/rules/maps), price series need date-range queries, a different access pattern; this keeps the personal side's adapter untouched.

- **Local:** IndexedDB. Volume is trivial (~41 series × 5yr daily ≈ 51,660 rows, ~300K numbers total, per the market-data research), so a hand-rolled range scan over a `(symbol, date)`-indexed store is enough — no SQLite-wasm or DuckDB-wasm needed as a second local-storage engine.
- **Hosted:** plain Postgres. Same volume argument — a `(symbol, date)` composite index covers the access pattern; TimescaleDB's compression and continuous aggregates buy nothing at this scale.
- **Caching policy: incremental.** One backfill call per symbol, then daily top-up calls for new rows only. `PriceStore` exposes a `purgeAll()`/TTL-aware delete — required if a licence like EODHD's Non-Professional tier is in use, which requires deleting cached data within one month of cancelling.
- **`Position`/`Trade` are unchanged** — price series are stored entirely separately from `core`'s domain types, joined only by symbol/ISIN at the view layer.

([Storage seam for price series](https://github.com/Elmata2/LaVega/issues/23))

## Hosting & runtime

**Local tier:** a Docker image running `investing-server`, with the storage backend gated by environment variable ([#23](https://github.com/Elmata2/LaVega/issues/23)) — self-hostable, and matches how a scaled-for-others deployment would look too.

**Local-tier sync trigger: app-open, no cron.** The self-hosted Docker image has no Workers-style scheduler behind it, so IBKR and Trading 212 sync when the app opens, gated by a per-adapter `lastSyncedAt` timestamp that skips re-fetching within 24h of the last successful sync. The same sync endpoint could later serve an optional host-level cron for self-hosters who want it running with the app closed — worth documenting if someone asks for it, not worth building speculatively now.

**Hosted tier: Cloudflare Workers.**

- Cron Triggers are native on the free tier, not plan-gated — unlike Vercel, which caps Function duration at 10s on Hobby and needs Pro for anything past that.
- Workers' CPU-time ceiling counts only active compute, not idle/backoff waiting — IBKR's Flex `SendRequest`/`GetStatement` poll (~30–60s, mostly waiting) fits this billing model far better than Vercel's wall-clock `maxDuration`.
- `node:crypto` isn't native on Workers. Resolved by rewriting Enable Banking's JWT signing to WebCrypto (`crypto.subtle.sign`, RS256/RSASSA-PKCS1-v1_5 supported natively) — portable across Node, Workers, and Vercel Edge alike. Tracked as its own follow-up: [Rewrite Enable Banking JWT signing to WebCrypto](https://github.com/Elmata2/LaVega/issues/30).

**Artifact shape:** one `investing-server` codebase, two deploy targets — a Docker image for local/self-host, Cloudflare Workers for the hosted tier — not one identical artifact everywhere, since Workers doesn't run arbitrary containers.

**Ruled out:**

- **No-server / pure-browser.** Broker and market-data APIs don't set CORS for browser origins, and client-held API keys would break the server-side-secret pattern `apps/server/src/config.ts` already established. Not viable.
- **Vercel.** Its AI-forward positioning was a draw, but Workers fits the actual sync-scheduling/long-poll profile better and isn't plan-gated on it. Vercel's AI agentic suite (Eve, AI Gateway) was separately researched and not carried forward — see [in-product agent seam](#in-product-agent-seam) below.

([Hosting & runtime for investing-server](https://github.com/Elmata2/LaVega/issues/24))

**Sync model this hosting must serve** (from `CONNECTORS.md`): IBKR and Trading 212 sync daily and automatically; DeGiro is manual, user-triggered file upload, no scheduling at all. **Decision: one shared Cron Trigger, one `wrangler.toml` entry**, firing a single daily job that loops both adapters — not a separate trigger per adapter. Each adapter's failure lands in its own `problems[]` (the existing `BrokerAccessAdapter` shape), so one broker going down doesn't block the other; nothing in `CONNECTORS.md` gives IBKR and Trading 212 different run-time needs, so a second trigger would just be one more moving part for no benefit. Local tier's answer is above, under Local tier. Investing-side only: Enable Banking's sync on the personal side has no scheduler today either — it's pulled on-demand, not cron-driven — and stays out of this ticket's scope ([Sync scheduling mechanism](https://github.com/Elmata2/LaVega/issues/31)).

## Observability & error reporting

**Hosted tier: Sentry (Workers SDK).** Captures uncaught exceptions from the daily Cron Trigger job, and — since `BrokerAccessAdapter` never throws — also calls `captureMessage()` at warning level for every non-empty `problems[]` result, naming the broker and reason. Without that second path, this ticket's own motivating scenario (IBKR failing mid-backoff) would never reach Sentry, since a Flex poll timeout surfaces via `problems[]`, not an exception.

Ruled out: Workers-native (Tail Workers + Logpush + Workers Analytics Engine) — Logpush needs Workers Paid, which conflicts with #24's free-tier-not-plan-gated reasoning for picking Workers in the first place. Sentry's free tier (5k events/month) covers one daily cron job with room to spare.

**DSN custody:** a Workers Secret, not the `CredentialStore`/`KeySource` seam (#27) — it's one static ops-level value for the whole deployment, not per-tenant data.

**Scrubbing:** a `beforeSend` hook strips anything matching broker Query ID / API-key shape before an event leaves the Worker — `problems[]` messages can echo raw provider error text.

**Alerting:** Sentry's built-in email notification. No Slack/Discord webhook for v1.

**Local/self-hosted tier: stdout logs only.** No Sentry wiring by default — an optional DSN env var lets a self-hoster opt in themselves; matches the local-tier stance elsewhere in this map (#24, #35) of never forcing a third-party cloud dependency onto the self-hosted deploy.

([Observability / error reporting for investing-server hosted tier](https://github.com/Elmata2/LaVega/issues/32))

## Browser-access approach for API-less brokers

**DeGiro v1 is manual CSV import, reusing the `FileImport` seam.** No credentials, no login, no local Playwright, no managed/remote browser vendor. DeGiro gets a file-import profile behind the same `FileImport` seam `BankAccessAdapter` already uses for MT940/CAMT/CSV bank statements — the user exports their own portfolio/transaction data from DeGiro's web app and uploads it ([Decide browser-access approach for API-less brokers](https://github.com/Elmata2/LaVega/issues/25)).

This reverses the earlier conclusion of [Research: browser infrastructure for API-less brokers](https://github.com/Elmata2/LaVega/issues/19), which had recommended local Playwright driving DeGiro's real UI as the v1 resilience layer, and had ruled out every managed/remote browser vendor (Browserbase, Steel, Browserless, Hyperbrowser, Anchor, Airtop, Cloudflare Browser Rendering/"Kitesurf") at any tier — routing a broker password through infrastructure LaVega doesn't control, on datacenter IPs that raise rather than lower DeGiro's bot-detection risk, was the disqualifying reason and still stands as the reason no future automation should take that path either. That research isn't wasted: it's deferred to future work ([DeGiro: local Playwright driving real UI](https://github.com/Elmata2/LaVega/issues/33)), with `docs/investing/research/browser-infrastructure.md` standing as the reference if that work is picked back up.

**Credential-custody position:** DeGiro has no credentials to custody at all — nothing left to consent to, so its risk-disclosure gate is dropped, and (unlike a login-based adapter) the hosted/cloud tier can offer DeGiro too, since file upload has no credential-custody problem. IBKR (Flex token + Query ID) and Trading 212 (API key) are the only two connectors that persist credentials, always locally, per `CONNECTORS.md` — they are what the `CredentialStore` seam below exists for.

## In-product agent seam

An `AgentRuntime` interface sits behind the in-product agent chat feature. Three candidates were weighed:

1. **Direct Anthropic SDK** — what's actually built today (`apps/server/src/agent/`, `chat.ts`), API key held server-side, never sent to the browser (`apps/server/src/config.ts`). Zero new work; this is the runtime in use.
2. **Vercel AI SDK** — dropped; lost on infra, since hosting picked Cloudflare Workers, not Vercel ([#24](https://github.com/Elmata2/LaVega/issues/24)).
3. **Cloudflare `agents` SDK (Durable Objects)** — the marked fallback runtime if ever swapping off Anthropic-direct. A free pick since the hosted tier already runs on Cloudflare Workers; earlier research ([#20](https://github.com/Elmata2/LaVega/issues/20)) never evaluated this option, a gap in that research rather than a deliberate ruling-out.

([In-product agent seam](https://github.com/Elmata2/LaVega/issues/26))

Separately, research into closing the tool-use gap recommends staying on the direct Anthropic SDK and using Anthropic's beta Tool Runner with real client tools (`get_positions`/`get_trades`/`get_price_history`) instead of the current context-stuffing chat pattern — no new framework needed for that either. Of the two names surfaced by the user while charting this map: "Eve" is a real, brand-new Vercel durable-agent framework (eve.dev) built for a different job (background/multi-channel agents); "Pi" turned out to be an unrelated third-party coding-agent CLI, not a Vercel product, and isn't relevant here ([Research: in-product agent runtimes](https://github.com/Elmata2/LaVega/issues/20)).

## Hosted-tier seams: identity, secrets, API keys

**Tenancy.** Every investing-side persisted record (`Position`, `Trade`, `PriceStore` rows, credential rows) carries a `tenantId` field from day one — a fixed sentinel constant (`LOCAL_TENANT_ID = "local"`, exported from `packages/core`) on the local tier, a real tenant id assigned at signup on the hosted tier. This is investing-side only; the personal side's `account`/`tx` schema is untouched, and hosted tenancy for the personal proposition is Alexander's own, later call. `tenantId` is a different axis from `entity` (privé/zakelijk) — `entity` partitions one user's own BVs, `tenantId` partitions between hosted customers; the two don't conflict.

**Secret custody.** DeGiro's credential-custody question is moot — it's CSV-only, no credentials ever touch LaVega ([#25](https://github.com/Elmata2/LaVega/issues/25)). Only IBKR and Trading 212 need this. A new **`CredentialStore`** seam holds broker credentials, and — via a generalized `KeySource` (below) — LLM and market-data keys too, on the same reasoning as `PriceStore` in [#23](https://github.com/Elmata2/LaVega/issues/23): a separate seam per access pattern, not a bolt-on to an existing one. Hosted implementation is **Cloudflare D1**, with application-level **AES-GCM** column encryption under a single Workers Secret master key — no per-user envelope keys or KMS; the smallest thing that satisfies "a D1 dump isn't game over," per `docs/CONTEXT.md`'s "simplest thing that serves the current feature" rule. Revisit only if tenant count or threat model later demands it.

**LLM / market-data API keys.** `apps/server/src/config.ts`'s `loadLlmConfig()` pattern generalizes into a `KeySource` interface with two implementations: **local** — env var, today's behavior unchanged (`ANTHROPIC_API_KEY` etc., `configured` boolean); **hosted** — a per-tenant row in `CredentialStore`, same D1 table and encryption. One code path behind the seam, not two divergent ones. Metering and abuse limits are out of scope here, per the map's billing/plans exclusion — `KeySource` reserves a `recordUsage()`/rate-check hook point, but no limiting logic is built now.

**Local tier must never require an account, service, or key of ours.** This is already recorded in `docs/CONTEXT.md`'s "Don't do" section; this file links to it rather than restating it.

([Hosted-tier seams: identity, secrets, API keys](https://github.com/Elmata2/LaVega/issues/27))

## Third-party code adoption (vendoring)

**Vendor MIT-licensed source verbatim when a file is self-contained; reimplement when it's bound to the upstream project's own runtime or type graph.** MIT into AGPL-3.0 is one-way compatible — copying is legal provided the original copyright notice and permission text travel with the copied code; nothing flows back the other way without relicensing.

Vendored code lives under `vendor/<upstream-project>/` inside the owning package, never mixed into first-party source. Each directory carries the upstream `LICENSE` verbatim, a short `README.md` naming the project, upstream URL, commit copied from, and what was changed; a root `NOTICE` file aggregates every vendored dependency, and the product README credits them where users will see it.

Applied concretely to the Gloomberb teardown: `docs/investing/research/gloomberb-teardown.md`'s import-boundaries and IBKR provider-router priority-and-fallback pattern is **reimplemented**, since the upstream directory runs ~6,500 lines and is bound to `bun:sqlite` — a runtime LaVega doesn't use. The pattern transfers; the code doesn't.

([Third-party code adoption policy (vendoring)](https://github.com/Elmata2/LaVega/issues/36))

---

## Future work

Deliberately **not** specified here. Named so the next effort knows where the edges are:

- **`apps/investing-web` UI/UX design** — layout, information hierarchy, what the overview page actually looks like. Visual identity (palette, type, frame/radius/shadow language) is settled above; this is layout only.
- **Instrument enrichment layer** — industry, sub-industry, company size, fundamentals — carried forward unchanged from `CONNECTORS.md`'s Future work.
- **Testing shape for the investing side** — not yet ticketed.
- **DeGiro local-Playwright automation**, live scheduled sync driving DeGiro's real UI instead of manual CSV export ([#33](https://github.com/Elmata2/LaVega/issues/33)).
- **EODHD adapter** — build only when a self-hoster requests it; see [#37](https://github.com/Elmata2/LaVega/issues/37).
- **Confirm-on-build items:** written confirmation of marketstack's redistribution licence reading ([#38](https://github.com/Elmata2/LaVega/issues/38)).
