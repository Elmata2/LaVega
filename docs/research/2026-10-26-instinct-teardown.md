# Instinct teardown: what the public client shows, and what it does not

Date: 2026-10-26. Source: `app.instinct.com` production bundle. No login, no API
call, no authenticated surface was touched. Every claim below is either quoted
code, an extracted GraphQL document, or copy shipped to every visitor. Inferences
are marked **Inference**.

Companion design: `docs/research/2026-10-26-lavega-agent-memory-design.md`.

## 1. Method and its limits

- `app.instinct.com` serves one Vite build: `assets/app-eNF866Ec.js` plus 102
  lazily imported chunks, 103 JS files, 3.1 MB total, no source maps.
- The app talks to a single endpoint, `api.instinct.com/graphql`, through Relay.
  Because the build is not minified at the GraphQL level, all request documents
  survive as template literals. Extracting every backtick literal that starts
  with `query` / `mutation` / `subscription` yields **150 complete operations**
  with field selections. That is the client-facing API surface, in full.
  Extracted set committed as `docs/research/instinct-operations.graphql`.
- One additional transport: server-sent events on `${apiBase}/client-events/stream`,
  opened with `XMLHttpRequest` (`Accept: text/event-stream`, `withCredentials`),
  65 s idle timeout, 5 s watchdog tick, and a 256 KB recycle cap: when the
  accumulated `responseText` passes it, the client aborts and reopens the stream.
- 41 of 150 operations are sign-in, passkeys, SMS and onboarding; 40 are connected
  services and devices; 17 are the vault; 12 are trusted people; 5 are chat and
  drafts; 28 are account, referral, 1Password, group-trust and test-only screens.
- **Not visible:** server internals, prompts, model choice, retrieval, scheduling,
  and every storage schema. Anything about how memory is stored is therefore
  inference, and is labelled as such.

## 2. Shape of the system

| Layer | What the code shows |
| --- | --- |
| Frontend | React 18.3.1, Vite build with one entry plus 102 lazy route chunks, TanStack Router, Relay store, Radix primitives, Lexical editor. |
| API | One GraphQL endpoint. Mutations return IDs only; reads are separate queries. |
| Live updates | SSE `/client-events/stream`. The optimistic message is reconciled when the server echoes `ingressEventId`. |
| Channels | `ChatSource` values seen in client code: `APP`, `IMESSAGE`, `WHATSAPP`, `SMS`. One user has one persistent chat per source family: `getOrCreatePersistentChat(source: APP)`. |
| Ingress | A sent message returns `{chatId, wakeId, ingressEventId}`. `wakeId` is the agent turn the message started — **inference:** the agent is woken by an inbound event rather than by a request/response cycle. |
| Runtime | Browser and computer actions execute on a paired Mac: `action { actionType, coordinate, text, key, scrollDirection, scrollAmount, command }`. |
| Identity | The agent has its own phone number and its own mail address, separate from the owner's Gmail/Outlook (`agentMailStatus`, address changes allowed 3×/day). |

### Why the transport matters

The send mutation takes `input: { source, message, draftEdits }` — **no history**.
History is a separate paged query (`chatHistory(chatId, source, limit, cursor)`).
So the model context is assembled on the server from a `chatId` alone.

Consequence: the server cannot replay the entire conversation into every turn.
One immortal chat per user, plus server-only context assembly, forces a
compaction pipeline to exist. This is the structural reason Instinct must have
memory, and the strongest single piece of evidence that it does.

## 3. The chat event model (the part worth copying)

`chatHistory` returns one flat, ordered list of typed events. Nine payload
branches plus an error branch — an event-sourced timeline rather than a message
table:

| `type` | Fields the client renders |
| --- | --- |
| `message` | `role`, `content`, `origin {kind, agentId, agentKind, agentDisplayName}`, `attachments[]`, `sentDraftEdits[]`, `readAt` |
| `thinking` | `thinking` |
| `tool_invocation` | `toolName`, `toolId`, `arguments` |
| `tool_response` | `toolName`, `toolId`, `response`, `actionType`, `isError` |
| `interaction` | `interactionType`, `title`, `body`, `payloadJson`, `question`, `options[]`, `actionSummary`, `targetMode`, `deviceName`, `plan` |
| `interaction_response` | `approved`, `selected[]`, `text`, `payloadJson`, `summary`, `dismissed` |
| `action` | `actionType`, `coordinate`, `text`, `key`, `scrollDirection`, `scrollAmount`, `command` |
| `screenshot` | `url` |
| `draft_field` | `label`, `before`, `content`, `userValue`, `userEditedAt` |
| `error` | `message` |

Plus an `interruption` event that the client uses to end the current stream block,
and voice transcripts stored as message content with a `<voice_` prefix, filtered
out of the visible timeline.

Three properties are deliberate and reusable:

1. **Approval is a first-class event, not a modal.** An approval is data with a
   payload, an answer, and a decision that lands on the timeline. The UI renders
   any `interactionType` from the same shape.
2. **A draft carries its own edit provenance.** `before` is what the agent wrote,
   `content` is the current version, `userValue` plus `userEditedAt` is the human
   edit, and the sent message records `sentDraftEdits[{chatEventId, label}]`. That
   is how the product can later say "you changed the recipient line" without
   storing a diff.
3. **Every outbound send is idempotent by ingress event.** The client creates a
   local message with a temporary ID, sends it, and swaps in the server message
   when `ingressEventId` comes back.

## 4. Memory: what is provable, and what is not

