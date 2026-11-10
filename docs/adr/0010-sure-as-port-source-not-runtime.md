# ADR 0010 — Sure is a port source, not a runtime dependency

## Status

Accepted 2026-11-10 (owner approved the adoption plan and decisions). Applies to the
personal and investing sides. Companion:
[`docs/superpowers/specs/2026-11-10-sure-adoption-plan.md`](../superpowers/specs/2026-11-10-sure-adoption-plan.md).

## Context

`we-promise/sure` (community fork of Maybe Finance, AGPL-3.0) is a mature Rails personal
finance application. LaVega is a local-first TypeScript monorepo: an encrypted browser vault
for the personal side, a Neon-backed investing dashboard, and pure Effect 4 domain logic in
`@lavega/core`. Both projects are AGPL-3.0.

LaVega is thin in exactly the places Sure is strong: first-class transfers, bills with
occurrences and payment matching, envelope budgets with carry-over, balance-sheet/income-
statement reporting, a retained statement/document vault, a generic import framework and a
single agent-tool registry exposed as MCP. Sure is thin where LaVega is strong: deterministic
cashflow forecasting, Dutch tax and card-catalogue logic, TWR/XIRR/risk/sector investing
analytics, local-first privacy and typed AI judgments.

The teardown (`docs/research/2026-11-10-sure-teardown.md`) established that:

1. Almost no Ruby file can be pasted into LaVega (Rails, ActiveRecord, Sidekiq, Hotwire,
   Postgres-specific SQL).
2. The transferable assets are deterministic algorithms, state machines, data-model
   invariants and test fixtures.
3. Running Sure as a sidecar would create a second source of truth, break the encrypted
   personal-vault promise, and add a second Postgres/Redis/Sidekiq stack with no Dutch model.
4. LaVega's existing return/risk stack must not be replaced by Sure's weaker one.

Sorting requires a decision on *how* Sure is used, not only *what* is taken.

## Decision

Use Sure as a **design and algorithm source**, through independent reimplementation:

1. **No runtime dependency.** LaVega does not run Sure, does not proxy Sure, and does not
   store product data in Sure.
2. **Port selected logic to TypeScript/Effect**, from the pinned commit
   `562fe096d149cb4d1fb1e6d3446527572c1ec7f6`, using the Ruby code and its behavioural tests
   as the specification. Say "independent reimplementation", not "clean-room": the method
   reads the Ruby. Port order and scope are in the adoption plan.
3. **Adopt concepts** where the code is Rails-bound: transfer state machine, bill
   occurrence identity, budget carry semantics, statement coverage/review, agent tool
   contract, provenance citation grammar.
4. **Attribute every port.** Each derived module carries a header naming Sure, the commit,
   AGPL-3.0, "independently reimplemented for LaVega" and the change date. The root `NOTICE`
   entry lands in Phase 0, before the first module ships; the plan's provenance ledger records
   each reuse. No verbatim source copy into first-party modules; no widening of the MIT-only
   vendor policy. Text adapted from the MIT-licensed wealth blueprint carries its own
   attribution.
5. **Never use the "Maybe" or "Sure" marks** in LaVega product naming, and state
   non-affiliation in `NOTICE`.
6. **Pin the reference.** A local clone at the pinned commit is reference material only,
   fetched by a script, never imported by build or test.
7. **Keep LaVega's invariants:** personal ledger never server-readable without a new ADR
   (`ADR 0009`), `tx.id` hash unchanged, outflow negative in `Tx`, Effect 4 for new logic,
   read-only bank/broker access, missing data shown as unknown.

## Consequences

Positive:

- The personal side gains the workflow features it lacks without abandoning its architecture.
- The investing side gains basis provenance, realised/income reporting and security identity
  without risking its stronger returns/risk math.
- The agent surface gains one tested tool contract instead of per-surface ad-hoc tools.
- AGPL compatibility keeps the licence clean; attribution is explicit and auditable.

Negative / accepted costs:

- Ports are reimplementations, not free code: ~6,000–9,000 new TypeScript lines plus storage
  and UI, over roughly 10–12 weeks of focused work.
- Sure is a moving development tree; behaviour must be re-verified at each phase against the
  pinned commit.
- Some Sure edge cases depend on Postgres (matching, report aggregates); LaVega must
  re-express and re-test them, with a performance envelope measured on the real vault.
- Clean-room discipline adds review overhead compared with copy-paste.

## Alternatives rejected

| Alternative | Why rejected |
|---|---|
| Run Sure as a local sidecar and integrate | Second runtime and source of truth; breaks the encrypted-vault promise; no Dutch tax/catalogue/invoice model; duplicates auth, backup and erasure. |
| Fork Sure as the personal app | Rewrites the product away from LaVega's privacy, Dutch and design constraints; abandons the existing forecast/investing work. |
| Copy Ruby verbatim into a `vendor/` tree | Nothing runs it; adds a dead dependency and a large AGPL surface without portability benefit. |
| Wait for Sure upstream to expose an API and use it remotely | Violates local-first/privacy, requires hosting credentials and personal data off-machine. |
| Take nothing | Leaves the highest-value personal gaps (transfers, bills, budgets, evidence) and the agent contract unaddressed. |

## Follow-ups

1. ADR 0011 — direction and money convention for ported modules (Phase 0).
2. ADR 0012 — MCP mount, bearer-token authentication and tenant resolution (Phase 0).
3. Phase 0 attribution scaffolding: `NOTICE`, reference script, provenance ledger, scrub rules,
   metric baselines.
4. Owner decisions listed in the adoption plan §9 (personal shipping, old data export,
   server-readable boundary, budget shape, investing priority, rules scope, issue filing).
5. Revisit if Sure changes licence, adds a stable documented API that fits local-first, or
   if LaVega's architecture moves to a server-readable personal store (new ADR required).
