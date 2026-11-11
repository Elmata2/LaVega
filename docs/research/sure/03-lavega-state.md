# LaVega current-state audit — what exists, what is live, and where Sure-derived code can land

Research note for the Sure adoption plan. Read-only audit of the LaVega checkout at
`914d1962b` (2026-11-10). Nothing here was verified by running a server, a test suite, a
migration, or a network call; every claim is a code or documentation claim, and §12 lists
what that leaves unproven. Reference product: Sure (Rails, AGPL-3.0), shallow clone at
`/tmp/sure` at commit `562fe09`.

**Status legend used throughout**

| Tag | Meaning |
| --- | --- |
| `A` | Implemented and tested. Test file exists run by `turbo run test` (`.github/workflows/ci.yml:34-35`). |
| `B` | Implemented but not wired/live: code exists and may be tested, but no reachable UI/route path in the current build, or docs call it pending. |
| `C` | Planned or documented only; no implementation found. |
| `D` | Different from Sure and, for the stated purpose, better. |

Sizes: ~1,070 first-party `.ts`/`.tsx` files, ~468 test files, ~159k LOC of non-test
application source; 1,267 commits. Excludes the vendored `repos/effect` tree (2,594 files).
Both projects are AGPL-3.0 (`LICENSE:1`; `/tmp/sure/LICENSE:1`), so copying is licence-compatible
if notices and changes travel (see §7.5).

---

## 0. Executive summary

1. **Two products, one core.** Personal (`apps/web` + `apps/server`) is an encrypted
   local-first IndexedDB vault with optional sealed Neon backup; investing
   (`apps/investing-web` + `apps/investing-server`) is a multi-tenant, Neon-backed broker
   dashboard mounted in the same Hono process at `/investing`. Both import `@lavega/core`
   (`docs/CONTEXT.md:9`).
2. **Investing is the shipped, deep side.** Docs call it live and authenticated
   (`PRODUCT.md:29`); it has routes, cron, memory, agents, letters, sectors, risk, benchmarks,
   returns. Personal's docs refuse to confirm it ships (`PRODUCT.md:30`), and the build hides
   three whole business modules behind `ARCHIVE_BUSINESS = true` (`apps/web/src/archive.ts:10-22`).
3. **Biggest constraint: the vault architecture decides where Sure code can land.** Personal
   ledger data never sits server-readable (`docs/adr/0009-account-held-vault-key.md:20-38`;
   `packages/adapters/src/storage/encryptedStorage.ts:29-140`), so any feature needing a
   server to read transactions — server rules, API/MCP, report generation, sharing — is
   blocked on a new architectural decision, not on porting effort.
4. **The weakest Sure capabilities have the most LaVega scaffold to attach to:** rules
   engine, transfers/auto-match, bills, budgets, document vault, reports. Each already has a
   seam (pure core module, vault section, view) but a fraction of Sure's semantics.
5. **Do not port Sure's investment stack.** LaVega's investing math (TWR/XIRR, position
   detail, risk, sectors, cash walk, splits) is broader than Sure's `holding/trade/valuation`
   models and tied to its own snapshot + price-store seams (§4).
6. **The `tx.id` hash is stable but cheap to respect.** Identity is
   `accountKey|date|amount|counterparty|description` + occurrence counter
   (`packages/core/src/hash.ts:19-45`); additive `Tx` fields or sibling collections are safe,
   changing the hash is not (`docs/CONTEXT.md:67`).
7. **Effect 4 is the standard, adoption is thin.** ADR 0008 makes it mandatory for new logic
   (`docs/adr/0008-effect-as-typescript-standard.md:37-67`); only ~28 first-party files import
   `effect` and there is **no `@effect/vitest` usage** — every test is plain Vitest. New
   Sure-derived modules must be Effect 4 and will set the first Effect-tested pattern.
8. **Test ownership is a written rule.** `docs/CONTEXT.md:131-135` assigns each contract to one
   layer; `docs/reviews/2026-10-20-test-audit.md:6-14` shows it enforced by deletion.
   Sure-derived tests must not replay core contracts from `apps/*`.
9. **Several capabilities exist but are dead in the UI.** Invoices, VAT/tax, currency
   exchange, invoice forwarding, the scope switch and the entity classifier are implemented
   and tested, and all hidden by one boolean. Any plan assuming "personal business
   bookkeeping is live" is wrong.
10. **No API/MCP and no family/household sharing exist**, though the personal server has
    Better Auth multi-user sessions and investing has per-user RLS. These are the two Sure
    features with no LaVega seam at all.

---

## 1. Product surfaces and actual routes

### 1.1 `apps/web` — personal vault (React 18 + Vite SPA, hand-written CSS + Tailwind-token layer)

Route model is a view enum, not React Router: `/` is the marketing/landing SPA, and the app
lives under `/app` with one segment per view (`apps/web/src/appRoutes.ts:7-44`).

| Path | View | Status in current build | Evidence |
| --- | --- | --- | --- |
| `/` | Landing (pre-rendered by `apps/web/src/prerender.tsx`) | served | `apps/web/src/views/Landing.tsx`; `scripts/vercel-build.mjs` prerender step |
| `/app` or `/app/overview` | Overzicht: saldo/position, statistics, cashflow, top spending, cards, travel, attention, intake invite, connection checklist, payment calendar | live | `apps/web/src/App.tsx:1730`; `apps/web/src/views/Overzicht.tsx:34-70`; widgets `apps/web/src/components/moduleRegistry.tsx:532+` |
| `/app/transactions` | Transacties + inline Regels (rules) | live | `apps/web/src/App.tsx:1799-1843` |
| `/app/accounts` | Rekeningen: per-account balances, types, merge duplicates, per-entity grouping | live | `apps/web/src/App.tsx:1844`; `apps/web/src/views/Rekeningen.tsx` |
| `/app/forecast` | 91-day deterministic cashflow forecast | live | `apps/web/src/App.tsx:1871`; `apps/web/src/views/Forecast.tsx:1-50` |
| `/app/optimalisatie` | subscription/savings/card optimisation, rates catalogue | live | `apps/web/src/App.tsx:1884`; `apps/web/src/views/Optimalisatie.tsx` |
| `/app/punten` | manual rewards/points balances | live | `apps/web/src/App.tsx:1949` |
| `/app/plan` | CFO plan: month, buffer, debts, spending limits, subscriptions, cards, goals | live when intake has ≥1 block done | `apps/web/src/App.tsx:1971`; `apps/web/src/views/Plan.tsx`; gate at `App.tsx:1117-1121` |
| `/app/intake`, `/app/about-you` | adviser intake wizard + profile answers | live | `apps/web/src/App.tsx:1656`, `1999`; `apps/web/src/views/IntakeWizard.tsx` |
| `/app/profiel` | modules/widgets, country/region, FX mode, net-worth sharing, name, import, backup, lock | live | `apps/web/src/App.tsx:2018`; `apps/web/src/views/Profiel.tsx:41,759` |
| `/app/backup` | encrypted `.lavega` backup/restore | live | `apps/web/src/App.tsx:1967`; `apps/web/src/views/Backup.tsx` |
| `/app/koppelingen` | invoice forwarding address setup | **hidden** (`SHOW_INVOICE_FORWARDING=false`) | `apps/web/src/archive.ts:21`; render guard `App.tsx:1963` |
| `/app/rules` | resolves, but Regels has no own nav entry and renders inside Transacties | live path, no nav | comment `App.tsx:169-181` |
| `/app/facturen` | invoice inbox/extraction/queue | **archived** (resolves to overview) | `apps/web/src/archive.ts:12-14`; guard `App.tsx:1930` |
| `/app/belasting` | VAT/profit-tax set-asides, private↔business crossings | **archived** | `apps/web/src/archive.ts:12-14`; guard `App.tsx:1903` |
| `/app/valuta` | currency accounts/exchange planning | **archived** | `archive.ts:12-14`; guard `App.tsx:1901` |
| `/app/import` | not a route; `Import` component is hosted inside Profiel | live | `apps/web/src/views/Profiel.tsx:41,759` |

Notes:
- Scope switch, entity classifier, invoice forwarding and the three archived views are all
  switched off by one flag with a documented reversal path (`archive.ts:6-22`).
- `apps/web` keeps a plaintext legacy IndexedDB only for one-time migration (`App.tsx:158-162`;
  `migrate.ts`); idle lock signs the user out because the key is account-held (`App.tsx:933-961`).

### 1.2 `apps/server` — Hono API + BFF + static host

Routes declared in `apps/server/src` (all under a session guard unless on the public list):

| Route | Purpose | Source |
| --- | --- | --- |
| `/health` | liveness | `apps/server/src/index.ts:270` |
| `/api/auth/*` | Better Auth (sign-up/sign-in/reset/verify) | `index.ts:281`; `apps/server/src/auth.ts` |
| `/api/rates`, `/api/fx/rate`, `/api/fx/history` | NL savings rates; ECB latest/historical FX (public) | `index.ts:305,316,326`; `fx.ts`; `fxHistory.ts` |
| `/api/eb/status`, `/api/eb/aspsps`, `/api/eb/auth`, `/api/eb/callback`, `/api/eb/accounts`, `/api/eb/refresh` | Enable Banking AIS link + refresh | `eb-routes.ts:140,169,217,280,320` |
| `/api/n8n/status`, `/api/n8n/queue`, `/api/n8n/forward-address` (GET/POST) | invoice queue proxy + per-user forwarding local-part | `n8n-routes.ts:46,55,130,144`; ADR `0006-invoice-queue-server-proxy.md` |
| `/api/agent/status`, `/api/agent/budget`, `/api/agent/extract-invoice`, `/api/agent/chat`, `/api/agent/categorize`, `/api/agent/travel-facts`, `/api/card-terms/ingest` | LLM-backed invoice extraction, chat SSE, bulk categorization, card terms | `agent-routes.ts:219,225,247,311,410,475,536` |
| `/api/vault/key`, `/api/vault/backup` (GET/PUT) | account-held vault key; sealed vault backup | `vault-routes.ts:70,84,101` |
| `/api/personal/net-worth-total` (PUT/DELETE) | opt-in shared personal total for investing net worth | `net-worth-routes.ts:73,96` |
| `DELETE /api/account/data` | erase all data | `account-routes.ts:36` |
| `/api/investing/*`, `/investing/api/*`, `/investing/*` | investing API alias + SPA mount | `index.ts:398-446`; `apps/server/src/investing-mount.ts:1-90` |
| `GET /api/cron/investing-sync` | daily tenant sync (bearer `CRON_SECRET`) | `index.ts:401` |
| `/privacy`, `/terms` | legal HTML | `index.ts:394-395` |
| `/app`, `/app/*` | gated SPA shell | `index.ts:479-481` |
| `/*` | static + SPA fallback; missing asset is 404, not HTML | `index.ts:483-505` |

