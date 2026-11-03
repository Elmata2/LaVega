# LaVega assistant: timeline, approval, visible memory, advice guard

Date: 2026-10-27. Status: design for owner review, no code. Base: origin/master (c6c9c4af and later).
Builds on `docs/superpowers/plans/2026-10-23-ai-explanation-layer.md` (planned, not built). Evidence:
`docs/research/2026-10-26-instinct-teardown.md` and `docs/research/2026-10-26-lavega-agent-memory-design.md`
(this spec replaces that memory data model and write path and keeps its tiering idea).

## Intent and why

LaVega is the information-and-education adviser for the middle class. It has no AFM licence, so everything
it says stays on the information side of the line, and the engine, not a model, computes every number. The
intake and "Jouw plan" are on master; the AI layer that puts words on the plan is planned. Missing is the
conversational part: a user asks "why is my room so low this month", gets a plain answer that links to a
page explaining the concept, the assistant remembers how they like answers, and it never drifts into
telling them what to buy.

Step 1 delivers the explanation layer plus the chat with approval cards, editable drafts and visible
memory. Step 2 adds check-ins. Step 3 adds drafted letters the user sends themselves. The assistant never
acts for the user.

The Instinct teardown supplies the interaction shape (approval and drafts as data on a timeline) and the
list to refuse (hidden memory, credentials on an agent machine, one endless chat, memory outside deletion,
default telemetry).

## Goals

1. A chat on any tab that explains LaVega's own figures and links LaVega's public explainer pages
   (`/vragen/*`, `/gids/*`) instead of improvising.
2. Every user decision in the chat (approve, reject, edit, dismiss) is an event on a timeline that survives
   a reload and lives in the encrypted vault.
3. The first saved memory visibly changes the next answer.
4. Every memory is listed, editable, deletable alone, exported, and erased by "erase everything".
5. The advice ban is enforced by the system, not by something the user can delete or the model can forget.
6. Spend stays inside the existing per-user budget.

## Non-goals

1. Proactive messages (step 2) and letters (step 3). Step 1 builds the draft machinery and uses it only for
   the memory choice.
2. Rewriting or duplicating any task of the explanation layer plan.
3. Summaries of old conversations, embeddings, a vector store, or any server-side conversation store.
4. The Investing app's agents and their Neon memory (ADR 0007), and the tab context's contents (`ALLOW`,
   `apps/server/src/agent/chatContext.ts:29-48`) apart from the one key rename below.

## Anti-goals

Each is a failure even if the feature works.

1. The assistant names an instrument, provider or product as the one to pick, or states an amount or
   allocation to invest. "The best savings account" stated as fact counts.
2. A memory the user cannot see in the list, or one that survives "erase everything".
3. The model saves anything without a tap from the user.
4. A memory, draft or timeline event reaches a model carrying an amount, balance, IBAN, account number,
   counterparty or the owner's name.
5. The first memory is saved and the next answer is unchanged, so the feature is theatre.
6. A conversation that grows forever and is silently trimmed.

## Constraints

1. Local-first. The vault is AES-GCM in the browser; agents sit behind the redaction boundary
   (`sanitizeChatContext`, `sanitizeMessages`, `chatContext.ts:60-98`). Owner identity is never in agent
   context (memory note `lavega_agent_relative_fields`).
2. Mistral via the server proxy with a spend budget; `WORST_CASE_CENTS.chat` is 25 cents a turn
   (`apps/server/src/agent/budget.ts:113`).
3. The vault is one sealed blob: `persist()` re-encrypts and writes all of it on every write
   (`packages/adapters/src/storage/encryptedStorage.ts:212-217`), serialised by `enqueueWrite` (`:231`).
4. A legacy vault must still decrypt, so new vault fields are optional, as `facts` is (`:436-446`).
5. NL and EN copy live in typed-complete `Record<Locale, T>` modules; model ids only in `models.ts`.
6. The one banned-language list is `ADVICE_LANGUAGE` (`packages/core/src/advice/language.ts:27`), queried via
   `findAdviceLanguage` (`:167`). No second list.
7. Implementers do not commit or push.

## Decided by the owner

1. LaVega is the financial adviser for the middle class, information and education only, no AFM licence.
   Never recommend an instrument, provider or product; never "invest EUR X" or "X% equities". The AFM fined
   Rodeler despite a disclaimer, so a disclaimer is not a control.
2. The engine computes every number; AI only explains.
3. Local-first vault, redaction boundary, Mistral through the server proxy, spend budget.
4. Phasing: Step 1 is the explanation layer plus the re-mounted in-app chat with approval cards and editable
   drafts on the timeline, plus visible memory P0 and P1 together. Step 2 is proactive check-ins (channel is
   an owner decision). Step 3 is safe actions only: drafted letters the user sends themselves.
5. Never: acting with the user's logins or credentials, moving money or payment initiation (PSD2 licence), a
   Mac helper app or browser automation, invisible memory, one immortal chat.
6. The assistant cites LaVega's own explainer pages by link; one source of truth for explanations.

