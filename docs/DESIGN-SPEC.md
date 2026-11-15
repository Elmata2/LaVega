# LaVega — Foundation Design Spec

**Date:** 2026-07-29 · **Status:** approved in brainstorming → pending spec review

## Decisions (locked)

| #                   | Decision                         | Choice                                                                                              |
| ------------------- | -------------------------------- | --------------------------------------------------------------------------------------------------- |
| Architecture stance | local-first vs cloud vs agnostic | **Deployment-agnostic** — pluggable storage + banking adapters; local now, hosted later, no rewrite |
| Stack tier          | minimal vs modern vs middle      | **Modern TS monorepo** — relax no-deps/no-build, keep privacy principles                            |
| UI                  | React vs Svelte                  | **Vite + React**                                                                                    |
| Server              | Hono vs Fastify                  | **Hono** (portable)                                                                                 |
| Storage             | —                                | **IndexedDB** adapter now → **Postgres** later                                                      |
| License             | AGPL vs MIT                      | **AGPL-3.0**                                                                                        |
| Monorepo            | —                                | **pnpm workspaces + TS project refs**                                                               |
| Tests               | —                                | **Vitest** (port Kasoverzicht's parser suite)                                                       |
| Repo                | —                                | **`Elmata2/LaVega`** (empty, private)                                                               |

## Two-dev split

`core/personal` (Alexander) and `core/investing` (cofounder) are separate modules with their own UI routes, both consuming the shared `core/ingest` + adapters. Parallel work, shared aggregation spine.

## Feature #1 — Aggregation dashboard (scope)

Port the Kasoverzicht clean-room engine into the new modular structure and ship a working v0 Alexander can run on his own accounts:

- **core:** model + tx.id hash, parsers (MT940 / CAMT.053 / CSV profiles), `ingest()` (normalize → dedup → per-entity consolidation), rules & signals.
- **adapters/storage:** IndexedDB `StorageAdapter`.
- **adapters/banking:** `FileImport` (offline) + `EnableBanking` (sandbox).
- **apps/web:** the five views — Overview, Transactions, Accounts, Signals, Rules — in React.
- **apps/server:** Hono endpoints for Enable Banking sync (keys stay server-side; CORS).
- **tests:** Vitest port of the 40 parser checks.

Out of scope for #1: forecasting (roadmap #2), investing module, hosted deploy, multi-user.

## Constraints carried in

No FinnTell reuse · privacy/local-first default · read-only (no PIS) · secrets never in repo · `core/` stays I/O-free.

## Open items to confirm at build

- Local working directory for the clone (proposed: `~/Desktop/LaVega`, outside the `My_Code` git repo to avoid nesting).
- Whether to proceed via a written implementation plan (writing-plans) or scaffold directly.
