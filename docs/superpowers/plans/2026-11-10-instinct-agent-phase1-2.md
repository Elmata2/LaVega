# Instinct agent, phases 1 and 2: Implementation Plan

> For agentic workers: execute task by task (superpowers:subagent-driven-development). Steps use checkbox syntax. Nothing is committed: every task ends with "Stage (no commit)".

**Goal:** An opted-in user gets at most one short money message a day (spending vs same weekday last week, deadlines in 7 days, one reviewed tip, a card/rate gain of at least EUR 50/yr) by in-app feed, web push and email (phase 1), plus two-way read-only answers and a daily template message on WhatsApp (phase 2).

**Architecture:** An hourly Vercel cron lists opted-in users whose send time falls in this hour, reads each user's Enable Banking session through the existing per-tenant RLS path, fetches 90 days unattended, computes one `Candidate` with a pure core function, renders it from copy templates, sends it, and stores only the message event and minimal state. Transactions live in memory for one call and are never written, logged or sent to a model. WhatsApp inbound goes through a signed webhook to a linked number, then fetch, deterministic read-only tools, and a model that only selects computed fact sentences (the server composes the message). See "As built" below.

**Tech Stack:** TypeScript, Hono on Vercel, Neon Postgres (PGlite in tests), vitest, React, `web-push`, Resend (existing HTTP pattern), WhatsApp Cloud API (plain `fetch`), Mistral via the existing provider.

**Spec:** `docs/superpowers/specs/2026-11-10-instinct-agent-design.md`

## As built (11 Nov 2026): deviations from this plan

Phases 1 and 2 are implemented and staged, not deployed. The task text below is kept as written. Where it differs from this section, this section and the code are right. The spec has the full route list and known limits; ADR 0004 and ADR 0010 have the data decisions.

- **Model role.** No model text is ever sent. Step 1: the model sees the scrubbed question, today's date and the category names, and picks one read-only tool. A pure function computes fact sentences. Step 2: the model returns only `{"use":[indices]}`; the server composes the message from the chosen sentences (at most 1000 characters, then a "... and N more lines" line). `guardAnswer` in `apps/server/src/agent/numberGuard.ts` only checks that every line is a fact or the "more" line, which holds by construction. `numbersIn` was not built. Built order: rate limit, LLM budget gate, step 1, bank read under the fetch cap, tool, step 2, compose, send.
- **Tools.** `spending_on_day`, `spending_in_range`, `compare_weekday`, `upcoming_charges`, `top_categories`. There is no `propose_cancellation`. A button reply is stored as `approval_response` and answered "Annuleren is nog niet beschikbaar."
- **Fetch counter.** One shared per-day counter per user: WhatsApp takes a read while the count is below 3, the cron while it is below 4 (`WHATSAPP_FETCH_CAP`, `CRON_FETCH_CAP`). The counter uses the real current Amsterdam date. When it is used up, the cron builds the message from candidates that need no bank data (due date, reviewed tip, card offer) and sends nothing if none qualifies, and WhatsApp answers "Ik kan nu niet bij je bank, probeer het morgen of open de app."
- **When the bank is read.** At the user's send hour (default 08:00 Europe/Amsterdam) and the 2 hours after it (`RETRY_HOURS`, counted round the clock; the window can pass midnight; the listing's "message day" only decides who is due, and the claim, dedupe keys, day words and fetch counter use the real Amsterdam date. The claim only moves forward, so a user gets at most one message per real Amsterdam date: after a wrapped retry delivers past midnight, that date's regular send is not made), and when a WhatsApp question needs data. The consent sentence still says "elke nacht"; the owner decides whether to reword it (ADR 0010). Rewording means bumping `CONSENT_VERSION`.
- **Event types.** The database CHECK keeps six types. The code writes `message`, `approval_response` and `error`. `approval_request`, `action` and `action_result` are reserved for phase 3. Retention is 90 days; per-event and per-conversation delete exist.
- **Consent validity.** `consentDaysFor` asks for the bank's `maximum_consent_validity` in days, capped at 180, else 89. The callback stores the echoed `valid_until` if it lies within 180 days, else 89 days.
- **Cross-tenant functions.** `list_agent_due_users(local_hour, retry_hours, local_date)` returning `(tenant_id, message_day)` (0028), `agent_user_for_phone` and `agent_consume_link_code` (0029). `agent_link_attempts` holds failed link attempts (5 per phone HMAC per 15 minutes; no global cap) with no user id and no runtime grant.
- **Webhook.** Signature on raw bytes. 401 when the secret is unset or the signature is bad; 413 over 256 KiB; 500 on database errors (Meta retries; the dedupe key `wa:<wamid>` makes that safe); 200 otherwise. Outbound dedupe key `wa-out:<wamid>`.
- **Template.** Exactly one body variable: the short figures line, created in both `nl` and `en` under the same name.
- **Mirror.** Rules, due dates and the card offer (name and yearly gain). Subscription corrections are not mirrored. Tips key on transaction data only (`answers` is `{}`) and are never sent while their `reviewedAt` is null (all five today).
- **WhatsApp consent and bank text.** Linking needs `{"aiConsent":true}` (400 `ai-consent-required` otherwise); without `ai_consent_at` the answer path sends a fixed reply and calls no model, bank or budget. A tool result with `containsBankText` (today `upcoming_charges` with items) skips step 2 and sends all facts (step 2 is also skipped when a tool returns one fact), so no counterparty name reaches the model. Mistral sees the scrubbed question and, for other tools, the fact sentences only.
- **Link codes and links.** Codes are `LV-` plus 8 characters. A WhatsApp link goes stale after 90 days without activity (later of link time and last inbound message): no send, link removed, one feed notice; other channels are unaffected. Mirror, push subscription and link code writes are conditional on an enabled settings row, and the answer path does nothing when the agent is off. The cron purges link attempts first, so the purge runs even when the listing fails.
- **No-bank path.** No tip fires on it and it does not reset the "paused" notice flag. `createLinkCode` has no DELETE: the upsert replaces the user's earlier code, expired or not.
- **Housekeeping.** `personal.agent_purge_link_attempts()` (0029) runs once per cron run. Writes after turn-off are conditional on an enabled settings row. The cron skips users with an old consent version. `unlink()` deletes pending link codes. `feed` is always in `channels`.
- **Config check.** `assertAgentConfig()` runs on every agent route and every cron run, not at boot. A missing key answers 503 `agent-not-configured` and never stops the server.

## Global Constraints