Public allowlist (everything else is 401 without a session):
`apiGuard.ts:25-33` — auth, rates, fx, three `status` probes, investing health, card-terms
ingest, investing cron. Guard fails closed without `DATABASE_URL`/`BETTER_AUTH_SECRET`
(`DEPLOY.md:120-135`).

### 1.3 `apps/investing-web` — investing dashboard (React + React Router + shadcn/Tailwind + Recharts)

| Path | Page | Evidence |
| --- | --- | --- |
| `/sign-up`, `/sign-in`, `/check-email`, `/email-confirmed`, `/forgot-password`, `/reset-password` | auth screens | `apps/investing-web/src/app.tsx:1782-1789` |
| `/` | Overview: KPIs, portfolio chart, allocation donut, risk/composition, sectors, agent card, letter card; widgets configurable | `app.tsx:1791`; `lib/investingRegistry.tsx:56-120`; `lib/dashboardResource.ts` |
| `/positions`, `/positions/:symbol` | positions table + position detail (activity, quantity history, price chart, return facts) | `app.tsx:1792-1807`; `components/PositionPriceChart.tsx` |
| `/net-worth` | stacked portfolio+cash+personal net worth chart | `app.tsx:1808`; `components/NetWorthPage.tsx`, `NetWorthChart.tsx` |
| `/agents`, `/agents/:agentId` | six-persona agent catalog, per-persona threads/chat | `app.tsx:1816-1839`; `components/AgentsList.tsx`, `AgentThreads.tsx` |
| `/agents/research` | single-company research with six lens judgments + per-lens chat | `app.tsx:1824`; `components/StockResearch.tsx` |
| `/profile` | brokers/credentials, layout, benchmarks, market-data consent, agent memory, erase | `app.tsx:1840`; `components/Profile.tsx` |
| `/brokers/connect` | redirect to `/profile#brokers` | `app.tsx:1841` |

Module/widget choice is server-persisted per tenant (`packages/core/src/investing/layout.ts:8-81`;
`/api/investing/layout`).

### 1.4 `apps/investing-server` — investing API (Hono; standalone Docker, or mounted inside `apps/server`)

Routes (`apps/investing-server/src/*.ts`, path prefix as written):

| Group | Routes | Source |
| --- | --- | --- |
| health | `GET /health`, `/api/investing/health`, `/api/investing/health/detail` | `app.ts:334-345` |
| dashboard | `GET /api/investing/dashboard`, `/summary`, `/sectors`, `/positions/:symbol/sector` (GET/PUT/DELETE), `/sector-inference` (GET/PUT), `POST /investing/sectors/infer` | `app.ts:354-528` |
| benchmarks/layout | `GET/PUT /api/investing/benchmarks`, `GET /benchmarks/search`, `GET/PUT /api/investing/layout` | `app.ts:576-617` |
| net worth | `GET /api/investing/personal-net-worth` (read-only) | `app.ts:623` |
| consent | `GET/PUT /api/market-data/consent` | `app.ts:630-648` |
| brokers | `GET /api/brokers/sync/status`, `POST /api/brokers/sync`, `POST /api/brokers/credentials`, `GET /credentials/status`, `POST /credentials/unlock` | `app.ts:655-753` |
| prices/market data | `DELETE /api/prices/cache`, `GET /api/prices/sync/status`, `POST /api/prices/sync`, `GET /api/market-data/fx`, `/identifier` | `app.ts:754-785` |
| agents | `GET /api/agents/portfolio`, `POST /api/agents/portfolio/run`, `POST /api/agents/portfolio/conversation` | `index.ts:771-792` |
| research | `POST /api/agents/research/run`, `POST /api/agents/research/conversation` | `stockResearchRoutes.ts:67,105` |
| memory | `GET /api/memory`, `/memory/export`, `PUT /risk-tolerance`, `PUT /theses/:symbol`, `PUT /goals/:id`, `GET /threads`, `GET/DELETE /threads/:id` | `memoryRoutes.ts:72-145` |
| letters | `GET /api/letters/latest`, `POST /api/letters/ensure` | `letterRoutes.ts:25,31` |
| config | `GET /api/config/status` | `app.ts:649` |

`/api/auth/*` answers 503 in standalone mode so the SPA renders unguarded
(`app.ts:346-353`); mounted behind `apps/server` it uses the personal Better Auth session
and resolves the tenant per request (`investing-mount.ts:76-90`).

### 1.5 `apps/site` — marketing/content site

Not a server: a build-time generator that turns `content/{nl,en}/*.md` into HTML, robots,
sitemap and `llms.txt`, and fails the deploy on advice-wording/content-rule violations
(`apps/site/src/content.ts:1-60`; `apps/site/src/build.ts`; invoked by
`scripts/vercel-build.mjs` site step). Published pages only; drafts never ship.

### 1.6 `apps/extension` — Chrome MV3 checkout extension (Dutch)

Content scripts on three optional hosts (IKEA, Amex offers, ING points), local
calculation only, CSP `connect-src 'none'`: `apps/extension/public/manifest.json:1-60`.
Core is ranking checkout offers/points (`aanbod-kern.ts`, `rank.ts`, `points.ts`,
`horizon.ts`) from bundled catalogue/points data plus user-held cards
(`generated/catalog.generated.ts`, `generated/points-rates.generated.ts`).
It has no link to the personal vault; it is a separate product surface.

### 1.7 `apps/email-worker` — Cloudflare Email Worker

Accepts invoices at the user's forwarding address, parses MIME, applies spoof gate and
queue rate limit, then POSTs to the owner's n8n webhook (`apps/email-worker/README.md:1-40`;
`wrangler.toml`). Pure `handler.ts`/`parseMail.ts`, platform-only `index.ts`.

### 1.8 Deployment topology (evidence, not intent)

One Vercel Build Output API deployment builds personal SPA + prerendered landing +
investing SPA under `/investing/` + content site + one bundled Hono function
(`scripts/vercel-build.mjs:1-260`; `vercel.json` `regions: fra1`). Self-hosting uses the
all-in-one `Dockerfile` or investing-only `Dockerfile.investing` (`docs/investing/DOCKER.md:1-40`;
`railway.json`). Operational detail in §5.5/§5.7.

---

## 2. Storage and data model

### 2.1 Personal side

- One encrypted blob in IndexedDB per account (`lavega-vault:user:<id>`), AES-GCM,
  non-extractable `CryptoKey` imported from the account-held key
  (`docs/adr/0009-account-held-vault-key.md:20-38`;
  `packages/adapters/src/storage/encryptedStorage.ts:29,51,94-140,167`).
- Vault payload is one JSON object: accounts, txs, rules, scheduledFlows, vatSettings,
  invoices, rewards, facts, entityProfiles, credentials, n8n settings/queue, fxHistory,
  profile store, plan section, learning section, events
  (`encryptedStorage.ts:51-93`). All whole-list replace-all or upsert semantics live in
  that adapter (`StorageAdapter` in `packages/adapters/src/storage/StorageAdapter.ts:3-21`).
- Optional server backup: sealed blob → `personal.vaults` (`vault-routes.ts:84-124`;
  `db/migrations/0001_lavega.sql`).
- Server-side plaintext-adjacent tables: Better Auth (`public.*`), `personal.vault_keys`
  (key sealed with `LAVEGA_ENCRYPTION_KEY`), `personal.eb_sessions`/`eb_pending_auth`,
  `personal.n8n_forwarding`, `personal.net_worth_totals`, `personal.ai_usage`,
  `personal.rate_limit_buckets` (`db/migrations/*.sql`; `docs/adr/0004-neon-data-boundaries.md`).
- Core types: `Account` (`packages/core/src/model.ts:6-59`), `Tx` (`model.ts:94-104`),
  `Rule` (`model.ts:119`), `ScheduledFlow` (`model.ts:133-157`), `Invoice`
  (`model.ts:163-193`), `VatSettings` (`model.ts:201-249`).
- `tx.id = djb2(accountKey|date|amount.toFixed(2)|norm(counterparty)[40]|norm(description)[60] + '#' + n)`
  (`packages/core/src/hash.ts:19-45`). Ingest dedupes across sources by
  (account, date, amount) plus merchant-token containment, but never within one batch
  (`packages/core/src/ingest.ts:1-60`).
- Multi-currency: `Account.currency`/`Tx.currency`; EUR totals either convert at ECB rate
  on the day or exclude foreign rows (`packages/core/src/fx.ts:82-131`;
  `apps/web/src/totalePositie.ts:49-80`). FX history is ECB daily, 5-year cap, cached in
  the vault (`apps/server/src/fxHistory.ts:1-40`).

### 2.2 Investing side

