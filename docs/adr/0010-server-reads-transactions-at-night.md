# The server reads transactions at night for opted-in users

## Status

Accepted 2026-11-10. Amends [0004](0004-neon-data-boundaries.md) (further cross-tenant functions) and
extends [0009](0009-account-held-vault-key.md): for users who switch the instinct agent on, the
personal vault is no longer closed to the server.

## Context

The instinct agent tells a user what needs attention: a renewal in the coming week, a trial about
to end, a better card or rate. Today LaVega only works when the user opens it. The vault lives in
the browser, so a closed browser means no data and no message. An agent that waits to be opened
is not an agent.

## Decision

Choice A. Only for users who opted in:

1. Once an hour, a cron lists the users whose send time has come (`personal.list_agent_due_users`,
   migration 0028). A user is due when the Amsterdam hour is the user's send hour (default 08:00)
   or up to `RETRY_HOURS` (2) later, counted round the clock so the window can pass midnight, and
   the user's day claim is empty or earlier than the "message day". The message day (the Amsterdam
   date on which the send hour fell) only decides who is due. The run itself uses the real
   Amsterdam date for the claim, the sent keys, the event dedupe keys, the day words in the message
   and the fetch counter. The claim only moves forward (`last_sent_date` is NULL or earlier), so a
   user gets at most one message per real Amsterdam date: if a retry that wrapped past midnight
   delivers, that date's regular send is not made. For each listed user the cron
   fetches the last 90 days of transactions and the balances from the user's Enable Banking sessions.
2. The bank is also read when a WhatsApp question needs fresh data. Both paths share one per-day
   fetch counter per user: WhatsApp may take a read while the count is below 3, the cron while it
   is below 4 (`WHATSAPP_FETCH_CAP`, `CRON_FETCH_CAP` in `apps/server/src/agent/instinct.ts`).
   When the cron's cap is used up, it builds
   the message from candidates that need no bank data (a due date within 7 days, a reviewed tip,
   the card offer; no tip can fire there) and sends nothing if none qualifies; it makes no bank
   call. That message does not reset the "paused" notice flag.
3. The fetched data is held in memory for the length of one run, used to compute the message,
   and discarded. No raw transaction or balance, and no IBAN, is written to Neon or a log line,
   or put in a model prompt. Derived figures (a renewal amount, a yearly gain) appear in the
   messages that are sent; those are stored encrypted as message events.
4. WhatsApp answers use a model in two steps, and no model text is ever sent to the user.
   Before any of this, WhatsApp answers need their own consent: the AI opt-in lives only in the
   browser, so the user ticks a separate required box when linking
   (`POST /api/agent/whatsapp/link-code` needs `{"aiConsent":true}`, else 400
   `ai-consent-required`; the time is stored in `ai_consent_at` on `agent_link_codes` and
   `agent_whatsapp`). Without it, the answer path sends a fixed reply and makes no model, bank or
   budget call.
   Step 1: the model sees the question (run through `scrubPersonalValues`), today's date and the
   category names, and picks one read-only tool. Tools: `spending_on_day`, `spending_in_range`,
   `compare_weekday`, `upcoming_charges`, `top_categories`. A pure function computes the facts
   as sentences. Step 2: the model sees the question and the fact sentences and returns only
   `{"use":[indices]}`. To Mistral goes the scrubbed question and, for tools without bank text, the computed fact
   sentences (totals, dates, category names). Never transaction rows, counterparty names, IBANs
   or balances. A tool result whose facts embed text from bank data (`containsBankText`; today
   `upcoming_charges` with at least one item) skips step 2, and so does a tool that returns one
   fact: all its facts are sent, so no
   counterparty name reaches the model.
   The server composes the message from the chosen sentences (at most 1000
   characters, with a "... and N more lines" line). `guardAnswer` in
   `apps/server/src/agent/numberGuard.ts` checks before sending that every line is a fact or the
   "more" line. That holds by construction, so the guard is an invariant check. Built order: rate
   limit, LLM budget gate, step 1, bank read under the fetch cap, tool, step 2, compose, send.
