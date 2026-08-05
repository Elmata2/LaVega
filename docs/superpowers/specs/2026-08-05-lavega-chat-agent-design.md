# LaVega Chat Agent — Design & Spec

> Brainstormed 2026-08-05. Owner decisions: (1) agent sees only the CURRENT TAB's minimal data, opt-in; (2) drop hardcoded "indicatief" tables — agent fetches realtime via web search; (3) model = Sonnet 5 + web search. Reuses the Phase-2c server LLM proxy (server-side ANTHROPIC key, redaction boundary, rate limiter).

## Answer up front
A floating **"LaVega" chat widget** (bottom-right, every tab). Each tab has its own **`.md` instruction file** (system prompt) + a **minimal per-tab context** the client sends. The agent answers the owner's questions using (a) that tab's real app data and (b) **live web search** for anything external/realtime (FX provider fees, point values, rates, deadlines). All "indicatief" estimates are removed from the static UI — realtime is the agent's job. Dormant until `ANTHROPIC_API_KEY` is set; every send is opt-in + consented.

## Privacy contract (hard)
- **Opt-in, per use.** The widget is inert until the owner enables the assistant (a one-time consent, persisted). Nothing is sent without an explicit chat message.
- **Per-tab minimal context.** Each message carries ONLY the current tab's scoped, allowlisted slice — never the full vault. A server-side `sanitizeChatContext(tab, raw)` enforces a per-tab field allowlist + size cap (the chat analogue of `sanitizeExtractInput`); anything outside the allowlist is dropped before it reaches Claude.
- **Server holds the key, not the data.** The Hono server is stateless — it has no vault access. The client supplies the context; the server injects it into the prompt and calls Claude with the owner's key. `@anthropic-ai/sdk` stays server-only.
- **Web search is disclosed.** The agent may issue web searches (queries go to Anthropic's web-search tool). The consent copy says so. Web-search queries must be about EXTERNAL facts (fees, rates, rules) — never contain the owner's amounts/counterparties (enforced by instruction + the agent only having tab context, not a mandate to echo it into searches).
- **No server persistence.** Conversations are not stored server-side; chat history lives in the browser session only.

## Architecture

### Server (`apps/server`)
- `src/agent/prompts/*.md` — one instruction file per tab: `overview.md`, `rekeningen.md`, `regels.md`, `forecast.md`, `optimalisatie.md`, `valuta.md`, `belasting.md`, `facturen.md`, `punten.md`, `backup.md`, plus `_base.md` (shared rules: you are LaVega, Dutch, local-first, never invent numbers, use web search for realtime external facts, always say when a figure is a live-searched estimate, never echo the owner's personal data into a web search). Loaded + cached at startup (`loadPrompt(tab)` → `_base.md` + `<tab>.md`).
- `src/agent/chatContext.ts` — `sanitizeChatContext(tab, raw): object` — per-tab allowlist + size cap (pure, tested; the redaction boundary for chat).
- `src/agent/chat.ts` — `runChat({ tab, messages, context, apiKey })`: builds the system prompt (`_base` + tab md + a serialized `context` block clearly labelled "TAB-CONTEXT (van het apparaat van de gebruiker)"), tools = `[web_search]` (Anthropic hosted server tool — verify exact type/version against the installed SDK, e.g. `web_search_20260209` on Sonnet 5), model `claude-sonnet-5`, adaptive thinking. Streams; runs the built-in tool loop (server web-search tool resolves server-side, no client round-trip). Returns an async stream of text deltas.
- `src/agent-routes.ts` — add `POST /api/agent/chat` (streaming SSE): 503 if not configured → 429 rate-limit → `sanitizeChatContext` (400 on violation) → stream `runChat`. Reuses the existing rate limiter + `loadLlmConfig`.

### Client (`apps/web`)
- `src/components/ChatWidget.tsx` — floating launcher (bottom-right) + panel. Props: `view` (current tab), `context` (the built tab slice), `configured`. Streams from `/api/agent/chat`, renders the conversation, shows a "🔎 zoekt op het web…" indicator during web-search. First open → consent gate (persisted via `settings.ts` `getChatEnabled`/`setChatEnabled`, default OFF).
- `src/agent/tabContext.ts` — `buildTabContext(view, state): { tab, context }` — the ONLY place app state becomes chat context; returns the minimal per-tab slice (see table). Mirrors the privacy allowlist client-side (defence in depth; the server re-checks).
- Mounted once in `App.tsx` (outside `<main>`), always available; receives `view` + a `context` memo built from the already-in-scope state.

### Per-tab context allowlist (minimal slice)
| Tab | Context sent (allowlisted) |
|---|---|
| overview | per-entity balances, top categories (name+totals), alert count, forecast shortfall flag, buffer |
| rekeningen | accounts: bank, type, entity, balance (no raw txs) |
| regels | the rules list |
| forecast | 13-week summary: median/shortfall week/drivers |
| optimalisatie | detected subscriptions + resolved account rates + best benchmark |
| valuta | live ECB rate (date + rates map) + non-EUR holding currencies |
| belasting | VAT set-aside figures + next deadlines + per-BV settings (computed, no raw txs) |
| facturen | invoices: counterparty, amount, issue/due date, status (this tab's data) |
| punten | rewards balances: program, points, updatedAt |
| backup | none (how-to only) |

## Remove all "indicatief"
- **Valuta:** remove the indicative provider-routes table + `FX_ROUTES`/`FX_ROUTES_AS_OF`/`routeNet`/`rankRoutes`/`ownedProviders` UI usage and the "indicatief" copy. Keep the **realtime ECB converter** (amount × live `crossRate`). Add a line: for the cheapest route/fees, ask the LaVega-assistent (it web-searches current Wise/Revolut/bank fees). Retire the now-unused core exports (or keep `crossRate` only).
- **Punten:** remove the estimated-value column + total + the Amex transfer card + `estimateValueCents`/`totalValueCents`/`amexTransferOptions`/`centsPerPoint` UI usage + the "schattingen" copy. Keep the **balance tracker** (program, points, bijgewerkt + staleness) and the program `datalist`. Value/transfer questions go to the assistant (live web search).
- Leave Optimalisatie rentes (genuinely live geld.nl scrape) and the FX fallback snapshot (a fallback behind the live ECB primary) as-is.

## Model & cost
`claude-sonnet-5`, adaptive thinking, streaming, web search on. Per message: a few k input (tab context + history) + web-search round-trips → a few cents/message. Acceptable; still dormant until the key is set.

## Phasing (one spec, phased plan)
- **P1 — Chat backbone:** `sanitizeChatContext` + `_base.md` + `chat.ts` (Sonnet 5 + web_search, streaming) + `POST /api/agent/chat` + rate limit/503. Server-only, tested (mock SDK).
- **P2 — Widget + consent + one tab:** `ChatWidget` + `buildTabContext` + consent gate, wired in `App.tsx`, working end-to-end for the `overview` tab (the `.md` + context).
- **P3 — All tab prompts + contexts:** the remaining `*.md` files + per-tab context slices.
- **P4 — Remove indicatief:** Valuta + Punten UI/core cleanup.

## Must-not-skip
- `sanitizeChatContext` per-tab allowlist test (the chat redaction boundary).
- The `_base.md` rule that the agent never echoes personal amounts/counterparties into a web-search query.
- Consent gate default OFF; 503 dormant path keeps the app fully usable without the key.

## Open/deferred
- Real callable app-tools (e.g. a `convert_currency` function) — v1 keeps deterministic numbers in the context and uses web search for realtime external facts; the agent explains rather than does money math.
- Conversation memory across sessions (v1 = session-only, not persisted).
