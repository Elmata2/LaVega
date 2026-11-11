# The instinct agent: a daily money message, two-way on WhatsApp, that can cancel

Date: 10 November 2026. Status: phases 1 and 2 implemented 11 November 2026
(staged on branch `docs/instinct-agent-design`, not deployed). Phase 3
(cancelling) is not built and waits for a lawyer. Where this spec and the code
differ, the code is right; the notes marked "As built" and
`docs/adr/0010-server-reads-transactions-at-night.md` say how. Evidence: `docs/research/2026-10-26-instinct-teardown.md`, prior
proposal `docs/research/2026-10-26-lavega-agent-memory-design.md` (on the
card-advice worktree; copy it into this branch with the spec).

## Why

LaVega only helps when the user opens it. The owner wants LaVega to come to the
user, like Instinct does on WhatsApp: one short message on an ordinary day,
the ability to reply, and real action when asked ("zeg Disney+ op").

## What the user gets

On a normal day, at most one message, only when something is worth saying:

1. **Spending vs the same weekday last week.** "Je gaf gisteren €84 uit, €40
   meer dan vorige dinsdag."
2. **Deadlines.** Subscription renewals and trial ends in the next 7 days
   (from detected subscriptions), VAT deadlines for users who charge VAT,
   other known due dates.
3. **One tip** that fits the day, from a fixed, reviewed tip library (no free
   AI invention of facts). As built: tips key on the transaction data only;
   the intake answers are not mirrored, so `answers` is always `{}`. Each tip
   has a `reviewedAt` date in `packages/core/src/instinct/tips.ts`; a tip with
   `reviewedAt: null` is never sent, and all five tips are unreviewed today.
4. **A better card or interest rate** when the existing card comparison or
   live savings rates show at least €50 a year more (owner may tune).

Channels, chosen per user in settings (any combination): push notification on
the phone, a feed inside the app, WhatsApp (two-way), email.

Two-way on WhatsApp: the user can ask a question in plain Dutch or English and
get an answer computed from the last 90 days. As built the answers are
read-only; cancelling a subscription is phase 3 and is not built.

## Decisions taken with the owner

- **Server reads transactions, opt-in (choice A).** For users who turn the
  agent on, the server fetches the last 90 days from Enable Banking at the
  user's send time (default 08:00 Europe/Amsterdam; an hourly cron with a
  2-hour retry window, `RETRY_HOURS`), computes the message in memory, and
  discards the transactions. Only
  the message, the channel settings and the minimal state below are stored.
  Same on an incoming WhatsApp question that needs fresh data: fetch, answer,
  discard. Both paths share one fetch counter per user per day: WhatsApp takes
  a read while the count is below 3, the cron while it is below 4. Clear consent
  text, NL: "LaVega leest elke nacht je transacties om je meldingen te sturen,
  en bewaart ze niet." This changes today's privacy promise (vault closed to
  the server) for opted-in users only; the vault itself stays as it is. Open
  decision: the sentence says "elke nacht" but the read happens at the user's
  send time (see ADR 0010).
- **Two-way WhatsApp, like Instinct**, via the official WhatsApp Business
  (Cloud) API with a LaVega number.
- **Cancelling is real, by email (phase 3, not built).** On the user's "Ja" for that subscription,
  LaVega sends a formal cancellation email to the provider from LaVega's own
  agent mailbox, in the user's name, citing their authorisation. It watches
  for the confirmation reply and reports back. Where a provider only accepts
  its own cancel button, LaVega sends the direct link and steps instead. After
  the next expected charge date it checks whether the payment stopped.

## What we take from Instinct, and what we refuse

Take: an agent woken by events (nightly job, inbound message, inbound email);
one persistent conversation per user per channel; approvals as data on the
timeline (an approval request and its answer are events, replayable);
idempotent sends keyed by an event id.

Refuse (from the memory proposal): invisible memory, memory outside deletion,
credentials copied to the agent, telemetry by default. Every stored item is
listable and deletable by the user, and "erase everything" covers it.