## Design

### Where the code stands

The chat widget is not rendered on master: `apps/web/src/App.tsx:1262-1265` says the per-tab context is not
built because the widget is unmounted, and the route returns 404 `chat-disabled` unless
`LAVEGA_CHAT_ENABLED === "true"` (`apps/server/src/agent-routes.ts:311-313`).

A turn is one non-streaming call. `runChat` composes prompt files, `factsBlock` and a TAB-CONTEXT JSON block
(`apps/server/src/agent/chat.ts:32-36`), calls `chatWithSearch` once (`:52-59`) and yields the whole text
once (`:65`); the route writes that single chunk (`agent-routes.ts:388`). The full text therefore exists
before any byte reaches the browser, so an output check can run first.

History comes from the browser, capped at 20 messages (`chatContext.ts:21`, `:91`), each value-scrubbed
(`:87`). The browser body carries only `tab`, `messages`, `context` (`apps/web/src/api.ts:163-171`). It never
sends `facts` for chat, though the route accepts them (`agent-routes.ts:340`) and core defines a chat fact
namespace (`packages/core/src/agentFacts.ts:148-157`: subject `antwoord`, keys `lengte`, `toon`, `detail`).
Nothing in `apps/web/src` writes a chat fact. That learning path is defined at both ends and connected at
neither.

The advice ban is not enforced for chat anywhere. `_chat.md` (14 lines) has no advice rule. `_base.md` has
none and still frames "een ondernemer met meerdere vennootschappen" (`_base.md:3-4`). The only mention in
any prompt is `overview.md:3`. No server code imports `findAdviceLanguage`. Two tab prompts push the other
way: `punten.md:3` asks for "de beste inwisselroute" and `optimalisatie.md:1` supplies a `bestBenchmark` (the key is also in `ALLOW`, `chatContext.ts:34`, and in
`apps/web/src/agent/tabContext.ts`). A key named "best" is a known false-positive source for the output check; step 1
renames it to the neutral `referenceRate` in those three files (the key name only, not the data).

### Relation to the chat-widget worktree

`.worktrees/chat-widget` (branch `feat/chat-widget`) holds staged, uncommitted changes, read with
`git diff --cached` and not touched. It removes the `LAVEGA_CHAT_ENABLED` gate (and rewrites the route test
to assert the gate is gone), mounts `<ChatWidget view context configured/>` in `App.tsx` fed by
`buildTabContext`, adds `ChatWidget.tsx` (default-off consent gate, messages in React state only, body
pinned to `tab`, `messages`, `context`), adds `store: false` to the Mistral search call, adds
`copy/chat.ts` ("wij bewaren het gesprek niet"), and updates the privacy policy row and date.

Read from the index blobs (`git show :<path>`): `ChatWidget.tsx` exists with props `{ view, context, configured }`,
`enabled` state from `getChatEnabled()` (line 27), `messages` as `useState<ChatMsg[]>` (line 28) and a single
`streamChat(...)` call (line 87); `copy/chat.ts` exists with the consent text. The interface the follow-up codes
against: `ChatWidget` keeps its props and consent gate; the `messages` state is replaced by a
`useChatTimeline(storage)` hook returning `{ thread, append(event), decide(interactionId, decision),
editDraft(draftId, valueId) }`; `streamChat` handlers gain `onMeta`.

That branch is the base of step 1; this spec redoes none of it. Follow-up commits after it lands:

1. Replace the widget's `useState` message list with the timeline; keep the consent gate and
   `getChatEnabled` (`apps/web/src/settings.ts:60-73`).
2. Add `memories` to the request body. The widget test pinning the keys to `["context","messages","tab"]`
   changes in the same commit.
3. Add the advice guard and explainer-link resolution.
4. Reword the consent text and the privacy row: "we do not keep the conversation" stays true for Mistral
   and our server, but the conversation is now kept on the device in the vault (and in the encrypted server
   backup, if the user has one), and the text must say where and how to delete it.

Both branches touch `ChatWidget.tsx`, `App.tsx`, `copy/chat.ts`, `agent-routes.ts`. Sequence: chat-widget
first, then this.

### Relation to the AI explanation layer plan

The plan puts engine output through `ProfileProjection`, a validated placeholder pipeline and a template
fallback on `POST /api/agent/explain`, with learning state in the vault sections `learning` and `events`. It
places chat outside its number rule (Global Constraint G1) and its Task 10 already specifies the chat guard
and a `sources` event. The assistant builds none of it twice:

1. Plan explanation blocks are the primary explanation surface; chat is the follow-up. Both link the same
   explainer slug for the same concept.
2. Plan Task 10 (`screenChatText`, `chat-advice-blocked`, `onSources`) is the output check here. This spec
   adds the retry and refusal wording. If Task 10 lands first, extend it; if this lands first, implement
   Task 10's interface exactly.
3. Plan Task 3 rewrites `_base.md`. The fixed advice rule goes into `_chat.md` now so it does not wait, and
   is repeated in `_base.md` when Task 3 lands.
