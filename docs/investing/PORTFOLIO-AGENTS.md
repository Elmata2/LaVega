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
- Backend route `POST /api/agents/portfolio/run` accepts `{ "agentId": "bill_ackman", "model": "openai/gpt-5-mini" }`.
- Supported personas: `warren_buffett`, `charlie_munger`, `bill_ackman`, `ben_graham`, `peter_lynch`, `stanley_druckenmiller`.
- Agent input is a portfolio snapshot from the signed-in user's broker data and price cache.
- Snapshot includes portfolio value, allocation, top positions, returns, price status, missing prices, and dashboard problems.
- Agent output is normalized JSON: `signal`, `confidence`, `summary`, `reasoning`, `insights`, `model`, `snapshotHash`.
- Provider routing uses OpenAI-compatible API settings:
  - `LAVEGA_AGENT_API_KEY`
  - `LAVEGA_AGENT_BASE_URL` (default `https://openrouter.ai/api/v1`)
  - `LAVEGA_AGENT_MODEL`
- Local or self-hosted models can use their OpenAI-compatible base URL in `LAVEGA_AGENT_BASE_URL`.

Not copied:

- Python LangGraph orchestration. Current product needs direct request/response per user portfolio.
- Financial Datasets API fetch layer. We do not yet store full fundamentals/news/insider data per holding.
- Prompt cache table. Current run store keeps latest result only; add durable per-agent snapshot cache when runs become scheduled or expensive.