## Shape

- **Consent + settings** (Neon, server): agent on/off, channels, send hour,
  WhatsApp number (linked by a one-time code that the user sends to LaVega's
  number), email, push subscription(s), language, consent version and date.
  As built there are no quiet hours; the send hour takes their place. The
  cancellation authorisation text is phase 3.
- **Hourly job** (Vercel cron `0 * * * *` on `/api/cron/instinct`, per due
  opted-in user): fetch 90 days → compute candidates in memory using
  existing core functions (spending by day, `computeSubscriptions`, card
  comparison, live rates; the card gain comes from the browser's mirror) → pick at most one message → render per channel →
  send → store the message event. A daily cap of one proactive message is
  enforced by a day claim in `agent_state`.
- **Minimal state** (Neon): last message date, last sent candidate keys (to
  avoid repeating the same tip or renewal), the per-day fetch count.
  Cancellation cases are phase 3. No transactions, no balances, no IBANs stored.
- **Conversation store** (Neon, per user, per channel): typed events like
  Instinct's timeline. The database CHECK constraint allows six types:
  message, approval_request, approval_response, action, action_result, error.
  As built, the code writes only message, approval_response and error;
  approval_request, action and action_result are reserved for phase 3.
  Retention is 90 days (`EVENT_RETENTION_DAYS`, purged by the cron) with
  per-event and per-conversation delete. Amounts appear in message text the
  user already received; nothing else is copied in.
- **Two-way handler** (as built, read-only): WhatsApp webhook → verify the
  Meta signature → map the sender's number to a linked user → rate limit (20
  messages per user per hour) → LLM budget gate → step 1: the model sees only
  the scrubbed question (`scrubPersonalValues`), today's date and the category
  names, and picks one read-only tool → bank read under the shared fetch cap →
  a pure function runs the tool and computes fact sentences → step 2: the
  model sees the question and the fact sentences and returns only
  `{"use":[indices]}` (step 2 is skipped when the tool returns one fact, or
  when the facts embed bank text; then all facts are sent) → the server composes the message from the chosen
  sentences (at most 1000 characters, then a "... and N more lines" line) →
  send. No model text is ever sent. `guardAnswer`
  (`apps/server/src/agent/numberGuard.ts`) checks that every line is a fact or
  the "more" line; it holds by construction and is an invariant check, not a
  filter. The model never sees a transaction, an IBAN, a balance, the phone
  number or the user id. Free-form replies go only inside WhatsApp's 24-hour
  window; proactive messages use an approved template.
- **Tools** (as built): `spending_on_day`, `spending_in_range`,
  `compare_weekday`, `upcoming_charges`, `top_categories`. All read-only.
  There is no `propose_cancellation`. A WhatsApp button reply is stored as an
  `approval_response` event and answered "Annuleren is nog niet beschikbaar."
  (EN: "Cancelling is not available yet."); nothing acts on it.
- **Cancellation flow** (phase 3, not built; state machine per case): proposed → approved (user
  "Ja" on the approval event) → sent (email out, from
  `agent@<lavega domain>`, Resend) → confirmed (provider reply matched by the
  existing email worker, `apps/email-worker`) or no_reply (after N days,
  remind and offer the link route) → verified_stopped / still_charged (after
  the next expected charge). Cancellation addresses come from a reviewed
  provider catalogue (new: provider, email address, cancel URL, notice
  period, source, checked date), like the card catalogue.
- **Push**: web push via a service worker and VAPID keys; the in-app feed
  reads the same message events.
- **Email channel**: Resend, same template as push in longer form.

## Constraints

- The AI never invents facts or amounts: every figure in a message comes from
  computed data. As built the model writes no user-facing text: daily messages
  are rendered from templates, and WhatsApp answers are composed by the server
  from computed fact sentences that the model only selects.
- Investing stays out (no product advice); card and rate suggestions stay
  factual, as in the plan.