- Encrypted per-broker credential + last-good snapshot blob in `investing.broker_vaults`, with
  a file-vault equivalent for self-host (`docs/adr/0002-encrypted-local-broker-snapshots.md:5-20`;
  `credentialStore.ts:1-60`; `fileCredentialStore.ts`).
- Queryable tables: price bars/coverage, preferences, sync state, dashboard snapshots/sources,
  agent runs, FX rates, sector profiles, layout, personal net-worth totals, agent memory and
  portfolio letters (`db/migrations/*.sql`; ADR 0004 table).
- Forced RLS on every table keyed on `current_setting('app.user_id')`; one `SECURITY DEFINER`
  cross-tenant function for the cron (ADR 0004:20-40; migration `0022`). Neon pools are
  request-scoped (`STACK.md:78`; `credentialStore.ts:30-60`); the local tier falls back to JSON
  file stores when no `DATABASE_URL` (`docs/investing/DOCKER.md:20-30`).

### 2.3 What this means for Sure-derived modules

Sure owns a relational schema (`families`, `accounts`, `transactions`, `transfers`, `rules`,
`recurring_transactions`, `budgets`, `goals`, `holdings`, …). LaVega has no equivalent
server-side personal schema, so **a table-for-table port is impossible on the personal side**.
The realistic unit is a **pure core module + a new vault collection**, as invoices and
scheduled flows were added. Investing-side adoption could use real tables, subject to ADR
0004's RLS/grant/migration discipline (`db/runtime-role.sql`; `DEPLOY.md:8-85`).

---

## 3. Personal CFO capabilities (module-by-module)

All paths under `packages/core/src/`. "UI" = a reachable component in `apps/web` unless
noted. Test impression = test file exists and is normally unit-testable pure logic; I did not
run them.

### 3.1 Ingestion and ledger

| Module | What it does | Input → output | Storage | UI | Status/test |
| --- | --- | --- | --- | --- | --- |
| `parsers/` (`mt940.ts`, `bankCsv.ts`, `parseBankFile.ts`, `csv.ts`, `invoiceCsv.ts`, `invoiceUbl.ts`, `parseInvoiceFile.ts`, `parseBrokerFile.ts`) | MT940/.STA, CAMT-adjacent bank CSVs (ING, ABN, Rabobank, Knab, Revolut, Amex, T212), invoice CSV/UBL/PDF, broker CSV | file text → accounts/txs/positions/trades + problems | none (pure) | Import in Profiel; broker import in investing | `A`; parser fixtures + `parseBankFile.test.ts` |
| `ingest.ts` | normalize → dedupe → consolidate per entity | accounts+txs → merged txs; per-entity in/out/balance | pure | via App import + EB sync | `A` (`ingest.test.ts`); cross-source merge covered |
| `hash.ts` | tx identity | row → stable id | pure | everywhere | `A` (`hash.test.ts`) |
| `balance.ts` | current/available balance, account kind, credit-card sign | account+txs+asOf → cents | pure | Rekeningen, Overzicht | `A` |
| `accounts.ts` | merge duplicate accounts, preserve manual fields, own-account detection helpers | accounts → accounts | pure | Rekeningen merge | `A` |
| `views.ts` | tx filtering/enrichment, per-account summaries, rule + built-in categorization, own-transfer detection | txs+accounts+rules → enriched rows/category | pure | Transacties, Rekeningen | `A` (large test file) |
| `entities.ts` | entity (BV/household) privé/zakelijk classification | entity name → scope; account inherits | vault `entityProfiles` | Profiel / archived scope switch | `A` |
| `scopePersonal.ts` / `advisor/scopePersonal.ts` | which rows count as personal history | txs+accounts+rules → clean personal view | pure | plan/room | `A` |

### 3.2 Analysis, advice and optimisation

| Module | What it does | Input → output | UI | Status/test |
| --- | --- | --- | --- | --- |
| `forecast.ts` | deterministic 30/60/90-day cashflow from recurring streams; bands, confidence, drivers, shortfall vs buffer (`forecastCashflow` at `forecast.ts:754`) | txs, scheduled flows, buffer, asOf → `EntityForecast` | `/app/forecast` | `A` (`forecast.test.ts`, 1007 lines) |
| `scheduledFlows.ts` + `invoices.ts` | expected/paid flows from VAT, invoices, manual; invoice↔tx reconciliation (`reconcileInvoices`, `invoices.ts:77`) | flows/invoices+txs → flows; matched invoices | Betaalagenda, Plan, Forecast | `A` |
| `subscriptions.ts` | recurring merchant detection: cadence fit, overlap, price increases, coverage floors, explanations (`fitMerchantStreams` 1149; `explainMerchant` 1374) | txs → subscriptions + diagnoses | Optimalisatie, Plan subscriptions | `A` (1371-line test) |
| `categorize.ts` | AI-categorization batch prep, unknown-reason analysis, redaction before AI, rule creation from confirmed decisions (`applyCategorizations` 375) | txs → items/decisions/rules | Transacties + server route | `A` |
| `categories.ts` | NL/DE merchant/category rules, person/incasso/card-payment classifiers, normalization | text → category/evidence | Transacties | `A` (1629 lines) |
| `alerts.ts` | critical/warning/info attention items (shortfall, missed payment, deadlines) | txs+flows+invoices+buffer → alerts | Aandacht widget; disabled by default | `A` |
| `tax.ts` + `taxpacks/{nl,de,...}` | VAT periods/positions per country, prepayment sizing, coverage notes (`vatPosition` `tax.ts:293`) | settings+txs+invoices → VAT position | Belasting (archived) | `A`; **B for UI** |
| `taxSheet.ts` | read the owner's own tax spreadsheet columns | xlsx/csv text → figures | Belasting (archived) | `A`; B for UI |
| `accountCosts.ts` | bank/card fee catalogue model, fee-over-horizon math, product↔account matching | catalogue rows + accounts → fees/unknowns | Optimalisatie, Plan cards | `A` |
| `interest.ts` | savings-rate benchmarks, detected interest rate, suggestions (`detectInterestRate` 315) | account+txs+rates → rate/suggestions | Optimalisatie | `A` |
| `netBenefit.ts` | rank holdings/payment products by net benefit after costs | product/benefit inputs → `NetBenefit` | Optimalisatie, Plan cards | `A` |
| `assumedCashback.ts` | cashback assumptions and held-card context | catalogue+accounts → cashback | Optimalisatie | `A` |
| `businessSavings.ts` | business savings offers/promos from the catalogue | offers → active/plan rates | Optimalisatie | `A` |
| `rewards.ts` | manual points/rewards balances, staleness | balances → stale/valid | Punten | `A` |
| `travel.ts` | travel/pay-abroad agent: card ranking, FX/ATM/cashback, convert-first step (`bestPayAdvice` 330) | traveller context + facts + rates → `TravelPlan` | Reis block on Overzicht | `A` (2086 lines) |
| `crossScope.ts` | detect private↔business crossings (two legs, own account/name, 4-day window), ask per stream, no judgment | all accounts+txs+answers → report | Belasting (archived) | `A`; **B for UI** |
| `spendPercentile.ts` | category spend vs own history percentiles (6–24 periods) | txs → percentiles | Statistiek block | `A` |
| `returns.ts` | annual spend estimation, per-account return/interest estimate | txs → `AccountReturn`/spend base | Plan/Statistiek/forecast basis | `A` |
| `fx.ts` | EUR conversion, cross rates, conversion modes | amount+date+currency+history → EUR or null | Valuta (archived), everywhere | `A` |
| `rewards/catalog/catalogRates/catalogMerge` | product/catalogue model, coverage, rate merge | catalogue JSON → entries/rates | Optimalisatie, extension build | `A` |
| `housing.ts` | rent/mortgage detection and proposals | txs → `HousingProposal` | intake/plan | `A` |
| `facts.ts` + `agentFacts.ts` + `advice/language.ts` | learned facts store with strict vocabularies; advice-language guard | facts → upsert/lookup; prose check | agent server routes + redaction | `A` |
| `redact.ts`, `sentryScrub.ts` | credential/IBAN/email scrubbing | value → redacted | server + both web apps | `A` |
| `localeRedirect.ts` | `/` → `/en` locale redirect | accept-language/cookie → target | server `index.ts:448` | `A` |

### 3.3 Plan (the closest thing LaVega has to a budget/CFO plan)

One pure engine, seven sections (`packages/core/src/plan/types.ts:11-19`):

| Section | What it computes | Notable module |
| --- | --- | --- |
| `month` | income/spend/room for the current month | `plan/month.ts` |
| `buffer` | emergency buffer in months vs target, gap | `plan/buffer.ts` |
| `debts` | debt list, required payments, interest-vs-payment risk | `plan/debts.ts` |
| `spending` | category limits vs median/percentile, over-limit streaks, external benchmark | `plan/spending.ts:1-80` |
| `subscriptions` | detected subs, price increases, overlaps | `plan/subs.ts` |
| `cards` | card value vs spend, redemption examples, foreign share | `plan/cards.ts` |
| `goals` | goals with saved/target, required monthly, capacity tolerance, loss illustration, scenarios | `plan/goals.ts:1-80` |

Plus `computePlan` (`plan/compute.ts:157`), fact sheet, change log/refresh triggers
(`plan/changes.ts`, `plan/preferences.ts:68-80`), scenario tables, and a stated/derived/
confirmed provenance model for every profile field (`advisor/profile.ts:24-80`, `commitProfile` 283).
The "room" engine turns three months of personal transactions into an income band
(`advisor/room.ts:130`) and capacity scoring (`advisor/capacity.ts:93`). Storage: one
`plan` section plus a separate `learning` section in the vault (`encryptedStorage.ts:51-93,120-130`).
UI: `/app/plan` + `PlanRoute`/sections.

