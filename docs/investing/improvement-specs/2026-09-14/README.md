# Investing technical improvement handoff

Review date: 2026-09-14. Repository: `Elmata2/LaVega`, local checkout `/Users/jortwiebrens/Documents/LaVega`. Reviewed baseline: `master`, `7a566c4`.

## Outcome

23 scoped specifications cover financial correctness, broker/runtime state, portfolio agents, and browser state ownership. The first priority is truthful financial data and preservation of last-good snapshots. Refactoring should put those rules behind tested module interfaces, not split large files for their own sake.

This review changes documentation only. Each specification includes evidence, intended behavior, scope and acceptance checks. Confirmed means source inspection establishes the failure path; synthetic reproductions and executed checks are identified separately. “Worth exploring” items contain an explicit validation gate. No review can guarantee discovery of every defect; these are all actionable findings from the inspected investing paths.

## Start here — instructions for an implementing agent

1. Read this file, the assigned specification, root `AGENTS.md`, `docs/CONTEXT.md`, and relevant ADRs under `docs/adr/`. Read linked source around the cited lines; line numbers refer to this baseline.
2. Resolve the current integration branch. Prior Tailwind v4/theme-token/lint work is on `worktree-shadcn-lint-setup`, commit `719773f`, and is **not** an ancestor of reviewed `master`. Preserve or integrate that work through the project's normal branch workflow; do not repeat its migration. Rebase specifications conceptually onto current source if lines moved.
3. Implement one assigned scope. Add a regression case that exercises the actual module interface before broad refactoring. Keep existing working behavior and unavailable-data states explicit.
4. Use isolated worktrees when agents work concurrently. Consult the ownership table below before editing shared files. Do not silently expand into neighboring specifications.
5. Run affected package tests/typechecks plus architecture checks when imports change. Update domain/docs and add forward-only database migrations when a specification changes persisted shape. Do not erase snapshots or require a fresh sync to conceal migration problems.
6. Handoff must state changed behavior, tests run, migration/backward-compatibility handling and remaining risks. No live broker, OpenRouter, deployment, or production-data changes are needed to validate these specifications; use sanitized fixtures/fakes.

An assignment can be: “Implement FIN-02 from `docs/investing/improvement-specs/2026-09-14/financial-core.md`. Read its README first, preserve existing changes, and satisfy its acceptance cases.” The specification plus this README provides the required local context.

## Scope and architecture

- `apps/investing-web`: overview, positions/detail, portfolio-agent conversations, credentials, sync progress and charts.
- `apps/investing-server`: HTTP composition, tenant runtime, snapshot restoration, broker/price orchestration, agent execution, local and Neon stores.
- `packages/core/src/investing`: quantity reconstruction, dated valuation, FX, cost basis, allocation, returns and read models.
- `packages/adapters/src/brokers` and `market-data`: Trading 212 / IBKR normalization, scheduled sync, Yahoo/cache behavior and persistence adapters.
- `packages/database`: investing repositories and tenant-scoped persistence. Integration paths inspected: `apps/server/src/investing-mount.ts`, `scripts/vercel-api.ts`, `scripts/vercel-build.mjs` and CI.

Retain the established direction: domain calculations in core; provider/storage details behind adapters; browser owns presentation and interaction. No broad framework replacement, new generic repository layer or wholesale `app.tsx` rewrite is justified. A seam earns depth when one module owns a rule that callers previously repeated. Every proposed extraction must pass the deletion test: it should concentrate complexity, not simply move it. Prefer locality and leverage across existing callers; one adapter alone does not justify a hypothetical abstraction.

## Specification index

P1 = incorrect financial results, loss of valid state, credential disclosure path, or broken primary action. P2 = resilience/consistency/verification repair. P3 = optional ownership improvement. These are implementation priorities, not claims of incidents in production.

