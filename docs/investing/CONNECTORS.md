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

`Position` and `Trade` land in `packages/core/investing/`. `Trade` carries an `id` computed the same way `tx.id` is — a hash over the identifying fields plus an occurrence counter — because scheduled syncs re-fetch overlapping windows and would otherwise double-count. Follow `packages/core/src/hash.ts`; do not invent a second hashing scheme.

## Credentials & secrets

Local-first by default, inherited unchanged from the personal side ([#5](https://github.com/Elmata2/LaVega/issues/5)): the user brings their own broker credentials, nothing routes through LaVega-run infrastructure, and no secret ever enters the repo. No broker in v1 needs an exception to this.

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

> **Confirm on build:** DeGiro's export is assumed to include trade-level order history, not just a positions snapshot. This wasn't verified against DeGiro's own documentation while writing this spec — confirm against a real export before implementing the parser, and adjust the "Data" line above if it only covers positions.

**Hosted/cloud tier:** DeGiro's CSV import works there too — file upload has no custody problem the way credentials would, so this isn't local-only ([#25](https://github.com/Elmata2/LaVega/issues/25)).

**Deferred:** driving DeGiro's real web UI (local Playwright) to get live, scheduled sync without a manual export step is real future work, not part of v1. See [Future work](#future-work).

## Interactive Brokers

**Status: official API, no local gateway.**

The obvious retail paths — Client Portal Web API and the TWS API — both require a persistently-running local process plus manual daily or weekly browser re-auth, with no supported automation ([#8](https://github.com/Elmata2/LaVega/issues/8)). **This adapter sidesteps both** ([#11](https://github.com/Elmata2/LaVega/issues/11)).

**Approach:** IBKR's official **Flex Web Service** — token + numeric Query ID, no browser session login, no always-on local process, no re-auth ritual. The trade-off is near-real-time data for a report that refreshes daily server-side, which is fine given the sync cadence below.

**Query shape:** one combined Flex Query with both **Open Positions** and **Trades** sections under a single Query ID — one token, one fetch, mapping directly onto `{positions, trades, source, problems}`.

**Sync model: scheduled, automatic, daily (end of day).** No lockout to protect against, and the report's own refresh cadence is a daily ceiling regardless, so manual-only would add friction for no benefit.

**Fetch flow:** Flex is two-step — `SendRequest` returns a reference code, then `GetStatement` must be polled with that code until the report is ready. The adapter polls synchronously with backoff inside `sync()`, timing out at ~30–60s; a timeout surfaces via `problems[]`. Blocking is acceptable because this runs on a schedule, not behind a user-facing click.

**Dependency:** `fast-xml-parser` (new). The Flex report is flat but attribute-based (`<OpenPosition symbol="..." position="..." />`) — not worth hand-rolling.

**Setup (user-facing):** in IBKR's Client Portal, create a Flex Query containing the Open Positions and Trades sections, then generate a Flex Web Service token. LaVega needs the token and the Query ID.

## Trading 212

**Status: official API, in beta.**

Trading 212 does have an official public API (`https://docs.trading212.com/api`), self-service key generation from inside the app, no waitlist ([#9](https://github.com/Elmata2/LaVega/issues/9)). Scoped to Invest and Stocks ISA accounts; multi-currency accounts unsupported, values come back in the primary account currency.

**This corrects a line in `docs/CONTEXT.md`:** "Trading 212 = cashflows only, not securities trades" is true of Trading 212's **CSV export**, but *not* of its API, which exposes real order history via `GET /api/v0/equity/history/orders` (cursor-paginated via `nextPagePath`, similar in shape to the Enable Banking `continuation_key` pattern already in this codebase).

**Auth:** HTTP Basic, `API_KEY:API_SECRET` base64-encoded. Optional IP restriction on the key.

**Sync model: scheduled, automatic, daily.** Deliberately coarse — per-endpoint numeric rate limits are still unconfirmed, so staying daily avoids tripping an unknown ceiling. Revisit the interval once limits are confirmed.

**Relationship to file import: complement, not replace.** The Trading 212 CSV path stays available (cashflows-only, always offline, per `docs/CONTEXT.md`'s file-import conventions). The API adapter sits alongside it — strictly more capable, since it adds real trade history — but nothing forces migration off CSV. The user picks the source.

**Open items carried into implementation.** None of these change the shape decided above; all three are confirm-on-build:
- exact positions/holdings endpoint name and fields (referenced in the docs but not confirmed from source)
- per-endpoint numeric rate limits
- whether a read-only key scope exists (drives the risk-disclosure gate above — the key format looks trade-capable)

---

## Future work

Deliberately **not** specified here. Named so the next effort knows where the edges are:

- **Instrument enrichment layer** — industry, sub-industry, company size, fundamentals, fed by a market-data provider. Feeds the intended intelligent-agent portfolio-analysis layer. Explicitly split out of the broker adapter ([#4](https://github.com/Elmata2/LaVega/issues/4)); a broker is not a market-data source.
- **Additional brokers** — Revolut Invest, Bux, eToro and others are wanted, deferred until the big-three adapters prove the interface ([#3](https://github.com/Elmata2/LaVega/issues/3)).
- **Sync scheduling mechanism** — DeGiro is manual (file upload), IBKR and Trading 212 are both daily-scheduled. Whether one shared scheduler drives them or each adapter self-schedules is still open.
- **DeGiro local-Playwright automation** — live, scheduled sync driving DeGiro's real web UI instead of manual CSV export, deferred out of v1 ([#33](https://github.com/Elmata2/LaVega/issues/33)). Research already done: `docs/investing/research/browser-infrastructure.md` ([#19](https://github.com/Elmata2/LaVega/issues/19)).
- **`apps/investing-web` UI/UX** — this spec is connectors only.
- **Hosted/cloud tier** — a standing directional constraint (any hosted tier is additive, never required), not a decision this spec makes.