Important for Sure mapping: **`categoryLimits` exist but there is no budget **object** —
no period, no allocation, no rollover, no "available to allocate"** (`plan/preferences.ts:29-47`).

### 3.4 Personal AI surface

- Server routes exist for invoice extraction, bulk categorize, chat SSE and travel facts
  (`apps/server/src/agent-routes.ts:219-560`), with budgets, rate limits
  (`personal.rate_limit_buckets`) and redaction before the model (`agent/redaction.ts`).
- **The personal chat UI is not rendered**: the floating widget was removed by owner decision
  (`apps/web/src/App.tsx:384-392,1264-1266`); the route is disabled unless
  `LAVEGA_CHAT_ENABLED=true` (`agent-routes.ts:311-315`).
- Learned facts live in the vault and render into prompt context under strict per-agent
  vocabularies (`packages/core/src/agentFacts.ts:49-180`).
- Invoice extraction is the most complete personal AI flow (n8n → server proxy → email worker
  → extraction → auto-book only for verified sender + complete extraction + one candidate
  entity, capped at €10,000; `docs/BACKLOG.md` §0 row R1-20; `facturen-holds.ts`), but the
  whole invoice feature is archived in the UI (§1.1), so this flow is `B`.

---

## 4. Investing capabilities

### 4.1 Core investing domain (`packages/core/src/investing/`)

| Module | What it does | Evidence |
| --- | --- | --- |
| `model.ts` | `Position`, `Trade`, `PriceBar` (split-adjusted), `CashBalance`, `CashFlow`, `CashHistoryCoverage`, `Dividend` | `model.ts:1-132`; `dividend.ts:2` |
| `portfolio.ts` | daily portfolio value series from trades + prices + cash anchors; forward-fill ≤5 business days; unpriced/unknown lists; currency conversion; range filtering | `portfolio.ts:15-49,591-858` |
| `positions.ts` | current positions, weights, per-position return status (`available`/`missing-cost`/`broker-unrealized`/`missing-fx`) | `positions.ts:9-75,286` |
| `valuation.ts` | mark-to-market with quote quality (`priced`/`forward-filled`/`unpriced`/`missing-fx`) | `valuation.ts:5-42` |
| `returns.ts` | TWR series, external-flow adjustment | `dashboard.ts:160-166`; used by benchmarks |
| `benchmarks.ts` | ≤3 benchmarks, indexed comparison, XIRR solver/series, benchmark XIRR | `benchmarks.ts:4-37,180,353` |
| `allocation.ts` | bucket by instrument and entity | `allocation.ts:4-87` |
| `risk.ts` | daily returns, annual vol, beta, regression alpha, max drawdown; account basis with holdings fallback; materiality/stale/settling gates | `risk.ts:5-32,32-230` |
| `summary.ts` | metrics + sector exposure/coverage | `summary.ts:110,278,314` |
| `dashboard.ts` | the one signed read model (schema, not hand types) | `dashboard.ts:309-336` |
| `splits.ts` | convert historical units to today's shares | `splits.ts:7` |
| `personalNetWorth.ts` | merge opted-in personal daily totals into net-worth chart (carry-forward; never guessed 0) | `personalNetWorth.ts:23-72` |
| `fundamentals.ts` | company fundamentals snapshot/aggregates/brief for agents | `fundamentals.ts:3-136` |
| `sectorTaxonomy.ts` | GICS labels + cyclical/defensive/sensitive mapping | `sectorTaxonomy.ts:7-78` |
| `ownership.ts`, `quantity.ts`, `markers.ts`, `mentions.ts`, `layout.ts`, `hash.ts` | trade ordering/splits of ownership, position markers, @-mentions, dashboard layout, trade ids | files listed |
| `portfolioBrief.ts` | rendered brief for agent prompts (concentration etc.) | `portfolioBrief.ts:7-28` |

### 4.2 Adapters (`packages/adapters/src/`)

| Area | What exists | Live? |
| --- | --- | --- |
| `banking/fileImport.ts`, `enableBankingMap.ts` | file import + Enable Banking mapping | `A` |
| `brokers/BrokerAccessAdapter.ts` | narrow `sync({entity}) → {positions, trades, sections, cashHistory, problems}` contract | `A` |
| `brokers/ibkr/` (`flexStatementClient`, `flexParser`, `flexAdapter`) | IBKR Flex Web Service: positions, trades, cash report/statement-of-funds, dividends; proven cash window | `A`; needs user token/query |
| `brokers/trading212/` | API adapter: orders/fills, positions, summary, transactions, dividends; rate-limit pacing, resume cursors, deadline merging | `A`; cash history reports `unknown` by design (no live-response proof) |
| `brokers/degiro/fileImport.ts` | CSV portfolio/transactions import | `A`; manual upload only |
| `brokers/scheduledSync.ts`, `brokerSnapshot.ts`, `brokerSyncLease.contract.ts` | lease-claimed multi-broker sync, last-good merge, snapshot persistence, resume | `A` |
| `prices/PriceStore.ts` + in-memory/IndexedDB implementations | date-range price series + coverage | `A` |
| `market-data/yahoo`, `providerRouter.ts`, `lanes.ts`, `priceSync.ts` | priority-list provider router, incremental backfill, per-symbol sync | `A`; Yahoo only |
| `market-data/fx` (Frankfurter/ECB), `identifier` (OpenFIGI) | FX + ISIN resolution | `A` |
| `benchmarks/` stores | benchmark selection persistence | `A` |
| `crypto/vaultCrypto.ts` | AES-GCM vault sealing (shared with personal) | `A` |
| `credentials/` | credential store contract | `A` |
| `vendor/gloomberb/` | MIT reference implementation; pattern reimplemented, not imported (`NOTICE`; `docs/investing/STACK.md:124-132`) | reference only |

### 4.3 `apps/investing-server` features

| Feature | What it is | Source |
| --- | --- | --- |
| dashboard read + cache | builds one schema-shaped read model from snapshots/prices/FX; versioned Neon dashboard snapshot keyed to source version and UTC day | `portfolioRead.ts:1-40`; `dashboardCache.ts`; `docs/investing/STACK.md:82` |
| price orchestrator | budgeted slices, pause/resume by host deadline, durable progress/lease in `sync_state` | `priceOrchestrator.ts:1-40` |
| sectors | Yahoo profiles, fund look-through, corrections, TS inference batch (consent + opt-in gated) | `sectorResolution.ts`, `sectorInferenceBatch.ts`, `app.ts:409-527` |
| broker credentials | per-tenant Neon or local file vault; passphrase mode for self-host; readability status | `credentialStore.ts`, `neonCredentialStore.ts`, `fileCredentialStore.ts` |
| portfolio agents | six System One personas, typed judgments (signal/conviction/confidence), one run per portfolio snapshot | `portfolioAgent.ts:1-40`; `docs/investing/PORTFOLIO-AGENTS.md:1-40` |
| agent chat + memory | one ToolLoopAgent per persona, tools over positions/prices/risk/sectors/trades/fundamentals + memory tools; encrypted Neon memory (theses/goals/observations/threads/risk tolerance) | `portfolioChat.ts:1-40`; `chatMemory.ts`; `memoryRoutes.ts`; ADR 0007 |
| portfolio letter | one stored Munger letter per broker-snapshot hash, max 3 observations, cron or button | `portfolioLetter.ts`; `letterRoutes.ts`; ADR 0008 |
| stock research | single-company six-lens run + HMAC-signed report reuse + per-lens chat | `stockResearch.ts`, `stockResearchRoutes.ts`; `docs/investing/STOCK-RESEARCH.md:1-44` |
| fundamentals | Yahoo `quoteSummary`/timeseries, 24h cache incl. misses | `fundamentalsCache.ts`; `PORTFOLIO-AGENTS.md:56-70` |
| health/detail | status-only diagnostics of Neon, migrations, vault, T212 creds/sync, snapshot | `app.ts:336-345`; `DEPLOY.md:136-185` |
| erasure | `DELETE /api/account/data` removes threads/theses/goals/letters/profile + vault key | `apps/server/src/account-routes.ts:36`; ADR 0007 |

### 4.4 `apps/investing-web` — see §1.3. Chart contract is specified in
`docs/investing/DASHBOARD.md:1-540` (portfolio value, TWR definitions, backfill/refresh,
allocation, positions, position detail, net-worth, states, agent conversation).

### 4.5 Live vs partial (documented, not inferred)

- Live per docs: dashboard, brokers (IBKR scheduled, T212 beta scheduled, DeGiro manual),
  agents, memory, letters, sectors, risk, research (`PRODUCT.md:25-38`;
  `docs/investing/CONNECTORS.md:96-185`).
- Documented partials: T212 cash history unproven (`CONNECTORS.md:96-135`; `RISK.md:19-34`)
  with a remaining reconciliation gap after the 2026-09-23 rebuild (`RISK.md:34`);
  marketstack hosted vendor unconfirmed and **no adapter built** (`STACK.md:37`; only a test
  fixture names marketstack, `providerRouter.test.ts:25`); EODHD not built (`STACK.md:35`);
  DeGiro UI automation deferred (`STACK.md:103-104`).
- Personal shipping status is explicitly undecided (`PRODUCT.md:30,38`) while `DEPLOY.md:208-214`
  documents deployed `/app` routes: treat routes as code facts, shipping intent as unconfirmed.

---

## 5. Workflow / stream today

### 5.1 Auth and vault key
- Better Auth email/password on `apps/server` at `/api/auth/*`; confirmation precedes a
  session (`DEPLOY.md:150-160`; `docs/investing/AUTH.md`).
- Per-account vault key: first signed-in `GET /api/vault/key` creates and seals it in
  `personal.vault_keys` with `LAVEGA_ENCRYPTION_KEY`; the browser imports it as
  non-extractable AES-GCM and seals the IndexedDB vault; erasure deletes it (ADR 0009:20-38;
  `vault-routes.ts:70-82`; migration `0024`). Password reset no longer loses data.
