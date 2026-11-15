# Agent memory for LaVega: visible, vault-held, budgeted

Date: 2026-10-26. Status: proposal, not an accepted decision. Companion evidence:
`docs/research/2026-10-26-instinct-teardown.md`. Related: ADR 0007 (portfolio
memory in Neon), ADR 0009 (account-held vault key), `packages/core/src/facts.ts`,
`packages/core/src/agentFacts.ts`.

## 1. What Instinct proves, and what we refuse

Instinct keeps memory as server infrastructure the user cannot list, edit, or
delete without deleting the account. It can do that because its chat is one
immortal thread and the server alone assembles context.

We keep the useful half — memory that makes the assistant better over time — and
refuse the invisible half. Four requirements follow, in priority order:

1. **Every memory is inspectable.** A list, with text, origin, and age.
2. **Every memory is deletable on its own**, and included in export and in
   "erase everything".
3. **The model never writes memory directly.** It proposes; the owner accepts,
   edits, or rejects.
4. **Nothing that could carry a balance, an amount, an IBAN, an account number,
   or a counterparty ever becomes memory.** Memory is replayed into prompts, so
   this is a redaction boundary, not a nicety — the same argument that already
   guards `agentFacts.ts`.

## 2. Where memory lives

Two stores already exist and the split rule falls out of how they are read:

| Store | Holds | Read when | Decided by |
| --- | --- | --- | --- |
| **Vault** (browser, AES-GCM, ADR 0009) | Personal and cross-agent memory: preferences, constraints, goals, corrections, thread summaries | Only when a prompt is built; travels with the request exactly as `facts` does today | this proposal |
| **Neon `investing.*`** (ADR 0007) | Portfolio records a server feature reads on a schedule: thesis, goal, observation, thread transcript | Turn summary, letters, snapshot jobs | accepted, unchanged |

Rule: **if a server feature must read it while the user is offline, it goes to
Neon; if it only shapes a prompt, it stays in the vault.** The personal-finance
chat has no server-side history today (`apps/server/src/agent/chatContext.ts`
caps the browser-sent list at 20 messages), so vault memory is the only thing that
can make that assistant improve.

New vault field: `memories?: MemoryRecord[]`, stored beside `facts` in
`packages/adapters/src/storage/encryptedStorage.ts` (mirror `getFacts` / `putFacts`
at lines 396–410; a legacy vault without the field must still decrypt).

## 3. Three tiers, replacing one flat list

| Tier | Name | Shape | Written by | Shown to model |
| --- | --- | --- | --- | --- |
| 0 | **Facts** (exists) | `{agent, subject, key, value, source}` | agent refresh + owner correction | Always, all of the agent's namespace, char-capped at 60 |
| 1 | **Memories** (new) | one sentence + scope + kind | proposal accepted by owner | Selected per turn under a budget |
| 2 | **Thread summaries** (new) | rolling summary of one thread | system, on overflow | Only for the thread being continued |

Tier 0 stays exactly as it is. Tier 1 is the Instinct-shaped memory, made visible.
Tier 2 is the compaction that Instinct hides; here it is a row the user can read.

## 4. Data model (tier 1)

```ts
export type MemoryKind =
  | "preference"   // "antwoord kort", "geen Engels gebruiken"
  | "constraint"   // "geen beleggingsadvies geven"
  | "goal"         // "eind dit jaar 10k buffer"
  | "correction"   // "de ING pas is een creditcard, niet betaalpas"
  | "entity"       // public brand/product only, same shape rule as facts
  | "episode";     // "verhuisde in maart naar Berlijn" — has a TTL

export type MemoryRecord = {
  id: string;              // hash(norm(scope)|norm(kind)|norm(subject)) — stable upsert
  scope: string;           // "global" | agent id ("chat" | "travel" | ...)
  kind: MemoryKind;
  subject: string;         // closed vocabulary, or a public brand
  value: string;           // <= 280 chars, one sentence, no amounts
  source: "user" | "agent";
  status: "proposed" | "confirmed" | "expired";
  pinned?: boolean;        // owner said "always remember this"
  createdAt: string;       // ISO date, set by caller (core stays clock-free, like facts.ts)
  updatedAt: string;
  lastUsedAt?: string;     // drives decay, and answers "why is this here"
  expiresAt?: string;      // required for "episode", absent otherwise
};
```

`id` is derived, not random, so a repeat proposal updates in place instead of
piling up — the same trick as `factId` in `facts.ts:27`.

## 5. Write path

```
turn ends
  → model returns structured memoryProposals[]
  → apps/server/src/agent/memory.ts validates every proposal (namespace + scrub)
  → route returns the surviving proposals to the browser
  → browser stores them with status:"proposed"
  → UI shows one chip per proposal: [Remember] [Edit] [No]
```

- **No direct write from the model.** Structurally impossible: the model never
  holds the vault key, and the route only returns proposals.
- **Autonomous band, narrow.** A proposal may be auto-confirmed only when
  `kind === "preference"`, `scope === "global"`, the subject is a closed-vocabulary
  token, and the value contains no identifier. Everything else waits for a yes.
  The UI still shows it, with an undo.
- **Owner statement wins.** A `source: "user"` record is never overwritten by an
  `agent` record — reuse the precedence rule of `upsertFacts` (`facts.ts:57`).
