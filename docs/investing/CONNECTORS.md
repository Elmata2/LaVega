# LaVega — Broker Connectors

_The spec for the investing proposition's broker integrations. Read `docs/CONTEXT.md` first — this file assumes it._

Charted via the [Investing connector strategy](https://github.com/Elmata2/LaVega/issues/1) wayfinder map. Every decision below links to the ticket that made it.

## Scope

Three brokers in v1 — **DeGiro**, **Interactive Brokers**, **Trading 212** — no priority order among them ([#3](https://github.com/Elmata2/LaVega/issues/3)). Each gets one adapter behind a shared `BrokerAccessAdapter` seam, mirroring how `BankAccessAdapter` sits behind bank access on the personal side.

Adapters pull **positions and trade history**. They do not enrich instruments (industry, sector, fundamentals) — that's a separate future layer, see [Future work](#future-work).

Read-only throughout. No order placement, no PIS — the whole-app hard constraint from `docs/CONTEXT.md` holds here, and each adapter's client surface is deliberately locked to read endpoints even where the upstream API exposes more ([#10](https://github.com/Elmata2/LaVega/issues/10)).

## Where the code lives

```
apps/
├── investing-web/                      # investing dashboard (Vite + React)
└── investing-server/                   # investing API (Hono)
packages/
├── core/investing/                     # investing domain module
└── adapters/src/brokers/
    ├── BrokerAccessAdapter.ts          # the contract
    ├── degiro/
    ├── ibkr/
    └── trading212/
```

`apps/web` and `apps/server` (the personal side) are **not renamed** — the `investing-` prefix keeps the two trees unambiguous for search and avoids merge conflicts with Alexander's work ([#2](https://github.com/Elmata2/LaVega/issues/2)).

Adapters nest under `packages/adapters/src/`, matching the existing `banking/`, `rates/`, `crypto/`, `storage/` convention ([#11](https://github.com/Elmata2/LaVega/issues/11)).

## The `BrokerAccessAdapter` contract

Narrow, and shaped exactly like `BankAccessAdapter` ([#4](https://github.com/Elmata2/LaVega/issues/4)):

```ts
export type BrokerResult = {
  positions: Position[];
  trades: Omit<Trade, "id">[];
  source: string;
  problems: string[];
};

export interface BrokerAccessAdapter {
  sync(input: { entity: string }): Promise<BrokerResult>;
}
```

`sync()` rather than `load()` because most broker paths here are API-driven, not file-driven — there is no `{filename, text}` to pass. DeGiro is the exception: it goes through `FileImport`, the same seam `BankAccessAdapter` already uses for its statement profiles, not through `BrokerAccessAdapter.sync()`. See [DeGiro](#degiro).

Per-broker failures go in `problems` so one broken connection doesn't block the rest, exactly as `BankAccessAdapter` does it. An adapter that can't reach its broker returns a `BrokerResult` with empty arrays and a populated `problems`; it does not throw.

`Position` and `Trade` land in `packages/core/src/investing/`. Positions carry the broker symbol, quantity, average/market price, market value, currency, and statement date. Trades carry ISO date, symbol, buy/sell side, quantity, price, amount, currency, commission, and an optional broker trade ID. Monetary values use the instrument/trade currency; quantities use broker units. `Trade` carries an `id` computed by `assignTradeIds` using the same hash and occurrence-counter pattern as bank transactions. Adapters return `Omit<Trade, "id">[]`; core stamps IDs after combining adapter results.

## Credentials & secrets

Local-first by default, inherited unchanged from the personal side ([#5](https://github.com/Elmata2/LaVega/issues/5)): the user brings their own broker credentials, nothing routes through LaVega-run infrastructure, and no secret ever enters the repo. No broker in v1 needs an exception to this.

Hosted credential storage is tenant-bound. The same signed-in user id must reach the credential write, the scheduled sync preflight, and the credential-aware adapter lookup; falling back to `local` inside one of those steps makes Neon reject the vault as belonging to another tenant. Each tenant may store its own IBKR and Trading 212 credentials independently.

If a hosted credential row cannot be decrypted with the configured server key, the dashboard and reconnect form must still load. Sync can report the unreadable row as a broker problem, but status reads treat it as reconnectable state so a user can save fresh broker credentials.

**Whether credentials are persisted differs per broker, and the reason is lockout risk, not convenience:**

| Broker | Persisted? | Why |
|---|---|---|
| DeGiro | N/A | No login. v1 is manual CSV import — the user exports their own portfolio/transaction file from DeGiro's web app and uploads it. No credentials touch LaVega at all ([#25](https://github.com/Elmata2/LaVega/issues/25)). |
| Interactive Brokers | Yes, locally | Flex token + Query ID only fetch a pre-defined report. There is no login they can trigger, so DeGiro's reasoning doesn't transfer ([#11](https://github.com/Elmata2/LaVega/issues/11)). |
| Trading 212 | Yes, locally | API key, no lockout mechanism. Same reasoning as IBKR ([#12](https://github.com/Elmata2/LaVega/issues/12)). |

## Risk-disclosure gates

One of the three adapters ships behind a **one-time consent checkbox** shown before the first sync, persisted locally so it doesn't re-nag. The UI gate is the one that matters; the same text is mirrored here for self-hosting users reading the docs.

- **Trading 212** — "This key may be able to place trades if its scope isn't read-only. Verify the scope in the Trading 212 app before granting."
- **Interactive Brokers** — no gate. Official API, no lockout risk. Setup instructions only.
- **DeGiro** — no gate. No login, no API call, nothing to consent to — the user is just uploading a file they exported themselves ([#25](https://github.com/Elmata2/LaVega/issues/25)).

---

## DeGiro

**Status: manual CSV import. No login, no API, no automation in v1** ([#25](https://github.com/Elmata2/LaVega/issues/25)).

DeGiro has **no official API** — its own helpdesk states third-party scripts and API wrappers violate its terms ([#7](https://github.com/Elmata2/LaVega/issues/7)), and driving DeGiro's UI (local Playwright or otherwise) has its own account-lockout and credential-custody problems ([#19](https://github.com/Elmata2/LaVega/issues/19)). v1 sidesteps all of that: the user exports their own portfolio/transaction data from DeGiro's web app and uploads it, the same way bank statements reach `BankAccessAdapter` today.

**Approach:** reuse the `FileImport` seam, not `BrokerAccessAdapter.sync()`. A DeGiro import profile parses the exported file into `{positions, trades}`, mirroring how `BankAccessAdapter` already has MT940/CAMT/CSV bank profiles behind the same `{filename, text}` shape. No credentials, no session, nothing to store or re-enter.

**Auth:** none. There is no login step in this adapter at all.

**Sync model: manual, user-triggered file upload.** No scheduling, no polling — there's no session to keep alive or lock out.

**Data:** both positions and full transaction/order history, from DeGiro's own account/portfolio export.

> **Verified for #47/#49:** DeGiro exports are semicolon-delimited CSV files. Transaction exports contain Date/Datum, Product, ISIN, Quantity/Aantal, Price/Koers, Total/Totaal, Currency/Valuta, transaction-cost and Order ID columns. Portfolio exports contain Product/ISIN (and often Symbol), Amount/Quantity, Price and Value columns, with optional Currency and export date. Portfolio price is treated as market price; absent average price and value fields remain null. Cash-flow exports have no product/order fields and are reported as cashflow-only.

**Hosted/cloud tier:** DeGiro's CSV import works there too — file upload has no custody problem the way credentials would, so this isn't local-only ([#25](https://github.com/Elmata2/LaVega/issues/25)).

**Deferred:** driving DeGiro's real web UI (local Playwright) to get live, scheduled sync without a manual export step is real future work, not part of v1. See [Future work](#future-work).

## Interactive Brokers

**Status: official API, no local gateway.**

The obvious retail paths — Client Portal Web API and the TWS API — both require a persistently-running local process plus manual daily or weekly browser re-auth, with no supported automation ([#8](https://github.com/Elmata2/LaVega/issues/8)). **This adapter sidesteps both** ([#11](https://github.com/Elmata2/LaVega/issues/11)).

**Approach:** IBKR's official **Flex Web Service** — token + numeric Query ID, no browser session login, no always-on local process, no re-auth ritual. The trade-off is near-real-time data for a report that refreshes daily server-side, which is fine given the sync cadence below.

**Query shape:** one combined Flex Query with **Open Positions**, **Trades**, **Cash Report**, and **Statement of Funds** sections under a single Query ID. One token and one fetch now supply positions, trades, per-currency ending-cash anchors, deposits, withdrawals, interest, fees, other cash movements, and dividends. Existing token and Query ID setup stays unchanged.

**Sync model: scheduled, automatic, daily (end of day).** No lockout to protect against, and the report's own refresh cadence is a daily ceiling regardless, so manual-only would add friction for no benefit.

**Fetch flow:** Flex is two-step — `SendRequest` returns a reference code, then `GetStatement` must be polled with that code until the report is ready. The adapter polls synchronously with backoff inside `sync()`, timing out at ~30–60s; a timeout surfaces via `problems[]`. Blocking is acceptable because this runs on a schedule, not behind a user-facing click.

**Dependency:** none. Flex reports used by the adapter are flat, attribute-based rows (`<OpenPosition symbol="..." position="..." />` and `<Trade ... />`). A small parser handles those rows, XML entities, IBKR's `YYYYMMDD;HHMMSS` date format, and per-row problems without adding an XML runtime dependency.

**Setup (user-facing):** in IBKR's Client Portal, create a Flex Query containing the Open Positions, Trades, Cash Report, and Statement of Funds sections, then generate a Flex Web Service token. LaVega needs the token and the Query ID. Statement duplicates use IBKR transaction identities when available. Dividend rows remain dividend records and are not also emitted as cash flows.

## Trading 212

**Status: official API, in beta.**

Trading 212 does have an official public API (`https://docs.trading212.com/api`), self-service key generation from inside the app, no waitlist ([#9](https://github.com/Elmata2/LaVega/issues/9)). Scoped to Invest and Stocks ISA accounts; multi-currency accounts unsupported, values come back in the primary account currency.

**This corrects a line in `docs/CONTEXT.md`:** "Trading 212 = cashflows only, not securities trades" is true of Trading 212's **CSV export**, but *not* of its API, which exposes real order history via `GET /api/v0/equity/history/orders` (cursor-paginated via `nextPagePath`, similar in shape to the Enable Banking `continuation_key` pattern already in this codebase).

**Auth:** HTTP Basic, `API_KEY:API_SECRET` base64-encoded. Optional IP restriction on the key. Confirmed against the published spec.

**Rate limits: confirmed, per endpoint, and tight.** Taken from Trading 212's OpenAPI description ([`api.json`](https://docs.trading212.com/_spec/api.json)); limits apply per account *and* per IP.

| Endpoint | Limit |
|---|---|
| `GET /api/v0/equity/history/orders` | 6 req / 1m |
| `GET /api/v0/equity/history/dividends` | 6 req / 1m |
| `GET /api/v0/equity/history/transactions` | 6 req / 1m |
| `GET /api/v0/equity/positions` | 1 req / 1s |
| `GET /api/v0/equity/account/summary` | 1 req / 5s |
| `GET /api/v0/equity/metadata/instruments` | 1 req / 50s |

Every response carries `x-ratelimit-limit`, `-period`, `-remaining`, `-reset` (Unix seconds) and `-used`. **Trading 212 does not send `Retry-After`**, so `x-ratelimit-reset` is the only header that says when a window reopens — an adapter that backs off exponentially instead gives up seconds into a 60-second window. The adapter paces itself off `-remaining`/`-reset` and waits through every required window **unless** a host deadline (`INVESTING_SYNC_BUDGET_MS`) would be overrun; then it stops and resumes. Repeated real HTTP 429 responses still produce `retryAfter` so scheduler can stop rejected requests. Runtime exposes pages, orders read, positions read, and current provider wait through broker-sync status API for UI progress.

**Paging:** `limit` defaults to 20 and maxes at 50. Always request 50 — the default costs 2.5x the requests for the same history against a 6-per-minute budget.

A first history is tens of pages. On Vercel the function `maxDuration` is 300s and the adapter stops ~60s before that (`INVESTING_SYNC_BUDGET_MS`, default 240s on the hosted tier, 45s when `VERCEL` is set without a budget). It does **not** sleep a 60s provider window that would overrun the host; it returns the pages already read, a `resume` cursor (`ordersNextPagePath`), and `retryAfter`. The next invocation continues from that cursor instead of restarting page one. Positions and account summary run first so a cut-off run still persists live holdings and cash. A holdings or account-summary failure (`positionsComplete` / `cashBalancesComplete` false) does not replace last-good rows with empty arrays, and does not set `lastSyncedAt`, so the next open retries those endpoints.

**Cash history:** `GET /api/v0/equity/account/summary` anchors available cash. Transaction and dividend endpoints follow every returned `nextPagePath` without date assumptions, deduplicate stable `reference` values, and persist normalized records in encrypted broker snapshots. They start only after order history is complete, so a resumed run does not spend the 6/min budget on a second stream while trades are still incomplete. Malformed rows and incomplete pagination become visible problems. A partial sync merges the pages it did read into the last snapshot and does not replace a complete history with a truncated one. `TRANSFER` direction, provider sign behavior, and account-specific retention still require one sanitized live-response check. Until then, ambiguous transfers are not invented, and non-zero `inPies` or `reservedForOrders` prevents treating `availableToTrade` as total cash.

**Sync model: scheduled, automatic, daily.** Deliberately coarse and paced by confirmed limits above. Sync state (`lastSyncedAt`, rate-limit cooldown, and any unfinished `resume` cursor) is persisted, so a restart or a Vercel invocation boundary does not turn into a fresh full sync.

**Relationship to file import: complement, not replace.** The Trading 212 CSV path stays available (cashflows-only, always offline, per `docs/CONTEXT.md`'s file-import conventions). The API adapter sits alongside it — strictly more capable, since it adds real trade history — but nothing forces migration off CSV. The user picks the source.

**Open items carried into implementation.**
- ~~per-endpoint numeric rate limits~~ — confirmed, see the table above.
- ~~exact positions/holdings endpoint name~~ — confirmed as `GET /api/v0/equity/positions`, returning a bare `Position[]`.
- ~~response field names and trade granularity~~ — mapped against the published schemas. `GET /api/v0/equity/history/orders` emits one LaVega trade per `HistoricalOrder.fill`, because fills are the executed units and carry execution price/time; `amount` is `fill.price * fill.quantity`, not `order.filledValue`, so partial fills are not double-counted. `GET /api/v0/equity/positions` maps `averagePricePaid` and `walletImpact.currentValue`; schema mismatches become `problems[]` entries.
- sanitized live-response verification for transaction signs, transfer direction, and retained history depth.
- whether a read-only key scope exists (drives the risk-disclosure gate above — the key format looks trade-capable). The spec does show per-scope 403s (`history:orders`, `portfolio`), so scopes exist; whether a read-only set can be granted is still unconfirmed.

---

## Future work

Deliberately **not** specified here. Named so the next effort knows where the edges are:

- **Instrument enrichment layer** — industry, sub-industry, company size, fundamentals, fed by a market-data provider. Feeds the intended intelligent-agent portfolio-analysis layer. Explicitly split out of the broker adapter ([#4](https://github.com/Elmata2/LaVega/issues/4)); a broker is not a market-data source.
- **Additional brokers** — Revolut Invest, Bux, eToro and others are wanted, deferred until the big-three adapters prove the interface ([#3](https://github.com/Elmata2/LaVega/issues/3)).
- **Sync scheduling mechanism** — resolved: one shared Cron Trigger on the hosted tier, app-open sync (gated by `lastSyncedAt`) on the local tier. See `docs/investing/STACK.md`'s Hosting & runtime section ([#31](https://github.com/Elmata2/LaVega/issues/31)).
- **DeGiro local-Playwright automation** — live, scheduled sync driving DeGiro's real web UI instead of manual CSV export, deferred out of v1 ([#33](https://github.com/Elmata2/LaVega/issues/33)). Research already done: `docs/investing/research/browser-infrastructure.md` ([#19](https://github.com/Elmata2/LaVega/issues/19)).
- **`apps/investing-web` UI/UX** — this spec is connectors only.
- **Hosted/cloud tier** — a standing directional constraint (any hosted tier is additive, never required), not a decision this spec makes.