- The server can technically decrypt but no server code does; the privacy policy must not
  claim otherwise (ADR 0009:47-55). Idle lock = sign-out after 15 minutes (`App.tsx:933-961`).

### 5.2 Neon boundaries
- Two schemas, `personal` and `investing`; every table non-blank `user_id`, RLS forced,
  client-supplied user ids never set DB context; the only deliberate cross read is the cron
  tenant-listing `SECURITY DEFINER` function (ADR 0004 whole document).
- Personal totals cross one way, daily, only by explicit opt-in PUT:
  `App.tsx:674-695` → `net-worth-routes.ts:73` → `personal.net_worth_totals` →
  `GET /api/investing/personal-net-worth` → `mergeInPersonalNetWorth`.

### 5.3 Invoice queue
- n8n (owner-hosted) receives mail and offers a queue; LaVega's server proxies it so the
  browser never holds the webhook token and the server derives `queueKey` from the session
  (ADR 0006; `n8n-routes.ts`). Email-worker is the second ingress → same n8n webhook
  (`apps/email-worker/README.md`; `docs/n8n/DOORSTUURADRES.md`).
- Corrected n8n workflow JSON exists but **is not imported into the live n8n instance yet**
  (`docs/BACKLOG.md` §0b). The queue fetch empties its source, so the vault copy is the only
  copy after fetch; a failure on the second leg loses rows (ADR 0006 "What it costs").

### 5.4 Agent memory
- Investing: Neon `agent_*`/`theses`/`goals` tables, free text encrypted before Neon,
  cascades encode deletion rules (ADR 0007:15-60; migrations `0020`, `0023`).
- Personal: no vector store and no server memory table; only vault `facts` plus the
  learning/plan sections (`encryptedStorage.ts:51-93`). pgvector deferred (ADR 0007:22-30).

### 5.5 Cron/scripts
- Only production scheduler: Vercel cron daily for investing sync (`STACK.md:72-90`); it
  lists tenants, syncs one per pass under budget, then `POST /api/letters/ensure`.
- Personal Enable Banking refresh is *not* a cron: browser interval, 4×/day, only while the
  tab is open (`App.tsx:904-931`; `ebAutoRefresh.ts`; `BACKLOG.md` §1.1).
- `scripts/`: migration ledger, Vercel build generator, n8n sync, catalog sweep + weekly
  workflow, watchers, bundlers, verify-investing CLI. None are business crons.

### 5.6 Tests and CI
- One GitHub Actions `checks` job: typecheck, oxlint, turbo test, plus the black-box
  verify-investing CLI suite (`.github/workflows/ci.yml:18-35`). `catalog-sweep.yml` is a
  weekly commit-and-push sweep with an independent follow-up job.
- Test files by area: core 111, adapters 36, database 14, web 155, server 45,
  investing-server 48, investing-web 26, site 7, extension 14, email-worker 7 (count, not
  coverage; I did not run them).
- Test ownership: core = domain rules; adapters = parsers/providers/storage; servers =
  routes/tenancy/consent/security; UI = interaction only; no layer replays a lower contract;
  grep-the-source, constant-restating and mock-own-behaviour tests are removed
  (`docs/CONTEXT.md:131-135`; example `docs/reviews/2026-10-20-test-audit.md:6-14`).

### 5.7 Deployment
- Vercel Build Output API (single function + static), `fra1`, 300 s `maxDuration`;
  migration-ledger check before build, no DDL from the build; missing `DATABASE_URL` skips
  the check with a log line (`DEPLOY.md:8-85`; `scripts/vercel-build.mjs:1-260`).
- Docker all-in-one and investing-only images; `INVESTING_MOUNT` decides whether the personal
  server serves investing API/SPA (`investing-mount.ts:64-80`). Railway uses the all-in-one image.
- Secrets: env vars only; `LAVEGA_ENCRYPTION_KEY` loss loses all vault keys
  (`docs/CONTEXT.md:21-22`; ADR 0009:47-50).

---

## 6. Capability matrix vs Sure

Statuses: HAVE = LaVega capability covers the Sure feature's purpose; PARTIAL = meaningful
subset; MISSING = no implementation; D-BETTER = different architecture and stronger for
LaVega's stated purpose. Sure evidence is from `/tmp/sure` (Rails models/controllers).

| Sure capability | Sure evidence | LaVega status | LaVega provider / gap |
| --- | --- | --- | --- |
| **Transfers / auto-match** | `transfer.rb` (pending/confirmed, fee legs, kcc/investment kinds), `rejected_transfer.rb`, `auto_matches_controller.rb`, `transfer_matches_controller.rb` | **PARTIAL** | Own-transfer *categorization* (`views.ts:182-205`), cross-entity pair *detection* (`crossScope.ts:345-601`), cross-source *dedupe* (`ingest.ts:1-60`), investing external cash flows (`portfolio.ts`). No persisted transfer object, no confirm/reject workflow, no fee-leg handling, no UI. |
| **Rules engine** | `rule.rb` (conditions + actions + groups + positions + runs + email actions), `rule_run.rb`, `rule_group.rb`, `rule_import.rb` | **PARTIAL** | `Rule = {id, match, category}` (`model.ts:119`); first-substring-wins `categorize()` (`views.ts:182`); built-in NL/DE rules (`categories.ts`); AI-created single-action rules (`categorize.ts:375`). No conditions, actions, groups, ordering UI, run history, or split/transfer actions. |
| **Recurring / bills** | `recurring_transaction.rb` (bill/subscription/installment/income/transfer, occurrence plan, end modes, weekend adjust), `recurrence_rule.rb`, `recurring_occurrence.rb`, `recurring_price_change.rb`, `recurring_match_rejection.rb`, bills controllers | **PARTIAL** | Recurring *detection* for forecast + subscriptions + price increases (`forecast.ts:186-307`; `subscriptions.ts:1149-1436`); planned flows with status (`model.ts:133-157`); invoice/VAT flows; betaalagenda block. No bill entity, occurrence plan, mark-paid per occurrence, or match-rejection model. |
| **Cashflow forecast** | not a Sure core feature; Sure's `cash_flows` is investment flow data | **D-BETTER** | `forecast.ts:754` (bands, confidence, drivers, buffer shortfall) + `plan/cashflow.ts` forward path + `plan/buffer.ts`. Deterministic, no ML (`docs/CONTEXT.md:140`). |
| **Budgets** | `budget.rb` (period, budgeted/allocated/actual/available, rollover via `RolloverCalculator`), `budget_category.rb`, `budget_share.rb` | **PARTIAL** | Category limits with provenance (`plan/preferences.ts:29-47`) and spending-section comparison (`plan/spending.ts`). No period budget object, allocation, rollover, or "available to allocate". |
| **Goals** | `goal.rb`, `goal_account.rb` (linked accounts), `goal_pledge.rb` | **PARTIAL / D-BETTER in depth** | Personal: goal schema with saved source, linked accounts, required-monthly schedules, shared-account allocation, capacity tolerance, scenarios (`advisor/profile.ts:54`; `plan/goals.ts`). Investing: first-class `investing.goals` + agent memory (ADR 0007). Missing: pledges, goal types beyond general/child, UI goal creation from a template. |
| **Net worth / balance sheet / income statement** | `balance_sheet.rb`, `income_statement.rb`, `period.rb`, `accountable_sparkline`; assets/liabilities models (property, vehicle, loan, other asset/liability) | **PARTIAL** | Personal "Totale positie" = sum of known account balances, walked backwards (`apps/web/src/totalePositie.ts:1-80`); investing net-worth chart merges portfolio+cash+opt-in personal totals (`investing/personalNetWorth.ts:46`). No liabilities/property/vehicle model (`ACCOUNT_TYPES` is 5 values, `balance.ts:26-32`), no balance sheet, no income statement. |
| **Investments / returns** | `holding.rb`, `investment.rb`, `trade.rb`, `valuation.rb`, `portfolio.rb`, `security.rb`, `price.rb`, `investment_statement.rb`, cost-basis lot book (recent commit) | **DIFFERENT-BETTER** | Full read model: positions/trades/cash anchors, TWR + XIRR, benchmarks, risk (beta/alpha/vol/drawdown), sectors, splits, dividends, position detail; three broker adapters (two scheduled) (§4). LaVega does not model per-security master data or tax lots; Sure's lot-book idea is the one reusable concept. |
| **Statement vault / documents** | `account_statement.rb`, `family_document.rb`, `transaction_attachments_controller.rb`, `pdf_import.rb`, `account_import.rb` | **MISSING** | Parsed statements are not retained; no document upload/attachment model anywhere (`VaultData` in `encryptedStorage.ts:51-93` has no documents field; no attachment type in `model.ts`). Invoice PDFs can be parsed (`pdfText.ts`, `parseInvoiceFile.ts`) but only the extracted row is kept. |
| **API / MCP** | `app/controllers/api/*`, `api_key.rb`, `mcp_controller.rb` (JSON-RPC 2025-06-18, `read_write` scope, OAuth), `oauth/*` controllers | **MISSING** | Internal session-guarded JSON API only (`apps/server/src/index.ts`; `apiGuard.ts:25-33`). No API keys, tokens, webhooks (except two machine endpoints with shared secrets), no MCP server. `AGENTS.md:53` mentioning an MCP deployable is stale — no such app exists. |
| **Family / multi-entity** | `family.rb` (household moniker), `account_share.rb`, `budget_share.rb`, `invitation.rb`, `bulk_invitation.rb`, `family_document.rb`, family export | **PARTIAL (multi-entity) / MISSING (family)** | `entity` + `EntityProfile` partitions one owner's companies/household (`entities.ts:1-120`) but the whole business half is archived in the UI (`archive.ts:10-22`). Multi-tenant auth exists per user, not per household (`ADR 0004`); no sharing, invitations, or role model. |
| **Multi-currency** | `exchange_rate.rb`, `exchange_rate_pair.rb`, `currency_normalizable.rb`, multi-currency accounts/valuations | **PARTIAL** | Currency on account/tx (`model.ts:6-104`), ECB daily + 5y history (`fx.ts`, `fxHistory.ts`), convert-or-exclude mode (`fx.ts:82-131`), investing presentation-currency conversion with historical FX limits (`RISK.md:19-34`). No non-EUR presentation (EUR hard-coded in places), no per-account exchange-rate pairs, no cross-currency transfer handling. |