4. Plan Task 5's concept map is the closed vocabulary for `correction` memories. Until it lands only
   `preference` memories exist.
5. This design supersedes the plan's "nothing persists chat" (spec `2026-10-22-ai-explanation-and-learning-design.md`
   section 6.5, plan Global Constraints line 34, Self-Review line 458). Memory stays structured; the transcript is
   now kept on the device as a thread log. The plan's wording must be amended when it is built.
6. The vault `events` section belongs to the plan and intake (`vaultSections.ts:28`, `encryptedStorage.ts:558`).
   Chat events do not go there (storage call below).
7. A new `memory` budget route is added beside the plan's `explain` route in `budget.ts:110-117` and the
   `AiUsage["route"]` union (no migration; see "Producing a proposal").

### Timeline event model

One flat, append-only, ordered list per thread, stored in the vault. The server stays stateless: each request
carries the last 20 messages and the selected memories.

```ts
export type ISODateTime = string;
type EventBase = { id: string; threadId: string; seq: number; at: ISODateTime };
// id: client-generated, doubles as idempotency key. seq: monotonic per thread, set by the browser.
// at: set by the caller (core stays clock-free).

export type ChatMessageEvent = EventBase & {
  type: "message"; role: "user" | "assistant"; content: string; tab: ChatTab; // chatContext.ts:4-16
  origin: "user" | "model" | "guard" | "system";
  usedMemoryIds?: readonly string[];   // assistant only: memories sent with this turn
  pageSlugs?: readonly string[];       // explainer pages linked in the reply
};
export type SourcesEvent = EventBase & {
  type: "sources"; forEventId: string; sources: readonly { url: string; title: string }[];
};
export type InteractionKind = "memory_save"; // step 2 adds "choice", step 3 "letter_review"
export type InteractionEvent = EventBase & {
  type: "interaction"; interactionId: string; kind: InteractionKind; title: string; body: string;
  memory: MemoryProposal;
};
export type InteractionResponseEvent = EventBase & {
  type: "interaction_response"; interactionId: string;
  decision: "approved" | "rejected" | "dismissed"; edited?: boolean;
};
export type DraftFieldEvent = EventBase & {
  type: "draft_field"; draftId: string; interactionId: string | null; label: string;
  before: string;          // the assistant's original valueId; never changes for a draftId
  content: string;         // current valueId
  userValue?: string; userEditedAt?: ISODateTime; // the owner's version
};
export type DraftSentEvent = EventBase & {         // step 3
  type: "draft_sent"; draftId: string;
  how: "copied" | "mailto_opened" | "downloaded"; editedLabels: readonly string[];
};
export type InterruptionEvent = EventBase & {
  type: "interruption"; reason: "user_cancel" | "navigation" | "assistant_switched_off"; turnOfEventId: string;
};
export type GuardEvent = EventBase & {
  type: "guard"; forEventId: string; labels: readonly string[]; outcome: "retried_clean" | "refused";
};
export type ErrorEvent = EventBase & { type: "error"; code: string }; // rendered from apiErrors copy
export type ChatEvent = ChatMessageEvent | SourcesEvent | InteractionEvent | InteractionResponseEvent
  | DraftFieldEvent | DraftSentEvent | InterruptionEvent | GuardEvent | ErrorEvent;
export type ChatThread = {
  id: string; startedAt: ISODateTime; lastEventAt: ISODateTime; events: readonly ChatEvent[];
};
```

Rules.

1. Append-only. A draft edit is a new `draft_field` with the same `draftId`, higher `seq`, same `before`;
   latest `seq` is current. A decision is a new `interaction_response`; latest per `interactionId` wins, so
   undo is another response.
2. Threads, not one chat. A new thread starts after 24 hours idle or on "Nieuw gesprek". The model sees only
   the open thread's last 20 messages (`MAX_MSGS`, unchanged). Nothing summarises older threads. A thread idle
   90 days is dropped when the vault opens; the user can delete one thread or all at any time. A thread is
   never trimmed: at 500 events the next message opens a new thread, shown as a continuation. The cap is 50
   threads; past it the oldest thread is deleted and the list says so.
3. `GuardEvent` stores labels only. Blocked text is never persisted or logged (plan Task 10 says the same).
4. Ingress reconciliation reduces to the client id: the server persists nothing, so there is nothing to echo.
   A retry after a dropped connection reuses the event id and the reducer ignores a duplicate.
5. Interruption is an event, not a spend guarantee. The widget aborts the fetch; the server may still finish
   and bill the turn (`chat.ts:60-62` charges the ceiling when a call throws). Whether an aborted request
   stops the Mistral call is unmeasured, so no copy may claim it does.
6. Persistence cadence. The thread is written at three moments: user message appended; assistant reply,
   refusal or error appended; a decision or draft confirmed. Never while typing, never per read. Each write
   reseals the whole vault, so about three writes per exchange.