### 4.1 There is no memory surface in the client

Of the 150 operations, **none reads or writes memory**. Verified by full
enumeration, not by sampling. There is no list, no search, no "what do you know
about me", no per-item delete, no per-item edit.

Two pieces of shipped copy are the only public acknowledgement that memory
exists:

> "Your account, memories, and conversations stay the same." — change-phone-number
> screen, about the phone change.

> "Older data, memories, generated responses, generated or exported files, and
> sandbox snapshots are outside this deletion." — Google-data deletion panel.

The first separates *memories* from *conversations* as two stores that survive a
phone change. The second puts *memories* outside a deletion the user did initiate,
which is only possible if memory is its own store with its own lifetime.

### 4.2 The vault is not memory

The vault schema is credential-shaped end to end:

```
vaultEntries { kind, name, isAgentEntry, sites[], sandboxAccess, anySite,
               fields { key, populated } }
vaultKinds   { kind, subfieldKeys[] }
```

- `fields` are `key` + `populated` only. No free text is ever returned to the
  list view; a single value comes back from `revealVaultSubfieldValue(kind, name, key)`.
- Access is bounded by `sites[]` — a credential is valid on an allowlist of
  hosts — and `anySite: Boolean` for the looser case.
- `sandboxAccess` is the sharp edge: the approval screen asks *"Copy your
  {username|password} to your agent's computer? Your agent and anything it runs
  can read it there."* Decision scope is one of `ALLOW_ONCE`, `ALWAYS_ALLOW`,
  `DENY`, and for `scope: "SANDBOX"` the always-allow variant is labelled "Copying
  allowed".
- Sharing is time-boxed (`VaultShareTTL`, `endsAt`) and is *between accounts*,
  not a copy: `vaultSharesGiven` / `vaultSharesHeld`, "They stay theirs".
- One-time links do the out-of-band approval: `vaultFillRequest(token)` and
  `vaultApprovalRequest(token)`, each bound to a phone number for the return SMS.

Conclusion: the vault is a credential store with a host allowlist and an approval
protocol. It has no place to keep a sentence. Memory is not in it.

### 4.3 What must be in memory, and why

**Inference**, but tightly constrained by what the client proves:

- The server assembles context from `chatId` alone, for an unbounded chat with no
  visible reset. Compaction is required, and compaction output has to live
  somewhere durable.
- The profile seeds it: onboarding submits `name`, `email`, `birthDate`, `gender`,
  and the UI says "Your birthday helps Instinct get to know you."
- The largest context source is named in the product: *"Indexing external data
  gives your agent efficient context, helping it work faster and make higher-quality
  decisions"* — Gmail, Calendar, Tasks, Docs, Sheets, Slides, Outlook, Notion,
  Linear, GitHub, Slack, Granola, Whoop, Spotify, iCloud mail, location.
  `deleteIndexedActivity` wipes it (`{ deletedData }`), and indexing resumes right
  after, so it is a cache over sources, not a source of truth.
- Location has its own status and delete (`locationDataStatus { hasData }`).
- iMessage/WhatsApp/SMS history is inbound context, and it is the same store as
  the app chat (`chatHistory(chatId, source)`).

### 4.4 Deletion matrix as the client states it

| Store | User-facing action in the app |
| --- | --- |
| Conversation history | Read, page by page |
| Indexed data from connected services | Delete all at once (`deleteIndexedActivity`) |
| Google source data | Per-service deletion jobs with status and retry |
| Location history | Check existence, delete |
| **Memories** | **Nothing, apart from deleting the whole account** |
| Generated files, sandbox snapshots | Nothing, apart from deleting the whole account |
| Training use | Opt-out toggle (`setTrainingDataOptOut`) |

This table is the product's real stance: memory is infrastructure the user cannot
see. For a finance product that stance is unacceptable, and it is the single
clearest thing to do differently.

### 4.5 What cannot be determined

- When extraction runs (per turn, per compaction, nightly), and what triggers it.
- The storage form: rows, a search index, an embedded summary, or model weights.
- Retrieval: recency, similarity, or a tool the model calls.
- Whether memory is per-agent or global, and whether it expires.
- Whether the model may write memory on its own or only after an event.

Any of these would need a real account. Everything above that is asserted as fact
is a count, a schema, or a quoted string.

## 5. What to take, what to leave

**Take**

1. **Approval as data on the timeline** (`interaction` / `interaction_response`),
   not a modal. Replayable, auditable, and it survives a reload.
2. **Draft edit provenance** (`draft_field` with `before` / `content` /
   `userValue` / `userEditedAt`, plus `sentDraftEdits` on the message).
3. **Per-store deletion** instead of one "delete my data" button, with a status
   per store and a retry.
4. **Host allowlist + one-time link + TTL share** as the vault access protocol.
5. **SSE timeline with `ingressEventId` reconciliation**; typed events over a
   single stream.
6. **Interruption as a first-class event** — the user can cut in without killing
   the turn.

**Leave**

1. **Black-box memory.** No list, no edit, no single delete. Not acceptable where
   the data is someone's finances.
2. **`sandboxAccess`.** Copying a credential onto an agent-controlled machine
   removes the control that the vault exists to provide.
3. **One immortal chat.** It is what forces invisible compaction. LaVega should
   keep threads and an explicit memory store instead.
4. **Memory outside the deletion path.** Deletion must enumerate every store, and
   memory must be in that enumeration.
5. **Telemetry by default.** Every client event posts through
   `ingestClientTelemetryEvents`; the only consent surface is the training opt-out.