- Opt-in, off by default; one switch turns it off AND deletes all server-side agent state.
- Consent text, exact NL: "LaVega leest elke nacht je transacties om je meldingen te sturen, en bewaart ze niet."
- At most 1 proactive message per user per day; send time per user, default 08:00 Europe/Amsterdam; hourly cron.
- Fetch window 90 days; no PSU headers (unattended); a refused fetch skips the day silently and retries next run; "agent on" requires at least one connected bank.
- Consent requested at the bank's `maximum_consent_validity` (89 days is the fallback when the bank states no maximum); reminder 7 days before expiry; after expiry pause data-needing messages and say so once.
- Deadlines: renewals and trial ends within 7 days. Better card/rate: gain >= EUR 50/yr (5000 cents), constant, owner may tune.
- Stored: message text and event bodies encrypted with `encryptBlob` (ADR 0007); no transactions, balances or IBANs; tables in schema `personal`, forced RLS on `app.user_id`.
- Conversation events: types message, approval_request, approval_response, action, action_result, error; retention 90 days; per-event delete.
- Every figure in any message comes from computed data. As built: the model writes no user-facing text; it selects fact sentences by index and the server composes the answer (see "As built").
- No investing advice; card and rate suggestions factual.
- WhatsApp: signature `X-Hub-Signature-256` verified on the raw body; free-form only within 24 h of the user's last inbound message; proactive = one utility template with only the user's own figures; number linked by a code the user sends to LaVega's number.
- NL and EN copy for everything user-facing; no Dutch outside `copy/` modules (see lavega_i18n_boundary).
- Phase 3 (cancelling) is out of scope.

## Review Focus

1. **Transactions persisted or leaked (choice A broken).** Pinned to Task 10: a sentinel counterparty must not appear in any repository write, log line, event body or model prompt.
2. **A wrong or invented figure reaches the user.** Pinned to Task 5 (computed figures and thresholds) and Task 22 (answers are composed from computed fact sentences; `guardAnswer` is an invariant check).
3. **Double, repeated or off-time messages.** Pinned to Task 6 (no-repeat via state) and Task 11 (two overlapping cron runs send once; failure releases the day claim).
4. **Cross-user exposure.** Pinned to Task 2 (two-user RLS test), Task 11 (cron reads only listed opted-in users) and Task 18 (webhook maps a number to exactly one user, bad signature gets nothing).
5. **Turning off or erasing leaves state behind.** Pinned to Task 3 (`deleteAll`), Task 4 (erasure, phase 1 tables) and Task 17 (phase 2 tables).

## Spec gaps and contradictions found (decisions embedded below)

- Spec says the cron reads `eb_sessions` "through a dedicated server role". The repo already solves this with a `SECURITY DEFINER` listing function plus per-tenant `withTenant` (ADR 0004, migration 0022). Plan uses that pattern and documents it as the ADR 0004 amendment. No new Postgres role.
- Spec says "nightly job" and "hourly cron"; plan uses one hourly cron, with a 2-hour retry window after the user's send time (my call, constant `RETRY_HOURS`).
- Spec Shape says the WhatsApp number is "verified by a one-time code sent from LaVega"; the settled section says the user sends a code to LaVega. Plan follows the settled section.
- "Subscription corrections" do not exist as stored data in the vault (only `Rule[]`). Plan mirrors rules only.
- Deadlines (VAT, other due dates) and held cards live only in the vault. Plan extends the mirror payload with `dueDates` (kind, label, date, no amounts) and a `cardOffer` snapshot (`name`, `yearlyGainCents`, `computedAt`) that the browser refreshes whenever it computes the plan. The nightly job cannot run `computeCards` itself without `PlanProfile` and `heldCards`. Rate gain IS computed server-side (balances and txs are fetched). Needs owner confirmation.
- Enable Banking allows about 4 fetches per bank per day; the daily message uses 1. Plan caps WhatsApp-triggered fetches at 3 per user per day, and says so to the user when exhausted.
- WhatsApp template approval and NL conversation pricing are open (spec). Plan is built against a configurable template name.

## Env vars and secrets (new)

`AGENT_CRON_SECRET` is not needed: reuse `CRON_SECRET`. New: `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` (mailto:alexander.steunenberg@gmail.com), `AGENT_EMAIL_FROM` (defaults to `AUTH_EMAIL_FROM`), `AGENT_DEDUPE_HMAC_KEY` (32 bytes, 64 hex), `AGENT_PHONE_HMAC_KEY` (32 bytes, 64 hex), `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_APP_SECRET`, `WHATSAPP_VERIFY_TOKEN`, `WHATSAPP_TEMPLATE_DAILY`, `WHATSAPP_NUMBER_DISPLAY` (the number users message). Existing and required: `LAVEGA_ENCRYPTION_KEY`, `CRON_SECRET`, `RESEND_API_KEY`, `MISTRAL_API_KEY`, EB credentials.

## Owner actions (not done by agents)

The complete, ordered checklist is "Owner actions for the Instinct agent" in `DEPLOY.md`. The list below is the plan-time version and misses `AGENT_DEDUPE_HMAC_KEY`, the tip review and the consent wording decision.