- Cancellation emails only after an explicit per-subscription "Ja"; never in
  bulk; the user can stop a case before sending.
- Everything opt-in, off by default, and off again with one switch that also
  deletes the server-side state.
- NL and EN copy.

## Phases (proposal)

1. Consent, settings, in-app feed, hourly job, the four message kinds, push
   and email channels. Implemented 11 Nov 2026, staged, not deployed.
2. WhatsApp: number linking, outbound templates, two-way answers (read-only).
   Implemented 11 Nov 2026, staged, not deployed.
3. Cancellation by email (not built, waits for a lawyer) with the provider catalogue, confirmation tracking,
   payment-stopped check.

## Settled after the builder check and research (10 Nov)

Owner answers:
- Phases 1 and 2 are built now. **Phase 3 (cancelling) waits for a lawyer**:
  the authorisation wording, whether providers accept a gemachtigde, and ACM
  rules for paid cancellation services (clear that LaVega acts as
  intermediary). No official source was found that a third party may cancel
  by email under a volmacht; general agency law (BW 3:60 ff.) suggests it,
  unverified.
- If a provider ignores a cancellation, LaVega **reports and follows up only**
  (reminder, cancel link, payment-stopped check). No refund promise.
- A **customer number or account email** is asked in WhatsApp at the moment of
  "Ja", only when the provider catalogue says that provider needs it.

My calls:
- **Send time**: the user picks a daily time (default 08:00, Europe/Amsterdam);
  an hourly cron sends to users whose send hour is the current hour or one of
  the 2 hours before it (`RETRY_HOURS`, counted round the clock, so it can pass
  midnight), and whose day claim is empty or earlier than their "message day" (the
  Amsterdam date on which the send hour fell; it only decides who is due). The
  claim, dedupe keys, day words and fetch counter all use the real current
  Amsterdam date, and the claim only moves forward. A user gets at most one
  message per real Amsterdam date: if a retry that wrapped past midnight
  delivers, that date's regular send is not made. There are no quiet hours.
- **Bank consent**: Enable Banking allows unattended fetches (often max 4 per
  day per bank; send no PSU headers so the call is marked unattended) and
  consents up to the bank's `maximum_consent_validity` (often 180 days, code
  falls back to 89 when the bank states no maximum). Renewal needs the user (SCA). 7
  days before expiry the agent sends "Koppel je bank opnieuw" through the
  user's channels; after expiry the agent pauses messages that need data and
  says so once. A refused fetch skips that run silently; the cron tries again in
  the next hour while the 2-hour retry window lasts, then waits for the next day. "Agent on" requires at least one connected bank.
- **Server access to sessions**: the cron lists due users through a
  `SECURITY DEFINER` function (`personal.list_agent_due_users`, migration 0028)
  and then reads each user's `eb_sessions` inside `withTenant(userId)`. No
  dedicated server role was added; see the ADR 0004 amendment.
- **Categories and due dates**: for opted-in users the browser mirrors the
  user's category rules, due dates and the card offer's yearly gain to Neon,
  so the daily message matches the app. Subscription corrections are not
  mirrored. Removed when the agent is turned off.
- **Privacy wording**: ADR 0009 already states the server can technically
  decrypt personal vaults; the spec does not claim otherwise. Choice A is
  recorded as a new ADR (server reads transactions at night for opted-in
  users, discards them), and the privacy statement and "erase everything"
  cover the new server-side stores.
- **Inbound cancellation mail** (phase 3): the email worker gets a second route
  for `agent@` with a per-case token in the reply address
  (`agent+<token>@`), posting straight to the server; a reply only counts when
  the token matches an open case AND the sender domain matches the provider in
  the catalogue.
- **WhatsApp**: number linking by a code shown in the app that the user sends
  to LaVega's number (inbound, free, no template needed). Approvals
  would use WhatsApp reply buttons on a message tied to one case (phase 3:
  `sendButtons` exists and is unused). Proactive messages use
  one utility template with only the user's own figures (exactly ONE body
  variable: the short text; create it in both `nl` and `en` under the same
  name), nothing promotional
  (a mixed template is billed as marketing at 3 to 4 times the rate). NL rates
  to be taken from Meta's rate CSV before launch; third-party figures
  conflict.
