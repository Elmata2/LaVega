# LaVega — Project Context

_The context file for AI-assisted work on LaVega. Read this first._

## What LaVega is

A **local-first, privacy-first personal finance agent** — a "financial company brain." It consolidates all bank accounts across a multi-BV owner's entities into one read-only overview, adds planning/forecasting, and (over time) an agent layer that integrates with everything.

**Owners:** Alexander (Generation C, `alexander@generation-c.nl`) + cofounder. Alexander owns the **personal** proposition; the cofounder owns the **investing** proposition; they share the aggregation core.

**Origin:** a clean-room restart of a discontinued product (FinnTell). See "Hard constraints" — no code/assets from that carry over.

## Vision

- **Now:** aggregation dashboard for own use (personal), plus the investing proposition.
- **Later:** a financial company brain — integrate with everything; deterministic cashflow planning; eventually a possible commercial/hosted path (up to acquisition, e.g. Stripe). Build for ourselves first; commercialize only once it works on our own data.

## Hard constraints (non-negotiable)

1. **No FinnTell reuse.** No code, export, domain, or asset from the old FinnTell / House-of-Founders environment. New name, new repo, new everything. Only the _ideas, market knowledge, and interview insights_ are ours to keep. (The Kasoverzicht restart app is clean-room and _is_ a valid basis — its logic may be re-implemented here.)
2. **Privacy / local-first by default.** No cloud, account, or tracking by default. Bank data stays on the machine except to the aggregator API itself. **Secrets (private keys, tokens, bank data) NEVER in the repo** — verify `.gitignore` before the first commit.
3. **Read-only bank access, no payment initiation (PIS).** Keeps us in the lightest PSD2 class — no own license required. Do not add PIS.

## Architecture — deployment-agnostic, adapter-based

The domain logic is pure and portable. **Storage** and **bank access** sit behind interfaces, so LaVega runs fully local now and flips to hosted later with no rewrite.

```
lavega/
├── packages/
│   ├── core/          # pure domain logic, no I/O, fully tested
│   │   ├── model/     # account & tx types + the tx.id dedup hash
│   │   ├── parsers/   # MT940 / CAMT.053 / CSV bank profiles
│   │   ├── ingest/    # normalize → dedup → consolidate per entity
│   │   ├── personal/  # Alexander's domain module
│   │   └── investing/ # cofounder's domain module
│   └── adapters/
│       ├── storage/   # StorageAdapter → Local (IndexedDB) now · Postgres later
│       ├── banking/   # BankAccess → FileImport · EnableBanking · finAPI
│       └── brokers/   # BrokerAccess → DeGiro · IBKR · Trading 212
├── apps/
│   ├── web/           # Vite + React dashboard (personal); `/` landing, `/app/<view>` vault
│   ├── server/        # Hono API: local sync now → hosted backend later (same code)
│   ├── investing-web/    # investing dashboard
│   └── investing-server/ # investing API
├── docs/CONTEXT.md    # this file
└── LICENSE (AGPL-3.0), README
```

### Datamodel (preserved from the Kasoverzicht clean-room app — do not change without a migration)

```ts
account = { key, iban, name, bank, entity, currency, balance };
tx = {
  id,
  accountKey,
  date /* ISO YYYY-MM-DD */,
  amount /* negative = outflow */,
  currency,
  counterparty,
  description,
  category,
  manual,
};
```

`tx.id = hash(accountKey|date|amount|counterparty|description + '#' + n)` where `n` counts occurrences within one import. This dedupes overlapping exports while keeping genuinely identical same-day transactions. **Preserving this hash means the existing Kasoverzicht back-up JSON imports cleanly.**

> **Known limitation — import one format per account.** Dedup keys on `accountKey` + `counterparty`/`description`, which differ between a bank's CSV and its MT940 export (e.g. ABN keys the CSV by BBAN `0123456789` but MT940 by IBAN `NL91ABNA0417164300`, and the two formats extract counterparty/description differently). So importing the _same account_ via **both** CSV and MT940 double-counts its transactions and splits it into two accounts. Import each account in a single format. True cross-format dedup would need IBAN/BBAN key canonicalisation + shared counterparty/description extraction — a later normalisation pass, out of scope for the current importer.

### Adapter contracts (the seams that make it deployment-agnostic)

- `StorageAdapter` — CRUD for accounts / txs / rules / maps. Impl now: IndexedDB. Later: Postgres. Core never imports a concrete storage.
- `BankAccessAdapter` — returns `{ accounts, txs, source, problems }` (exactly what `ingest()` expects). Per-account failures go in `problems` so one broken link doesn't block the rest. Impls: `FileImport` (MT940/CAMT/CSV, always offline), `EnableBanking`, `finAPI`.
- `ingest()` is the **single** entry path for all data, file or API.

## Stack

