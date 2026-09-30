# Portfolio agents

Investor personas read the synced portfolio and give a judgment, and the user can chat with
one about it. Backed by `apps/investing-server/src/portfolioAgent.ts`, which calls an
OpenAI-compatible endpoint (OpenRouter by default).

## Sub-features

- agent catalog: `GET /api/agents/portfolio` lists six personas (`warren_buffett`,
  `charlie_munger`, `bill_ackman`, `ben_graham`, `peter_lynch`, `stanley_druckenmiller`).
- agent picker: card title `Investor lens`. Radio group `aria-label="Choose agent"`.
- one-shot analysis: `Analyse portfolio` (`Agent reading…` while pending) posts
  `/api/agents/portfolio/run` and shows a signal (`bullish` / `bearish` / `neutral` /
  `no_view`) with a confidence.
- conversation: `Open conversation with <name>` opens `/agents/:agentId`. The positions panel
  there is `Positions in conversation`. Each turn posts `/api/agents/portfolio/conversation`
  with `{ agentId, messages }` and streams the reply (`text/event-stream`).
- The positions panel's accessible name is `Positions in conversation`. The visible heading is
  `Your positions`. Empty copy is `No positions available.`
- failure states: overview catalog error `Failed to load agents.`. The `/agents` list and
  the conversation shell use the title `Agents unavailable`. Also `No portfolio agents
available.`, `Agent not found`, `Agent run failed.`, `Agent reply failed.`
- while a chat reply streams and no assistant bubble is in yet, the status is
  `<displayName> is reading positions…`. The analyse control still reads `Agent reading…`.

## How to get to it (user POV)

Sign in, then open **Agents** to select any of the six personas, including Charlie Munger.
The **Research Stock** card runs one stock through all six agents together.
Saved conversation headers wrap on narrow screens so **New conversation** remains inside the card.

The `Investor lens` card is on the overview. Pick a persona, then press
`Analyse portfolio`, or follow `Open conversation with <name>`. Deep links work:
`/investing/agents/warren_buffett`.

## Driving it with control-investing

```bash
C=".claude/skills/verify-investing/control-investing.mjs"
node $C api GET /api/agents/portfolio --target prod        # catalog, no model call
node $C assets --target prod --path /investing/agents/warren_buffett
node $C api POST /api/agents/portfolio/conversation --target preview \
  --body '{"agentId":"warren_buffett","messages":[{"id":"u1","role":"user","parts":[{"type":"text","text":"What is my biggest risk?"}]}]}'
node $C browser open --target prod                          # then snapshot, click the card
node $C browser screenshot --png /tmp/lavega-verify-investing/evidence/munger-chat.png
```

The PNG path is `/tmp/lavega-verify-investing/evidence/<name>.png`. `browser screenshot`
creates that directory. A repo path or `$TMPDIR` is `path-rejected`. Do not retry under a
different folder.

Proof it works: the catalog returns six agents. A run returns `result.judgments` (one entry
per persona) with `signal.choice` of `bullish`, `bearish`, `neutral`, or `no_view`, plus
`result.model` and `result.snapshotHash`. There is no top-level `result.signal`. A
conversation streams `text-delta` events and ends with `data: [DONE]`. The chat never runs the six-persona judgment.

## Gotchas

- `run` and `conversation` call a paid model on every request. They are not reads; keep them
  off `--target prod` unless the user asked.
- Model errors answer `502` with `problems`, not `503`. On
  `POST /api/agents/portfolio/conversation`, an unknown `agentId` answers `400`
  `Unknown portfolio agent`, and a missing user message answers `400`.
  `POST /api/agents/portfolio/run` does not read `agentId`. A model failure after the stream opened is an `error` event in a `200`
  stream, and the UI shows `Agent reply failed.`
- On the local file vault, both return 502 `Agent run storage failed to start` while the
  vault is `empty` or `locked`. That happens before the model call. A local model proof
  needs an unlocked vault and `LAVEGA_AGENT_API_KEY` or `OPENROUTER_API_KEY`.
- The key is `LAVEGA_AGENT_API_KEY`, then `OPENROUTER_API_KEY`. The model is
  `LAVEGA_AGENT_MODEL`, and the base URL is `LAVEGA_AGENT_BASE_URL`. `ANTHROPIC_API_KEY` does
  not drive these agents.
- An unknown `agentId` in the URL renders `Agent not found`, not a redirect.
- The chat reads fundamentals only after market-data consent. On the local fixture, accept it first:
  `curl -X PUT -H 'content-type: application/json' -d '{"accepted":true}' http://127.0.0.1:8799/api/market-data/consent`.
- Mistral's shared OpenRouter pool answers 429 often. The server sends a `models` fallback list, so
  a slow reply may come from the fallback model. Check `local.log` for `statusCode: 429`.
- `browse wait --networkidle` returns before the stream ends. Wait for
  `#agent-message:not([disabled])` instead.