- **State and encryption**: per-user tables in the `personal` schema with the
  RLS pattern used for vaults; message text and conversation events encrypted
  at rest following the ADR 0007 pattern.


## As built (11 Nov 2026)

Source of truth is the code; this section records where it ended up.

### Routes

All `/api/agent/*` routes below are behind a session, send
`Cache-Control: private, no-store`, and answer 503 `agent-not-configured` when
a required key is missing (checked on every request, never at boot). They are
registered only when a runtime database is configured.

| Method and path                           | What it does                                                         |
| ----------------------------------------- | -------------------------------------------------------------------- |
| `GET /api/agent/settings`                 | Settings, `bankConnected`, `consentVersion`, public VAPID key.        |
| `PUT /api/agent/settings`                 | Turn on (needs the current consent version and a live bank) or off (off deletes all agent state). |
| `PUT /api/agent/mirror`                   | Store the mirror (rules, due dates, card offer). 409 while the agent is off. |
| `DELETE /api/agent/mirror`                | Empty the mirror.                                                    |
| `POST /api/agent/push`                    | Store one push subscription. 409 `agent-off` while the agent is off.  |
| `DELETE /api/agent/push`                  | Remove one subscription by endpoint.                                 |
| `POST /api/agent/whatsapp/link-code`      | Body `{"aiConsent":true}` required, else 400 `ai-consent-required`. Create a one-time link code (15 minutes) and return it with the display number. Also 409 `agent-off` while the agent is off. |
| `GET /api/agent/whatsapp`                 | Link status, masked phone (last two digits), link time.              |
| `DELETE /api/agent/whatsapp`              | Unlink.                                                              |
| `GET /api/agent/feed`                     | Events, newest first. Query: `channel`, `limit` (1 to 100), `before` cursor. |
| `DELETE /api/agent/events/:id`            | Delete one event.                                                    |
| `DELETE /api/agent/conversation/:channel` | Delete all events of one channel.                                    |
| `GET /api/cron/instinct`                  | The hourly cron (`0 * * * *`). Public in `apiGuard`, guarded by `CRON_SECRET` as a bearer token. Registered even without a database. |
| `GET /api/whatsapp/webhook`               | Meta handshake: echoes `hub.challenge` only when `hub.mode` is `subscribe`, `hub.verify_token` matches and the challenge is non-empty, else 403. |
| `POST /api/whatsapp/webhook`              | Inbound messages. Public in `apiGuard`, trusted only by the Meta signature. |

### Webhook behaviour

- The signature (`X-Hub-Signature-256`, HMAC-SHA256 with `WHATSAPP_APP_SECRET`)
  is checked on the raw bytes before anything is parsed.
- 401 when the secret is unset or the signature is bad. 413 when the body is
  over 256 KiB. 500 when a database call fails, so Meta retries; the dedupe key
  `wa:<wamid>` makes a retry safe. 200 for everything else, including a body
  that is not JSON and messages from unknown numbers.
- Outbound messages are stored with the dedupe key `wa-out:<wamid>`.
- A text from an unlinked number is checked against the link-code format
  (`LV-` and eight characters) and consumed through
  `personal.agent_consume_link_code`. Anything else gets no reply. The link
  code throttle lives in Postgres: 5 failed attempts per phone HMAC per 15
  minutes. There is no global cap.

### Tables

Seven agent tables carry a user id and are deleted by account erasure
(`USER_DATA_TABLES` in `packages/database/src/index.ts`): `agent_whatsapp`,
`agent_link_codes`, `agent_events`, `agent_push_subscriptions`, `agent_mirror`,
`agent_state`, `agent_settings`, all in schema `personal`. An eighth table,
`agent_link_attempts`, has no user id, no runtime grant, and is not in
erasure; it is purged after 15 minutes. See ADR 0004 for the cross-tenant
functions.

