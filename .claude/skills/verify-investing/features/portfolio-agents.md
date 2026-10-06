# Portfolio agents

Investor personas read the synced portfolio and give a judgment, and the user can chat with
one about it. The one-shot judgment is `apps/investing-server/src/portfolioAgent.ts`: TypeSafe
System One (`TYPESAFE_API_KEY`). The conversation is `apps/investing-server/src/portfolioChat.ts`:
an OpenAI-compatible chat, OpenRouter by default (`LAVEGA_AGENT_API_KEY`, then
`OPENROUTER_API_KEY`).

## Sub-features

- agent catalog: `GET /api/agents/portfolio` lists six personas (`warren_buffett`,
  `charlie_munger`, `bill_ackman`, `ben_graham`, `peter_lynch`, `stanley_druckenmiller`).
- agent picker: card title `Investor lens`. Radio group `aria-label="Choose agent"`.
  A click selects that persona and opens `/agents/:agentId` in a new tab
  (`window.open(target, "_blank")`). There is no window name. If the browser blocks the
  tab, the same click navigates in-page. Arrow keys move the selection and do not open
  the conversation. The in-page link then reads `Open conversation with <name>`.
  The Overview letter's `Discuss` button is a separate in-page navigation to
  `charlie_munger`. See [dashboard-overview.md](dashboard-overview.md).
- one-shot analysis: `Analyse portfolio` (`Agent reading…` while pending) posts
  `/api/agents/portfolio/run` and shows a signal (`bullish` / `bearish` / `neutral` /
  `no_view`) with a confidence.
- conversation: `Open conversation with <name>` opens `/agents/:agentId`. Back link:
  `← Back to overview`. Eyebrow `Portfolio agent`, then the display name. Input label
  `Ask <displayName>`, placeholder `Ask about your positions…`, button `Send`. The positions
  panel's accessible name is `Conversation context`. Its eyebrow is `Context` and the visible
  heading is `Your positions`. Empty copy is `No positions available.` Each turn posts
  `/api/agents/portfolio/conversation`.
  The body is `{ agentId, messages }`. When agent memory is configured, it also needs a UUID
  `id` (the thread id). The reply streams (`text/event-stream`).
- saved threads: with memory, the conversation shows eyebrow `Memory`, heading `Conversations`,
  and `New conversation`. Profile shows `Agent memory` (`aria-label="Agent memory"`): risk
  tolerance, theses, and goals. Both stay hidden when `GET /api/memory/threads` does not
  succeed. The local file server answers 503 `Agent memory needs a database`, so neither
  block is on screen.
- failure states: overview catalog error `Failed to load agents.`. The `/agents` list and
  the conversation shell use the title `Agents unavailable`. Also `No portfolio agents
available.`, `Agent not found`, `Agent run failed.`, `Agent reply failed.`
- while a chat reply streams and no assistant bubble is in yet, the status is
  `<displayName> is reading positions…`. The analyse control still reads `Agent reading…`.

## How to get to it (user POV)

Sign in, then open **Agents** to select any of the six personas, including Charlie Munger.
The **Research Stock** card (eyebrow `Research Stock`, heading `One stock. All six agents.`,
link `Start stock research →`) opens `/agents/research`. The research page heading is
`One company. Six perspectives.` See [stock-research.md](stock-research.md).
When memory is on, saved conversation headers wrap on narrow screens so **New conversation**
remains inside the card. The conversation layout uses one constrained grid column below the
desktop breakpoint; long content must not expand the card beyond the viewport.

The `Investor lens` card is on the overview. A radio click selects that persona and opens
the conversation popup. Press `Analyse portfolio` for the one-shot judgment, or follow
`Open conversation with <name>` for the in-page route. Deep links work:
`/investing/agents/warren_buffett`.

## Driving it with control-investing

```bash
C=".claude/skills/verify-investing/control-investing.mjs"
node $C api GET /api/agents/portfolio --target prod        # catalog, no model call
node $C assets --target prod --path /investing/agents/warren_buffett
node $C api POST /api/agents/portfolio/conversation --target preview \
  --body '{"agentId":"warren_buffett","id":"00000000-0000-4000-8000-000000000001","messages":[{"id":"u1","role":"user","parts":[{"type":"text","text":"What is my biggest risk?"}]}]}'
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
  `Unknown portfolio agent`, and a missing user message answers `400`
  `Conversation message is required`. When agent memory is configured, a missing or
  non-UUID `id` answers `400` `Conversation thread id is required`. Local file mode has no
  memory repository, so `id` is optional there. A model failure after the stream opened is
  an `error` event in a `200` stream, and the UI shows `Agent reply failed.`
- `POST /api/agents/portfolio/run` does not read `agentId`. It needs `TYPESAFE_API_KEY`.
  On the local file vault, `empty` or `locked` returns 502 `Agent run storage failed to start`
  before the model call. A missing TypeSafe key, once the store has started, is 502
  `TYPESAFE_API_KEY is not set; configure TypeSafe System One`.
- Conversation does not use that run store. A missing chat key is 502
  `LAVEGA_AGENT_API_KEY or OPENROUTER_API_KEY is not set`, including on an empty local vault.
  The chat key is `LAVEGA_AGENT_API_KEY`, then `OPENROUTER_API_KEY`. The model is
  `LAVEGA_AGENT_MODEL`, and the base URL is `LAVEGA_AGENT_BASE_URL`. `ANTHROPIC_API_KEY` does
  not drive these agents. `doctor` `llm` does not prove either key.
- An unknown `agentId` in the URL renders `Agent not found`, not a redirect.
- The chat reads fundamentals only after market-data consent. On the local fixture, accept it first:
  `curl -X PUT -H 'content-type: application/json' -d '{"accepted":true}' http://127.0.0.1:8799/api/market-data/consent`.
- Mistral's shared OpenRouter pool answers 429 often. The server sends a `models` fallback list, so
  a slow reply may come from the fallback model. Check `local.log` for `statusCode: 429`.
- `browse wait --networkidle` returns before the stream ends. Wait for
  `#agent-message:not([disabled])` instead.

The Vercel adapter forwards streaming deltas as they arrive and holds database context until
the response completes. Measure first text on preview separately from full reply duration;
provider latency and output length can change each run.
