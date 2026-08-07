# In-Product Agent Runtimes — Research

Research for GitHub issue #20 ("Research: in-product agent runtimes"), a Wayfinder ticket for the
investing dashboard's future natural-language capability ("why is my portfolio down this month",
"what's my sector exposure", "did I actually beat the index"), answered from the user's real
positions, trades, and price history.

**Sourcing note:** every material claim below is cited inline with a link to its primary source
(official docs, the npm registry, or this repo's own code) and collected again in "Sources" at the
end. Where a claim could not be confirmed from a primary source it is flagged
**[Unverified/Not found]** rather than guessed. All web pages were fetched live on 2026-08-07.

---

## 1. What LaVega already does, and where it strains

The personal side already ships a working agent pattern. Reading the actual code (paths adjusted
from the ticket — `agent-routes.ts` lives at `apps/server/src/agent-routes.ts`, not inside
`agent/`):

- **`apps/server/src/config.ts`** — `loadLlmConfig()` reads `ANTHROPIC_API_KEY` from the server
  process's environment and returns `{ configured, apiKey }`. The key is never returned to a
  client; only a boolean `configured` flag is (`apps/server/src/agent-routes.ts:25`).
- **`apps/server/src/agent/anthropicExtract.ts`** — a one-shot, forced-tool call
  (`tool_choice: { type: "tool", name: "record_invoice" }`) against `claude-haiku-4-5` for invoice
  field extraction. No loop, no streaming, no conversation.
- **`apps/server/src/agent/chat.ts`** (`runChat`) — the actual conversational agent, streamed over
  SSE via `agent-routes.ts`'s `POST /api/agent/chat`. It calls `client.messages.stream()` once per
  turn with `model: "claude-sonnet-5"`, `thinking: { type: "adaptive" }`, and exactly **one** tool:
  Anthropic's hosted `web_search_20260209` server tool. There is **no client-side tool-use loop** —
  the code only forwards `text_delta` events and silently drops any `tool_use`/`tool_result`
  blocks, because the only tool present is server-executed.
- **`apps/server/src/agent/chatContext.ts`** — instead of tools, the user's actual data reaches
  Claude by being serialized into the system prompt: a per-tab allowlist (`ALLOW`) picks which
  top-level keys the client may send (e.g. `rekeningen` → `["accounts"]`), and the whole thing is
  capped at `MAX_CONTEXT_CHARS = 60_000` characters. This is a **context-stuffing** pattern, not
  tool calling.
- **`apps/web/src/api.ts`** — the browser side hand-rolls the client half of SSE: a `fetch()`,
  `res.body.getReader()`, and manual parsing of `data:`-delimited records. There is no streaming
  library involved.

**What this does well:** the key-custody story is already correct and requires no new work — one
env var, read server-side only, exactly the shape Enable Banking's `EB_APPLICATION_ID` already
uses in the same file (`apps/server/src/config.ts`). The SSE route (`agent-routes.ts`) already
guards `503` (not configured) → `429` (rate-limited) → `400` (bad input) → stream, and the
redaction boundary (`chatContext.ts`/`redaction.ts`) already exists before any data reaches
Anthropic.

**Where it would strain for a portfolio agent:** the context-stuffing pattern caps at 60k
characters of JSON. A single tab's static snapshot (account balances, category rules) fits that
comfortably; a broker's full trade history, dividend history, and daily price series for a
multi-year, multi-position portfolio will not, and re-sending it on every turn is wasteful even
when it fits. Answering "did I beat the index" or "why is my portfolio down this month" requires
the agent to *decide what to fetch* (which date range, which tickers, which benchmark) rather than
being handed everything up front — i.e. it needs real client-side tools (`get_positions()`,
`get_trades(range)`, `get_price_history(ticker, range)`) that Claude calls on demand. **None of
that tool-calling scaffolding exists in the repo today** — `chat.ts` has zero client-tool
definitions, zero `tool_use` parsing, and zero `tool_result` construction. Building it is new work
regardless of which SDK/framework is chosen below.

---

## 2. Direct Anthropic SDK (the incumbent pattern)

Official docs: [Tool use overview](https://docs.claude.com/en/docs/agents-and-tools/tool-use/overview),
[Tool Runner (SDK)](https://docs.claude.com/en/docs/agents-and-tools/tool-use/tool-runner),
[Agent SDK overview](https://docs.claude.com/en/api/agent-sdk/overview),
[Pricing](https://docs.claude.com/en/docs/about-claude/pricing).

- **Tool-use model.** Anthropic's docs draw an explicit line between **client tools** (defined by
  you, executed in your app, results sent back as `tool_result`) and **server tools** (`web_search`,
  `web_fetch`, `code_execution`, `tool_search`, `memory`, `bash`, `text_editor` — executed on
  Anthropic's infrastructure). `get_positions`/`get_trades`/`get_price_history` would be client
  tools: you write the JSON schema, Claude returns a `tool_use` block, your Hono handler runs the
  real query and returns a `tool_result`.
  ([Tool use overview](https://docs.claude.com/en/docs/agents-and-tools/tool-use/overview))
- **Tool Runner (beta)** removes exactly the boilerplate `chat.ts` is missing: it "handles the
  agentic loop, error wrapping, and type safety" — you hand it tools and messages, iterate over
  `client.beta.messages.tool_runner(...)`, and it runs each tool call and re-invokes the model
  automatically, or call `.until_done()` for the final answer. It supports `max_iterations`,
  intercepting/modifying tool results, and (Python/TS/Ruby) automatic context compaction for long
  conversations. Available in the TS SDK, in beta.
  ([Tool Runner (SDK)](https://docs.claude.com/en/docs/agents-and-tools/tool-use/tool-runner))
- **Claude Agent SDK and Managed Agents are the wrong row in Anthropic's own comparison table**,
  not upgrades on the plain Client SDK. Anthropic's own docs table (below "Compare the Agent SDK to
  other Claude tools") lines up four options: *Agent SDK* = "Claude Code as a library" for building
  agents that plan and edit files/run commands; *CLI* = terminal interactive use; **Client SDK** =
  "Calling the API directly and implementing the tool loop yourself" — this is what LaVega already
  uses; *Managed Agents* = a separate hosted REST product where Anthropic runs the agent **and the
  sandbox**. Managed Agents in particular doesn't solve LaVega's local-first requirement — it moves
  key custody *and* execution to Anthropic's infrastructure, which is a worse fit for a self-hosted
  app than the status quo, not a better one.
  ([Agent SDK overview](https://docs.claude.com/en/api/agent-sdk/overview))
- **Where it runs / edge.** `@anthropic-ai/sdk` is a plain HTTP client; it runs anywhere Node (or
  edge JS) runs. LaVega's Hono server is already described as "portable across Node/edge/cheap
  hosting" (`docs/CONTEXT.md`), so nothing here changes that.
- **Streaming into React.** `client.messages.stream()` gives an async-iterable of decoded SSE
  events server-side — exactly what `chat.ts` already uses. The SDK provides **no** browser/React
  primitives; LaVega's hand-rolled `fetch()` + `ReadableStream` reader in `apps/web/src/api.ts` is
  what bridges that to the UI today, and would need to keep being maintained (or be replaced by a
  UI library — see §4).
- **Lock-in.** Tool schemas, message shape, and the tool-loop code are all written directly against
  Anthropic's wire format. Swapping providers means rewriting the tool definitions and the loop.
- **Cost.** Per-token, no markup, at Anthropic's published table:
  Claude Haiku 4.5 — $1 / $5 per MTok (input/output); Claude Sonnet 5 — $2 / $10 per MTok through
  2026-08-31, then $3 / $15 per MTok. Tool-use adds a small fixed system-prompt token cost per
  request (354–588 tokens for Sonnet 5, depending on `tool_choice`).
  ([Pricing](https://docs.claude.com/en/docs/about-claude/pricing))

## 3. Vercel AI SDK

Official docs: [Introduction](https://ai-sdk.dev/docs/introduction),
[Agents overview](https://ai-sdk.dev/docs/agents/overview),
[AI Gateway](https://vercel.com/docs/ai-gateway).

- **What it is.** A TypeScript toolkit with three surfaces: **AI SDK Core** (`generateText`,
  `streamText`, tool calling, and a `ToolLoopAgent` class that "handles the loop, context
  management, and stopping conditions" for you — the direct analogue of Anthropic's Tool Runner,
  but provider-agnostic), **AI SDK UI** (framework-agnostic React/Vue/Svelte hooks, e.g. `useChat`,
  for chat and generative UI), and **AI SDK Harnesses** (a separate abstraction — see §4/§5, not
  relevant to building your own tool-using agent).
  ([Introduction](https://ai-sdk.dev/docs/introduction), [Agents overview](https://ai-sdk.dev/docs/agents/overview))
- **Provider-agnostic by design.** The intro page's own example swaps models by changing a string
  (`model: "xai/grok-4.5"`); the same call shape works against Anthropic, OpenAI, Google, Bedrock,
  Mistral, and a long list of others, each with declared tool-use/streaming/image support.
  ([Introduction](https://ai-sdk.dev/docs/introduction))
- **Tool-calling shape.** Same conceptual shape as the direct SDK — you still write per-tool
  `inputSchema` (Zod) + `execute()` — but the `ToolLoopAgent` class runs the loop for you across
  whichever provider you configure, instead of that logic being specific to Anthropic's SDK.
- **Streaming into React.** This is a genuine, bounded win over the status quo: AI SDK UI's
  `useChat` (and the underlying `readUIMessageStream`) is exactly the kind of code LaVega
  hand-rolled in `apps/web/src/api.ts` (manual `fetch` + `ReadableStream` + SSE-record parsing).
  Adopting just the UI layer, independent of which model-calling layer is used server-side, would
  delete that hand-rolled parser.
- **Where it runs / edge.** It's an npm library (`ai`), not a hosted service — runs wherever the
  Hono server already runs, including edge runtimes; no new infrastructure requirement.
- **Key custody.** Identical shape to the direct SDK: a provider API key lives in a server-side env
  var (`ANTHROPIC_API_KEY`, etc.) that the SDK reads in whatever Node/edge process calls it. The AI
  SDK itself adds no key-custody option that Anthropic's own SDK doesn't already have.
- **Lock-in — the actual selling point.** Swapping providers is a config change
  (`model: "anthropic/claude-..."` → `model: "openai/gpt-..."`), not a rewrite, because Core/UI
  primitives are provider-agnostic. This is a real, measurable reduction in lock-in versus the raw
  Anthropic SDK, paid for with one more dependency (and, if paired with Vercel's own AI Gateway, a
  second party sitting between LaVega and the model provider).
- **Cost / hosted-tier subsidy.** The SDK itself adds no cost. Vercel's optional **AI Gateway**
  offers "one key, hundreds of models" with spend monitoring/budgets, and states explicitly:
  "No markup on tokens. Tokens cost the same as they would from the provider directly, with zero
  markup, including with Bring Your Own Key (BYOK)." That means the Gateway is a routing/observability
  layer, not a subsidy mechanism by itself — a LaVega-hosted tier would still need its own metering
  and margin on top, the Gateway (or a self-hosted proxy of any kind) doesn't do that for free.
  ([AI Gateway](https://vercel.com/docs/ai-gateway))

## 4. "Eve" (Vercel) — identified

**[Confirmed real.]** Eve is a genuine, currently-shipping Vercel product, found at
[eve.dev](https://eve.dev) and on npm as [`eve`](https://registry.npmjs.org/eve) (package repo
`github.com/vercel/eve`; latest version `0.31.0`, published 2026-08-06 — the day before this
research was done, confirming it is new and actively shipping, not a stable/mature product).

**What it actually is:** a batteries-included, filesystem-first *agent application framework* —
Vercel's own framing is "Like Next.js for agents." An `agent/` directory holds an `instructions.md`
(a complete agent needs nothing else) plus optional `agent.ts` (model/runtime config, uses the AI
SDK under the hood for model calls), `skills/`, `tools/` (one TypeScript file per tool, filename =
tool name, no manual registration), `sandbox/` (isolated Docker execution), `channels/` (Slack,
Discord, Teams, WhatsApp, web chat), `connections/` (MCP-based auth to external services),
`subagents/`, `schedules/` (cron), and `evals/`. It integrates natively with React/Next.js via
`withEve(nextConfig)` and a `useEveAgent()` hook that finds its own same-origin routes (no CORS, no
URL env vars to manage). Vercel's own docs state it is "Built on open-source SDKs, yours to
self-host" — durable execution via a Postgres-backed workflow engine, model calls via the AI SDK,
sandboxing via Docker, connections via MCP — with "zero managed-infrastructure dependencies" on the
self-hosted path. ([eve.dev](https://eve.dev))

**Relevance to LaVega:** genuinely a self-hostable, React-native, in-product agent runtime — but
built for a different job than "answer a question about data already in the dashboard." Its
headline features (durable/crash-resumable execution, Docker-sandboxed code execution, multi-channel
delivery to Slack/Discord/cron, subagents, evals) are aimed at long-running background agents, not a
single-request conversational Q&A widget. Adopting it means taking on Postgres-backed workflow state
and a Docker sandbox that LaVega doesn't otherwise need. Combined with its pre-1.0 maturity (`0.31.0`,
shipping daily), it is not a fit for the near-term "ask the dashboard a question" capability. Worth
revisiting only if LaVega later wants scheduled digests or multi-channel delivery (e.g. a Slack bot
version of the agent) — not for v1.

## 5. "Pi" — identified

**[Confirmed real, but not what the ticket's framing implied.]** "Pi" is **not** a Vercel product.
It surfaces in the AI SDK docs as one of several "established agent harnesses" — alongside
**Claude Code**, **Codex**, **Deep Agents**, and **OpenCode** (with **Amp**, **Goose**, and
**Mastra** listed as "coming soon") — that the AI SDK's `HarnessAgent` class can run, via a
dedicated adapter package per harness (`@ai-sdk/harness-claude-code`, `@ai-sdk/harness-codex`, …,
`@ai-sdk/harness-pi`).
([Agents overview](https://ai-sdk.dev/docs/agents/overview), [Harness Adapters](https://ai-sdk.dev/docs/ai-sdk-harnesses/harness-adapters))

Following the trail to what `@ai-sdk/harness-pi` actually wraps: its own npm package description
states it is a `"HarnessV1 adapter backed by @earendil-works/pi-coding-agent. Pi runs in the host
Node.js process and uses the sandbox as a remote filesystem + shell — no bridge process is
installed…"` ([npm registry](https://registry.npmjs.org/@ai-sdk/harness-pi)). That underlying
package, `@earendil-works/pi-coding-agent`, describes itself simply as `"Coding agent CLI with
read, bash, edit, write tools and session management"`
([npm registry](https://registry.npmjs.org/-/v1/search?text=%40earendil-works%2Fpi-coding-agent)),
open-sourced at `github.com/earendil-works/pi`.

So "Pi" is a **third-party, open-source terminal coding-agent CLI** — in the same product category
as Claude Code, OpenAI Codex CLI, Amp, and Goose (autonomous agents that read/edit files and run
shell commands to do software-engineering tasks) — that the Vercel AI SDK happens to ship an
adapter for, exactly as it does for Claude Code and Codex. It is **developer tooling for editing
code**, not an in-product runtime, not a conversational data agent, and not built by Vercel. It has
no relevance to a portfolio Q&A feature and should not be considered further for this use case.

## 6. Other credible frameworks (brief)

- **Mastra** ([mastra.ai/docs](https://mastra.ai/en/docs)) — a TypeScript-native agent framework:
  `Agent` class + `createTool()`, a "model router" string format (`anthropic/claude-...`,
  `openai/...`) that reads the matching provider env var (`ANTHROPIC_API_KEY`, etc. — same
  key-custody shape as everything else here), plus its own dev UI ("Mastra Studio") and
  deploy/storage layer. Notably, Mastra's own docs list **"Data analysis agents: Let users query
  databases and dashboards in natural language,"** naming Index and PLAID Japan as users — the
  single closest named use case to LaVega's ask found in this research. Worth a real prototype spike
  later; it is TypeScript-first and would fit alongside Hono, but it brings a second full framework
  and its own storage/server concerns on top of the existing stack, more plumbing than the ticket's
  "how much plumbing" question wants for a v1.
- **LangGraph** ([docs.langchain.com](https://langchain-ai.github.io/langgraphjs/)) — "a low-level
  orchestration framework and runtime for building, managing, and deploying long-running, stateful
  agents," modeled as an explicit state graph (`StateGraph`, nodes, edges) so deterministic and
  agentic steps can be mixed. LangChain's own docs recommend pairing it with **LangSmith** for
  tracing, evaluation, and deployment — a separate paid, hosted product. This is meaningfully more
  machinery and vendor surface than a single conversational tool-use loop needs; not a fit for v1.
- **OpenAI Agents SDK (JS)** ([openai.github.io/openai-agents-js](https://openai.github.io/openai-agents-js/))
  — OpenAI's own TypeScript agent framework (`Agent`, `Runner`, tools, handoffs, guardrails,
  sessions, MCP support, and an "AI SDK Integration" extension). Structurally the same shape as
  Vercel's `ToolLoopAgent`/Anthropic's Tool Runner, but OpenAI-branded and OpenAI-model-first. Since
  LaVega's existing prompts (`apps/server/src/agent/prompts/*.md`) and incumbent code are already
  written for Claude, this offers no structural advantage over the AI SDK.

---

## 7. Comparison table

| | Where it runs / edge | Key custody | Tool-calling plumbing | Streaming → React | Lock-in | Cost model |
|---|---|---|---|---|---|---|
| **Direct Anthropic SDK** (current, + Tool Runner) | Node/edge — no change from today | Server env var (`config.ts`, already built) | Write client tools + schema; Tool Runner (beta) removes the loop boilerplate | Server SSE stream exists (`chat.ts`); React side is hand-rolled (`api.ts`) | High — tied to Anthropic's wire format | Per-token, Anthropic's published rates, no markup |
| **Claude Agent SDK / Managed Agents** | Agent SDK: your process. Managed Agents: Anthropic's hosted sandbox | Managed Agents moves custody *and* execution off-box — worse fit, not better | Built for coding-agent-style tasks (file/shell tools), wrong shape for Q&A-over-data | N/A for this use case | High | Managed Agents adds hosted-infra pricing on top of tokens |
| **Vercel AI SDK** (Core + UI) | npm lib, runs anywhere Node/edge does | Same as direct SDK — server env var | Same shape, `ToolLoopAgent` runs the loop; provider-agnostic | `useChat`/UI hooks are a real upgrade over the hand-rolled parser | Low — swap a model string | Pay the provider directly; SDK adds no cost |
| **Vercel AI SDK + AI Gateway** | Same as above, plus one more network hop through Vercel | Same, or BYOK through the Gateway (zero markup) | Same as AI SDK | Same as AI SDK | Low, plus a second vendor in the path | Zero markup on tokens; Gateway ≠ automatic subsidy — LaVega would still meter/margin itself |
| **Eve (Vercel)** | Self-hostable; needs Postgres (durable workflow) + Docker (sandbox) | Server-side, same shape, but inside a much bigger runtime | Tools = one TS file each; built-in loop | Native `useEveAgent()` React hook | Low (AI SDK underneath) | Pay the provider; framework itself is free/OSS but pre-1.0 |
| **"Pi" harness** | Local coding-agent CLI process | N/A — not applicable | N/A — it's a code-editing CLI, not a data agent | N/A | N/A | N/A |
| **Mastra** | Node process + its own server/storage layer | Server env var, same shape | `createTool()` + `Agent`; closest named "data analysis agent" use case | Own Studio UI; would need custom wiring into LaVega's React app | Low (model-router string) | Pay the provider directly |
| **LangGraph** | Node process; intended to pair with hosted LangSmith | Server env var, same shape | Explicit state graph — most control, most code | Not turnkey; built for backend orchestration, not chat UI | Low on model, but adds LangSmith as a vendor if used as intended | Pay the provider + optional LangSmith |
| **OpenAI Agents SDK (JS)** | Node/edge | Server env var, same shape | Same shape as AI SDK (`Agent`/`Runner`) | Needs custom wiring | Medium — OpenAI-model-first | Pay the provider directly |

---

## 8. Key-custody options and trade-offs (the hard constraint)

Three real patterns were found across comparable tools, plus one that was **not** found as a clean
recommended practice anywhere:

1. **Server-side key, held by whichever server the operator runs — LaVega's existing pattern.**
   `apps/server/src/config.ts`'s `loadLlmConfig()` reads `ANTHROPIC_API_KEY` from the server
   process's environment; the key never reaches the browser, only a `configured` boolean does
   (`agent-routes.ts:25`). This is structurally identical to **Open WebUI**'s self-hosted pattern:
   run a Docker container (`docker run ... ghcr.io/open-webui/open-webui`), configure a provider
   connection, and the key is held by that container's own persisted backend, with the browser only
   ever talking to it ([Open WebUI quick start](https://docs.openwebui.com/getting-started/quick-start/)).
   **Trade-off:** requires a server process — but LaVega already requires one for bank sync
   (Enable Banking, finAPI), so this is not new infrastructure, only a new use of infrastructure
   that already exists. This is the pattern to keep.
2. **BYOK typed straight into the browser, sent to the provider directly from client JS.** This was
   the pattern the ticket most worried about ("Bring-your-own-key in the browser exposes the key")
   — and no examined tool recommends it as a clean, safe default. It was **not found** as an
   endorsed pattern in any primary source reviewed. The key would sit in `localStorage` or JS
   memory, readable by anyone with devtools access or any XSS in the page, and Anthropic's Messages
   API is not designed to be called cross-origin from a browser the way a backend calls it. **Not
   recommended.**
2b. **BYOK held in a native app's OS keychain**, with model calls made from the local desktop
   process itself (no third-party server in the loop at all). This is real and well-documented:
   Zed's docs state plainly that "Keys saved through Zed are stored in the system keychain, not in
   `settings.json`" ([Zed — Use API Access](https://zed.dev/docs/ai/use-api-access.html)). It's a
   genuinely clean answer to key custody — but it only exists because Zed is a native desktop app.
   LaVega is a web SPA (`apps/web`, Vite + React) talking to a Hono server; adopting this pattern
   would mean becoming a native/desktop app (e.g. via Tauri or Electron), which is a much bigger
   architectural change than the choice of agent runtime, and out of scope here.
3. **BYOK entered into a locally-run server process the user starts themselves** — this collapses
   to the same shape as option 1. Whether the "server" is `apps/server` running on the self-hoster's
   own machine/VPS, or a container like Open WebUI's, the key custody story is identical: one
   process the user controls holds the secret, the browser never sees it.

**Recommendation on custody:** keep pattern 1/3 — LaVega's existing server-side env-var model. It
already satisfies the "self-hoster has no server of ours to hold a key" concern in the ticket,
because the self-hoster's *own* `apps/server` process is that server; nothing changes here for a
future hosted tier either, since it's the same env var read from the operator's environment either
way. Do not build a browser-BYOK path; it has no clean precedent and works against the "secrets
never leave the user's control boundary" spirit of `docs/CONTEXT.md`'s hard constraints.

---

## 9. Recommendation

**Stay on the direct Anthropic SDK** — it is already installed, already paid for in prompt and
redaction work (`apps/server/src/agent/prompts/*.md`, `redaction.ts`, `chatContext.ts`), and its
key-custody model is already correct for both self-hosted and future-hosted deployments. Close the
actual gap the ticket identifies — no real tool-use loop for the portfolio's own data — by:

1. Writing real client tools (`get_positions`, `get_trades`, `get_price_history`) instead of
   stuffing the whole tab context into the system prompt, and
2. Adopting Anthropic's beta **Tool Runner** (`client.beta.messages.tool_runner`) to run that loop,
   rather than hand-rolling it — it directly replaces the boilerplate `chat.ts` is currently missing.

Optionally, independently of the model-calling layer, evaluate the **Vercel AI SDK's UI hooks**
(`useChat`) purely to delete the hand-rolled `fetch`/`ReadableStream`/SSE-parsing code in
`apps/web/src/api.ts` — that is a real, bounded win regardless of which SDK talks to the model.

**Do not adopt:** Eve (self-hostable and React-native, but built for durable/multi-channel
background agents with Postgres+Docker infrastructure LaVega doesn't need, and pre-1.0); "Pi"
(a third-party coding-agent CLI with no relevance to a data Q&A feature); the Claude Agent SDK or
Managed Agents (wrong shape, and Managed Agents actively works against the local-first custody
model); LangGraph or a full LangSmith-paired setup (too much orchestration and a second vendor for
a single tool-use loop). **Revisit later, not now:** Mastra, if LaVega ever wants a second model
provider or a heavier multi-agent setup — it's the one framework whose own docs name "natural
language queries over dashboards" as a real use case.

---

## Sources

- Anthropic — [Tool use overview](https://docs.claude.com/en/docs/agents-and-tools/tool-use/overview)
- Anthropic — [Tool Runner (SDK)](https://docs.claude.com/en/docs/agents-and-tools/tool-use/tool-runner)
- Anthropic — [Agent SDK overview](https://docs.claude.com/en/api/agent-sdk/overview)
- Anthropic — [Pricing](https://docs.claude.com/en/docs/about-claude/pricing)
- Vercel AI SDK — [Introduction](https://ai-sdk.dev/docs/introduction)
- Vercel AI SDK — [Agents overview](https://ai-sdk.dev/docs/agents/overview)
- Vercel AI SDK — [Harness Adapters](https://ai-sdk.dev/docs/ai-sdk-harnesses/harness-adapters)
- Vercel — [AI Gateway](https://vercel.com/docs/ai-gateway)
- Vercel Eve — [eve.dev](https://eve.dev)
- npm registry — [`eve` package metadata](https://registry.npmjs.org/eve)
- npm registry — [`@ai-sdk/harness-pi` package metadata](https://registry.npmjs.org/@ai-sdk/harness-pi)
- npm registry search — [`@earendil-works/pi-coding-agent`](https://registry.npmjs.org/-/v1/search?text=%40earendil-works%2Fpi-coding-agent)
- Mastra — [Get started docs](https://mastra.ai/en/docs)
- LangChain/LangGraph — [LangGraph overview](https://langchain-ai.github.io/langgraphjs/)
- OpenAI Agents SDK (JS) — [Documentation home](https://openai.github.io/openai-agents-js/)
- Zed — [Use API Access](https://zed.dev/docs/ai/use-api-access.html)
- Open WebUI — [Quick Start](https://docs.openwebui.com/getting-started/quick-start/)
- This repo — `apps/server/src/config.ts`, `apps/server/src/agent-routes.ts`,
  `apps/server/src/agent/anthropicExtract.ts`, `apps/server/src/agent/chat.ts`,
  `apps/server/src/agent/chatContext.ts`, `apps/web/src/api.ts`, `docs/CONTEXT.md`