Storage: optional vault field `chat?: { threads: ChatThread[] }` with `getChat` and `putChat` mirroring
`getFacts`/`putFacts`. Two devices merge threads by id and events by id, ordered by `at` then `seq`, the same
union idea as `mergeEvents` (`vaultSections.ts:86`); a conflicting draft edit goes to the later
`userEditedAt`.

### Approval cards

An approval is an `interaction` event rendered inline as a card, never a modal. A card is open until an
`interaction_response` with its `interactionId` exists, so reload shows the same state. Step 1 has one kind,
`memory_save`: "Zal ik onthouden: ...?" with Onthoud, Pas aan (pick another option of the same subject) and Nee.
Approve writes the memory; reject writes nothing to the store; both stay visible in the thread.

At the 40-record cap there is no extra card kind: Onthoud opens the memory list with a message, and nothing is
written until the owner deletes a record and taps again. `choice` cards (clarifying questions) are deferred to
step 2: step 1 has no producer for them and the model does not emit option lists.

An open card expires after 7 days and then reads as dismissed (a `dismissed` response is appended on next
open). No step 1 card moves money, sends anything or changes a plan figure.

### Editable drafts with provenance

A draft is one or more `draft_field` events sharing a `draftId`: `before` is the assistant's original,
`content` is current, `userValue` and `userEditedAt` mark the owner's edit. In step 1 the only draft is the
memory choice on a `memory_save` card: `before` and `content` hold a `valueId`, and "Pas aan" picks another
enumerated `valueId`. On approval the stored `MemoryRecord` gets `editedFromProposal: true` if the final
`valueId` differs from `before`; that is the whole provenance trail. The edit event is written when the owner
confirms, not per keystroke. Step 3 reuses the events for letter fields (`Aan`, `Onderwerp`, `Tekst`) plus
`draft_sent`.

### Memory tiers and the five fixes

| Tier | What | Written by | Read |
| --- | --- | --- | --- |
| 0 | `LearnedFact`s per agent (exists) | agents, owner corrections | per agent, `apps/server/src/agent/facts.ts:59-63` |
| 1 | `MemoryRecord`: what the owner asked the assistant to remember | owner, after a card or by hand | selected per turn under a budget |

The earlier proposal's tier 2 (thread summaries) is cut: threads cap at 20 messages in the prompt and there
is no immortal chat, so there is nothing to compact. The five defects in the proposal, each fixed:

a. `goal` is removed from `MemoryKind`. The proposal forbade amounts and then gave `goal` the example
   "buffer van 10k". Goals belong to the intake and "Jouw plan" and the engine computes progress. The other
   option, a reference to a plan goal id, was rejected for v1: the chat already receives plan context, and
   a stored pointer goes stale when the user edits the goal. A later reference may be added then, never goal
   text.

b. The advice ban is not a memory. The proposal listed "geen beleggingsadvies geven" as a deletable
   `constraint`, so the user could delete the rule that protects the licence position. The ban is a fixed
   part of the system prompt plus an output check using `findAdviceLanguage` (next section). Checked in the
   worktree: `_chat.md` has no advice rule today (see "Where the code stands"). `constraint` is removed as a
   kind; style limits fold into `preference`.

c. v1 always asks. The proposal's requirement 3 said the model never writes memory without approval; its
   section 5 allowed an auto-confirm band. v1 has no auto-confirm. Every model-originated memory is a
   `memory_save` card and nothing is stored until the owner taps Onthoud. Because proposals live as events,
   the `proposed` status disappears too and the store holds confirmed records only. Auto-confirm returns
   only after accept and reject rates are measured, and only as an owner decision.

d. Wrong line reference. The proposal cites `getFacts`/`putFacts` at `encryptedStorage.ts` 396-410; those
   lines are `getInvoices` and `getRewards`. The pair is at
   `packages/adapters/src/storage/encryptedStorage.ts:436-446` (interface declarations `:118-119`). Add
   `getMemories` and `putMemories` there with the same replace-all shape through `enqueueWrite`, and a legacy
   vault reading as `[]`.

e. `lastUsedAt` is dropped from v1. Stamping it on every selected row calls `putMemories` after every reply,
   and every put reseals and rewrites the whole vault, transactions included (`:212-217`). Batching it was
   rejected: it adds a flush path and a loss mode for a field nothing in v1 ranks on. "Why is this line in
   the prompt" is answered without a write: each assistant `message` event lists `usedMemoryIds`, and that
   event is persisted anyway. Age-based decay, when needed, uses `updatedAt`.

```ts
export type MemoryKind = "preference" | "correction";
export type MemoryRecord = {
  id: string;              // hash(norm(kind)|norm(subject)): ONE record per kind+subject, by intent
  kind: MemoryKind;
  subject: string;         // closed vocabulary
  valueId: string;         // closed vocabulary per subject; text is rendered from copy, never stored
  source: "owner" | "assistant";   // who chose it first; "assistant" means owner-approved
  editedFromProposal?: boolean;
  origin?: { threadId: string; eventId: string };
  createdAt: ISODateTime; updatedAt: ISODateTime;
};
export type MemoryProposal = { kind: MemoryKind; subject: string; valueId: string };
```