- **`episode` records need a TTL.** Default 90 days. They expire from prompts
  first; the row stays visible with `status: "expired"` until deleted, so a stale
  memory is never silently wrong.

## 6. Read path

Deterministic selection. No embeddings, no vector store — ADR 0007 already defers
that until keyword lookup fails, and finance memory is small.

```ts
selectMemories(all, { scope, message, budgetChars, now })
```

1. Keep `status: "confirmed"` and not expired, where `scope` is `"global"` or the
   current agent.
2. Always include every `constraint` and every `global` `preference` — small,
   bounded, and the ones a model must not contradict.
3. Rank the rest: `scopeMatch > pinned > keyword overlap with the current message >
   recency`, where keyword overlap is normalized token intersection, not fuzzy
   similarity.
4. Take items until the char budget (start at 1200 chars, measure) is reached.
5. Stamp `lastUsedAt` on the selected rows.
6. Render with provenance, because it changes how the model treats a line:

```
WAT LAVEGA ZICH HERINNERT (door jou bevestigd; niet tegenspreken):
- [voorkeur] antwoord kort
- [grens] geen beleggingsadvies geven
WAT LAVEGA ZELF LEERDE (mag gecorrigeerd worden):
- [doel] buffer van 10k dit jaar (sinds 2026-03)
```

That block replaces nothing: `factsBlock` still follows it, and `TAB-CONTEXT`
still follows that.

## 7. Privacy boundary

Three gates, all upstream of the model call, all reusable as they are:

1. **Namespace** — `packages/core/src/memory.ts` mirrors `AGENT_SPECS`: per-agent
   allowed `kind`/`subject` pairs, closed vocabularies, bounded value shapes.
2. **Scrub** — `scrubPersonalValues` (`packages/core/src/categorize.ts:153`) runs
   on every memory value before it enters the prompt, same as chat context.
3. **Reject, do not fail** — one bad row must not break a request
   (`sanitizeKnownFacts` already makes this choice at `apps/server/src/agent/facts.ts:24`).

Server route changes mirror what `facts` already does: the browser sends
`memories`, the route never trusts `scope` from the client, and the agent id is set
by the route.

## 8. Deletion and export

Every path is a real operation, not a promise:

| Action | Scope |
| --- | --- |
| Delete one | by `id` |
| Delete all for one agent | `scope === agent` |
| Delete all learned by the model | `source === "agent"` |
| Delete everything | empty `memories[]` |
| Export | included in the vault backup, beside `facts` |

"Erase all data" must enumerate memories explicitly. Instinct's gap is that its
user-initiated deletions do not cover memory; ours must not repeat it.

## 9. What we do not build

1. **No immortal chat.** Threads stay threads. The thing that forces invisible
   compaction in Instinct is the single endless conversation — not needed here.
2. **No memory read/write tool callable by the model.** The model proposes; the
   browser decides. A tool that writes memory would move the trust boundary.
3. **No credential-adjacent memory.** Nothing derived from a vault credential,
   an account number, or a transaction amount. `entity` memory is a public brand
   only, shape-checked like the `travel` namespace.
4. **No server-side memory store for prompt-time data.** If the browser can hold
   it, the browser holds it.

## 10. Phased plan

**P0 — the store, with no model writing (small, shippable)**

- `packages/core/src/memory.ts`: types, `memoryId`, `validateMemory`, `selectMemories`, `memoryBriefing`.
- `packages/core/src/memory.test.ts`: namespace rejects, owner-wins precedence, budget cut, TTL expiry.
- `packages/adapters/src/storage/encryptedStorage.ts`: `memories?` field, `getMemories`, `putMemories`, legacy-vault path.
- `apps/web/src/views/Profiel.tsx`: "Wat LaVega onthoudt" section — list, edit, delete, add by hand.
- Acceptance: a memory typed by the owner survives reload, appears in the vault backup, and can be deleted one by one.

**P1 — the model can propose**

- `apps/server/src/agent/memory.ts`: `sanitizeMemories`, `memoryBlock`.
- `apps/server/src/agent/chat.ts`: inject `memoryBlock` after `factsBlock`.
- `apps/server/src/agent-routes.ts`: read `memories` from the body, return `memoryProposals`.
- Prompt change in `apps/server/src/agent/prompts/_chat.md`: when to propose, and the one-sentence, no-amounts rule.
- `apps/web/src/api.ts` + chat UI: proposal chips with accept/edit/reject.
- Acceptance: the assistant proposes a preference, the owner rejects it, and the next turn does not carry it.

**P2 — compaction, made visible**

- Tier 2 `ThreadMemory`: rolling summary per thread, generated when the browser's
  20-message window overflows, stored in the vault, shown collapsed in the thread.
- Recall by keyword when the user asks "wat weet je nog over X", over the same
  store — no new infrastructure.

## 11. Open questions

1. Should tier 1 be one list or one list per agent? Proposed: one list, `scope`
   column, filtered in the UI.
2. Does the portfolio agent's Neon memory (ADR 0007) merge into this? Proposed: no.
   Keep the split rule in §2, and let the UI say where each memory lives.
3. Budget in characters or tokens? Characters, measured once P1 lands.
4. Do `episode` records exist at all? They are the most Instinct-like and the
   easiest to get wrong. Proposed: only in P2, only with a TTL.