- pnpm workspaces + workspace deps (`@lavega/*`), resolved via `moduleResolution: bundler`; no TypeScript project references
- **UI:** Vite + React (`apps/web`)
- **Server:** Hono (`apps/server`) — portable across Node/edge/cheap hosting
- **Storage:** IndexedDB adapter now → Postgres adapter later
- **Tests:** Vitest
- **Lint / format:** oxlint + oxfmt at repo root (Turborepo root tasks `//#lint`, `//#format`). No ESLint/Prettier. Config: `.oxlintrc.json`, `.oxfmtrc.json`. Scripts: `pnpm lint`, `pnpm lint:fix`, `pnpm format`, `pnpm format:fix`, `pnpm quality`.
- **License:** AGPL-3.0 (open, but blocks a competitor hosting a SaaS off the code)

## Bank access

- **Enable Banking** first, against the **sandbox** we have access to. JWT RS256 (`node:crypto`), routes for aspsps/auth/callback/sync/forget, pagination via `continuation_key`, prefer `CLBD` balance. Re-implement cleanly in TS from the Kasoverzicht `server.mjs` logic (clean-room, permitted).
- **finAPI** second (client-credentials → user token; webform response varies by version).
- **File import** always available offline: MT940/.STA, CAMT.053, CSV with per-bank profiles (ING, Rabobank, ABN tab-no-header, Knab, Revolut, Amex, Trading 212). Amex expenses may be positive → "invert amounts" option. Trading 212's **CSV export** = cashflows only (deposits/withdrawals/dividends), not securities trades — its **API** does expose trades, see `docs/investing/CONNECTORS.md`.

## Broker access (investing)

Specified in **`docs/investing/CONNECTORS.md`** — `BrokerAccessAdapter` contract, per-broker auth/sync/risk for DeGiro, Interactive Brokers and Trading 212, and the credential-persistence rules. Read it before touching `packages/adapters/src/brokers/`.

## Portfolio agents (investing)

Specified in **`docs/investing/PORTFOLIO-AGENTS.md`** — investor-persona backend based on `virattt/ai-hedge-fund`: persona registry, portfolio snapshot, OpenAI-compatible model routing, and normalized JSON insights. Read it before touching `apps/investing-server/src/portfolioAgent.ts` or `/api/agents/portfolio`.

## Investing stack

Specified in **`docs/investing/STACK.md`** — the investing side's own stack, diverging deliberately from the personal side's in several places: `apps/investing-web` runs shadcn/ui (Tailwind + Radix) rather than hand-written CSS; the hosted tier runs on Cloudflare Workers rather than local Docker; local/self-hosted price data defaults to Yahoo Finance, an unofficial API used against its Terms of Service (see [ADR 0001](adr/0001-yahoo-finance-default-price-source.md)). Read it before touching `packages/core/investing/`, `apps/investing-web`, or `apps/investing-server`.

### Investing glossary

- **Position detail** — the view for one instrument, including current or historical holding state, price history, activity, and return facts.
- **Activity** — dated broker events for one instrument: trades and dividends. Several events can share one date without an invented order when timestamps are unavailable.
- **Quantity history** — dated changes in held units, used to explain partial buys and sells. It is an expandable detail, not a separate position.
- **Closed position** — an instrument with zero current quantity but retained trade or dividend history. It remains addressable through its detail route.

## Conventions

- Dutch in the UI, English in code identifiers.
- Amounts always negative for outflow, regardless of source.
- Dates always `YYYY-MM-DD`. Account key = IBAN if available, else filename-derived (Amex, T212).

## Testing discipline

Port Kasoverzicht's parser suite into Vitest: synthetic export fixtures per bank + MT940, asserting DBIT/CRDT sign, value-date fallback, merged remittance info, CLBD balance, pagination. Run after any parser/mapping change; add a fixture _before_ a new bank profile.

## Roadmap

1. **Feature #1 (this build):** aggregation dashboard — port the engine + five views, IndexedDB storage, file-import + Enable Banking (sandbox).
2. **Deterministic cashflow forecast (30/60/90 days)** on recurring items — validate on own history, **no ML**. _This is the wedge: interviews said the real need is planning, not overview, and Excel is the competitor — "prove you forecast more accurately than I do."_
3. Personal module (Alexander) + Investing module (cofounder) build-out.
4. Later: hosted deployment (flip the adapters), multi-user, broad integrations, AI payments.

## Don't do

- No FinnTell code/asset reuse. No PIS. No secrets in the repo.
- Don't let `core/` import I/O or a concrete adapter — keep the seams clean.
- Don't change `tx.id` without a migration.
- Don't drop the local-first default without a deliberate, recorded decision.
- Investing local tier must never require a LaVega account, a LaVega-run service, or any key of ours — self-hoster brings their own broker credentials and their own LLM/market-data keys, full stop. Hosted paid tier is additive only (issue #27).
- Don't add features, abstractions, or error handling for cases that can't happen — build the simplest thing that serves the current feature.