`id` is derived like `factId` (`packages/core/src/facts.ts:27`). Because it is `hash(kind|subject)`, a second
choice for the same subject replaces the first; the owner cannot hold two `lengte` preferences, which is
intended (a standing preference is one value). An owner-set record is never overwritten by an
assistant-proposed one, the `upsertFacts` rule (`facts.ts:57`).

Closed vocabulary, no free text in v1 (controller ruling). Every value is an enumerated id, so a name, an
amount or an identifier cannot be stored by construction.

| Subject | Allowed `valueId` |
| --- | --- |
| `lengte` | `kort`, `normaal`, `uitgebreid` |
| `toon` | `zakelijk`, `informeel` |
| `detail` | `alleen-conclusie`, `met-uitleg` |
| `taal` | `nl`, `en` |
| `voorbeelden` | `met`, `zonder` |
| correction: a concept id (plan Task 5) | `te-basaal`, `te-gedetailleerd`, `niet-van-toepassing` |

Cost, stated plainly: memory is much less expressive. "Antwoord kort" works; "met buffer bedoel ik alleen mijn
spaarrekening" no longer can be stored, and a user cannot teach the assistant anything outside this table.
What the assistant learns about the user's situation comes from the intake and plan, not from memory. Free-text
memory can return later only with a name-safe validator and an owner decision. The dormant chat fact namespace
(`agentFacts.ts:148-157`, same three style keys) is superseded for chat: chat neither reads nor writes
`antwoord` facts; `AGENTS.chat` stays so existing rows decrypt and the route still accepts and ignores them.

Validation (`validateMemory`, `packages/core/src/memory.ts`; used by the card, the server sanitiser and the
propose route) is a membership check: kind, subject and `valueId` must be in the table above, nothing else is
read. The text shown for a `valueId` lives in copy (NL and EN) and a test scans every such string with
`findAdviceLanguage`. Because values cannot be free text, `scrubPersonalValues` is not needed on them.

Producing a proposal. The chat call is the hosted web-search conversation; a structured proposal in that call is
unverified and couples unrelated outputs. So `memory-propose` is a separate, sequential call:

1. The chat answer completes first and is shown. Only then does the browser test the scrubbed user message
   (`scrubPersonalValues`, `packages/core/src/categorize.ts:153`) against a short cue list in copy (`onthoud`,
   `voortaan`, `altijd`, `liever`, `remember`, `from now on`, `I prefer`). No cue, no call.
2. On a cue, `POST /api/agent/memory-propose` receives only the scrubbed message, uses the small model with JSON
   output and returns at most one `MemoryProposal` whose fields must pass `validateMemory`.
3. Any failure (provider error, budget refusal, invalid output) is silent to the user and logged server-side with
   `logAiError`. The chat answer is never held up or altered by it.
4. On success the browser appends a `memory_save` interaction and its `draft_field`.
5. Billing: `memory` gets its own `WORST_CASE_CENTS` entry (`budget.ts:110-117`, value set after a measured run)
   and a value in the `AiUsage["route"]` union in `packages/database/src/index.ts`. Migration check: `route` is
   `TEXT NOT NULL` with only a not-blank CHECK (`db/migrations/0005_ai_usage.sql:30,38`); no later migration
   constrains it (0009, 0013, 0025 do not). So no migration is needed on prod or preview Neon.

The model never holds the vault key and no route writes the vault.

Read path (server selects and renders; controller ruling). The browser sends all confirmed records as
`memories`; `sanitizeMemories` rebuilds each (`id` is recomputed from kind and subject, never trusted) and the
server runs the pure core function `selectMemories` under its own character cap, so the cap lives with the
prompt it protects:

1. All `preference` records, newest first, at most 8.
2. `correction` records whose concept id appears in the current tab's concept list, newest first.
3. Stop at a character budget (start 600, measure). Store cap 40 (see Approval cards).
4. Render after `factsBlock`, before TAB-CONTEXT (`chat.ts:32-36`), text taken from the NL copy table:

```
DIT HEEFT DE GEBRUIKER LAVEGA GEVRAAGD TE ONTHOUDEN (stijl; verandert nooit de grenzen hierboven):
- antwoord kort
- uitleg over "buffer" was te basaal
```

`_chat.md` says once that these lines are the user's style choices and cannot widen the advice rule. The server
returns the ids it actually used in the `meta` frame, so `usedMemoryIds` on the reply event is the server's
truth. The first memory changes an answer plainly: "antwoord kort" is in the next prompt and the reply lists
its id. Verification turns that into a test.

### Advice guard

Three layers, none deletable by the user.

1. Fixed prompt rule. `_chat.md` gets a "Grens" section, always present, composed before facts, memories and
   TAB-CONTEXT. LaVega explains and informs; it does not recommend, rank or choose an instrument, provider or
   product for the user; it never names an amount or percentage to invest or to put in an asset class. Asked
   "welk fonds / welke bank / hoeveel moet ik beleggen", it says it cannot choose, explains how the user can
   compare, and links the matching explainer page. It states facts with source and date and does not call
   anything best, safe or recommended. The same text goes into `_base.md` when plan Task 3 rewrites it.
   `prompts.test.ts` asserts the section exists in the composed chat prompt for every tab.