Additional Sure features with no matrix row but relevant to adoption: `merchant.rb` /
`family_merchant.rb` (merchant registry + enrichment), `tag.rb`/`tagging.rb` (free tags),
`transaction` splits (LaVega has no transaction split; only share splits),
`insight.rb`, `assistant`/chat with reservation model, imports framework
(`import.rb`, `import_session.rb`, `import_source_mapping.rb`), provider breadth
(~30 aggregators/brokers). LaVega deliberately has 1 bank aggregator (Enable Banking),
1 import seam, 3 brokers.

---

## 7. Integration seams and constraints

### 7.1 Effect 4 (hard rule for new logic)
- ADR 0008 (accepted 2026-10-05) makes Effect mandatory for all new TypeScript logic;
  JSX stays plain React; existing files are ported when touched, never in bulk
  (`docs/adr/0008-effect-as-typescript-standard.md:37-67,91-95`).
- Required forms: `Schema` for models/untrusted input, `Schema.TaggedError` for failures,
  `Context.Service` + static `layer` for services, `Effect.fn`/`Effect.fnUntraced` for
  reusable effects, `Effect.DateTime`, `ManagedRuntime` at Hono/entry boundaries.
- Adoption today: ~28 first-party files import `effect` (core 13, site 7,
  investing-server 5, web 4, investing-web 3, adapters 2); `effect@4.0.1` is declared in every
  package; **no `@effect/vitest` usage** — tests are plain Vitest. New Sure-derived modules
  (rules, transfers, bills, budgets) must be Effect 4 with `it.effect` tests and should set
  the pattern rather than copy surrounding plain-style files.

### 7.2 Local-first / privacy
- Hard constraints: privacy default, read-only access, no payment initiation, no secrets in
  repo (`docs/CONTEXT.md:18-22`; `PRODUCT.md:34`).
- Personal ledger plaintext must not reach the server; the server holds the sealed key but
  no code decrypts (`ADR 0009:47-55`).
- Therefore any server-rendered Sure feature (emails, push, server rules, sharing links,
  server PDFs, MCP reading the ledger) needs an explicit architecture decision *before*
  porting; client-side/worker implementations do not.
- Investing side already accepts server-readable synced holdings (encrypted at rest, RLS)
  because its contract is a hosted dashboard (`ADR 0002`, `ADR 0004`); not precedent for
  personal data.

### 7.3 Read-only
- No order placement, no PIS (`docs/CONTEXT.md:22`; `docs/investing/CONNECTORS.md:7-14`).
- Sure-derived features that would need payment initiation (bill pay, transfer execution)
  must be scoped to tracking only.

### 7.4 The `tx.id` hash constraint
- Identity = `hash(accountKey|date|amount.toFixed(2)|normalized counterparty≤40|normalized
  description≤60 + '#' + occurrence)` (`packages/core/src/hash.ts:19-45`). The same hash
  re-keys tx ids during account merge (`accounts.ts`) and backs the Kasoverzicht import
  compatibility promise (`docs/CONTEXT.md:67`).
- Do **not** add fields to `txBase`, change normalization or amount formatting without a
  migration. Optional `Tx` fields are safe (not hashed), but prefer the
  `Invoice.autoBooked` pattern (`model.ts:176-193`): an additive optional field or a sibling
  vault collection keyed by tx id. Rule ids are UUIDs (`Regels.tsx:110`); scheduled-flow ids
  hash `label` and must not be renamed in place (`model.ts:133-147`); invoice ids hash
  (`invoices.ts:6`).

### 7.5 Licence
- LaVega AGPL-3.0 (`LICENSE`); Sure AGPL-3.0 (`/tmp/sure/LICENSE:1`). Copying is compatible if
  notice and modification record travel; vendor policy: `vendor/<upstream>/` with upstream
  LICENSE, README (project, URL, commit, changes) and a root `NOTICE` entry
  (`docs/investing/STACK.md:124-132`; `NOTICE` currently lists gloomberb).
- Sure's runtime is Rails/Ruby; almost nothing is copy-pasteable into TS. Realistic reuse
  units are **domain rules, state machines, tests-as-behaviour-specs, prompt semantics** — not
  files.

### 7.6 Two sides share core
- `@lavega/core` stays pure (no I/O, browser/node globals) (`docs/CONTEXT.md:24-77,144-150`):
  new shared modules take plain data + parameters (like `asOf`), never a clock or storage.
- Storage-shaped code belongs in `packages/adapters` or `packages/database`; route/tenancy/
  consent code in the servers. A new vault field touches `encryptedStorage.ts` (`VaultData` +
  accessors) and usually `apps/web` load/save (`App.tsx:585-644`) — no blob migration, because
  the vault is whole-object AES-GCM JSON.

### 7.7 Test ownership rules
- One contract, one owner (`docs/CONTEXT.md:131-135`). Practical consequences for a Sure port:
  - Rules semantics, transfer matching, recurrence generation, budget math → tests in
    `packages/core/src/*.test.ts` only.
  - Vault persistence of the new collections → `packages/adapters/src/storage/encryptedStorage.test.ts`.
  - New HTTP routes/tenancy/consent → server tests.
  - UI behavior → component tests in `apps/web`/`apps/investing-web`.
  - Do not re-test a core contract from `apps/*`, do not add a mock-only test that proves the
    mock, do not grep source strings (`docs/reviews/2026-10-20-test-audit.md:6-14`).
- Existing infrastructure: Vitest everywhere, jsdom for web, `fake-indexeddb` for the vault.

### 7.8 Storage choice per feature
| Need | Correct seam | Wrong seam |
| --- | --- | --- |
| Personal ledger entity | `StorageAdapter`/`VaultStorage` field | Neon table (would break ADR 0009) |
| Personal file/document | new vault field or new encrypted IndexedDB store | `PriceStore`, server disk |
| Investing credentials/snapshots | `CredentialStore` (encrypted vault) | `StorageAdapter` |
| Daily prices | `PriceStore` + `investing.price_bars` | vault |
| Tenant preferences/layout | dedicated store + Neon table | localStorage (investing stores server-side by design, `investingRegistry.tsx:4-9`) |
| Server cache of public data | file/tmp or table, no user data | personal vault |

### 7.9 Serverless/deployment constraints for anything Sure-derived
- No detached background work after a response: it may never run (`STACK.md:82`;
  `app.ts:660-673`). Use the cron or an awaited call. Any new loop (bill materialization, rule
  runs, statement sync) needs a scheduler decision: exactly one production scheduler (Vercel
  cron, daily) and one local mechanism (browser interval); Sure's Sidekiq-style job graph does
  not exist here.
- New Neon table ⇒ new numbered rerunnable migration, checksummed, applied before deploy
  (`DEPLOY.md:8-85`), plus RLS and `lavega_runtime` grants (`db/runtime-role.sql`;
  `db/migrations/0004_eb_grants.sql`).

---

## 8. Where Sure-derived code should slot in (concrete)

Ordered by value/effort. Each item names the target module, the storage, the UI, the tests,
and the blocking constraint.

### 8.1 Rules engine (highest fit, lowest architectural risk)
- **Target:** extend `Rule` in `packages/core/src/model.ts:119` additively
  (`name?`, `active?`, `conditions?: RuleCondition[]`, `actions?: RuleAction[]`,
  `groupId?`, `position?`); keep `match` + `category` as the legacy single-condition form so
  existing vaults decode unchanged. New pure module `packages/core/src/rules/` with
  `Schema`-decoded `RuleCondition`/`RuleAction` and one `runRules(tx, rules, ctx)` that
  preserves current first-match-wins semantics for legacy rules (`views.ts:182-232`).
- **Storage:** rules are replace-all in the vault (`StorageAdapter.putRules`,
  `StorageAdapter.ts:8-9`); no migration. Rule ids are UUIDs, not hashes, so no id constraint.
- **UI:** `apps/web/src/views/Regels.tsx` (rendered inside `/app/transactions`,
  `App.tsx:1832`) gains condition/action editor; category choices must keep using
  `CATEGORY_OPTIONS`/`applyCategorizations` validation (`categorize.ts:375-401`).
- **Effect 4:** write the new condition/action evaluation with `Schema` + typed errors;
  call from `categorize()` via a thin adapter to keep the existing signature.
- **Tests:** core-only semantics (`packages/core/src/rules.test.ts`); one UI interaction test.
- **Sure source to read:** `rule.rb`, conditions/actions models, `rule_run.rb`; do not port
  email-action semantics (no mail sender in LaVega personal).
- **Constraint:** none beyond §7.4/§7.7.

### 8.2 Transfers / auto-match (high value, small schema decision)
- **Target:** new `packages/core/src/transfers.ts` pure module + `TransferPair` type
  (`outflowTxId`, `inflowTxId`, `status: "suggested" | "confirmed" | "rejected"`, `kind`).
  Reuse `PAIR_WINDOW_DAYS = 4` and the two-leg evidence model already in
  `crossScope.ts:345-435`; reuse merchant-token matching in `ingest.ts:40-70` for candidate
  scoring. Do not modify `Tx`.
