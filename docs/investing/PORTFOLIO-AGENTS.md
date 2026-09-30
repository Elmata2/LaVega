# Portfolio investor agents

LaVega ports the useful structure from `virattt/ai-hedge-fund`, not its Python runtime.

The Agents catalog also opens a single-company [Stock research](STOCK-RESEARCH.md)
workspace. Its five lens judgments and conversations share one signed company report.

Reference copies of the source (persona prompts, agent base, fundamentals snapshot, data protocol, decision records, risk limits, strategies, and project docs) live in [`agents/`](./agents/README.md).

Source components inspected:

- `src/agents/*.py` at `ad3f8e91`: old graph agents fetch metrics, line items, market cap, news/insiders, then call one LLM prompt per persona.
- `hedge_fund/signals/*.py` on current `main`: persona files are prompt-only classes.
- `hedge_fund/signals/llm_agent.py`: shared agent base builds snapshot, routes LLM call, parses JSON, abstains on LLM errors.
- `hedge_fund/features/snapshot.py`: point-in-time snapshot, stable rendered prompt, content hash.
- `hedge_fund/llm/client.py` and `registry.py`: provider-agnostic LLM client, JSON extraction, env-key routing.
- `hedge_fund/llm/cache.py`: prompt hash cache and audit record.

LaVega implementation:

- Backend route `GET /api/agents/portfolio` returns available personas for UI selection.
- Backend route `POST /api/agents/portfolio/run` evaluates all six lenses against one snapshot.
- Backend route `POST /api/agents/portfolio/conversation` takes `{ agentId, id, messages }` (`id` is the thread id, see [Memory](#memory)) in the AI SDK UI message format (the last 12 are kept) and streams one persona's answer as a UI message stream. See [Chat](#chat).
- Supported personas: `warren_buffett`, `charlie_munger`, `bill_ackman`, `ben_graham`, `peter_lynch`, `stanley_druckenmiller`.
- Agent input is a portfolio snapshot from the signed-in user's broker data and price cache.
- Snapshot includes portfolio value, allocation, top positions, returns, price status, missing prices, and dashboard problems.
- Agent output is typed judgment data. Each persona has a `Choice` signal (`bullish`, `bearish`, `neutral`, or `no_view`) and a `Score` conviction. Confidence derives from answer probability concentration, never model self-report.
- One TypeSafe System One request contains all persona question pairs. The result records model and snapshot hash. A missing answer affects only its persona; other judgments remain usable.
- Agent workbench shows positions in a compact value-sorted context list. Desktop list stays inside a sticky viewport-bounded panel; mobile list uses its own scroll area. Each row links to position detail, with a separate link to the full positions view.
- Typed judgments use TypeSafe System One:
  - `TYPESAFE_API_KEY` is required at runtime.
  - `TYPESAFE_MODEL` defaults to `jev-1.13.0`.
  - `AI_DAILY_BUDGET_CENTS` and `AI_MONTHLY_BUDGET_CENTS` gate usage before each request.
- Written explanation remains separate and on-demand. It must receive typed judgment context and must not replace it.

Not copied:

- Python LangGraph orchestration. Current product needs direct request/response per user portfolio.
- Prompt cache table. Current run store keeps latest result only; add durable per-agent snapshot cache when runs become scheduled or expensive.

## Chat

The chat is one agent per conversation. It never calls the six-persona judgment; that runs only on the **Analyse** card.

- Code: `apps/investing-server/src/portfolioChat.ts` builds a `ToolLoopAgent` (at most 5 steps). The route streams it with `createAgentUIStreamResponse`, and `AgentView` renders it with `useChat`. One `Chat` instance per persona lives for the page's lifetime, so a reply keeps streaming into its own conversation while the reader looks at another persona.
- Persona: `apps/investing-server/src/personaProfiles.ts` holds conversational rewrites of the persona sources in [`agents/`](./agents/README.md), plus shared rules: stay in voice, use the brief and tools, never invent a number, educational and not advice.
- Tools: `get_positions`, `get_price`, `compute_portfolio_value`, `get_fundamentals`, `get_sector_exposure`, `get_risk` and `get_trades`, plus the memory tools below. All read the signed-in tenant's data only.
- Prefetch: before the model is called, the server renders a portfolio brief and fetches fundamentals in parallel for up to 3 symbols the message names and the 5 largest holdings (5 second cap each). The first answer rarely waits on a tool round trip.
- Fundamentals: `FundamentalsProvider` in `@lavega/core`, with Yahoo Finance (`quoteSummary` plus timeseries) as the only adapter. FactSet is a possible later adapter behind the same seam. Results are cached for 24 hours per symbol, misses included, and concurrent reads share one fetch. Fundamentals are read only after the user accepts market-data consent; without it, the tool reports them as unavailable.
- Model: `LAVEGA_AGENT_MODEL`, default `mistralai/mistral-small-2603`. On OpenRouter the request also sends `models` with `qwen/qwen3.8-flash` as fallback, because Mistral's shared OpenRouter pool often answers 429. Key: `LAVEGA_AGENT_API_KEY`, then `OPENROUTER_API_KEY`. Base URL: `LAVEGA_AGENT_BASE_URL`.
- Latency, measured locally on the fixture portfolio (29 September 2026): the first token arrives in about 0.6 to 1.6 seconds when the brief is enough, and 7 to 16 seconds when the model takes tool steps first. Before this change, a turn ran the full judgment before answering.
- Errors: an unknown persona, an empty message, or (with a database) a missing thread id answers `400`. A model failure mid-stream arrives as an `error` event, and the UI shows `Agent reply failed.`

## Memory

Agents remember the owner across conversations. Storage and data model: [ADR 0007](../adr/0007-agent-memory-in-neon.md). Terms: the investing glossary in [`docs/CONTEXT.md`](../CONTEXT.md). Memory needs `DATABASE_URL`; without it the chat runs as before and `/api/memory` answers `503`.

- Code: `packages/database/src/agentMemory.ts` (repository, migration `0020_agent_memory.sql`), `apps/investing-server/src/chatMemory.ts` (instructions and tools), `apps/investing-server/src/memoryRoutes.ts` (owner routes).
- Threads: the web chat id is the thread id. The route stores the user message before the model runs, in parallel with the prefetch, and the reply when the stream ends. The model still reads the last 12 messages the client sends; stored messages are for reopening. A thread id of another agent is refused.
- Turn summary: one statement per turn, run in parallel with the fundamentals prefetch, so time to first token does not grow. It returns risk tolerance, the 20 newest goals, the theses of held symbols the message names, and the dormant thesis of any symbol held again. The same statement turns the thesis of a symbol no longer held dormant, unless the portfolio reads as empty (more likely an unfinished sync than a sale of everything).
- Instructions: with no risk tolerance the agent asks once. A named holding without a thesis gets asked for one. A dormant thesis is shown labelled as from the previous holding, with the question whether it still holds.
- Tools: `recall_memory` (theses, goals, observations or threads, filtered by symbol and, for observations and threads, a start date; 20 rows), `save_thesis` (held symbols only), `save_goal`, `note_observation`, `set_risk_tolerance`. The instructions allow `save_thesis` and `save_goal` only after the owner confirms.
- Owner routes: `GET /api/memory` (risk tolerance, theses, goals), `PUT /api/memory/risk-tolerance`, `PUT /api/memory/theses/:symbol`, `PUT /api/memory/goals/:id`, `GET /api/memory/threads?agentId=`, `GET` and `DELETE /api/memory/threads/:id`, `GET /api/memory/export`. No route deletes a thesis or a goal on its own. `DELETE /api/account/data` erases all memory tables.
- UI: the agent page lists its conversations (open, new, delete with a second click). Profile, Agent memory: risk tolerance, theses and goals with edit, and the export link.