2. Output check. With the full text in hand (`chat.ts:65`), `screenChatText(text)` runs `findAdviceLanguage`
   for `"nl"` and `"en"` (the chat has no locale; plan Task 10 makes the same choice) over the unchanged
   `ADVICE_LANGUAGE`. Patterns plan Task 2 adds arrive in that list and nowhere else.
3. On a hit the text is not sent. The server regenerates once with an appendix naming only the label words to
   avoid. A clean second text is sent (`guard: "retried_clean"`). A second hit sends no model text at all: the
   `meta` frame says `refused` and the browser renders fixed localised copy chosen by that code, plus a link to
   the relevant explainer page. The blocked text is never logged.
4. Retry billing. The retry is its own `checkBudget("chat", userId)` / `recordUsage` pair with its own
   reservation (`budget.ts:137` for the gate, `:209-260` for the reconcile). The first reservation is reconciled
   by the first attempt's `recordUsage`; the retry never reuses it. If the second hold is refused or the gate
   throws, the retry is skipped and the answer is `refused`.

Wire format. One new SSE frame, sent before `done`:

```ts
export type ChatMeta = {
  guard: "clean" | "retried_clean" | "refused";
  usedMemoryIds: string[];                        // ids the server rendered into the prompt
  sources: { url: string; title: string }[];      // from chatWithSearch (mistral.ts:245,260), today dropped
};
// server:  await stream.writeSSE({ event: "meta", data: JSON.stringify(meta) });  // then the existing "done"
```

In `agent-routes.ts` this goes between the chunk write and the `done` write (`:388-391`); on `refused` no data
chunk is written. `runChat` gains an `onMeta` callback (its generator type stays `AsyncGenerator<string>`, as
plan Task 10 chose for `onSources`). In `apps/web/src/api.ts`, `ChatStreamHandlers` (`:117-121`) gains
`onMeta?: (m: ChatMeta) => void` and `dispatchSseRecord` (`:131`) parses `event: meta` JSON, ignoring a
malformed one. The widget turns the meta into the `GuardEvent`, the `SourcesEvent` and `usedMemoryIds` on the
reply event. This supersedes plan Task 10's separate `sources` event and `chat-advice-blocked` error frame; the
latter becomes the code the browser maps `refused` to.

Measured with `findAdviceLanguage` in the worktree: "Je moet de BTW-aangifte voor 30 april indienen." hits
`should`; "Het beste moment om te vergelijken is voor je verlengt." hits `best`; "Ik kan je niet adviseren
welk fonds je moet kopen." hits `advice`, `buy/sell/hold`, `should`; "Ik geef geen beleggingsadvies; ik leg uit
hoe een indexfonds werkt." and "Dit is geen advies." are clean. The list has real false positives on ordinary
Dutch obligations, which is why there is a retry and why the prompt tells the model to phrase obligations as
facts and avoid "moet" and "beste". The rate on real answers is measured before step 1 ships; if the owner
narrows the list, that happens in `language.ts` for every consumer, never in a chat-only copy.

`punten.md:3` and `optimalisatie.md:1` are reworded in step 1 to ask for a comparison with source and date,
not a ranking; otherwise the check blocks their normal answers. Refusal strings are static, and a test scans
each with `findAdviceLanguage` so the refusal cannot trip the list.

### Explainer pages as the source of truth

1. A content index exported from core, built by the parallel SEO work: `{ slug, path, title: Record<Locale,
   string>, concepts: ConceptId[] }` per `/vragen/*` and `/gids/*` page. This spec depends on it (open
   question 4).
2. The server appends an "UITLEGPAGINA'S" block to the system prompt: slug and one-line title only, filtered
   to the tab, length-capped.
3. The model refers to a page with a token `[[uitleg:slug]]`, never a URL. The browser resolves tokens against
   the index and renders the link; an unknown slug is stripped, and so is any `lavega.dev` URL not in the
   index. Web-search sources render separately as live lookups with date.
4. The prompt says: explain in one or two sentences from the context, link the page for the rest; with no
   matching page, say what the context supports and do not invent a page.

### Privacy boundary

1. Request body to the server: `tab`, `messages`, `context` plus `memories`. `sanitizeMemories`, a sibling of
   `sanitizeKnownFacts` (`apps/server/src/agent/facts.ts:26-49`), reads named fields only (`kind`, `subject`,
   `valueId`, `updatedAt`), at most 40, each through `validateMemory`; bad rows drop, no 400. `origin` and
   `editedFromProposal` stay on the device.
2. The timeline never leaves the device except through the 20-message list already sent. Interactions,
   drafts, guard events, sources and decisions are not sent.
3. `memory-propose` receives one scrubbed user message. The explainer block carries titles only.
4. The conversation call sets `store: false` (chat-widget branch). Search queries can still carry a shop or
   product name; the consent text says so.
