# Research: Gloomberb teardown

_Source: [gloom-sh/gloomberb](https://github.com/gloom-sh/gloomberb) at commit `0dafb31` (2026-08-18), product site [gloom.sh](https://gloom.sh). Read against a full local clone, not just the README._

This document answers one question: what, if anything, should LaVega's investing
proposition take from Gloomberb? It records findings. The decisions that followed from
it live in these tickets:

| Decision                                                                           | Outcome                                                                                              |
| ---------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| [#34](https://github.com/Elmata2/LaVega/issues/34) Yahoo as default local provider | Yahoo is the default local/self-hosted price source, behind a one-time disclosure                    |
| [#35](https://github.com/Elmata2/LaVega/issues/35) Hosted-tier vendor              | marketstack Basic, pending written confirmation ([#38](https://github.com/Elmata2/LaVega/issues/38)) |
| [#36](https://github.com/Elmata2/LaVega/issues/36) Vendoring policy                | Vendor verbatim when self-contained, reimplement when entangled                                      |
| [#37](https://github.com/Elmata2/LaVega/issues/37) EODHD's fate                    | Open                                                                                                 |

Implementation follows in [#39](https://github.com/Elmata2/LaVega/issues/39) (import
boundaries), [#40](https://github.com/Elmata2/LaVega/issues/40) (IBKR Flex),
[#41](https://github.com/Elmata2/LaVega/issues/41) (Yahoo client), and
[#42](https://github.com/Elmata2/LaVega/issues/42) (provider router).

The headline: **mine it, do not adopt it.** Gloomberb and LaVega disagree on runtime,
presentation layer, storage, and market focus, and Gloomberb has none of the EU brokers
LaVega most needs. But six of its subsystems are worth taking, and one of them —
the Yahoo client — changed a decision LaVega had already closed.

## What Gloomberb is

An open-source Bloomberg-style finance terminal. It ships as a terminal UI and as a
packaged desktop app, both driven by a command bar and Bloomberg-style mnemonics
(`DES`, `PORT`, `OMON`, `13F`). Version 0.10.5, ~1.9k stars, 735 commits, and commits
landing daily — this is an actively developed project, not an abandoned one.

Scale: roughly 270,000 lines of TypeScript across 1,153 non-test source files.

Runtime and stack:

| Concern      | Gloomberb                                                               | LaVega investing                                                |
| ------------ | ----------------------------------------------------------------------- | --------------------------------------------------------------- |
| Runtime      | Bun                                                                     | Node, plus Cloudflare Workers for the hosted tier (#24)         |
| UI           | OpenTUI (terminal) and Electrobun (desktop), sharing one component tree | React + Vite + shadcn/ui in the browser (#17)                   |
| Charts       | Custom renderers per target                                             | shadcn/ui Charts on Recharts (#22)                              |
| Local store  | SQLite via `bun:sqlite`                                                 | IndexedDB now, Postgres later (#23)                             |
| Market data  | Yahoo Finance, SEC EDGAR, FRED, Gloom Cloud                             | Yahoo local (#34), marketstack hosted (#35), Frankfurter/ECB FX |
| Agent        | `@earendil-works/pi-agent-core`                                         | Anthropic SDK direct, behind an `AgentRuntime` seam (#26)       |
| Brokers      | Interactive Brokers only                                                | DeGiro, IBKR, Trading 212                                       |
| Market focus | US-centric — SEC filings, 13F, congressional trades                     | EU-first                                                        |

The mismatch is structural, not cosmetic. Nothing about the presentation layer
transfers, and the two projects disagree on runtime, storage, and data vendor.

## Licence

Gloomberb is MIT. LaVega is AGPL-3.0. MIT is one-way compatible with AGPL-3.0: LaVega
may copy MIT-licensed source into an AGPL-3.0 codebase, provided the MIT copyright
notice and permission text travel with the copied code. The reverse is not true, so
nothing flows back without relicensing.

Gloomberb's `LICENSE` adds a non-binding request beyond the standard MIT text:

> When using this software in a product or service, attribution to the Gloomberb
> project (https://github.com/gloom-sh/gloomberb) is appreciated and encouraged,
> though not legally required beyond preserving the above copyright notice.

Preserving the notice is the legal obligation. Visible credit is a courtesy the
project asks for, and one worth extending.

Note that Gloomberb's own dependency set does not transfer cleanly. `@opentui/*`,
`electrobun`, `@stoqey/ib`, and `youtubei.js` all carry their own terms and would need
separate review if any of them came along with a lift.

## What is worth taking

Ranked by value against LaVega's existing decisions. Every path below is relative to
the Gloomberb repository root.

### 1. Enforced import boundaries — `src/architecture/import-boundaries.test.ts` (~120 lines)

A test that walks every source file, extracts every import specifier by regex, and
fails when a forbidden edge exists: `src/core/` may not import React, `react-dom`,
OpenTUI, or Electrobun; renderer-specific packages may only be imported from inside
their own renderer directory.

`docs/CONTEXT.md` already states the same rule for LaVega — "Don't let `core/` import
I/O or a concrete adapter" — but nothing enforces it. This file is generic, has no Bun
coupling worth speaking of, and is the cheapest high-value lift in the repository.

### 2. `ResourceStore` and cache policies — `src/data/resource-store.ts` (420 lines), `src/sources/provider-router/cache.ts` (173 lines)

A single stale-while-revalidate cache keyed on
`(namespace, kind, entityKey, variantKey, sourceKey)`, where every kind of resource
declares its own `CachePolicy { staleMs, expireMs }`. Quotes go stale in 5 minutes and
expire in a day; daily price history goes stale in a day and expires in 30; SEC filing
documents last a year. Records carry `fetchedAt`, `staleAt`, `expiresAt`,
`lastAccessedAt`, and `sizeBytes`, and the store runs size- and row-bounded maintenance
so the cache cannot grow without limit.

LaVega's #23 decided a narrower `PriceStore` seam for price series alone. Gloomberb's
generalisation is the thing worth studying: the same store also holds quotes, FX rates,
and fundamentals, which LaVega will need. The `purgeAll()` requirement from EODHD's
cancel-and-delete licence term maps onto this shape without strain.

Caveat: the implementation is bound to `bun:sqlite`. The schema and the policy table
are the transferable parts, not the code.

### 3. IBKR Flex Web Service client — `src/plugins/ibkr/flex/` (602 lines plus 245 lines of tests)

This is the closest thing to a drop-in. `docs/investing/CONNECTORS.md` specifies IBKR
exactly as Gloomberb implements it: a Flex token plus a numeric Query ID, the two-step
`SendRequest` then `GetStatement` flow, and polling with backoff until the report is
ready. Gloomberb has that working, with error handling for IBKR's status codes and a
tested date parser for Flex's `YYYYMMDD;HHMMSS` format.

Two details are worth acting on:

- **No Bun coupling.** `statement-client.ts` imports only a local `httpFetch` helper;
  `flex/index.ts` imports only local types. It ports to Hono or Workers unchanged.
- **No XML library.** Gloomberb parses the Flex report by matching
  `<OpenPosition ... />` elements and pulling attributes with a regex. `CONNECTORS.md`
  currently plans to add `fast-xml-parser` for this. Flex reports are flat and
  attribute-only, so the dependency may be avoidable. Worth confirming against a real
  report before deciding either way.

### 4. Cloud as an optional sync transport — `src/sync/types.ts` (80 lines)

Gloomberb solves the same local-first-with-an-optional-hosted-tier problem LaVega has
open in #27, and it solves it with two small interfaces. A `SyncContributor` knows how
to `collect()` its slice of state and `apply()` a slice back. A `SyncTransport`
declares `isAvailable()`, `pullSnapshot()`, and `pushSnapshot()`. Cloud sync is a
plugin contributing a transport; with no transport registered the application is
simply local, with no code path missing and no account required.

`SyncSnapshot` carries a `schemaVersion` and a per-contributor `schemaVersion`, so
individual slices can migrate independently.

### 5. Provider routing and fallback — `src/sources/provider-router/` (~6,500 lines)

Providers are ordered by priority; `firstProviderResult` walks them until one returns
non-null, logging failures rather than propagating them. A capability layer lets
plugins register as data sources, and `sortCachedRecords` prefers fresh over stale over
expired, then higher-priority sources, then more recent fetches.

The whole directory is far larger than LaVega needs. The pattern is the takeaway:
prioritised providers, graceful degradation to stale cache, and provenance recorded on
every cached record so the UI can say where a number came from.

### 6. Chart specification as data — `src/time-series/spec.ts`, `alignment.ts`, `studies.ts`

Gloomberb's chart composer accepts expressions like
`G AAPL:price, MSFT:revenue, FRED:CPIAUCSL` and renders unrelated series on one
synchronised timeline. A versioned `ChartSpec` object describes panels, series,
transforms (`raw`, `percent`, `index100`, `yoy`, `qoq`, `log`), studies (SMA, EMA,
Bollinger, RSI, MACD, ratio, spread, correlation), and axis scales. Mixed-frequency
series are aligned as-of filing dates.

This is more ambitious than LaVega's #16 three-chart v1 needs. It is filed here as a
signpost: a declarative, versioned chart spec is what LaVega's charts should grow into
if they ever grow, and knowing that shape now is cheaper than discovering it later.

### 7. Yahoo Finance client — `src/sources/yahoo-finance/` (2,543 lines across 13 files)

Added after the market-data decision was reopened (#34). Yahoo is now LaVega's default
price source for local and self-hosted tiers, and this client is the hard part: it
obtains a session cookie from `fc.yahoo.com`, fetches a crumb token from
`query2.finance.yahoo.com/v1/test/getcrumb`, sends a browser `User-Agent`, and retries
on 401, 403 and 429, re-fetching the crumb when it is rejected.

Endpoints used are Yahoo's undocumented internals: `/v8/finance/chart/` for history,
`/v10/finance/quote` for quotes, `/v1/finance/search` for lookup. EU coverage works by
ticker suffix, and `src/utils/exchanges.ts` already maps `AMS`, `XAMS`, `AEB` and
`EURONEXT` onto Euronext Amsterdam with the right timezone.

Take roughly 900 lines of it — `http.ts`, `symbols.ts`, `history.ts`, `mappers.ts`,
`types.ts` — and leave `options.ts` and most of `financials.ts`, which serve panes
LaVega does not have. Tracked in #41.

Note that this is the one lift where LaVega knowingly accepts terms-of-service risk;
see #34 for the reasoning and the disclosure requirement.

## What is not worth taking

- **The presentation layer.** OpenTUI and Electrobun are the whole reason Gloomberb's
  component tree exists. LaVega's #17 chose React in a browser. Nothing in
  `src/components/` (62,867 lines) or `src/renderers/` (14,521 lines) applies.
- **The plugin system** (`src/plugins/`, 112,502 lines). Gloomberb is a platform with
  third-party plugin installation from GitHub. LaVega is a personal finance tool for
  its authors. This is the single largest subsystem in the repository and it exists to
  serve a goal LaVega does not have.
- **The US data surface.** SEC EDGAR, 13F, congressional trades, and TheBuildout are
  the bulk of the research panes and none of them cover EU-listed instruments.
- **The `BrokerAdapter` interface.** Gloomberb's runs to roughly 40 methods and
  includes `placeOrder`, `previewOrder`, and `cancelOrder`. LaVega's
  `BrokerAccessAdapter` is deliberately one method returning
  `{positions, trades, source, problems}`, and read-only broker access is a hard
  constraint. Adopting the interface would import order placement into a codebase that
  has ruled it out.

## Gaps Gloomberb does not fill

Gloomberb has no DeGiro, no Trading 212, no EODHD, and no Enable Banking — verified by
grep across the whole source tree. Every EU-specific connector in
`docs/investing/CONNECTORS.md` remains original work. The two brokers LaVega most needs
help with are exactly the two Gloomberb does not implement.

## Open risks

- **Copying at 270k lines of scale.** Gloomberb's abstractions are sized for a plugin
  platform serving dozens of panes. Lifting them wholesale into a three-chart dashboard
  contradicts `docs/CONTEXT.md`'s "build the simplest thing that serves the current
  feature."
- **Divergence maintenance.** Vendored code that is then modified stops receiving
  upstream fixes. Any lift needs a recorded decision about whether it is a fork or a
  one-time copy.
- **Attribution scope.** If LaVega vendors even one file, the MIT notice must ship with
  the product, not only sit in the repository.
- **Yahoo terms-of-service exposure, knowingly accepted.** Yahoo's terms prohibit
  automated access and prohibit using their content to build a database or data feed.
  #34 accepts this for the local and self-hosted tiers on the reasoning that a user
  querying from their own machine resembles a browser, and requires a one-time
  disclosure. It is excluded from the hosted tier entirely (#35). The endpoints are
  also undocumented and informally IP-blocked, so this source can break without notice
  — the provider router (#42) exists partly so that it can.