### Bank consent validity

`/api/eb/auth` looks up the chosen bank in Enable Banking's `/aspsps` list and
asks for `access.valid_until` of `floor(maximum_consent_validity / 86400)`
days, capped at 180 (`consentDaysFor` in `apps/server/src/eb-routes.ts`). If
the bank states no maximum, or the lookup fails, it asks for 89 days. The
callback stores the `valid_until` that the bank echoes if it lies between now
and now plus 180 days, else 89 days from now. `SESSION_TTL_MS` is 181 days so
a stored session outlives its consent. The cron sends a reminder when the
earliest consent expiry among the banks that answered is 0 to 7 days away
(once per expiry date), and one "paused" notice when every consent has expired.

### WhatsApp consent and what goes to the model

The AI opt-in lives only in the browser, so linking WhatsApp takes its own
required consent (`ai_consent_at` on `agent_link_codes`, copied to
`agent_whatsapp`). Without it the answer path sends a fixed reply and makes no
model, bank or budget call. To Mistral goes the scrubbed question and, for tools
without bank text, the computed fact sentences (totals, dates, category names).
Never transaction rows, counterparty names, IBANs or balances. A tool result
with `containsBankText` (today `upcoming_charges` with at least one item) skips
step 2 and all its facts are sent, so no counterparty name reaches the model.

### Turn-off and housekeeping

State, event, mirror, push subscription and link code writes only happen
while an enabled settings row exists, and `agent_consume_link_code` refuses
for a user whose agent is off. The WhatsApp answer path does nothing when the
agent is off. The purge of old link attempts runs first in every cron run, so
it runs even when the due listing fails (that answers 503 and logs the error
name). Auth notice mail failures log `auth_notice.failed` with error name and
status only. The scrubbed question filter removes IBANs, e-mail addresses,
phone numbers, BSNs and amounts written with a euro sign or EUR; amounts
without a sign stay. The
cron skips users whose consent version is older than `CONSENT_VERSION`, and
calls `personal.agent_purge_link_attempts()` once per run. `unlink()` deletes
pending link codes. A new link code replaces the user's earlier one (upsert),
expired or not. `feed` is always in `channels`. Push and email failures log
the event name, error name and status only.

### Known limits

- The rate limiters (20 WhatsApp messages per user per hour, the first
  link-code filter) live in the memory of one server instance, so each
  instance counts alone.
- A WhatsApp link goes stale after 90 days without activity (the later of
  link time and last inbound message): the next proactive send does not go out,
  the link and any pending code are deleted, and one feed notice is written.
  Other channels are unaffected. A user message refreshes the clock.
- A push subscription belongs to one browser, not to the account.
- The cron has no per-user time limit on the bank fetch; only the overall
  budget of 80% of the 300-second function limit stops the loop.
- When the shared fetch cap is used up, the cron builds the message from
  candidates that need no bank data (a due date within 7 days, a reviewed tip,
  the card offer; no tip can fire there). If none qualifies, nothing is sent
  and the day claim stays. A message from this path does not reset the
  "paused" notice flag.
  The owner may want to change this.
- WhatsApp answers have no conversational tone by design: the server sends
  computed sentences, not model text.

## Open at spec time (status 11 Nov 2026)

Still open:
- WhatsApp Business costs per conversation in NL and template approval time
  (to be looked up, not guessed).
- Legal: review of the privacy statement for choice A (section "Dagelijkse
  melding" in `apps/server/src/legal.ts`), and the cancellation authorisation
  wording (phase 3).
- The consent sentence says "elke nacht" (ADR 0010: owner decides).

Answered by the build, not yet proven against a live bank: the agent sends no
PSU headers so the read counts as unattended, and caps reads at 4 per day per
user (the bank limit is about 4). Renewal of the consent needs the user, so the
agent reminds and pauses instead.
