# Card terms: fresh, not tidy — design

**Alexander's objection, which is correct:** "we cannot accept a 7-month-old information gap in
today's economy — when I manually search I can find the terms quite easily."

He is describing the agent. Claude with web search does exactly what he does by hand, and it works:
measured on 2026-08-16, it returned Revolut 0%, ING betaalpas 1,4%, ING creditcard 2%, ABN AMRO
1,2% and 2%, Trading 212 0%. Its weakness was never accuracy — it was **latency** (40s to 5min) and
occasionally coming back empty.

## What was wrong, in order of how much damage it did

1. **The precedence ladder ignored age.** `comparison(2)` outranked `agent(1)`, so bank.nl's table —
   stamped _laatst gecontroleerd 2026-01-15_ — would overwrite a lookup done this morning. Fixed in
   `79ab906`: much-older figures are refused whatever their source, much-newer ones are accepted
   whatever their source, and precision only decides between figures of similar age.
2. **The n8n workflow fetched fixed URLs**, which is the approach that failed every way it could:
   the Amex URL 404'd, ABN's "in het buitenland" page is marketing copy, ABN's tariff page is a
   JS shell, Revolut and Trading 212 answer 403 behind Cloudflare, ING kills the connection, and
   Knab's multi-product page made the model report the **creditcard's 2%** when we asked for the
   betaalpas — which actually charges 1,4%. One wrong number out of six is a worse outcome than
   none, because a wrong number gets acted on.

## The fix: n8n becomes a scheduler, not a second implementation

The obvious repair is to give the n8n workflow web search instead of fixed URLs. Do not do that.
`apps/server/src/agent/travel.ts` **already** performs this lookup correctly, and it carries two
findings that cost real time to learn:

- `tool_choice: { type: "auto" }`, deliberately **not** forced. Measured: forcing the report tool
  makes the model answer on its first turn, before it can run a single search — so it reports
  provider names with no fields at all. Forced ⇒ zero searches, empty terms. Auto ⇒ ~10 searches,
  correctly hedged answers.
- `max_uses: 4`, a 240s ceiling, `maxRetries: 0`, and result attribution that pins a reply to the
  provider we asked about so a model cannot introduce products the owner does not hold.

Rebuilding that in a Code node would duplicate the prompt composition, the tool wiring, the
attribution and both findings — and it would drift. So:

**The card-terms workflow collapses to one HTTP node on a schedule:**

    daily 06:00  →  POST https://lavega.dev/api/agent/travel-facts
                    { homeCountry, destination, currency, providers[], knownFacts: [] }

That endpoint returns instantly with whatever is cached and starts background lookups for the gaps.
So a daily ping keeps the cache warm, and by the time anyone opens the travel block the answer is
already there — which removes the agent's only real weakness without touching its accuracy.

What disappears with it: six URLs to maintain, the HTML-to-text node, the per-provider Anthropic
call in n8n, the second copy of the prompt, and the whole class of bug where a model reads the
neighbouring product off a multi-product page.

Keep `POST /api/card-terms/ingest`. It is closed unless its token is set, and it stays the only way
to push a corrected figure in from outside.

## What each source is for, after this

| Source                     | Covers                                     | Freshness           | Role                                           |
| -------------------------- | ------------------------------------------ | ------------------- | ---------------------------------------------- |
| The owner's own correction | anything he fixes                          | permanent           | wins over everything, always                   |
| Agent + web search         | every provider, incl. the bot-blocked ones | today               | **primary**                                    |
| bank.nl comparison         | 7 Dutch banks, debit and credit apart      | stamped, months old | **instant floor**, so the block is never empty |

bank.nl stops being the ceiling and becomes the floor: it fills a gap in one fetch, is visibly
dated, and is superseded the moment a fresher lookup lands.

## The UI half

Every figure shows **how old it is** — "1,4% · gevonden vandaag" against "1,4% · gecontroleerd
15 jan" — so he can judge it rather than trust it. That is the same principle as the coverage
notes on the forecast and the "not comparable" state on the month comparison: the app says what it
knows and how well it knows it.

## Verified, not assumed

The bank.nl parser was run against the **live page** on 2026-08-17, not the saved fixture: HTTP 200,
96,751 bytes, 12 rows across 7 banks with debit and credit kept apart. It reports Knab betaalpas at
**1,4%** — correcting the exact figure the per-provider workflow got wrong — and returns `null` for
American Express and Revolut rather than guessing, so those fall through to the agent by design.
