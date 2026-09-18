# Portfolio investor agents

LaVega ports the useful structure from `virattt/ai-hedge-fund`, not its Python runtime.

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
- Financial Datasets API fetch layer. We do not yet store full fundamentals/news/insider data per holding.
- Prompt cache table. Current run store keeps latest result only; add durable per-agent snapshot cache when runs become scheduled or expensive.