5. What is stored: message events (encrypted; kept 90 days; the user can delete any one or a
   whole conversation), the agent settings, minimal state (what was sent and when, so nothing is
   sent twice; the per-day fetch count), and a mirror of the user's category rules, due dates and
   the card offer (card name and yearly gain figure), which the browser refreshes. Also stored:
   - the WhatsApp number, sealed with `encryptBlob`, with an HMAC of it (`phone_hash`) as the only
     lookup key;
   - one-time link codes, as an HMAC only, valid 15 minutes (a new code replaces the user's earlier
     one, expired or not; there is no separate cleanup);
   - push subscriptions, sealed;
   - a WhatsApp link goes stale after 90 days without activity (the later of link time and last
     inbound message): no send, the link and any pending code are deleted, and one feed notice is
     written. Other channels are unaffected;
   - the user's email address for the email channel, sealed.
6. `personal.agent_link_attempts` (migration 0029) records failed link-code attempts (5 per phone HMAC per 15 minutes; there is no global cap). It has no
   user id (the sender is unknown), holds the phone HMAC and a timestamp, and has no grant for the
   runtime role. It is not part of account erasure because it holds no user id. Rows older than
   15 minutes are purged by `agent_consume_link_code` on every call and by
   `personal.agent_purge_link_attempts()`, which the cron calls once per run.
7. Consent is explicit, off by default, and worded exactly (NL): "LaVega leest elke nacht je
   transacties om je meldingen te sturen, en bewaart ze niet." (`CONSENT_TEXT_NL` in
   `apps/server/src/instinctConsent.ts`, version `CONSENT_VERSION`.)
   Turning the agent off deletes all server-side agent state. After that, the repository writes
   state and events (`claimDay`, `putState`, `takeFetchBudget`, `appendEvent`) only while an
   enabled settings row exists, so a late call cannot re-create state. The same holds for the
   mirror, push subscriptions and link codes, and the link-code function refuses for a user whose
   agent is off. The WhatsApp answer path does nothing when the agent is off. The cron skips users whose
   consent version is older than `CONSENT_VERSION`. `unlink()` also deletes pending link codes.
   The `feed` channel is always stored in `channels`. Push and email failures are logged as
   event name, error name and status only.

## Why

The agent has to come to the user. A message at 08:00 needs data at 08:00, and the only party
that is awake then is the server. Holding the fetch in memory keeps the stored footprint to what
the user can see and delete in the feed.

## Consequences

- "The server cannot read the vault" no longer holds for opted-in users. ADR 0009 already says
  the server can unseal the vault key; this adds that it reads bank data live. Users who never
  opt in are unchanged.
- The privacy statement must describe the nightly read, and account erasure must cover every new
  store: the seven agent tables with a user id (`agent_settings`, `agent_state`, `agent_mirror`,
  `agent_push_subscriptions`, `agent_events` from migration 0027; `agent_whatsapp`,
  `agent_link_codes` from 0029). `agent_link_attempts` holds no user id and is purged after 15
  minutes. `ai_consent_at` on two of them is a plain timestamp.
- Turning the agent off deletes all server-side agent state in one step.
- Consent to the bank is requested at the bank's maximum validity, so the nightly read lasts as
  long as the bank allows. A reminder goes out 7 days before expiry; after expiry, messages that
  need data pause.
- A fetch the bank refuses (no PSU headers, unattended) skips that day silently; the cron tries
  again in the next hour of the retry window. At most one proactive message per user per day.
- The consent sentence says "elke nacht", but the cron reads at the user's own send time (default
  08:00), and a WhatsApp question can trigger a read at any hour. Open decision for the owner:
  reword the sentence (for example "elke dag" or "op het tijdstip dat jij kiest"). If the sentence
  changes, bump `CONSENT_VERSION` so earlier consents do not stand for the new wording. The code
  is not changed by this ADR.
