# Portfolio agents

The investor lens on the overview, and the conversation page behind one persona.

## Sub-features

- overview card, eyebrow `Agent`, title `Investor lens`. Six personas from
  `GET /api/agents/portfolio`: Warren Buffett, Charlie Munger, Bill Ackman, Ben Graham,
  Peter Lynch, Stanley Druckenmiller. The radio group is `Choose agent`.
- `Analyse portfolio` posts `POST /api/agents/portfolio/run`. Loading label
  `Agent reading…`. Failure text is the server problem, or `Agent run failed.`
- `Open conversation with <name>` is a same-tab link to `/agents/:agentId`. Choosing a
  persona in the radio group also calls `window.open` on that route, and falls back to
  the same route when the popup is blocked.
- conversation page. Shell eyebrow `Agent conversation`, title `Agent`. Inside the card
  the eyebrow is `Portfolio agent` and the title is the persona name. The prompt
  placeholder is `Ask about your positions…` and the button is `Send`. The reply posts
  `POST /api/agents/portfolio/conversation` with `agentId`, `prompt` and `history`.
- context list `Your positions`. Empty copy: `No positions available.`
- missing states: `Loading agents…`, `No portfolio agents available.`, `Agents unavailable`,
  `Agent not found` / `Choose an agent from the overview.`

## How to get to it (user POV)

The card is on the overview, under the risk summary and above `Status`. Open a persona to
reach `/investing/agents/<id>` (`/agents/<id>` on the standalone server).
`← Back to overview` returns to `/`.

## Driving it with control-investing

```bash
C=".claude/skills/verify-investing/control-investing.mjs"
node $C api GET /api/agents/portfolio
node $C assets --path /agents/warren_buffett
node $C api POST /api/agents/portfolio/run --body '{}'
```

Proof the catalog works: `200` and six agents, each with `id`, `displayName`, `description`
and `investingStyle`, and no `instructions` or `criteria`. The overview renders those six
names and `Analyse portfolio`. `/agents/warren_buffett` renders that persona.
`/agents/not-a-persona` renders `Agent not found`.

A run or a conversation on a fresh local server is `verified-unreachable` past this point.
`POST /api/agents/portfolio/run` and `POST /api/agents/portfolio/conversation` answer `502`
with `Agent run storage failed to start` while the file vault is empty or locked. The store
throws `credential vault is locked` (`apps/investing-server/src/fileCredentialStore.ts`).
Unlock the vault first. Do not invent a passphrase.

After the vault is unlocked, the judgment run still needs `TYPESAFE_API_KEY`
(`apps/investing-server/src/systemOne.ts`). The conversation text model needs
`LAVEGA_AGENT_API_KEY` or `OPENROUTER_API_KEY`
(`resolvePortfolioConversationConfig` in `apps/investing-server/src/portfolioAgent.ts`).
Those are not the keys `/api/config/status` reports.

## Gotchas

- The catalog is public to the investing API. It does not call a model. A `200` catalog is
  not proof that `Analyse portfolio` can finish.
- `?verify=1` does not disable the agent card.
- A conversation also starts a judgment run, so it fails at the same vault gate as
  `Analyse portfolio`.
- Do not post a run against production. It spends a model call and writes a run record for
  the signed-in tenant.
