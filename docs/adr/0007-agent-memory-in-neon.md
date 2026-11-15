# Agent memory in Neon

## Status

Accepted.

## Decision

Portfolio agent memory lives in our own Neon Postgres, in the `investing` schema, under the same per-user row-level security as the other investing tables (ADR 0004). We do not use a hosted memory service such as mem0 or Supermemory, and we do not add `pgvector` or a vector store such as turbopuffer yet.

Terms follow the investing glossary in `docs/CONTEXT.md`: thread, thesis, dormant thesis, goal, observation, risk tolerance, erase all data.

## Why

A vendor is acceptable to us if it is clearly better, so privacy alone did not decide this. What decided it is fit:

- The memory we need is structured, not fuzzy. A thesis is one row per user and symbol. A goal, an observation, and a thread are small records keyed by user, agent, and symbol. Exact lookups answer every recall we know of today.
- Deletion rules are part of the domain. Deleting a thread must delete its observations and keep confirmed theses and goals. Erase all data must remove everything. Foreign keys and cascades in our own tables state these rules directly. A hosted memory service would own the extraction and deletion, and we would have to prove its behavior matches ours.
- One database keeps the user's data export, erasure, and RLS in one place.

Revisit when an agent needs recall by meaning across many threads ("what did I say about semiconductors?") and keyword or symbol lookup fails. The first step then is `pgvector` in the same database; a separate vector store comes after that.

## Data model

All tables carry `user_id` and use RLS. Free text from the user or the agent is encrypted before it reaches Neon, the same as broker snapshots.

| Table                          | Key                        | Holds                                                                                                                |
| ------------------------------ | -------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `investing.agent_threads`      | `id`                       | One thread: `agent_id`, title, created and updated time.                                                             |
| `investing.agent_messages`     | `thread_id`, `seq`         | Messages of a thread in order. Cascades on thread delete.                                                            |
| `investing.theses`             | `user_id`, `symbol`        | One thesis per symbol for all brokers and agents. `status` is `active` or `dormant`. Not deleted by thread delete.   |
| `investing.goals`              | `id`                       | One goal. `symbol` is null for a portfolio goal. `source_thread_id` is set null on thread delete, so the goal stays. |
| `investing.agent_observations` | `id`                       | One observation: `agent_id`, `thread_id`, optional `symbol`. Cascades on thread delete.                              |
| `investing.preferences`        | `user_id` (existing table) | New `risk_tolerance` column: `conservative`, `balanced`, `aggressive`, or null when not set.                         |

Threads and observations belong to one agent. Theses, goals, and risk tolerance are shared by all agents.

## Write path

A thesis or goal is saved only after the user confirms it. The user can state it directly, or the agent proposes it in the thread and the user accepts. Observations are written by the agent without confirmation, because they are tied to their thread and die with it.

A thesis becomes `dormant` when its position closes. Agents do not read dormant theses. On a rebuy the agent shows the dormant thesis, labelled as from a previous holding, and asks if it is still true.

## Read path

Each turn the agent gets a small fixed summary: risk tolerance and the user's goals. Everything else, including theses, observations, and older threads, comes through a `recall_memory` tool the agent calls when it needs it. The summary is one indexed query per turn, so time to first token stays flat. If risk tolerance is null, the agent asks once and saves the answer.

## Implementation notes

- Migration `0020_agent_memory.sql`. Every key and foreign key leads with `user_id`, because a foreign-key check bypasses row-level security: a key on the thread id alone would let one user link rows to another user's thread.
- The turn summary also carries the thesis of each held symbol the message names, and the dormant thesis of a symbol held again, so the agent can ask for a missing thesis or confirm a dormant one without a tool call. It is still one indexed statement. That statement also marks theses of symbols no longer held as dormant.
- Messages are stored for reopening a thread; the model reads the history the client sends.

## Consequences

- Thesis identity was originally the normalized broker symbol, not a cross-broker instrument identifier, so different symbols for the same security could hold separate theses (the preview holdings include `GOOGL_US_EQ` and `ABEAd_EQ`, both with ISIN `US02079K3059`). **Resolved by the canonical instrument key in the update below (WS4.5, #297).** Holdings and trade records still keep their broker symbols; the key is the identity the agent reads by.
- Encrypting free text rules out SQL full-text search over memory. `recall_memory` filters by agent, symbol, and date instead. Semantic recall, if it comes, needs its own decision on how encrypted text is indexed.
- The user can list, reopen, and delete threads, and edit theses and goals. A thesis cannot be deleted on its own; erase all data removes it.
- The data export must include threads, theses, goals, observations, and risk tolerance. It also includes portfolio letters (ADR 0008).

## Update: canonical instrument keys (WS4.5, #297)

Status: accepted. The follow-up named in Consequences is now the decision.

Thesis identity moves from the broker symbol to the ISIN-first canonical
instrument key defined by `packages/core/src/investing/securities.ts`:
`isin:<ISIN>` when the ISIN is well formed (ISO 6166 shape and check digit),
else `sym:<TICKER>@<MIC>` with a canonicalised MIC, else `sym:<TICKER>`.

- **One instrument, one key.** `resolveSecurityIdentities` groups the broker
  snapshot's rows by ISIN, so the same ISIN from two brokers resolves to one
  identity and one thesis key, and a symbol change with the same ISIN does not
  split history. A ticker that points at two identities is reported as
  ambiguous and left out of the symbol map rather than silently folded.
  Missing ISINs and distinct share classes stay separate, as Consequences
  required.
- **The storage shape.** Migration `0030_thesis_instruments.sql` adds a nullable
  `instrument_key` and a `review_required` flag to `investing.theses`. The
  primary key stays `(user_id, symbol)`: the symbol is the row's stable edit
  handle, the key is the identity the agent reads by. A partial unique index on
  `(user_id, instrument_key)` where the row is not under review makes "one
  instrument, one thesis key" a database fact.
- **Migration never merges a conflict.** Theses of one instrument with an
  identical body and status fold into one row. Confirmed theses that disagree
  keep every row and are flagged for review, and the owner resolves them. A
  thesis whose symbol the snapshot cannot place keeps a null key. The plan is
  computed by `planThesisMigration` in core and applied by
  `applyThesisMigration`; `POST /api/memory/instruments/migrate` runs it with the
  current broker snapshot as the identity source.
- **Reads follow the key.** The turn summary matches a thesis by symbol or by
  canonical key, and the chat passes the held and named holdings' keys, so a
  thesis stored under another broker's spelling of the same ISIN is found. The
  owner UI shows a "Needs review" badge on a conflicting thesis.
- **What stays out.** The agent tools still speak broker symbols; the key is
  resolved at the memory boundary. `Security` master data (asset class, sector,
  region) is not stored in LaVega, so the allocation ladder uses the existing
  instrument/entity grouping rather than Sure's classification dimensions.
