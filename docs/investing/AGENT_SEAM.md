# LaVega — In-Product Investing Agent Seam

Decision for [#26](https://github.com/Elmata2/LaVega/issues/26). This is a reserved seam, not an agent build.

## Decision

The investing agent is a **server-side, opt-in, read-only chat feature**. It uses the existing `apps/server/src/agent/` pattern: server holds the model key, streams answers to the browser, and sends only scoped portfolio data after consent.

No browser BYOK path. No direct model calls from React. No agent reads from IndexedDB or React state directly.

## Runtime

Use direct `@anthropic-ai/sdk` first, because it is already the monorepo pattern and already has key custody, redaction, rate-limit, and SSE routes.

When the investing agent needs real tools, add Anthropic Tool Runner to the server agent path rather than hand-rolling a tool loop.

Do not use for this seam:
- Pi or harness agents: coding tools, wrong product shape.
- Eve/LangGraph/Mastra: more runtime than this feature needs.
- Vercel AI SDK: optional later only if UI streaming code becomes worth deleting.

## Tool surface

The agent gets **tool functions**, not database access.

Required first tools:

```ts
get_positions(input: { entity?: string; asOf?: string })
get_trades(input: { entity?: string; from: string; to: string; instrumentId?: string })
get_price_history(input: { instrumentId: string; from: string; to: string; currency?: string })
```

Implementation rule:

```
agent tool -> server route/tool runner -> investing service -> packages/core/investing query -> storage/market adapter
```

Never:

```
agent tool -> React component state
agent tool -> raw storage query
agent tool -> broker adapter login/sync
```

`packages/core/investing/` must own the domain query shape and calculations. UI and agent must call the same domain queries. React components may format results, but must not be the only place portfolio facts are computed.

## Data ownership

Keep these types in `packages/core/investing/`:
- `Position`
- `Trade`
- `Instrument`
- `PricePoint`
- portfolio query inputs/outputs

Keep provider I/O behind adapters:
- broker sync in `packages/adapters/src/brokers/`
- price/market data in a future `packages/adapters/src/market-data/`
- storage behind existing `StorageAdapter` or an investing-specific extension of it

## API key custody

The model API key lives only in server runtime config.

Self-hosted tier answer: user must run `apps/server` (or future `apps/investing-server`) and set `ANTHROPIC_API_KEY` there. If no server exists, the investing agent is unavailable.

Hosted tier answer: hosted server holds the operator/user key according to future billing model. Browser still never sees it.

Rejected: browser-stored API key. It exposes key through JS/devtools/XSS and breaks local-first privacy expectations.

## Inference location

Inference runs in the Hono server process that owns the key.

Node/serverful is the safe default for tool loops that can fetch trades and price history. Edge is allowed only if its runtime limits can support streaming plus tool iterations without truncation. Do not make edge-only APIs a requirement.

## Privacy gate

Investing agent is default OFF.

Before first use, show one-time explicit consent:

> The investing assistant sends selected portfolio data to the model provider to answer your question. Use only if you accept this data leaving this device/server boundary.

Per request:
- send only tool results needed for the user question
- read-only tools only
- no order placement tools
- no broker credential access
- no server-side conversation persistence by default
- rate-limit like existing agent routes

## Must not foreclose

Future decisions must keep these true:

1. `packages/core/investing/` contains reusable portfolio queries, not UI-only calculations.
2. Broker adapters remain sync-only data sources; agent does not call them for live login.
3. Price history has an adapter seam; no provider-specific schema leaks into prompts.
4. Browser never receives the model API key.
5. Local/self-hosted mode can disable the agent without disabling the dashboard.
6. Hosted mode can add metering/billing without changing domain query contracts.
7. Read-only constraint stays intact: no trading, no PIS, no order tools.
8. Consent is required before portfolio data reaches a model provider.