1. Apply migrations 0027, 0028 (phase 1) and 0029 (phase 2) on prod Neon AND the preview branch, as schema owner with BYPASSRLS (0028 and 0029 refuse otherwise); `ROLLBACK;` first in the SQL editor if it says "Failed transaction".
2. Generate VAPID keys (`npx web-push generate-vapid-keys`), add the three VAPID vars on Vercel (prod and preview).
3. Add `AGENT_PHONE_HMAC_KEY` and the Resend sender for agent mail on Vercel.
4. Confirm the Vercel plan allows an hourly cron (Task 11 adds `0 * * * *`), then redeploy so `config.json` crons update.
5. Meta Business setup (phase 2): verified business, WhatsApp Business account, phone number, permanent system-user token, app secret, webhook URL `https://www.lavega.dev/api/whatsapp/webhook` with verify token, submit ONE utility template (single paragraph, variables only the user's own figures), read NL rates from Meta's rate CSV before launch.
6. Decide the open items above (card snapshot assumption; EN template).
7. Legal review of the privacy statement change (Task 14) before launch; this does not need the phase 3 lawyer work.

---

## Phase 1

### Task 1: ADR 0010 (choice A) and ADR 0004 amendment

**Files:**
- Create: `docs/adr/0010-server-reads-transactions-at-night.md`
- Modify: `docs/adr/0004-neon-data-boundaries.md` (Status paragraph and "One cross-tenant read")

**Interfaces:** none (docs).

- [ ] Write the ADR: Status Accepted 2026-11-10; Decision (opted-in users only, 90 days fetched nightly and on WhatsApp replies, held in memory, discarded; stored = message events, settings, minimal state, mirrored rules); Why (the agent must come to the user); Consequences (vault closed to the server no longer holds for opted-in users, ADR 0009 already says the server can decrypt; privacy statement and erasure cover new stores; EB consent length raised to bank maximum; refused fetch skips the day).
- [ ] Amend ADR 0004: add "Amended by 0010" line and a section "Second cross-tenant read": `personal.list_agent_due_users(hour)` (0028) is `SECURITY DEFINER`, returns user ids only, granted to `lavega_runtime`; the cron then reads each listed user's `eb_sessions` with `withTenant(userId)`. Explain why this replaces the "dedicated role" in the spec (same blast radius, already audited pattern, no second credential).
- [ ] Verify: `grep -n "0010" docs/adr/0004-neon-data-boundaries.md` shows the amendment; `grep -c "list_agent_due_users" docs/adr/0010-*.md` is 1 or more.
- [ ] Stage (no commit): `git add docs/adr`.

### Task 2: Migration 0027, agent tables with forced RLS

**Files:**
- Create: `db/migrations/0027_instinct_agent.sql`
- Test: `packages/database/src/agentTables.test.ts`

**Interfaces:** Produces tables (all `personal`, `user_id TEXT NOT NULL`, composite keys leading with `user_id`, `ENABLE`+`FORCE` RLS, policy `FOR ALL TO PUBLIC USING/WITH CHECK (user_id = NULLIF(current_setting('app.user_id', true), ''))`, grants SELECT/INSERT/UPDATE/DELETE to `lavega_runtime`, owner check block copied from 0024):
- `agent_settings(user_id PK, enabled BOOL, channels_blob BYTEA, send_hour SMALLINT 0-23 DEFAULT 8, locale TEXT 'nl'|'en', consent_text_version TEXT, consented_at TIMESTAMPTZ, email_blob BYTEA, updated_at)`
- `agent_state(user_id PK, last_sent_date DATE, sent_keys_blob BYTEA, last_tip_date DATE, expiry_reminded_for TEXT, expiry_paused_noted BOOL, fetches_today SMALLINT, fetches_day DATE)`
- `agent_mirror(user_id PK, payload_blob BYTEA, updated_at)` (rules, dueDates, cardOffer; no amounts besides the card gain)
- `agent_push_subscriptions(user_id, endpoint_hash TEXT, subscription_blob BYTEA, created_at, PK(user_id, endpoint_hash))`
- `agent_events(user_id, id UUID, channel TEXT CHECK in ('feed','push','email','whatsapp'), type TEXT CHECK in (message, approval_request, approval_response, action, action_result, error), body_blob BYTEA, dedupe_key TEXT, created_at, PK(user_id, id), UNIQUE(user_id, dedupe_key))`, index on `(user_id, created_at)`.

- [ ] Failing test (`agentTables.test.ts`, same PGlite harness as `erasure.test.ts`, role `lavega_runtime`):
  ```ts
  test("user B cannot read or write user A's agent rows", async () => {
    await asUser("a", (q) => q("INSERT INTO personal.agent_settings (user_id, enabled, channels_blob) VALUES ('a', true, '\\x01')"));
    expect(await asUser("b", (q) => q("SELECT * FROM personal.agent_settings"))).toHaveLength(0);
    await expect(asUser("b", (q) => q("INSERT INTO personal.agent_settings (user_id, enabled, channels_blob) VALUES ('a', true, '\\x01')"))).rejects.toThrow(/row-level security/);
  });
  test.each(AGENT_TABLES)("%s has forced RLS and a runtime grant", async (t) => { /* pg_class.relforcerowsecurity, information_schema.table_privileges */ });
  test("dedupe_key makes a second insert of the same event a no-op conflict", ...);
  ```
- [ ] Run `pnpm --filter @lavega/database test -- agentTables` expect FAIL (relation does not exist).
- [ ] Implement the migration (idempotent `IF NOT EXISTS`, `DO $$` policy creation as in 0024).
- [ ] Run again expect PASS; also `pnpm --filter @lavega/database test -- migrations` PASS (existing grant test covers new tables).
- [ ] Stage (no commit).

### Task 3: Agent repository (settings, state, mirror, push subscriptions)

**Files:**
- Create: `packages/database/src/agent.ts`; modify `packages/database/src/index.ts` (`export * from "./agent.js"`)
- Test: `packages/database/src/agent.test.ts`

**Interfaces:**
```ts
export type AgentChannel = "feed" | "push" | "email" | "whatsapp";
export type AgentSettings = { enabled: boolean; channels: AgentChannel[]; sendHour: number; locale: "nl" | "en"; email: string | null; consentVersion: string; consentedAt: string };
export type AgentState = { lastSentDate: string | null; sentKeys: { key: string; date: string }[]; lastTipDate: string | null; expiryRemindedFor: string | null; expiryPausedNoted: boolean };
export type AgentMirror = { rules: Rule[]; dueDates: { kind: "vat" | "other"; label: string; date: string }[]; cardOffer: { name: string; yearlyGainCents: number; computedAt: string } | null };
export function createAgentRepository(db: Database, userId: string | undefined | null): {
  getSettings(): Promise<AgentSettings | null>; putSettings(s: AgentSettings): Promise<void>;
  getState(): Promise<AgentState>; claimDay(today: string): Promise<boolean>; releaseDay(today: string): Promise<void>; putState(patch: Partial<AgentState>): Promise<void>;
  takeFetchBudget(today: string, max: number): Promise<boolean>;
  getMirror(): Promise<AgentMirror | null>; putMirror(m: AgentMirror): Promise<void>;
  putPush(sub: PushSubscriptionJSON): Promise<void>; listPush(): Promise<PushSubscriptionJSON[]>; deletePush(endpoint: string): Promise<void>;
  deleteAll(): Promise<void>; // settings, state, mirror, push subs AND events (turn-off)
};
export async function listAgentDueUsers(db: Database, hour: number, retryHours: number, today: string): Promise<string[]>; // calls personal.list_agent_due_users
```
`claimDay` is `UPDATE agent_state SET last_sent_date = $1 WHERE user_id = current_setting('app.user_id') AND last_sent_date IS DISTINCT FROM $1 RETURNING 1` after an upsert of the row; true only for the first caller.

- [ ] Failing test: round-trip settings (blob not plaintext: raw column does not contain the email string); `claimDay("2026-11-11")` twice via two parallel calls returns exactly one `true`; `releaseDay` makes the next claim true; `takeFetchBudget(today, 3)` true x3 then false, resets next day; `deleteAll()` leaves zero rows in all five tables for that user and does not touch user B.
- [ ] Run `pnpm --filter @lavega/database test -- agent.test` expect FAIL (module missing).
- [ ] Implement with `withTenantStatement` for single statements and `withTenant` where two statements are needed; `encryptBlob/decryptBlob` for blob columns; `endpoint_hash = sha256(endpoint)`.
- [ ] Run expect PASS (note `listAgentDueUsers` is tested in Task 10 after migration 0028 exists).
- [ ] Stage (no commit).

### Task 4: Event repository and erasure coverage

**Files:**
- Modify: `packages/database/src/agent.ts`, `packages/database/src/index.ts` (`USER_DATA_TABLES`)
- Test: `packages/database/src/agent.test.ts` (events), `packages/database/src/erasure.test.ts` (extend)

**Interfaces:**
```ts
export type AgentEventType = "message" | "approval_request" | "approval_response" | "action" | "action_result" | "error";
export type AgentEvent = { id: string; channel: AgentChannel; type: AgentEventType; body: { text: string; meta?: Record<string, string | number> }; createdAt: string };
// on createAgentRepository(...):
appendEvent(e: Omit<AgentEvent, "createdAt"> & { dedupeKey?: string }): Promise<"stored" | "duplicate">;
listEvents(opts: { channel?: AgentChannel; limit: number; before?: string }): Promise<AgentEvent[]>;
deleteEvent(id: string): Promise<boolean>;
deleteConversation(channel: AgentChannel): Promise<number>;
purgeOlderThan(days: number): Promise<number>; // used with EVENT_RETENTION_DAYS = 90
export const EVENT_RETENTION_DAYS = 90;
```

- [ ] Failing tests: duplicate `dedupeKey` returns `"duplicate"` and stores one row; `deleteEvent` of another user's id returns false; `purgeOlderThan(90)` removes a row backdated 91 days and keeps one at 89; erasure test: after `eraseUserData(db, "a")` every `personal.agent_*` table has 0 rows for `a` and the report lists each table name.
- [ ] Run `pnpm --filter @lavega/database test -- agent erasure` expect FAIL.
- [ ] Implement; add `"personal.agent_events"`, `"personal.agent_push_subscriptions"`, `"personal.agent_mirror"`, `"personal.agent_state"`, `"personal.agent_settings"` to `USER_DATA_TABLES` (none reference each other; place before `personal.vaults`). Task 17 appends the phase 2 tables the same way.
- [ ] Run expect PASS.
- [ ] Stage (no commit).

### Task 5: Core `dailyMessage` candidate generators

**Files:**
- Create: `packages/core/src/instinct/types.ts`, `packages/core/src/instinct/candidates.ts`; modify `packages/core/src/index.ts` (export)
- Test: `packages/core/src/instinct/candidates.test.ts`

**Interfaces:**
```ts
export type CandidateKind = "deadline" | "better-offer" | "spending" | "tip";
export type Candidate =
  | { kind: "spending"; key: string; figures: { yesterdayCents: number; lastWeekdayCents: number; diffCents: number; weekday: number } }
  | { kind: "deadline"; key: string; figures: { what: "renewal" | "vat" | "other"; name: string; dueDate: string; daysAway: number; amountCents: number | null } }
  | { kind: "tip"; key: string; figures: { tipId: string } }
  | { kind: "better-offer"; key: string; figures: { what: "card" | "rate"; name: string; yearlyGainCents: number } };
export const SPEND_MIN_DIFF_CENTS = 2000, SPEND_MIN_DIFF_RATIO = 0.25, DEADLINE_DAYS = 7, OFFER_MIN_YEARLY_CENTS = 5000;
export type DailyInput = { today: string; txs: Tx[]; accounts: Account[]; rules: Rule[]; mirror: AgentMirror; balances: { accountKey: string; cents: number }[]; rates: readonly RateBenchmark[]; answers: TipAnswers; state: { sentKeys: {key:string;date:string}[]; lastTipDate: string | null } };
export function spendingCandidate(i: DailyInput): Candidate | null;
export function deadlineCandidates(i: DailyInput): Candidate[];
export function offerCandidates(i: DailyInput): Candidate[];
```
Algorithm notes: yesterday = `today - 1`; compare outgoing spend on that date with the same weekday 7 days earlier, EUR only (`isEurCurrency`), excluding own transfers via `categorize(tx, rules, ownAccounts(accounts)) === "Eigen overboeking"`; emit only if `abs(diff) >= SPEND_MIN_DIFF_CENTS` and `abs(diff)/lastWeekday >= SPEND_MIN_DIFF_RATIO` (or lastWeekday is 0 and spend >= 2x min). Deadlines: `detectSubscriptions(txs, {asOf})` next charge = `lastDate + cadenceDays`, within 0..7 days; plus `mirror.dueDates` in the same window; amount only for renewals. Rate offer: for the largest EUR savings account (`accountType` savings), gain = balance x (`bestRate(rates)` - `detectInterestRate`) per year, emit if >= OFFER_MIN_YEARLY_CENTS; card offer from `mirror.cardOffer` if `yearlyGainCents >= OFFER_MIN_YEARLY_CENTS` and `computedAt` within 90 days.

- [ ] Failing tests: Tuesday EUR 84 vs prior Tuesday EUR 44 gives `spending` with `diffCents: 4000`; EUR 10 difference gives null; own transfer is excluded; HUF spend ignored; Netflix monthly charge due in 5 days gives `deadline` `daysAway: 5`, due in 9 gives none; VAT mirror date in 3 days gives deadline with `amountCents: null`; EUR 20,000 savings at 1.0% vs best 3.0% gives `yearlyGainCents: 40000`; EUR 100 at +1% (EUR 1/yr) gives none; card snapshot EUR 49 none, EUR 50 emitted.
- [ ] Run `pnpm --filter @lavega/core test -- instinct/candidates` expect FAIL.
- [ ] Implement as pure functions; integer cents only.
- [ ] Run expect PASS.
- [ ] Stage (no commit).

### Task 6: Tip library and `dailyMessage` ranking with no-repeat

**Files:**
- Create: `packages/core/src/instinct/tips.ts`, `packages/core/src/instinct/dailyMessage.ts`
- Test: `packages/core/src/instinct/tips.test.ts`, `packages/core/src/instinct/dailyMessage.test.ts`

**Interfaces:**
```ts
export type Tip = { id: string; when: (a: TipAnswers, i: DailyInput) => boolean; reviewedAt: string; reviewedBy: string; source: string };
export type TipAnswers = Record<string, never>; // phase 1: tips key on DailyInput only; intake answers are not mirrored
export const TIPS: readonly Tip[];
export const TIP_COOLDOWN_DAYS = 3, REPEAT_WINDOW_DAYS = 30;
export function dailyMessage(input: DailyInput): Candidate | null;
```
Ranking: deadline (soonest first) > better-offer (largest gain) > spending > tip. Skip any candidate whose `key` is in `state.sentKeys` within `REPEAT_WINDOW_DAYS`. A tip needs `today - lastTipDate >= TIP_COOLDOWN_DAYS`. Candidate keys: `deadline:<name>:<date>`, `offer:<what>:<name>:<yyyy-mm>`, `spending:<date>`, `tip:<id>`.

- [ ] Failing tests: `TIPS` each has non-empty `id`, `reviewedAt`, `reviewedBy`, `source`, unique ids, and a NL+EN render entry exists in the copy module (checked in Task 8's parity test); with a deadline and a spending candidate present the deadline wins; same deadline key sent yesterday gives the next candidate; nothing worth saying returns null; tip suppressed inside cooldown; determinism (same input twice gives equal output).
- [ ] Run `pnpm --filter @lavega/core test -- instinct` expect FAIL.
- [ ] Implement. Start the library with 5 to 8 tips derived from existing reviewed facts (subscription overlap, price increase, idle savings, fee-heavy account); each `when` uses only `DailyInput`. No tip text lives here, only ids.
- [ ] Run expect PASS.
- [ ] Stage (no commit).

### Task 7: Message rendering (NL/EN copy)

**Files:**
- Create: `apps/web/src/copy/instinct.ts` (consumed by web UI), `packages/core/src/instinct/render.ts`
- Test: `packages/core/src/instinct/render.test.ts`; extend `apps/web/src/copy/parity.test.ts` if it enumerates copy modules

**Interfaces:**
```ts
export type RenderedMessage = { title: string; short: string; long: string }; // short = push/WhatsApp, long = email/feed
export function renderCandidate(c: Candidate, locale: "nl" | "en"): RenderedMessage;
export function renderConsentReminder(locale: "nl" | "en"): RenderedMessage; // "Koppel je bank opnieuw"
export function renderPausedNotice(locale: "nl" | "en"): RenderedMessage;
```
Templates live in `packages/core/src/instinct/copy.ts` (typed-complete for both locales; `tipId` -> text map keyed exhaustively by `TIPS` ids). Money via `formatEuroCents`-style helper already in core/format (use existing; if none in core, add a 6-line one here).

- [ ] Failing tests: spending NL equals "Je gaf gisteren EUR 84 uit, EUR 40 meer dan vorige dinsdag." (exact currency format per existing money helper); EN has no Dutch words; every tip id has both locales (compile-time `Record<TipId, ...>` plus runtime assert); no template interpolates anything but `figures`.
- [ ] Run `pnpm --filter @lavega/core test -- instinct/render` expect FAIL; implement; expect PASS.
- [ ] Stage (no commit).

### Task 8: Enable Banking consent maximum

**Files:**
- Modify: `apps/server/src/eb-routes.ts` (`/api/eb/auth`, `/callback`)
- Test: `apps/server/src/eb-routes.test.ts`

**Interfaces:** `consentDaysFor(aspsp: { maximum_consent_validity?: number } | undefined): number` exported; returns `min(floor(seconds/86400), 180)` when present and >0, else `CONSENT_DAYS` (89). `SESSION_TTL_MS` becomes `(180 + 1) * 86_400_000` so the row outlives the longest consent.

- [ ] Failing tests: auth for a bank whose `/aspsps` entry says `maximum_consent_validity: 15552000` (180 d) posts `access.valid_until` about 180 days out; bank without the field posts 89 days; the callback stores `validUntil` equal to what was asked.
- [ ] Run `pnpm --filter @lavega/server test -- eb-routes` expect FAIL.
- [ ] Implement: in `/auth`, `eb(GET /aspsps?country=&psu_type=)`, find by name, compute days; remember the value in the session payload via `validUntil` (already stored). Do not change reconnect behaviour.
- [ ] Run expect PASS.
- [ ] Stage (no commit).

### Task 9: Unattended fetch (90 days, no PSU headers)

**Files:**
- Create: `apps/server/src/agent/unattendedFetch.ts`
- Modify: `apps/server/src/eb-routes.ts` (export `fetchSessionItems` with a `days` parameter, default 365)
- Test: `apps/server/src/agent/unattendedFetch.test.ts`

**Interfaces:**
```ts
export type FetchOutcome =
  | { status: "ok"; txs: Tx[]; accounts: Account[]; balances: { accountKey: string; cents: number }[]; consentExpiresAt: number }
  | { status: "no-bank" } | { status: "expired"; bank: string } | { status: "refused" };
export async function fetchForAgent(userSessions: { sessionId: string; payload: EbSession; createdAt: string }[], now: number, deps?: { eb?: typeof eb }): Promise<FetchOutcome>;
```
Maps raw items through `mapEbTransaction`/`mapEbAccount` from `@lavega/adapters`. `refused` covers 429/5xx/other errors (silent skip); `expired` is a 401/403 or a lapsed `consentLive` (NOT silent: feeds the reminder/paused logic).

- [ ] Failing tests: request URLs use `date_from` 90 days back (not 365); the recorded request headers contain no header starting `psu-` (case-insensitive); 429 gives `refused`; 401 gives `expired`; no sessions gives `no-bank`; a lapsed consent gives `expired` without calling the bank.
- [ ] Run `pnpm --filter @lavega/server test -- unattendedFetch` expect FAIL; implement; expect PASS (also re-run eb-routes tests).
- [ ] Stage (no commit).

### Task 10: Migration 0028 and the due-user listing; per-user orchestrator

**Files:**
- Create: `db/migrations/0028_agent_due_users.sql`, `apps/server/src/agent/instinct.ts`
- Test: `packages/database/src/agentTables.test.ts` (function), `apps/server/src/agent/instinct.test.ts`

**Interfaces:**
```sql
personal.list_agent_due_users(local_hour int, retry_hours int, local_date date) RETURNS TABLE (tenant_id text)
-- SECURITY DEFINER, search_path pinned, REVOKE FROM PUBLIC, GRANT EXECUTE to lavega_runtime;
-- enabled AND send_hour <= local_hour <= send_hour+retry_hours AND last_sent_date IS DISTINCT FROM local_date; refuse to apply without BYPASSRLS (copy 0022).
```
```ts
export type InstinctDeps = { db: Database; now: () => Date; fetchSessions: (userId: string) => Promise<EbSessionRow[]>; catalogue: CatalogueEntryLike[]; rates: RateBenchmark[]; send: Record<AgentChannel, (userId: string, msg: RenderedMessage, s: AgentSettings, eventId: string) => Promise<"sent" | "failed">>; fetchOutcome?: typeof fetchForAgent };
export async function runForUser(deps: InstinctDeps, userId: string): Promise<"sent" | "none" | "skipped" | "paused" | "reminded">;
```
Flow: claim the day (`claimDay`); `fetchForAgent`; `refused`/`no-bank` releases claim and returns `skipped`; `expired` sends the paused notice once (`expiryPausedNoted`) and returns `paused`; ok: if consent expires within 7 days and `expiryRemindedFor !== expiresAt` send the reminder (this counts as the day's message) and return `reminded`; else `dailyMessage`; null releases the claim and returns `none`; otherwise render, send per channel, `appendEvent` with `dedupeKey = "daily:"+date`, `putState` (sentKeys, lastTipDate). If every channel failed, `releaseDay`. After use the function holds no reference to `txs` (scoped inside one inner function so they are out of scope on return).

- [ ] Failing tests: due-users function returns only opted-in users at 08:00 and again at 10:00, not at 11:00, not after a send; two users, user B never listed when disabled. Orchestrator with fake deps: **sentinel test**: txs contain counterparty `SENTINEL-ZORGVERZEKERAAR`; collect every `putState`, `appendEvent`, `console.*`, channel `send` argument and any prompt string; assert none contains the sentinel nor an IBAN-shaped string; refused fetch leaves state unclaimed and sends nothing; expiry reminder fires once at 7 days; a failed send on all channels releases the claim; sentKeys prevents the same deadline tomorrow.
- [ ] Run `pnpm --filter @lavega/database test -- agentTables` and `pnpm --filter @lavega/server test -- instinct` expect FAIL; implement; expect PASS.
- [ ] Stage (no commit).

### Task 11: Hourly cron route and Vercel cron entry

**Files:**
- Create: `apps/server/src/agent/instinctCron.ts`
- Modify: `apps/server/src/index.ts` (`app.get("/api/cron/instinct", ...)`), `apps/server/src/apiGuard.ts` (`PUBLIC_API_PATHS` add `/api/cron/instinct`), `scripts/vercel-build.mjs` (crons add `{ path: "/api/cron/instinct", schedule: "0 * * * *" }`)
- Test: `apps/server/src/agent/instinctCron.test.ts`, `apps/server/src/apiGuard.test.ts`

**Interfaces:** `export async function runInstinctCron(request: Request, deps = defaultDeps()): Promise<Response>` using `authorizedCronRequest` (CRON_SECRET bearer, same as `runInvestingCron`); local hour/date from `Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Amsterdam" })`; per user `withInvestingTenant`-free: call `runForUser`, catch per user, time budget (stop when 80 percent of the function limit is used); also `purgeOlderThan(EVENT_RETENTION_DAYS)` per processed user and sweep.

- [ ] Failing tests: no/incorrect bearer gives 401 and lists nobody; Amsterdam hour is used across the DST change (2026-03-29 01:00 UTC and 2026-10-25 boundaries); two concurrent `runInstinctCron` calls produce one send per user (fake `claimDay` backed by a real PGlite repository); one throwing user does not stop the next; apiGuard treats `/api/cron/instinct` as public while `/api/agent/settings` stays guarded.
- [ ] Run `pnpm --filter @lavega/server test -- instinctCron apiGuard` expect FAIL; implement; expect PASS.
- [ ] Verify config: `node scripts/vercel-build.mjs` is heavy, so assert via a unit test that reads the crons array exported from a small helper, or grep: `grep -n "api/cron/instinct" scripts/vercel-build.mjs`.
- [ ] Stage (no commit).

### Task 12: Email channel

**Files:**
- Create: `apps/server/src/agent/emailChannel.ts`
- Test: `apps/server/src/agent/emailChannel.test.ts`

**Interfaces:** `export async function sendAgentEmail(to: string, msg: RenderedMessage, locale: "nl" | "en", appUrl: string): Promise<"sent" | "failed">`. Reuses `sendAuthEmail` (Resend); `from` from `AGENT_EMAIL_FROM ?? AUTH_EMAIL_FROM`; body = `msg.long` plus a link to `/app` settings ("zet meldingen uit"); never throws.

- [ ] Failing tests: Resend called once with subject `msg.title` and text containing `msg.long`; missing `RESEND_API_KEY` returns `failed` without throwing; no figures beyond the rendered text.
- [ ] Run `pnpm --filter @lavega/server test -- emailChannel` expect FAIL; implement; expect PASS.
- [ ] Stage (no commit).

### Task 13: Web push channel (server) and service worker

**Files:**
- Create: `apps/server/src/agent/pushChannel.ts`, `apps/web/public/sw.js`
- Modify: `apps/server/package.json` (`web-push`), `apps/web/src/main.tsx` (register after sign-in only)
- Test: `apps/server/src/agent/pushChannel.test.ts`, `apps/web/src/swRegistration.test.ts`

**Interfaces:**
```ts
export async function sendPush(userId: string, msg: RenderedMessage, repo: ReturnType<typeof createAgentRepository>, deps?: { webpush?: typeof import("web-push") }): Promise<"sent" | "failed">;
```
Payload is `{ title, body: msg.short, url: "/app" }`. A 404 or 410 from the push service calls `repo.deletePush(endpoint)`. `sw.js` handles `push` (showNotification) and `notificationclick` (focus or open `/app`); it caches nothing. CSP already allows `workerSrc 'self'`.

- [ ] Failing tests: one subscription gets one `sendNotification`; 410 deletes that subscription and still returns `sent` if another succeeded; no subscription returns `failed`; VAPID vars missing returns `failed`; registration helper is not called when signed out and does not request notification permission by itself.
- [ ] Run `pnpm --filter @lavega/server test -- pushChannel` and `pnpm --filter @lavega/web test -- swRegistration` expect FAIL; implement; expect PASS.
- [ ] Stage (no commit).

### Task 14: Agent routes (settings, mirror, push subscribe, feed, events) and privacy text

**Files:**
- Create: `apps/server/src/instinct-routes.ts`
- Modify: `apps/server/src/index.ts` (register behind the same database condition as vault routes), `apps/server/src/legal.ts` (privacy statement), `apps/server/src/legal.test.ts`
- Test: `apps/server/src/instinct-routes.test.ts`

**Interfaces:** all session-guarded via `tenantId`; bodies validated at the boundary (zod/Effect Schema as in neighbours):
- `GET /api/agent/settings` returns settings + `bankConnected: boolean`
- `PUT /api/agent/settings` body `{ enabled, channels, sendHour, locale, email, consentVersion }`; 409 `bank-required` when enabling with no live EB session; stamps `consentedAt`; turning `enabled` false calls `repo.deleteAll()`
- `PUT /api/agent/mirror` body `AgentMirror` (rejects when not enabled; rejects any field named amount/iban beyond `cardOffer.yearlyGainCents`); `DELETE` clears
- `POST /api/agent/push` body PushSubscription JSON; `DELETE /api/agent/push` body `{ endpoint }`
- `GET /api/agent/feed?channel=&limit=&before=` returns events (decrypted); `DELETE /api/agent/events/:id`; `DELETE /api/agent/conversation/:channel`
- `CONSENT_VERSION = "2026-11-v1"` exported; changing the consent text bumps it.

- [ ] Failing tests: unsigned gives 401; enabling without a bank gives 409; `enabled:false` leaves zero rows (spy on `deleteAll`, then real PGlite check); user A cannot delete user B's event id (404); mirror with an extra `amountCents` key is rejected; feed returns decrypted text in newest-first order; privacy HTML contains the consent sentence verbatim and the retention (90 days) and states server reads transactions nightly for opted-in users.
- [ ] Run `pnpm --filter @lavega/server test -- instinct-routes legal` expect FAIL; implement; expect PASS.
- [ ] Stage (no commit).

### Task 15: Browser mirror of rules, due dates and card snapshot

**Files:**
- Create: `apps/web/src/agent/mirror.ts`
- Modify: `apps/web/src/App.tsx` (call after `saveRules` and after plan computation, only when agent enabled)
- Test: `apps/web/src/agent/mirror.test.ts`

**Interfaces:**
```ts
export function buildMirror(i: { rules: Rule[]; flows: ScheduledFlow[]; plan: PlanResult | null; now: Date }): AgentMirror; // strips amounts: dueDates from flows with status expected/confirmed and future dueDate; cardOffer from plan cards best net gain
export function createMirrorSync(api: { put(m: AgentMirror): Promise<void> }, enabled: () => boolean): { push(m: AgentMirror): void }; // debounced 2 s, skips identical payloads, never runs when disabled
```

- [ ] Failing tests: `buildMirror` output serialises without any `amountCents` of flows or any counterparty; paid or cancelled flows are excluded; debounce collapses 5 rule edits into 1 PUT; disabled makes zero calls.
- [ ] Run `pnpm --filter @lavega/web test -- agent/mirror` expect FAIL; implement; expect PASS.
- [ ] Stage (no commit).

### Task 16: Consent and settings UI, feed view, erase wording

**Files:**
- Create: `apps/web/src/views/AgentSettings.tsx`, `apps/web/src/views/AgentFeed.tsx`
- Modify: `apps/web/src/views/Profiel.tsx` (mount section), `apps/web/src/copy/instinct.ts`, `apps/web/src/api.ts` (client functions)
- Test: `apps/web/src/views/AgentSettings.test.tsx`, `apps/web/src/views/AgentFeed.test.tsx`

**Interfaces:** Component `AgentSettings({ locale })` shows: switch, the exact consent sentence (NL from `copy/instinct.ts`, tested for equality with the Global Constraints string; EN translation), channel checkboxes (feed, push, email; WhatsApp appears in Task 20), time select (default 08:00), a notice "Meldingen komen op je gekozen tijd, nooit eerder", list of stored items with delete buttons, and the turn-off confirm: "Uitzetten verwijdert alles wat LaVega op de server voor deze functie bewaart." Enabling is disabled with an explanation until a bank is connected. Push toggle requests browser permission on click only.

- [ ] Failing tests: consent sentence appears verbatim and the switch cannot be enabled without checking the consent box; no bank gives a disabled switch plus text; turn-off calls `PUT enabled:false` after confirm and shows the empty state; feed renders events newest first and delete removes one; NL/EN parity (existing `parity.test.ts` pattern).
- [ ] Run `pnpm --filter @lavega/web test -- AgentSettings AgentFeed parity` expect FAIL; implement; expect PASS.
- [ ] Stage (no commit).

---

## Phase 2

### Task 17: Migration 0029 and repository for WhatsApp links and codes

**Files:**
- Create: `db/migrations/0029_whatsapp_links.sql`
- Modify: `packages/database/src/agent.ts`, `packages/database/src/index.ts` (`USER_DATA_TABLES`)
- Test: `packages/database/src/agentTables.test.ts`, `packages/database/src/erasure.test.ts`

**Interfaces:**
- `personal.agent_whatsapp(user_id PK, phone_hash TEXT UNIQUE NOT NULL, phone_blob BYTEA, linked_at, last_inbound_at TIMESTAMPTZ)`; `personal.agent_link_codes(user_id PK, code_hash TEXT NOT NULL, expires_at TIMESTAMPTZ)`; both forced RLS plus runtime grants.
- `personal.agent_user_for_phone(phone_hash text) RETURNS text` and `personal.agent_consume_link_code(code_hash text, phone_hash text, phone_blob bytea) RETURNS text` (both `SECURITY DEFINER`, pinned search_path, EXECUTE to `lavega_runtime`, return only a user id; consume is one statement that deletes the code, rejects expired, and inserts the link, so a code works once).
- Repo additions: `createLinkCode(): Promise<{ code: string; expiresAt: string }>` (format `LV-` + 8 (as built; planned 6) chars from an unambiguous alphabet, 15 minutes, stores HMAC only), `getLink()`, `unlink()`, `touchInbound(userId, at)`; free functions `userForPhone(db, phoneHash)`, `consumeLinkCode(db, codeHash, phoneHash, phoneBlob)`; helper `phoneHash(e164: string): string` = HMAC-SHA256 with `AGENT_PHONE_HMAC_KEY`.
- ai_usage needs no migration (route column has no CHECK); add `"instinct-reply"` to `AiUsage["route"]` and `WORST_CASE_CENTS` (`instinct-reply: 3`) in the same task.

- [ ] Failing tests: link code works exactly once, fails after 15 min and for a wrong hash; two users cannot link the same phone (unique violation surfaces as `phone-taken`); `userForPhone` returns the right id and never another; RLS two-user test on both tables; erasure removes both and the report lists them; `unlink()` removes the link.
- [ ] Run `pnpm --filter @lavega/database test -- agentTables erasure` expect FAIL; implement; expect PASS.
- [ ] Stage (no commit).

### Task 18: WhatsApp client and signed webhook

**Files:**
- Create: `apps/server/src/whatsapp/client.ts`, `apps/server/src/whatsapp/webhook.ts`
- Modify: `apps/server/src/index.ts` (register), `apps/server/src/apiGuard.ts` (`/api/whatsapp/webhook` public; it carries its own signature)
- Test: `apps/server/src/whatsapp/client.test.ts`, `apps/server/src/whatsapp/webhook.test.ts`

**Interfaces:**
```ts
export function verifySignature(rawBody: string, header: string | null, appSecret: string): boolean; // constant-time compare of "sha256=" HMAC
export type Inbound = { wamid: string; from: string; at: number; kind: "text"; text: string } | { wamid: string; from: string; at: number; kind: "button"; buttonId: string } | { kind: "ignored" };
export function parseInbound(payload: unknown): Inbound[];
export type WhatsAppClient = { sendTemplate(to: string, name: string, lang: "nl" | "en", vars: string[]): Promise<{ wamid: string }>; sendText(to: string, text: string, windowOpenAt: number | null, now: number): Promise<{ wamid: string }>; sendButtons(to: string, text: string, buttons: { id: string; title: string }[]): Promise<{ wamid: string }> };
export function createWhatsAppClient(env, fetchImpl): WhatsAppClient;
```
Routes: `GET /api/whatsapp/webhook` answers the `hub.challenge` only when `hub.verify_token` matches; `POST` reads the raw body ONCE, verifies the signature before parsing, returns 200 quickly, dedupes by `wamid` (`appendEvent` dedupeKey `wa:<wamid>`).

- [ ] Failing tests: valid signature accepted, one flipped byte rejected, missing header rejected, and a rejected request triggers zero repository calls; challenge echoed only with the right token; `sendText` with `windowOpenAt` null or older than 24 h throws `WindowClosedError` and never calls `fetch`; `sendTemplate` posts template name, language and only the given variables; replayed `wamid` handled once.
- [ ] Run `pnpm --filter @lavega/server test -- whatsapp` expect FAIL; implement; expect PASS.
- [ ] Stage (no commit).

### Task 19: Number linking

**Files:**
- Create: `apps/server/src/whatsapp/linking.ts`
- Modify: `apps/server/src/instinct-routes.ts` (`POST /api/agent/whatsapp/link-code`, `GET /api/agent/whatsapp`, `DELETE /api/agent/whatsapp`), `apps/server/src/whatsapp/webhook.ts`
- Test: `apps/server/src/whatsapp/linking.test.ts`

**Interfaces:** `export async function handleUnlinked(db, inbound: Extract<Inbound,{kind:"text"}>): Promise<"linked" | "ignored">` — a text matching `/^LV-[A-Z2-9]{6}$/i` (trim, case-insensitive) is consumed through `consumeLinkCode`, then `sendText` confirms ("Gekoppeld. Ik stuur je voortaan hier je dagelijkse bericht."). Anything else from an unknown number is ignored with no reply (no spam amplification) and counted by the shared rate limiter per phone hash.

- [ ] Failing tests: valid code links and replies once; wrong or expired code gives no link and no reply; unknown number saying "hallo" gets no reply; second user using the first user's code fails; unlink deletes the row and later messages from that number are ignored; settings shows the number masked (last 2 digits).
- [ ] Run `pnpm --filter @lavega/server test -- linking` expect FAIL; implement; expect PASS.
- [ ] Stage (no commit).

### Task 20: WhatsApp as a proactive channel (template) and settings UI

**Files:**
- Create: `apps/server/src/whatsapp/channel.ts`
- Modify: `apps/server/src/agent/instinctCron.ts` (add to `send`), `apps/web/src/views/AgentSettings.tsx`, `apps/web/src/copy/instinct.ts`
- Test: `apps/server/src/whatsapp/channel.test.ts`, extend `AgentSettings.test.tsx`

**Interfaces:** `sendWhatsAppDaily(userId, msg: RenderedMessage, ...): Promise<"sent" | "failed">` calls `sendTemplate(number, WHATSAPP_TEMPLATE_DAILY, locale, msg.whatsappParams)` (one variable: the flattened short text); stores outbound event with `dedupeKey = wa-out:<wamid>`. UI: the link-code panel ("Stuur deze code naar +31 ... op WhatsApp"), polling `GET /api/agent/whatsapp` every 3 s for 15 min, unlink button; WhatsApp checkbox only selectable once linked.

- [ ] Failing tests: template send uses only the rendered figures line; unlinked user returns `failed` and never calls the client; UI disables the checkbox until linked; code panel shows the code and an expiry, never the phone number in clear.
- [ ] Run `pnpm --filter @lavega/server test -- channel` and `pnpm --filter @lavega/web test -- AgentSettings` expect FAIL; implement; expect PASS.
- [ ] Stage (no commit).

### Task 21: Read-only tools for answers

**Files:**
- Create: `packages/core/src/instinct/tools.ts`
- Test: `packages/core/src/instinct/tools.test.ts`

**Interfaces:**
```ts
export type ToolCall = { tool: "spending_on_day"; date: string } | { tool: "spending_in_range"; from: string; to: string; category?: string } | { tool: "compare_weekday"; date: string } | { tool: "upcoming_charges"; days: number } | { tool: "top_categories"; from: string; to: string } | { tool: "unknown" };
export type ToolResult = { figures: Record<string, number | string>; facts: string[] }; // facts are template-rendered sentences built from figures
export function runTool(call: ToolCall, i: DailyInput): ToolResult;
export function parseToolCall(raw: unknown): ToolCall; // boundary validation: unknown shapes become { tool: "unknown" }; dates must be real ISO dates within the 90-day window; days 1..31
```
There is no write tool; `propose_cancellation` is not built (phase 3). The `ToolCall` union is closed so adding one later forces the handler to be updated (exhaustive switch).

- [ ] Failing tests: `spending_on_day` equals manual sum; range outside 90 days clamps and reports `coveredFrom`; `compare_weekday` matches Task 5; own transfers excluded; malformed or injected input (`{"tool":"drop"}`, SQL-ish strings) becomes `unknown`; function is pure (same input, same output, no mutation of `i.txs`).
- [ ] Run `pnpm --filter @lavega/core test -- instinct/tools` expect FAIL; implement; expect PASS.
- [ ] Stage (no commit).

### Task 22: Two-way handler with redaction boundary and number guard

**Files:**
- Create: `apps/server/src/whatsapp/reply.ts`, `apps/server/src/agent/numberGuard.ts`; add `apps/server/src/agent/prompts/_instinct.md` and its entry in `vercel-build.mjs` shipped-prompt assertion (lavega_runtime_data_files)
- Modify: `apps/server/src/whatsapp/webhook.ts`
- Test: `apps/server/src/agent/numberGuard.test.ts`, `apps/server/src/whatsapp/reply.test.ts`

**Interfaces:**
```ts
export function numbersIn(text: string): number[]; // normalises "1.234,50", "EUR 84", "40", percentages
export function guardAnswer(answer: string, allowed: ToolResult[], asked: string): { ok: true } | { ok: false; unknown: number[] };
export async function answerInbound(deps: { repo; fetchOutcome; llm: LlmProvider; budget: typeof checkBudget; client: WhatsAppClient; now: () => number }, userId: string, text: string): Promise<"answered" | "fallback" | "no-data" | "rate-limited" | "window-closed">;
```
Flow as first planned (superseded, see "As built"): rate limit (per user 20 messages/hour, reuse `createRateLimiter`) -> `takeFetchBudget(today, 3)`; exhausted -> fixed reply "Ik kan nu niet bij je bank, probeer het morgen of open de app." -> budget gate (`checkBudget("instinct-reply", userId)`) -> step 1 `llm.complete` with ONLY `scrubPersonalValues(text)` asking for a JSON `ToolCall` -> `parseToolCall` -> fetch via `fetchForAgent` -> `runTool` -> step 2 `llm.complete` receives ONLY `ToolResult.facts` + the scrubbed question, never transactions -> `guardAnswer`; on `ok:false` (or model error) send the template-rendered `facts` joined instead (`fallback`) -> `sendText` (needs window; the inbound just opened it) -> `appendEvent` for the inbound and outbound with dedupe keys, `recordUsage`.

- [ ] Failing tests: guard accepts "EUR 84" when facts contain 8400 cents, rejects an invented "EUR 90", ignores years and dates equal to those in facts, handles NL decimal comma; handler: sentinel counterparty and IBAN never appear in either prompt; model returns an invented amount -> fallback facts are sent, not the model text; fetch budget exhausted -> fixed reply and zero bank calls; unlinked sender never reaches the handler; model throws -> fallback; budget refused -> fixed reply; inbound and outbound both stored as events.
- [ ] Run `pnpm --filter @lavega/server test -- numberGuard reply` expect FAIL; implement; expect PASS.
- [ ] Stage (no commit).

### Task 23: Conversation retention, window state and approval scaffolding

**Files:**
- Modify: `apps/server/src/whatsapp/webhook.ts`, `apps/server/src/agent/instinctCron.ts` (purge already scheduled in Task 11; add `touchInbound`), `apps/web/src/views/AgentFeed.tsx` (WhatsApp conversation list with per-event delete, "verwijder gesprek")
- Test: `apps/server/src/whatsapp/webhook.test.ts`, `apps/web/src/views/AgentFeed.test.tsx`

**Interfaces:** inbound `kind: "button"` with id `approve:<caseId>` or `reject:<caseId>` is stored as `approval_response` event (`meta: { caseId, answer }`) and answered with the fixed reply "Annuleren is nog niet beschikbaar."; nothing sends buttons yet (`sendButtons` exists and is tested, unused). Each processed inbound text updates `last_inbound_at` which feeds `sendText`'s 24 h check.

- [ ] Failing tests: button reply stored as `approval_response` and triggers no action and no tool; free text after 25 h with no new inbound is refused by `sendText` and recorded as an `error` event; conversation delete removes all WhatsApp events for the user only; a 91-day-old event is gone after the cron purge.
- [ ] Run `pnpm --filter @lavega/server test -- webhook` and `pnpm --filter @lavega/web test -- AgentFeed` expect FAIL; implement; expect PASS.
- [ ] Stage (no commit).

### Task 24: End-to-end verification and erase-everything check

**Files:**
- Test: `apps/server/src/agent/instinct.e2e.test.ts` (PGlite repository, fake EB/Resend/push/WhatsApp), extend `packages/database/src/erasure.test.ts`

- [ ] Failing test: enable agent for user A with all four channels and a linked number, run `runInstinctCron` twice in one hour (one send per channel), post a signed inbound question (answered with computed figures), then `DELETE /api/account/data`: every `personal.agent_*` table has zero rows for A, B's rows untouched, report lists all seven agent tables.
- [ ] Run `pnpm --filter @lavega/server test -- instinct.e2e` expect FAIL; fix wiring until PASS; then run the whole suite `pnpm test` and `pnpm -r typecheck` (whatever the repo's typecheck script is named) and record output.
- [ ] Verification evidence (not claimed until run): after owner applies migrations on the preview Neon branch, use the `run` skill against a preview deployment: enable the agent for a test account with a sandbox bank, trigger `curl -H "Authorization: Bearer $CRON_SECRET" .../api/cron/instinct`, and confirm one feed event. Real WhatsApp and push are owner-verified.
- [ ] Stage (no commit).

---

## Phase 3: not planned

Cancelling by email waits for the lawyer (authorisation wording, gemachtigde acceptance, ACM rules). Seams already left: event types `approval_request`, `approval_response`, `action`, `action_result`; `sendButtons`; closed `ToolCall` union; `agent+<token>@` is not built.