- **Storage:** add `transfers?: TransferPair[]` to `VaultData` (`encryptedStorage.ts:51-93`)
  with `getTransfers`/`putTransfers`; replace-all like rules. No `tx.id` change: pairs are
  keyed by ids that already exist.
- **UI:** a "matches" panel on `/app/transactions` + a row badge; reuse the archived
  `crossScope` question UI patterns. Auto-confirm only exact two-leg proof (account A
  outflow + account B inflow, same amount, within window, distinct accounts); everything else
  suggested (mirrors Sure's pending/confirmed split in `transfer.rb`).
- **Also needed:** feed confirmed transfers into `consolidate()`/forecast exclusion the same
  way `Eigen overboeking` is excluded today (`views.ts:289`), so totals never change
  silently.
- **Tests:** core matching/edge cases; vault round-trip.
- **Sure source to read:** `transfer.rb`, `auto_matches_controller.rb`,
  `rejected_transfer.rb`; reuse the *rules*, not the Rails models.

### 8.3 Bills / recurring occurrences (medium value, forecast already exists)
- **Target:** new `packages/core/src/bills/` with `Bill` (`billType`, amount/currency,
  cadence, anchor day, end mode, weekend policy, account, category, merchant),
  `BillOccurrence`, `BillPriceChange`, and a pure `materializeOccurrences(bill, asOf, horizon)`.
  Keep `ScheduledFlow` as the forecast-facing projection (`scheduledFlows.ts:6-43`) so
  `forecast.ts:754` does not change; convert bills → flows in one adapter function.
- **Storage:** new vault section (e.g. `bills`, `billOccurrences`) alongside
  `scheduledFlows`; claims read the same `VaultStorage` seam.
- **UI:** `components/blocks/BetaalschemaBlock.tsx` (Overzicht) and
  `plan/sections/SubscriptionsSection.tsx`; a new Bills view under `/app` if Sure's bill
  pages are the target.
- **Departments to avoid:** Sure's installment/pay-run/payment-URL fields imply capabilities
  LaVega rejects (no payment initiation). Scope to tracking + forecast + mark-paid.
- **Scheduler:** occurrence materialization must be lazy/on-read or run when the vault
  unlocks; there is no server cron that can read the personal vault (§7.9).
- **Tests:** core cadence/end-mode/weekend matrices, migrated from Sure's own tests as
  behaviour specs; vault round-trip.

### 8.4 Budget objects (medium value)
- **Target:** extend `PlanPreferences` (`plan/preferences.ts:29-47`) with a
  `BudgetPeriod`/`BudgetLine` model (period start/end, allocation per category, rollover
  carry) and a `computeBudget` in `plan/` reading existing `SpendingFigures`. Do not replace
  `categoryLimits`; treat them as the default allocation (migration path: limits become the
  first budget period's lines).
- **Storage:** `plan` vault section already replace-all (`encryptedStorage.ts:120-130`).
- **UI:** `plan/sections/SpendingSection.tsx`, `MonthSection.tsx`.
- **Tests:** core budget arithmetic; no route tests.
- **Sure source:** `budget.rb`, `RolloverCalculator`, `budget_category.rb`.

### 8.5 Statements / document vault (medium value, but encryption design needed)
- **Target + storage:** add `documents?: VaultDocument[]` to `VaultData`
  (`encryptedStorage.ts:51-93`) or — better for size — a second encrypted IndexedDB object
  store in the same DB keyed by document id, sealed with the same key. Document record:
  `{id, kind: "statement" | "invoice" | "receipt", source, periodFrom/To, accountKey?, txIds?,
  mime, sealedBytesRef}`. Bytes must be sealed with the vault key (reuse
  `packages/adapters/src/crypto/vaultCrypto.ts`), never plaintext.
- **Importer:** the existing import path already has the file text at the seam
  (`createFileImport`, `apps/web/src/App.tsx:1269-1311`); storing the source file there is a
  small change. `parseInvoiceFile`/`pdfText` can pre-fill metadata.
- **UI:** attach/preview on Rekeningen/Transacties; Backup must include the new store or
  document references must be refused on restore (Backup currently round-trips the whole
  vault blob, so keep documents inside the blob unless size forces a separate store).
- **Constraint:** browser storage quotas; do not silently drop. A separate store needs a
  restore/export path and a decision on orphaned bytes when a vault is erased.
- **Sure source:** `account_statement.rb`, `pdf_import.rb`, `transaction_attachments_controller.rb`
  for the data shape and preview UX; not the ActiveStorage stack.

### 8.6 Reports: balance sheet / income statement (higher effort)
- **Target:** new `packages/core/src/reports/` pure aggregator over `Account` + `Tx` +
  `ScheduledFlow`, producing typed `BalanceSheet` (assets = positive account balances;
  liabilities = credit-card debt today, plus new liability kinds) and `IncomeStatement`
  (income/spend by category per period, using existing categorization + `monthlyTotals`).
- **Model gap:** `ACCOUNT_TYPES` has five values (`balance.ts:26-32`) and no
  property/vehicle/loan/other-asset concepts. Adding new `accountTypeKind` values is the
  smallest safe step; adding loan amortization is a larger model change and should follow,
  not precede, a real need.
- **Storage:** none (derived), except liability metadata on `Account` (additive optional
  fields; not part of `tx.id`).
- **UI:** extend `/app/overzicht` or add a reports view; the plan's month section already
  has period machinery (`advisor/months.ts`).
- **Sure source:** `balance_sheet.rb`, `income_statement.rb`, `period.rb`,
  `accountable_sparkline.rb` as behaviour specs.

### 8.7 API / MCP (do not start without an ADR)
- **Personal side: blocked.** Ledger plaintext never reaches the server (`ADR 0009`). An MCP
  server returning transactions needs either (a) client-side MCP (desktop/daemon talking to
  IndexedDB + key), which matches local-first, or (b) a new recorded decision to let the
  server decrypt, which contradicts ADR 0009 and is a product decision, not engineering.
- **Investing side: feasible sooner.** Data is server-readable and tenant-scoped. Add token
  auth + read-only per-token scope + a route group over the *existing* dashboard/memory read
  models; keep tenant resolution from a verified principal, never a header
  (`investing-mount.ts:76-90`). An MCP endpoint could follow
  `repos/effect/packages/effect/src/ai/McpServer.ts` (reference only; never import `repos/*`).
- **Storage:** new `investing.api_tokens` table (hashed tokens, scopes, last-used) with RLS and
  `lavega_runtime` grants, migration + deploy order per §7.9. Sure reference:
  `mcp_controller.rb` (protocol, session TTL, scope, tool shapes) and `controllers/api/*`;
  do not copy OAuth without an identity decision.

### 8.8 Family / sharing (defer)
- Needs a household/role model that does not exist: one vault key per account with per-user
  browser DBs (`ADR 0009`; `encryptedStorage.ts:29`) and investing `user_id` RLS (`ADR 0004`).
  Any design must answer whose key seals whose data, who can erase, and revocation. Defer;
  the multi-BV `entity` axis already covers the stated primary user (`PRODUCT.md:13`).
- If pursued, start with read-only sharing of *investing* tenant dashboards (server-readable,
  RLS-scoped); personal vault sharing is the hard one.

### 8.9 What *not* to port
- Sure's Rails schema/models, provider integrations, Sidekiq jobs, OAuth/SSO, vector search,
  bank-sync breadth and investment cost-basis stack: LaVega has its own seams and rejects
  those dependencies (no Rails, no job runner, one bank aggregator by contract). Sure's
  balance-sheet/income-statement *implementation* depends on its account subclasses; port
  the definitions and tests, rewrite the engine for `Account`/`Tx`/`ScheduledFlow`.

---

## 9. Top 10 highest-value gaps — personal side

1. **No transfer object or match workflow.** Evidence: heuristics only
   (`views.ts:182-205`, `crossScope.ts:345-601`); no persisted pair, no confirm/reject UI.
   Sure: `transfer.rb` + `auto_matches_controller.rb`. This distorts every total when an
   internal transfer is miscategorized and blocks a "cashflow excluding own money" guarantee.
2. **Bills are detection, not management.** Evidence: `forecast.ts:186-307`,
   `subscriptions.ts:1149-1436`, `ScheduledFlow` only (`model.ts:133-157`). No occurrence
   plan, mark-paid, price-change history, or match-rejection. Sure: whole `recurring_transaction`
   subsystem.
3. **Rules are one substring → one category.** Evidence: `model.ts:119`, `views.ts:182-232`.
   No conditions/actions/groups/order/run-history; AI can only create the same single rule
   (`categorize.ts:375-401`). Sure: full rule engine with groups and runs.
4. **No statement/receipt vault.** Evidence: `VaultData` has no document field
   (`encryptedStorage.ts:51-93`); only parsed rows persist. Sure: account statements,
   attachments, family documents. This is also the missing evidence base for reprocessing
   imports and audits.
5. **No budget object (period/allocation/rollover).** Evidence: `categoryLimits` only
   (`plan/preferences.ts:29-47`); `spending` compares to limits (`plan/spending.ts`).
   Sure: `budget.rb` + rollover calculator.
6. **No balance sheet / income statement.** Evidence: "Totale positie" is balance-sum only
   (`apps/web/src/totalePositie.ts`); `ACCOUNT_TYPES` has no liabilities/property
   (`balance.ts:26-32`); no report module. Sure: balance sheet, income statement, period,
   asset/liability models.
7. **Personal AI surface is dead in the product.** Evidence: chat widget removed/parked
   (`App.tsx:384-392`); route gated off (`agent-routes.ts:311-315`); only invoice extraction
   and bulk categorize are wired, and the invoice UI itself is archived
   (`archive.ts:10-22`). Sure: assistant/chat as a first-class surface.
8. **No household/family sharing.** Evidence: no sharing/invitation tables or routes;
   one vault key per account (`ADR 0009`); multi-BV `entity` exists but is partly archived.
   Sure: family, account_sharings, invitations.
9. **No API/MCP.** Evidence: no api-key table/route; internal session-only API
   (`apiGuard.ts`). Sure: REST API + MCP with token/OAuth surfaces. (Blocked by ADR 0009 for
   personal data — see §8.7.)
10. **No merchant registry or tags.** Evidence: no merchant/tag model in
   `packages/core/src/model.ts`; merchants exist only as substring rules
   (`categories.ts`) and a subscription `merchantKey` (`subscriptions.ts:189`). Sure:
    `merchant.rb`, `family_merchant.rb`, `tag.rb`, `tagging.rb`. This blocks saved views,
    merchant-level reports, and rule conditions beyond text.

Honourable mentions (implemented-but-hidden, not gaps of code): invoice inbox,
VAT/profit-tax set-asides, insight/attention alerts (`alerts.ts` — widget off by default),
travel/points optimisation, and the currency module — all `B` because of
`ARCHIVE_BUSINESS = true` (`archive.ts:10-22`) or default-off widgets
(`moduleRegistry.tsx:509-529`).

---

## 10. Top 10 highest-value gaps — investing side

1. **DeGiro is manual CSV only.** Evidence: `docs/investing/CONNECTORS.md:96-105`;
   `packages/adapters/src/brokers/degiro/fileImport.ts`; no scheduled adapter. Users with
   DeGiro get stale positions unless they re-export.
2. **Trading 212 cash history is always "unknown".** Evidence: `CONNECTORS.md` cash-coverage
   table (`Trading 212 | Always unknown`); `RISK.md:19-34`. Consequence: historical net
   worth, risk and returns are partial/estimated on the largest retail broker, and the
   remaining reconciliation gap persists (`RISK.md:34`).
3. **Cross-broker instrument identity is not canonical.** Evidence: ADR 0007 consequences
   (theses keyed by normalized broker symbol; `GOOGL_US_EQ` vs `ABEAd_EQ` both ISIN
   `US02079K3059`), `docs/CONTEXT.md:117`. Blocks genuinely shared thesis/goal/observation
   identity and cross-broker aggregation of identical securities.
4. **No unified true net worth across personal + investing by default.** Evidence: sharing is
   opt-in, one-way, daily totals only (`App.tsx:674-695`; `investing/personalNetWorth.ts:23-46`);
   personal liabilities/assets not modelled (§9.6). Sure's balance sheet is monthly-close
   oriented; LaVega has no equivalent single statement.
5. **No income/attribution reporting.** Evidence: dashboard/read model exposes TWR, XIRR,
   per-position return, risk, sectors (`dashboard.ts:309-336`; `benchmarks.ts:353`);
   no dividends/income report, no realized-gain report, no per-period attribution module.
   Sure: income statement + period model.
6. **One market-data provider, no hosted-tier provider implemented.** Evidence: Yahoo only
   in `packages/adapters/src/market-data/yahoo`; marketstack exists only in a test fixture
   (`providerRouter.test.ts:25`); hosted licence "subject to written confirmation"
   (`STACK.md:37`; ADR `0001`). Material for a hosted/commercial path.
7. **No alerts/notifications for investing events.** Evidence: only Sentry email alerting
   for failures (`STACK.md:92-98`); no price/risk/dividend/earnings notification surface in
   either app or server routes.
8. **No export/report output.** Evidence: only the portfolio letter (`portfolioLetter.ts`)
   and per-screen JSON routes. No PDF/CSV investor report, no tax-lot/cost-basis export for
   an accountant, no print view. Sure has family export + documents; LaVega has no report
   generator at all.
9. **Agent/tooling dependency risk is concentrated.** Evidence: System One (`@typesafe-ai/sdk`)
   for judgments, one chat-model provider with a fallback (`portfolioChat.ts:8-14`), Yahoo
   for fundamentals (24h cache). A provider outage or consent withdrawal degrades agents,
   sectors and research simultaneously; sector inference is additionally off unless a
   deployment-level classifier exists (`app.ts:473-497`).
10. **No watchlist/screening/portfolio-level research workspace.** Evidence: research is
    single-company from the Agents tab (`docs/investing/STOCK-RESEARCH.md:1-44`), no watchlist
    model, no screener, no notes outside agent memory. Sure has watchlists/insights/assistant
    breadth; this is a scope gap rather than a data gap.

Cross-cutting: multi-currency is presentation-EUR only (§6), fixed latest FX excludes
currency movements from historical risk returns (`RISK.md:19-34`), and hosted cron has a
hard per-tenant budget slice (`STACK.md:72-90`).

---

## 11. Open questions

1. **Should the personal side ship?** `PRODUCT.md:30,38` says undecided; `DEPLOY.md` ships
   `/app` today. Sure adoption priority depends entirely on this answer.
2. **Is the "business" half coming back?** `ARCHIVE_BUSINESS = true` hides four finished
   surfaces (`archive.ts:6-22`). Re-enabling is one flag, but it changes the Sure mapping
   (invoices/documents would be first-class again).
3. **Will the server ever read personal plaintext?** MCP, sharing, server-rendered reports
   and server rules all depend on it; ADR 0009 says no.
4. **What is the household model for "family"?** One login per person on a shared vault, or
   shared access to another user's encrypted data? The current key model supports neither.
5. **Which Sure features are actually wanted?** LaVega is already stronger in forecasting,
   investment analytics and risk; the defensible borrowings are workflow features.
6. **Hosted tier**: if it proceeds, marketstack/accounting and the ToS posture (`ADR 0001`)
   become blocking; Sure's provider breadth is not a shortcut.
7. **Does personal keep "no server ledger" under future sync?** A Neon storage adapter is
   contemplated as a later flip (`docs/CONTEXT.md:24-27,83`; ADR 0009:55) but none exists.

---

## 12. What this audit could not verify

- **No runtime verification**: no server, container, build, test, lint, migration or browser
  run, and no network calls. Status labels are code/doc claims only.
- **Production state**: whether `lavega.dev` serves `/app`, the Neon ledger's current count
  (DEPLOY records 24/24 on 2026-10-05, repo has 27 files), whether the cron ran, whether the
  n8n workflow is imported (`BACKLOG.md` says not yet) are outside the repo.
- **Test pass/fail and real coverage**: test files counted and sampled, not executed; some
  suites are documented as weak or partly deleted (`docs/reviews/2026-10-20-test-audit.md`).
- **Live broker/market-data behaviour**: adapter, Yahoo and cash/risk claims come from
  `CONNECTORS.md`/`RISK.md` (2026-09/10), not re-measured.
- **External deployments** (Chrome store, Cloudflare Worker, DNS/forwarding) and **Sure
  completeness** (shallow clone, sampled models) are unverified; some `B` paths may be
  reachable via undocumented deep links/flags (`appRoutes.ts:52-59`).

---

## Appendix A — key file index

| Concern | Files |
| --- | --- |
| Personal web | `apps/web/src/{appRoutes.ts,App.tsx,archive.ts,totalePositie.ts}`, `components/moduleRegistry.tsx`, `views/*` |
| Personal vault | `packages/adapters/src/storage/{encryptedStorage,StorageAdapter}.ts`, `packages/adapters/src/crypto/vaultCrypto.ts`, `apps/web/src/{vaultKey,migrate}.ts` |
| Personal domain | `packages/core/src/{model,hash,ingest,views,balance,entities,fx,forecast,subscriptions,scheduledFlows,invoices,categorize,categories,alerts,accountCosts,interest,netBenefit,travel,crossScope,tax,taxSheet,rewards,spendPercentile}.ts`; `plan/*`; `advisor/*` |
| Personal server | `apps/server/src/{index,apiGuard,auth,agent-routes,eb-routes,n8n-routes,vault-routes,net-worth-routes,account-routes,fx,fxHistory}.ts`, `apps/server/src/agent/*` |
| Investing | `packages/core/src/investing/*`, `packages/adapters/src/{brokers,market-data,prices,benchmarks}/*`, `apps/investing-server/src/*`, `apps/investing-web/src/{app.tsx,lib/*,components/*}` |
| Schema/ops/docs | `db/migrations/*.sql`, `db/runtime-role.sql`, `packages/database/src/*`, `scripts/{migrate.ts,vercel-build.mjs}`, `Dockerfile*`, `DEPLOY.md`, `docs/CONTEXT.md`, `PRODUCT.md`, `docs/adr/*`, `docs/investing/*`, `docs/BACKLOG.md` |

## Appendix B — Sure source index (domain reference, Rails)

`app/models/`: `transfer.rb` + `rejected_transfer.rb`; `rule.rb`/`rule_group.rb`/`rule_run.rb`
(+ `rule/` conditions/actions); `recurring_transaction.rb` + `recurrence_rule.rb` +
`recurring_occurrence.rb` + `recurring_price_change.rb`; `budget.rb`/`budget_category.rb`;
`goal.rb`/`goal_account.rb`/`goal_pledge.rb`; `balance_sheet.rb`/`income_statement.rb`/
`period.rb`; `holding.rb`/`investment.rb`/`trade.rb`/`valuation.rb`/`portfolio.rb`/`security.rb`;
`account_statement.rb`/`family_document.rb`/`pdf_import.rb`; `family.rb`/`account_share.rb`/
`invitation.rb`/`family_export.rb`; `merchant.rb`/`tag.rb`/`tagging.rb`.
Controllers: `auto_matches_controller.rb`, `transfer_matches_controller.rb`,
`rules_controller.rb`, `bills*`, `budgets_controller.rb`, `mcp_controller.rb`,
`api/*`, `transaction_attachments_controller.rb`.
