# Stock research

Open **Agents → Research Stock** at `/investing/agents/research`. Enter a company ticker,
such as `AAPL`. The workspace shows company fundamentals on the left and five investment
lenses on the right: Warren Buffett, Charlie Munger, Bill Ackman, Benjamin Graham and
Peter Lynch. Existing portfolio agents remain available from the Agents catalog.

`POST /api/agents/research/run` accepts `{ "symbol": "AAPL" }`. The server checks the
signed-in tenant's market-data consent, fetches fresh Yahoo company fundamentals, then
sends one TypeSafe System One request containing signal and conviction questions for
each lens. The run does not require broker positions. Missing company data, provider
errors and model errors are reported explicitly. Missing metrics display as unavailable.

The report includes provider and fetch time, price currency, financial statement currency,
typed judgments and model identity. Price and free cash flow can use different currencies.
Percent metrics are stored as fractions and displayed as percentages. These are fetched
company facts, not a live quote feed.

Signal is bullish, bearish, neutral or no view. Bullish probability is the model's
probability assigned to the bullish classification, not the probability a share price
will rise. Signal confidence is the probability assigned to the selected classification.
Conviction measures evidence certainty separately. System One does not generate written
reasoning; the short overview describes the relevant investing rubric. Profile chat gives
a fuller explanation from the facts.

Selecting a lens opens its streaming conversation beside the same metrics. Each lens has
its own conversation for the report. A new research run starts new conversations.
`POST /api/agents/research/conversation` accepts `{ agentId, reportToken, messages }`.
The server verifies an HMAC-signed report bound to the signed-in tenant and expiring after
one hour, then uses the exact report facts. It does not fetch company data again or read
unrelated holdings. `LAVEGA_ENCRYPTION_KEY` signs deployed reports; local single-tenant
development can use a process-local secret. No database migration is needed.

The existing chat model settings and persona philosophies apply. The personas are
educational approximations, not statements by the real investors. Refresh research when
the report expires or newer facts are needed.

Verification drive: [.claude feature map](../../.claude/skills/verify-investing/features/stock-research.md).
