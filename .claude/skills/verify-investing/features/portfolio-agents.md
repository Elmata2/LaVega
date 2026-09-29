# Portfolio agents

Investor personas read the synced portfolio and give a judgment, and the user can chat with
one about it. Backed by `apps/investing-server/src/portfolioAgent.ts`, which calls an
OpenAI-compatible endpoint (OpenRouter by default).

## Sub-features

- agent catalog: `GET /api/agents/portfolio` lists six personas (`warren_buffett`,
  `charlie_munger`, `bill_ackman`, `ben_graham`, `peter_lynch`, `stanley_druckenmiller`).
- agent picker: radio group `Choose agent` on the overview.
- one-shot analysis: `Analyse portfolio` (`Agent reading…` while pending) posts
  `/api/agents/portfolio/run` and shows a signal (`bullish` / `bearish` / `neutral` /
  `no_view`) with a confidence.
- conversation: `Open conversation with <name>` opens `/agents/:agentId`. The positions
  panel's accessible name is `Positions in conversation`. The visible heading is
  `Your positions`. Empty copy is `No positions available.` Each turn posts
  `/api/agents/portfolio/conversation` with the last 12 turns.
- failure states: `Agents unavailable`, `No portfolio agents available.`, `Agent not found`,
  `Agent run failed.`, `Agent reply failed.`

## How to get to it (user POV)

Sign in, and the agent card is on the overview. Pick a persona in `Choose agent`, then press
`Analyse portfolio`, or follow `Open conversation with <name>`. Deep links work:
`/investing/agents/warren_buffett`.

## Driving it with control-investing

```bash
C=".claude/skills/verify-investing/control-investing.mjs"
node $C api GET /api/agents/portfolio --target prod        # catalog, no model call
node $C assets --target prod --path /investing/agents/warren_buffett
node $C api POST /api/agents/portfolio/conversation --target preview \
  --body '{"agentId":"warren_buffett","prompt":"What is my biggest risk?"}'
node $C browser open --target prod                          # then snapshot, click the card
```

Proof it works: the catalog returns six agents, a run returns `result` with a `signal`, and a
conversation returns `result.text` plus `judgment`.

## Gotchas

- `run` and `conversation` call a paid model on every request. They are not reads; keep them
  off `--target prod` unless the user asked.
- On the local file vault, both return 502 `Agent run storage failed to start` while the
  vault is `empty` or `locked`. That happens before the model call. A local model proof
  needs an unlocked vault and `LAVEGA_AGENT_API_KEY` or `OPENROUTER_API_KEY`.
- Model errors answer `502` with `problems`, not `503`. An unknown `agentId` or an empty
  `prompt` answers `400`.
- The key is `LAVEGA_AGENT_API_KEY`, then `OPENROUTER_API_KEY`. The model is
  `LAVEGA_AGENT_MODEL`, and the base URL is `LAVEGA_AGENT_BASE_URL`. `ANTHROPIC_API_KEY` does
  not drive these agents.
- An unknown `agentId` in the URL renders `Agent not found`, not a redirect.
