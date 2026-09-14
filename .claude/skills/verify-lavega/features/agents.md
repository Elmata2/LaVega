# AI agents (categorize, chat, invoice extraction)

The opt-in agents send redacted text to the server, which proxies to Anthropic. Without `ANTHROPIC_API_KEY` on the server every agent route answers `503` and the UI shows the feature as unavailable; with the key set, each agent asks for confirmation before it changes anything.

## Sub-features

- `agents-dark` `/api/agent/status` reports `configured:false` and the agent buttons explain why.
- `agents-status` with a key, `configured:true` and the opt-in toggles appear in Profiel.
- `agents-categorize` `Categoriseer met AI` in Transacties proposes categories for unknown transactions and waits for confirmation.
- `agents-chat` the floating chat answers per-view questions once opted in.
- `agents-invoice` Facturen → PDF upload extracts an invoice draft for confirmation.

## How to get to it (user POV)

- Profiel → AI toggles; Transacties → `Categoriseer met AI`; Facturen → PDF upload; the floating chat button.

## Driving it with control-lavega + browser

Preconditions:

- Dark case: plain `up`. Configured case: `up --with-ai` with a key in `apps/server/.env`.

- **Dark on prod.** Run `node .claude/skills/verify-lavega/control-lavega.mjs api GET /api/agent/status --target prod`; body is `{"configured":false}` (as of 2026-09-07). This is the documented state, not a pass for any agent.
- **Dark locally.** `api POST /api/agent/categorize --body '{"items":[]}'` answers `503`. In the browser, Transacties shows the categorize action disabled or explained.
- **Configured.** With `--with-ai`, `api GET /api/agent/status` is `{"configured":true}`. In Transacties, click `Categoriseer met AI`; a review list appears and nothing is applied until confirmed. Screenshot `agents-01-review.png`; after confirming, reload and check the categories stuck.
- **Redaction.** With `--with-ai`, `logs --lines 40` after a categorize call shows no IBAN, amount or date in the request log lines.
- **Proof.** Status bodies, the 503/200 pair, screenshots of the review flow.

## Gotchas

- A `503` means "no key", a `401` means "no session" (prod only). Do not read one as the other.
- `--with-ai` spends the owner's real key; keep the run small.
- Production has no key on Vercel yet (measured 2026-09-01 and again 2026-09-07), so agent features cannot be verified there until it is set.
