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

## Consequences

- Encrypting free text rules out SQL full-text search over memory. `recall_memory` filters by agent, symbol, and date instead. Semantic recall, if it comes, needs its own decision on how encrypted text is indexed.
- The user can list, reopen, and delete threads, and edit theses and goals. A thesis cannot be deleted on its own; erase all data removes it.
- The data export must include threads, theses, goals, observations, and risk tolerance.