| ID     | Priority | Specification                                                            | Evidence / strength                          |
| ------ | -------- | ------------------------------------------------------------------------ | -------------------------------------------- |
| FIN-01 | P1       | [Broker ownership in holdings reconstruction](financial-core.md#fin-01)  | Synthetic reproduction; Strong               |
| FIN-02 | P1       | [Partial/failed IBKR snapshot preservation](financial-core.md#fin-02)    | Confirmed call path; Strong                  |
| FIN-03 | P1       | [Execution quantity and ordering](financial-core.md#fin-03)              | Sign reproduced; ordering inspected; Strong  |
| FIN-04 | P1       | [Historical FX coverage](financial-core.md#fin-04)                       | Confirmed policy/test conflict; Strong       |
| FIN-05 | P1       | [Cost-basis coverage and currency](financial-core.md#fin-05)             | Partial basis reproduced; Strong             |
| FIN-06 | P1       | [List/detail quote freshness](financial-core.md#fin-06)                  | Synthetic reproduction; Strong               |
| FIN-07 | P2       | [Price-cache coverage/provenance](financial-core.md#fin-07)              | Confirmed call path; Strong                  |
| FIN-08 | P2       | [Cash-history coverage](financial-core.md#fin-08)                        | Fixture validation required; Worth exploring |
| R1     | P1       | [Absolute sync deadline propagation](runtime-and-storage.md#r1)          | Confirmed call path; Strong                  |
| R2     | P1       | [Broker ownership and atomic snapshot commit](runtime-and-storage.md#r2) | Cross-instance race; Strong                  |
| R3     | P1       | [Price lease/progress durability](runtime-and-storage.md#r3)             | Confirmed failure paths; Strong              |
| R4     | P1       | [Local store commit-before-publish](runtime-and-storage.md#r4)           | Confirmed failure paths; Strong              |
| R5     | P2       | [Fresh broker data for price discovery](runtime-and-storage.md#r5)       | Confirmed call path; Strong                  |
| R6     | P2       | [Unreadable credential recovery](runtime-and-storage.md#r6)              | Confirmed call path; Strong                  |
| R7     | P2       | [Agent-run ordering and local protection](runtime-and-storage.md#r7)     | Race/protection gap; Strong                  |
| UI-01  | P1       | [Dashboard resource ownership](frontend.md#ui-01)                        | Request/decoder failure paths; Strong        |
| UI-02  | P1       | [Persona selection and catalog states](frontend.md#ui-02)                | Confirmed defects; Strong                    |
| UI-03  | P1/P2    | [Sync polling lifecycle](frontend.md#ui-03)                              | Confirmed failure paths; Strong              |
| UI-04  | P2       | [Chart-window transitions](frontend.md#ui-04)                            | Wheel defect/gesture gaps; Strong            |
| UI-05  | P3       | [Risk-summary resource ownership](frontend.md#ui-05)                     | Conditional extraction; Worth exploring      |
| AG-01  | P1       | [Agent snapshot/output integrity](agents-and-observability.md#ag-01)     | Confirmed semantics/validation gaps; Strong  |
| AG-02  | P2       | [Portable snapshot hashing](agents-and-observability.md#ag-02)           | Reproduced architecture-test failure; Strong |
| SEC-01 | P1       | [Complete credential redaction](agents-and-observability.md#sec-01)      | Synthetic reproduction; Strong               |

## Delivery and parallel ownership

Top recommendation: implement **FIN-02 with R2 as consecutive work**. First establish whether each broker section is complete; then make its durable application race-safe. Otherwise a transient IBKR failure can replace useful portfolio state, and concurrent instances can undo correct normalization. AG-02 is a small independent verification unblock; SEC-01 is an independent security repair.

| Work lane                  | Sequence                                                  | Shared-file constraint                                                                                             |
| -------------------------- | --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| Snapshot ingestion/runtime | FIN-02 → R2 → R1 → R5                                     | `index.ts`, broker result types, scheduled sync; keep one owner during each merge                                  |
| Financial model            | FIN-01 → FIN-03 → FIN-04 → FIN-05 → FIN-06 → FIN-08 gate  | `model.ts`, `portfolio.ts`, `positions.ts`; serialize model/schema changes, then split only with agreed interfaces |
| Price execution            | R3 and FIN-07 coordinated                                 | Orchestrator and cache adapter can be separate, but share progress/coverage contract                               |
| Local persistence          | R4 → R6 → R7                                              | Credential vault and store helpers overlap; coordinate R2 persistence edits                                        |
| Browser resources          | UI-01 → UI-02 → UI-03; UI-05 only if deletion test passes | All touch `app.tsx`; assign one owner or merge sequentially                                                        |
| Chart interaction          | UI-04                                                     | Independent chart module; check financial output shapes after FIN changes                                          |
| Agent execution            | AG-02 → AG-01; coordinate R7                              | Same portfolio-agent/runtime files; do not race edits                                                              |
| Problem reporting          | SEC-01                                                    | Independent reporter module                                                                                        |

FIN-08 requires FIN-01/FIN-02 and representative settlement fixtures before changing cash math. UI-03 depends on agreed runtime terminal outcomes; mocks can be prepared earlier. R2 may require new store compare-and-swap/lease operations and database migration; it does not authorize replacing Neon or changing trusted tenant resolution. Shared files across lanes mean the table is an ownership guide, not permission to launch every lane against one checkout.

## Existing decisions and documentation drift

- Preserve ADR-0001: Yahoo remains the default market-data provider. Fix coverage/currency provenance without changing provider policy.
- Preserve ADR-0002: encrypted local snapshots and last-good data survive failed/partial sync. FIN-02/R2/R4 enforce this decision.
- Preserve ADR-0004: tenant-scoped Neon records and encrypted broker vaults. Shared production agent stores already use the trusted tenant resolver; no cross-tenant leak was established by this review.
- `DASHBOARD.md` requires trade-date FX, while current forward fallback and current-rate plumbing violate it: FIN-04 updates code and tests.
- `DASHBOARD.md` prohibits incomplete-history return estimates while implementation supports broker-average estimates: FIN-05 must document honest coverage and labels rather than silently remove useful estimates.
- Market-data consent descriptions differ between older dashboard text and current workflow. Preserve current behavior; reconcile documentation from actual accepted decisions, without introducing a new consent flow under these specs.
- Risk summary intentionally refreshes manually after sync, with a test enforcing it. UI-05 preserves that behavior. Automatic refresh is not an approved correctness fix.
- Local agent-run encryption in R7 needs explicit storage-policy documentation: ADR-0002 directly governs broker snapshots; applying its protection approach to derived insights is a proposed extension, not an existing explicit agent-run mandate.

## Verification evidence and limits

Executed on reviewed checkout:

- Investing frontend tests: **85 passed**.
- Core, database and investing-server tests: passed in baseline/targeted runs.
- Typechecks for investing frontend/runtime, core, adapters and database: passed.
- Adapter architecture check: **fails** because `portfolioAgent.ts` imports `node:crypto`; isolated rerun confirmed it. Overall recursive test command therefore fails. Do not claim a green repository baseline.
- Synthetic financial probes reproduced broker-anchor loss (€30 current row vs €20 chart), negative sell reversal, partial basis (€40 value / €10 known basis producing 300%), and stale detail valuation (list unavailable vs detail €20).
- Synthetic redaction probe leaves the credential suffix in `Authorization: Bearer SYNTHETIC_EXAMPLE_TOKEN`.

No live broker sync, production database operation, model call, deployment, build or browser end-to-end validation was performed for this review. Static failure paths still require the specified regression tests during implementation. Full application behavior beyond investing is out of scope.

## Preserved follow-ups and review artifacts

Prior-session font 404/OTS failures remain a separate follow-up: reported earlier, **not reverified** here. `apps/web` Tailwind adoption remains separate. Tailwind/card/popover/lint changes already present on `719773f` are not new findings.

Existing uncommitted `docs/investing/PORTFOLIO-AGENTS.md` edits were preserved. No code, migration, branch, commit or deployment was changed by this review. The temporary visual report links back to this versioned handoff pack; its CDN styling/diagrams require network access, while its text remains readable offline.