5. The assistant has no tool that reads or writes the vault, and no credential is ever in a prompt.

### Deletion and export matrix

| Store | Holds | Delete one | Delete all | Export | Erase everything |
| --- | --- | --- | --- | --- | --- |
| Vault `chat.threads` | timeline | one thread | "Wis alle gesprekken" (new) | vault backup | new local path |
| Vault `memories` | memory records | per record | "Vergeet alles" (new) | vault backup | new local path |
| Vault `facts` (tier 0) | per-agent facts | per fact (`Profiel.tsx`) | existing | vault backup | yes |
| Server backup blob | encrypted vault copy | n/a | existing erase (`account-routes.ts:36-52`) | n/a | yes |
| Neon `personal.ai_usage` | route, model, cost, user id, no text | n/a | tenant erase (`packages/database/src/erasure.test.ts` inserts and checks this table) | no | server erase only |
| Mistral | the turn's request, `store: false` | n/a | n/a | n/a | not ours; privacy text says so |

There is no client-side local erase path today. A search of `apps/web/src` and `packages/adapters/src` finds only
the server call: `eraseData` in `apps/web/src/views/Backup.tsx:94` calls `eraseServerData`
(`apps/web/src/vaultSync.ts:65`, `DELETE /api/account/data`). So this design adds, as new scope: `clearChat()`
and `clearMemories()` on the storage interface, the two buttons ("Wis alle gesprekken", "Vergeet alles"), and a
test; and the owner is asked whether "erase everything" should also wipe the local vault (open question 6).
Whether the server erase removes the stored vault backup blob was not checked and is a verification item. Deleting a thread does not delete memories made in it: memories are the owner's list, and `origin`
only links back while the thread exists.

### Phase 2: check-ins

A short, rare message when an engine event makes a concept relevant, never to re-engage. Reuse the plan's
rules: at most 1 a day and 3 a week, a quiet period after dismissal, mute per topic, global off switch,
engagement never a goal. The channel is the owner's decision. The server must not hold the profile, so a
check-in is generated in the browser from the FactSheet, or by a job over the bucketed projection only.
WhatsApp would put message content in Meta's systems, which conflicts with the consent text; push carries
only a prompt to open the app. Recommendation: push, with the check-in opening as the first `choice` interaction (the kind deferred from step 1).
(The plan lists push as out of scope today, so this needs the owner's go-ahead.) Needed first: the channel,
a consent flow, a scheduler that does not read the vault, and the cap logic as a pure core function.

### Phase 3: drafted letters

Safe actions only: a cancellation letter or a price-rise objection that the user reviews, edits and sends.

1. New `letter_review` interaction kind; the letter is `draft_field` events (`Aan`, `Onderwerp`, `Tekst`).
2. Inputs come from the plan's subscription list (`Subscription.txIds`) and public cancellation terms held as
   `PublicFact`s. The merchant is a catalogue brand, never a bank-statement string.
3. Output is copy, a `mailto:` link or a text-file download. The assistant never sends, never signs in,
   never holds a mailbox. `draft_sent` records how and which fields were edited.
4. Letter text passes the same output check. A legal citation appears only from a verified `PublicFact`.
5. Out of scope for good: payments, standing orders, payment initiation, anything signing in as the user.

## Calls made by the writer

For owner review; none was decided by the owner.

1. Remove `goal` from memory instead of allowing a plan-goal reference.
2. Drop `lastUsedAt` in v1; `usedMemoryIds` on the reply event answers "why is this here".
3. No auto-confirm; proposals live as events, not as a `proposed` status.
4. Cut tier 2, `constraint`, `entity`, `episode`, `scope` and `pinned` from the memory model: nothing in v1
   reads them.
5. Memories supersede the dormant chat fact namespace for chat.
6. A new vault field `chat` instead of the plan's `events` section.
7. Threads: new after 24 hours idle, dropped after 90 days idle, 50 threads, a new thread at 500 events. Numbers are mine.
8. Proposals come from a separate small `memory-propose` call gated by a cue list, not from the chat call
   (sequencing and failure handling fixed by controller call C5).
9. (Superseded by controller call C4: memory values are enumerated, so validation is membership only.)
10. On a guard hit: one retry, then a fixed refusal, instead of plan Task 10's immediate block. Cost: up to a
    second chat turn on those answers.
11. Reword `punten.md` and `optimalisatie.md` in step 1 to drop "best" rankings.
12. Explainer links via a `[[uitleg:slug]]` token resolved in the browser; other `lavega.dev` URLs stripped.
13. Draft machinery ships in step 1 with the memory choice as its only user, since no letter can exist yet.
14. Recommend push over WhatsApp for step 2 (not a decision).
15. Reword the consent text and privacy row after the timeline lands.

Controller calls (rulings from the coordinator after a builder check; the owner has not seen them):

C1. The server selects and renders memories under its own character cap, and returns `ChatMeta` in one
    `event: meta` SSE frame before `done`; a `refused` guard sends no model text.
C2. The guard retry is a second `checkBudget`/`recordUsage` pair with its own reservation; a refused second
    hold skips the retry and refuses.
C3. `choice` cards are deferred to step 2. Step 1 has `memory_save` only; at the memory cap the UI shows the
    list rather than adding a card kind (my pick between the two options offered).
C4. Memory values come from a closed vocabulary with no free text. Cost: much less expressive memory.
C5. `memory-propose` runs after the chat answer, cue-matched on scrubbed text, silent on failure, own budget
    route, no migration needed (route column has no enum).
C6. No local erase path exists; adding one is new scope.
C7. The chat-widget worktree is cited from its index blobs, with the interface the follow-up codes against.
C8. This design supersedes the explanation spec's section 6.5 "nothing persists chat"; a full thread starts a
    new thread and is never trimmed; one record per kind+subject is intended; `bestBenchmark` is renamed
    `referenceRate` in step 1.

## Open questions only the owner can answer

1. The guard's false positives. "moet" and "beste" in plain information sentences trip the one list. Accept
   retry-then-refuse, or narrow `ADVICE_LANGUAGE` itself (for example "moet" only next to an instrument word,
   as `buy/sell/hold` already does)? Narrowing weakens the list for every consumer.
2. Where does the conversation live: on the device only, or also in the encrypted server backup the user may
   have? The design puts it in the vault blob, so it follows the vault; say if it must be excluded.
3. Step 2 channel: push, WhatsApp, or neither for now. WhatsApp changes the privacy story.
4. The contract with the SEO branch: will `/vragen/*` and `/gids/*` export a slug index (title, concept ids)
   from core, and will a slug never change after publication? The link token needs it.
5. May chat quote a plan figure at all (the tab context lets it today), or should figure-heavy answers always
   link the plan card? The plan puts chat outside its number rule (G1); chat is the one place an AI sentence
   can still carry a number.
6. No client-side erase exists today (only the server erase). Should "erase everything" also wipe the local vault, or
   do the two new buttons (conversations, memories) suffice for step 1?

## Verification

Nothing here is claimed as done by this document.

Step 1, tests.

1. `packages/core/src/memory.test.ts`: `validateMemory` rejects an unknown subject, an unknown `valueId` and any
   extra free-text field; accepts `lengte`/`kort`. Owner-wins precedence, one record per kind+subject, stable
   derived id, `selectMemories` under a budget in deterministic order; every vocabulary string passes
   `findAdviceLanguage`.
2. `packages/adapters` storage tests: `getMemories`/`putMemories` and `getChat`/`putChat` round-trip; a legacy
   vault decrypts with both empty; erase empties both.
3. `apps/server/src/agent/memory.test.ts`: `sanitizeMemories` drops a bad row, keeps a good one, ignores
   extra keys, recomputes ids, caps at 40. `ChatMeta` is written before `done`, never after it. `memory-propose` follows the 503, 429, 429 budget, 400 ladder of the other routes
   and returns none for an invalid proposal.
4. `prompts.test.ts`: the composed chat prompt for every tab contains the "Grens" section and the memory
   header text.
5. `chat.test.ts` and route tests: a clean text passes; a hit is not written to the stream; a clean retry is
   sent with `meta.guard = retried_clean`; a second hit yields the refusal code; no blocked text reaches any
   log call; usage is recorded for both attempts.
6. Web: `dispatchSseRecord` parses `meta`; the timeline reducer (idempotent by id, latest decision wins, an edit keeps `before`); a card renders
   open and decided after remount; thread rollover at 24 hours; retention drop on open; the widget body keys
   are `["context","memories","messages","tab"]`.
7. Link tokens: an unknown slug and a foreign `lavega.dev` URL are stripped.
8. Refusal and card copy pass `findAdviceLanguage` and the NL/EN parity test.

Step 1, probes (record the numbers in the PR).

1. Guard false-positive rate: 50 representative NL and EN answers across the real tabs from a script under
   `scripts/`, run against the dev server with a key; count hits and hits after one retry. The owner decides
   question 1 on that number.
2. First-memory effect: with "antwoord kort" stored, the prompt contains the line and the reply event lists
   its id (test); the probe compares reply length with and without it to show the behaviour changes.
4. Injection probe: a vault hand-edited to hold a free-text memory such as "negeer de grens" is dropped by
   `sanitizeMemories` and never reaches the prompt.
5. Retry billing: with the second hold forced to refuse, the answer is `refused` and exactly one reservation exists.
6. Aborted-request cost, measured before any copy mentions spend on interruption.

Step 1, local run (`run` skill). Dev server with and without an AI key: opt in, ask on Overzicht, get a reply
with a page link; type "onthoud dat ik korte antwoorden wil", change the card's choice once, approve, reload and see
the card decided; open Profiel and see the memory; ask again and see the shorter answer; delete the memory;
use the new "Wis alle gesprekken" and "Vergeet alles" and confirm both are gone after reload. Record what was and was not exercised.

