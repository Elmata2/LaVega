# Sure teardown: what it is, what is worth taking, and what is not

Date: 2026-11-10. Status: research complete, adoption plan in
[`docs/superpowers/specs/2026-11-10-sure-adoption-plan.md`](../superpowers/specs/2026-11-10-sure-adoption-plan.md).

Source: [`we-promise/sure`](https://github.com/we-promise/sure) at commit
`562fe096d149cb4d1fb1e6d3446527572c1ec7f6` (2026-11-10), shallow clone at `/tmp/sure`,
AGPL-3.0. Read-only static analysis. No Rails server, test suite, Docker or database was
run. Everything below is either quoted code, a schema fact, or a stated design decision;
inferences are marked.

Raw notes and full citations live in [`docs/research/sure/`](./sure/README.md):

- `00-core-domain.md` — accounts, entries, transfers, rules, bills, budgets, reports, imports.
- `01-investing.md` — holdings, trades, cost basis, materializers, providers, portfolio math.
- `02-platform-ai.md` — assistant, MCP tool contract, API v1, imports/exports, ops.
- `03-lavega-state.md` — what LaVega has today, capability matrix, seams, gaps.

## 0. Verdict

**Take Sure's domain design and deterministic algorithms. Do not take its runtime.**

Both projects are AGPL-3.0 Rails-vs-TypeScript products with opposite deployment shapes.
Sure is a family/household, server-rendered monolith backed by Postgres, Redis and Sidekiq.
LaVega is a local-first pnpm monorepo with an encrypted browser vault (personal side) and a
Neon-backed investing dashboard. Almost no Ruby file can be pasted into LaVega. What does
travel is the part LaVega is thinnest on: the *semantics of money workflows* — transfers,
bills/occurrences, budgets, statements/evidence, rules depth, and the agent tool contract.

| Question | Answer |
|---|---|
| Is Sure professionally written? | **Yes.** 208k Ruby app LOC, 1,227 test files / 272k test LOC, DB constraints plus model validations, unusually dense intent comments. Strongest code is the Maybe-era domain (accounts/entries/budgets/goals/reports) and the newer Bills subsystem. |
| Can LaVega reuse it verbatim? | **No.** Rails/ActiveRecord/PG-SQL/Hotwire runtime does not exist in LaVega. |
| Can LaVega reuse the logic? | **Yes.** AGPL-3.0 to AGPL-3.0 is compatible. Recommended shape: independent TypeScript/Effect reimplementation from the Ruby algorithms and their tests, with written attribution (see §6). Do not call it clean-room: the method reads the Ruby and its tests. |
| Should LaVega run Sure as a sidecar service? | **No.** Second runtime (Postgres+Redis+Sidekiq), duplicate data ownership, no fit with the encrypted vault, no Dutch tax/catalogue model. No historical instance or export remains (owner confirmed 2026-11-10), so there is not even a migration use. |
| What is the single biggest win? | **The Bills subsystem** (schedule → occurrences → payment matching → paycheck plan), because LaVega already ships a forecast but detects rather than *manages* commitments. It directly strengthens the stated wedge. |
| What is the single biggest trap? | **Sign convention.** Sure stores outflow positive; LaVega stores outflow negative. Every ported formula must cross one explicit normalization boundary, or cashflow/report math silently inverts. |

## 1. What Sure is

A community fork of the abandoned Maybe Finance app, now maintained as `we-promise/sure`.
It is a full personal-finance application: accounts of every kind, transactions, transfers,
categories, merchants, tags, rules, recurring bills, budgets, goals, net-worth and cashflow
reports, document/statement vault, investments, AI assistant, REST API v1, and an MCP server
for external agents. Self-hosted with Docker; the fork is actively developed.

Scale at the pinned commit:

| Metric | Value |
|---|---|
| Framework | Rails 8.1, Postgres, Redis, Sidekiq |
| Application Ruby | ~207,600 LOC under `app/` |
| Tests | 1,227 Minitest files, ~272,500 LOC |
| Migrations | 479 |
| Models | 300+ files/dirs under `app/models/` |
| Views/components | 839 ERB files, 147 JS files |
| Provider integrations | ~30 bank/broker/crypto connectors through a provider registry |
| Agent surface | 55 assistant function files; 49 MCP tools (35 core + 14 preview) |
| Licence | AGPL-3.0 |

Product shape that matters for LaVega:

- **Money model**: `Account` is a shell with a typed `accountable` (Depository, Investment,
  Crypto, Property, Vehicle, OtherAsset, CreditCard, Loan, OtherLiability). One `Entry`
  envelope carries a `Transaction` (income/expense/transfer), a `Trade` (security movement)
  or a `Valuation` (an absolute value or debt at a date). This is why Sure can show a balance
  sheet, an income statement and a net-worth line from the same ledger.
- **Workflow layer**: transfers are first-class pairs with pending/confirmed/rejected state;
  bills are recurring series with materialized occurrences and payment matching; budgets are
  monthly envelopes with carry-over; goals earmark account money; rules are ordered
  condition/action programs with dry-run.
- **Evidence layer**: a Statement Vault stores bank/broker statements by SHA-256, detects
  period/account metadata, keeps a review queue, and reports month coverage and a report-only
  ledger reconciliation. Agents may upload and inspect metadata but never receive bytes.
- **Agent layer**: one tool registry feeds both the in-app assistant and the external MCP
  endpoint; writes are paired with preview/dry-run tools; provenance is a citation grammar
  appended to the written fact, not model prose.

## 2. Architecture and data model

| Layer | Sure | Consequence for a port |
|---|---|---|
| Tenancy | `Family` (household) with users, account sharing, roles | LaVega's `entity` is a different axis (BV vs private). Do not port scoping; define "accounts that count". |
| Ledger | `Account` + `Entry` (`entryable_type` = Transaction/Trade/Valuation) | The concept LaVega most needs. LaVega's flat `Tx` has no valuation or trade envelope. |
| Money | Hand-rolled `Money` over `BigDecimal(19,4)`, strict currency mismatch in dev/test | LaVega uses floats in the vault. New modules should use integer cents and convert at the boundary. |
| Sign | **Outflow positive, inflow negative** | **Opposite of LaVega** (`amount` negative = outflow). Flip once. |
| Balances | Daily `Balance` rows, anchors, forward/reverse calculators, holdings materialization | The strongest candidate for a net-worth series port. |
| Time | `Date.current`, family timezone, custom month start day | Ports take explicit `asOf` (LaVega core is clock-free). |
| Sync | `Sync` records with hierarchy, errors, partial states; Sidekiq jobs | Concept only; LaVega has no server-side reader for personal data. |
| FX | `ExchangeRate` table + nearest-rate cache; missing rate = unknown, not 1:1 | Aligns with LaVega's "unknown is not zero" principle. |
| Providers | Runtime registry + concept interfaces + per-provider adapters | Concept aligns with LaVega's adapter seams; connectors themselves are US/EU aggregators LaVega rejects. |
| AI/MCP | Assistant function classes == MCP tools; Doorkeeper OAuth or env token | Strong contract to copy; auth model must be stricter in LaVega. |

Critical invariant differences to encode in the plan:

1. **Direction.** Normalize to an explicit `direction: "in" | "out"` or to LaVega's existing
   negative-outflow convention inside each new module. Never copy a formula that reads
   `amount < 0` without flipping.
2. **Unknown vs zero.** Sure returns `nil` for missing FX/basis/quantity in the paths that
   matter (cost basis, realised gains, reconciliation). Keep that. LaVega's product
   principle 1 requires it.
3. **Evidence.** Internal transfers, investment contributions and credit-card payments are
   *funds movements*, not spending. LaVega already excludes "Eigen overboeking" heuristically;
   Sure proves the general model.

## 3. Feature inventory against LaVega

Full matrix with evidence is in [`sure/03-lavega-state.md` §6](./sure/03-lavega-state.md).
Condensed:

| Sure capability | LaVega today | Read |
|---|---|---|
| Transfers with confirm/reject and fee legs | Heuristic categorisation + cross-entity pair detection only; no persisted pair, no UI | **Gap, high value** |
| Bills: series, occurrences, mark-paid, payment matching, paycheck plan | Recurring-stream detection + forecast + planned `ScheduledFlow`s; no occurrence plan, no payment matching | **Gap, highest strategic value** |
| Rules: conditions, actions, groups, ordering, dry-run, run history | One substring → one category, first match wins | **Gap, medium-high** |
| Monthly budgets with envelope carry and rollover | Category limits + spending comparison only | **Gap, medium** |
| Goals with linked accounts and earmarks | Substantial personal/investing goal model, different shape | Partial; adopt earmark/months-of-expenses concepts |
| Balance sheet, income statement, spending-vs-normal, net worth | Sum of balances walked backwards; no assets/liabilities, no statements | **Gap, medium-high** |
| Statement/receipt/document vault | Nothing; parsed rows only | **Gap, medium** |
| Import sessions, column mapping, PDF/CSV/XLSX bootstrapping | Per-bank file parsers; no generic import wizard, no retained source | Gap, medium |
| Sure/Actual/Monarch export import | No | Not scheduled: no historical data to migrate. Kept in the research notes as a format reference only |
| Merchant registry, tags, splits, pending/excluded states | No merchant/tag model, no transaction splits, no pending state | Gap, medium |
| Investments: holdings/trades/valuations, cost basis, providers | LaVega is **ahead** on TWR/XIRR/risk/benchmarks/sectors; behind on security master, lot/basis provenance, tax-treatment, realised-gain/income report, tax-lot export | Mixed |
| AI assistant + MCP tool contract | Investing agents exist with tools/memory; no shared registry, no MCP, no provenance grammar | **Gap, high leverage** |
| Family/household sharing | None; `entity` only | Defer (needs an ADR: whose key seals whose data) |
| Dutch specifics (belasting, toeslagen, card catalogue, invoices) | LaVega is **better/unique** | Keep; Sure has nothing here |

## 4. Reuse map, ranked

Legend: **PORT** = reimplement the algorithm/logic in TypeScript/Effect, using the Ruby as
the spec and its tests as behaviour fixtures. **CONCEPT** = take the design/contract and
write new code. **SKIP** = do not take. Effort: S ≤ 1 day, M 2–5 days, L 1–2 weeks
(one focused agent, as used in `plans/README.md`).

### 4.1 Personal finance (the bulk of the value)

| # | Sure asset | LOC (Ruby) | Decision | Effort | LaVega target |
|---|---|---|---|---|---|
| 1 | Transfer model: pair matching, FX tolerance, statuses, rejection memory, fee legs, kind derivation | ~1,390 | **PORT** | M | new `packages/core/src/transfers.ts` + `TransferPair[]` vault field + match panel |
| 2 | Bills: schedule engine, occurrence generation/regeneration, 90-day horizon, weekend/end modes, idempotent identity | ~1,700 (series model + schedule + occurrences) | **PORT first** | M | new `packages/core/src/bills/schedule.ts`, `occurrences.ts`; bills vault section |
| 3 | Bill matching + allocation: confidence scoring, tiers, ambiguity margin, partial payments, learning, rejections | ~1,300 | **PORT second** | L | `bills/match.ts`, `bills/allocate.ts`; transactions UI matching |
| 4 | Bill detection: amount clustering, circular expected-day median, claim-or-create, classifier keywords | ~750 | **ADAPT** existing `forecast.ts`/`subscriptions.ts` primitives; do not run a second detector | M | `bills/detect.ts` |
| 5 | Paycheck planner: paydays from declared income, period slices, reserved vs due, shortfall vs cash on hand | ~312 | **PORT** | M | `bills/paycheck.ts`; Betaalschema view |
| 6 | Rules engine: conditions/actions, ordered groups, claim sets, stop-processing, dry-run, lock semantics | ~3,800 | **PORT in phases** (evaluator first) | L | `packages/core/src/rules/*`; extend `Rule` additively |
| 7 | Budgets: envelope math, parent/child inheritance, signed carry rollover, initialized-months chain, bills-reserved | ~1,550 | **PORT math** | M | `packages/core/src/budget.ts`; plan section |
| 8 | Balance materialization: anchors, forward/reverse daily balance, cash/non-cash split, flows factor | ~1,450 | **PORT** | M | `packages/core/src/balanceSeries.ts`; net-worth line |
| 9 | Income statement/reporting: classification, category netting, medians, spending-vs-normal, savings rate | ~2,540 | **PORT subset** | M | `packages/core/src/reports.ts` |
| 10 | Insights generators: spending anomaly, cashflow warning, subscription audit, savings-rate change, idle cash | ~810 | **PORT formulas** | S–M | extend `alerts.ts` |
| 11 | Label normalizer: bank descriptor → merchant, rail/date/noise stripping, NL/DE/EN packs | ~730 | **PORT trimmed** | M | `packages/core/src/labels.ts` |
| 12 | CSV import framework: column mapping, date/number detection, sign conventions, preflight, dry run | ~1,500 subset | **CONCEPT + PORT** | M | `packages/core/src/csvImport.ts`; import wizard |
| 13 | Statement Vault: SHA-256 identity, period detection, deterministic account matching, review queue, month coverage, report-only reconciliation | ~3,178 | **CONCEPT** (encrypted client-side, not Active Storage) | M–L | `packages/core/src/statements/*` + encrypted document store |
| 14 | Family/multi-entity, sharing, roles | large | **SKIP / DEFER** | — | needs a key/ownership ADR |
| 15 | Loans amortization/projection | ~2,010 | **SKIP v1** | — | only when liabilities exist |

### 4.2 Investing

| # | Sure asset | Decision | Effort | LaVega target |
|---|---|---|---|---|
| 16 | `Holding::LotBook` moving-average basis: acquisition fee in basis, full-liquidation reset, unknown-cost transfer spans, exact split restatement | **PORT** | S | extend `investing/positions.ts` or new `investing/costBasis.ts` |
| 17 | Basis provenance + priority (manual > calculated > provider) + locks + provider carry-forward | **CONCEPT** | M | broker snapshot schema + positions builder |
| 18 | Forward holding materialization with gap-fill and split-before-trade ordering | **PORT** | M | quantity/series builder |
| 19 | Reverse materialization from a provider snapshot (only if LaVega persists daily history) | **CONDITIONAL** | L | new `holdingHistory.ts` if needed |
| 20 | Realised-gain-at-disposal with exact-date FX and fee on proceeds | **PORT** (small delta) | S | `positions.ts`; add realised-gain report |
| 21 | Flow classifier (external inflow/outflow, income, fee, internal) with transfer-scope rule | **CONCEPT** | S/M | external cash flows for TWR |
| 22 | Security master identity by ticker+MIC, provider affinity, price provisional flags, listing clamp | **CONCEPT** (LaVega is ISIN-first) | M | `investing/securities.ts`, price orchestrator |
| 23 | Tax-treatment taxonomy (taxable/tax-deferred/tax-exempt) and gains grouped by treatment | **CONCEPT (data)** | S–M | account metadata + report |
| 24 | Allocation ladder: cash bucket, unclassified-as-real-bucket, parent-scoped drill-down, denominator floor | **CONCEPT** | M | `investing/allocation.ts` |
| 25 | Activity labels (Buy/Sell/Dividend/Interest/Fee/Transfer/Sweep/Reinvestment) + income-as-transaction handling | **CONCEPT** | S | broker normalisation |
| 26 | XIRR multi-root detection (`ambiguous?`) and scale-invariant tolerance | **COMPARE** | S | `benchmarks.ts#solveXirr`; LaVega is otherwise ahead |
| 27 | SnapTrade/aggregator breadth, 12 connectors | **SKIP** | — | conflicts with local-first credential custody |
| 28 | TWR / benchmark / risk / volatility / drawdown | **SKIP** | — | LaVega is stronger; do not regress |

### 4.3 Agent/platform and interoperability

| # | Sure asset | Decision | Effort | LaVega target |
|---|---|---|---|---|
| 29 | Shared tool registry: one set of typed tool definitions feeding in-app chat and `/mcp`, filtered once per caller | **PORT** | S–M | `packages/core/src/agentTools.ts` + `apps/server/src/mcp.ts` |
| 30 | MCP transport: JSON-RPC `initialize`/`tools/list`/`tools/call`, protocol negotiation, session id, `202` for notifications, error shape | **PORT** | M | `apps/server` (investing first; personal blocked by ADR 0009) |
| 31 | Tool contract patterns: docs in schema, read/write pairs, `preview_*` + token + TTL, `dry_run`, error-as-data with hint, no internal SQL across the boundary | **PORT** | S | tool dispatcher wrapper |
| 32 | Provenance citation grammar (`grade: A/B/C`, `estimated:`) and field-level `{source, grade, date, documentId}` | **PORT** | S | `packages/core/src/provenance.ts`; valuation/invoice writes |
| 33 | Import/export interop: Sure ZIP (`version.txt`, CSVs, `all.ndjson`), record vocabulary, rules exported by name + `value_ref` | **REFERENCE ONLY** (no migration scheduled) | — | research notes; no code |
| 34 | Import readback verification: expected vs actual counts, mismatch list, revert | **PORT concept** | S | importer completion report |
| 35 | Tool-loop hardening: 8-round cap, forced text on last round, tool-pair-safe trimming, partial turn → failed | **PORT** | S | investing chat + future personal chat |
| 36 | Per-operation AI usage ledger incl. failed calls, cache tokens, capability probes | **ADOPT** | S | extend `apps/server/src/agent/budget.ts`/`pricing.ts` |
| 37 | Statement Vault agent tools (metadata, coverage, `record_valuation` with citation) | **CONCEPT** | M | only after local document store exists |
| 38 | Doorkeeper OAuth, Sidekiq capsules, Turbo streaming, Active Storage, Rails admin, hosted billing | **SKIP** | — | wrong runtime |

**Total realistic port volume**: ~8,000–11,000 lines of Ruby are worth reading as a spec;
expect ~7,000–11,000 lines of new TypeScript plus storage/UI wiring. This is a multi-phase
program, not one PR.

## 5. Code quality

Strengths, verified by reading:

- **Test discipline.** Test LOC exceeds application LOC. Tests are behavioural, fixtures are
  realistic, and edge cases that matter (FX tolerance, ambiguous matches, month-end clamping,
  split rounding) have named tests.
- **Intent comments.** The comments explain *why* and which failure mode the code prevents:
  e.g. why a pending entry is never auto-linked, why average cost cannot include a
  transfer-in, why a day-31 bill matches Feb 28, why the system prompt is byte-stable for
  provider caching. This is the best part of the codebase to use as a port specification.
- **Invariants twice.** DB check constraints plus model validations for money and enum rules.
- **Deterministic matching.** Transfer and bill matching are scored, tiered, ambiguity-guarded,
  and store the signals so the user can see why. No ML.
- **No invented numbers.** Missing FX, unknown basis, unproven cash history, unavailable
  reconciliation — all explicit states.

Weaknesses and caveats:

- **The clone is a moving development tree, not a release.** At this commit the cost-basis
  implementation was just replaced; XIRR has no caller; Security::Split has no production
  writer; asset-class columns have no writer; the portfolio hub is preview-gated. Treat the
  code as a design document and pin the commit.
- **Business logic lives in PostgreSQL.** Transfer candidate search, reporting aggregates and
  basis batch queries are SQL. LaVega's pure-array core must re-express them, and matching is
  O(n²) inside a date window — measure before putting it on a UI read path.
- **Rails coupling.** Advisory locks, callbacks, `Current.*`, Active Storage, Sidekiq,
  family-scoped defaults. None of that ports; re-derive the intent.
- **Date/time and scope.** `Date.current`, family timezone, custom month start, account
  sharing scopes thread through reports. LaVega must pass `asOf` and define one account scope.
- **AI governance is weaker than its plumbing.** MCP is write-capable by default behind one
  coarse `read_write` scope, has no per-tool scope, no spend cap (cost is recorded, not
  enforced), unbounded tool output, and provenance stored as prose in notes. LaVega should
  do better, not copy these.
- **Fork-specific features are younger than the Maybe core.** The Bills subsystem and
  Statement Vault are high quality but recent; verify against a tagged release before
  depending on behaviour that looks half-landed.

Trust ranking for porting: **Bills > Transfers > Budgets > Balance/reporting > Rules >
Insights > Labels > Statement Vault > Investing materializers > Assistant internals.**

## 6. Licence and attribution

- Sure is **AGPL-3.0**; LaVega is **AGPL-3.0**. Copying/deriving is licence-compatible.
- AGPL requires derivative files to carry prominent notices of the change and date, and the
  combined work to stay AGPL. A distributed LaVega must keep its source offer.
- Sure is itself a fork of Maybe. Its README requires downstream users to keep the original
  AGPLv3 licence and to state clearly that the work is **not affiliated with or endorsed by**
  Maybe Finance Inc. "Maybe" is a trademark; do not use it, or "Sure", as a product name or
  logo.
- LaVega's current vendor policy (`docs/investing/STACK.md` §Vendored source) only blesses
  MIT verbatim vendor drops. This plan therefore recommends **independent reimplementation
  with attribution**, not verbatim source copies:
  - header on each ported module: `Port of Sure (we-promise/sure) commit 562fe09; AGPL-3.0; rewritten for LaVega`;
  - a `NOTICE` entry naming the Sure project, commit, licence and scope of reuse;
  - fixture files adapted from Sure's tests get the same note;
  - keep a short provenance table in the plan/phase docs.
  This is engineering guidance, not legal advice; a lawyer should confirm before a commercial
  distribution.

## 7. What not to take

1. Rails, ActiveRecord, Sidekiq, Hotwire/Turbo, Active Storage, Doorkeeper, Postgres-specific SQL.
2. Family/household sharing and role model (needs a key-ownership ADR first).
3. Plaid/SimpleFIN/SnapTrade/CoinStats-style aggregator breadth — conflicts with local-first
   credential custody and adds third-party data flows.
4. Bank-account balance rows, sync jobs and provider import adapters — LaVega has its own seams.
5. Sure's investment return stack: no TWR, no benchmark, no risk metrics; LaVega is ahead.
   Never import `PeriodReturnTrend` semantics as "portfolio return".
6. Hosted billing, trial cleanup, archived-export token flow, admin/impersonation, demo generator.
7. Any write-capable agent surface without per-tool scopes, spend caps and human approval.
8. Dutch tax/catalogue logic — Sure has none; LaVega keeps its own.

## 8. Historical data: none

Owner confirmed on 2026-11-10 that the old self-hosted Maybe/Sure instance is gone and no
export was kept. Consequences:

- no migration importer is scheduled, and no phase depends on historical data;
- the Sure export format is documented in [`sure/02-platform-ai.md`](./sure/02-platform-ai.md) §4
  as a reference only. Do not build it unless the owner later supplies an export and asks for
  it as a separate opt-in issue;
- generic import (CSV/Excel with mapping, preview and revert) still ships because new bank and
  broker files need it. It stays client-side in the browser Import view and must not be
  presented as a migration path.

## 9. Risks and unknowns

| Risk | Severity | Mitigation |
|---|---|---|
| Sign-convention inversion silently corrupts totals | High | One normalization boundary; direction property; property tests; reconcile against real vault data |
| SQL logic re-expressed in JS changes results | High | Port Sure's behavioural tests as fixtures; golden tests on synthetic vault data |
| Rules regex dialect / catastrophic backtracking | Medium | Document dialect; cap pattern length; linear-time engine or timeout; no user regex on main thread |
| FX and period scope differences | High | Explicit `asOf`, one account-scope predicate, one missing-rate policy per surface |
| Encrypted personal vault blocks server-side features | High | Keep deterministic features client-side; invest in investing-side server features. ADR 0009's real invariant: the key is sealed and no server code decrypts; the server can technically decrypt, so a policy change needs a new ADR. |
| No server scheduler for personal data | Medium | Lazy materialization on vault unlock; cron only for investing |
| Duplicating existing detection (forecast/subscriptions) | Medium | Port the management model, not a second detector |
| Sure fork drift | Medium | Pin commit; re-verify at each phase start; prefer algorithms over current behaviour |
| Effort underestimate | Medium | Phases are independently shippable; each ends with acceptance evidence |
| AGPL/trademark compliance | Low–Medium | Attribution headers with change date, NOTICE in Phase 0, independent-reimplementation policy, no Sure/Maybe marks |

Not verified: no Rails runtime, no test execution, no commercial legal review. These are
follow-ups, not facts.

## 10. Recommendation

Adopt Sure as a **design and algorithm source**, not as a dependency. Run the program in six
workstreams, ordered by value/risk:

1. Ledger truth: transfers + rules depth + labels/states/insights.
2. Bills and budgets: the commitment model the forecast is missing.
3. Wealth view and evidence: valuations/assets/liabilities, balance series, reports,
   encrypted statement vault, generic import.
4. Investing depth: basis provenance/lots, realised and income reporting, tax treatment,
   security master, allocation cash buckets — not Sure's return stack.
5. Agent platform: shared tool registry, read-first MCP for investing, provenance grammar,
   tool-loop hardening, spend governance.
6. Interop/hardening: LaVega export, attribution, eval fixtures.

Exact tasks, target files, acceptance criteria, sequencing and the decisions needed from the
owner are in the adoption plan:
[`docs/superpowers/specs/2026-11-10-sure-adoption-plan.md`](../superpowers/specs/2026-11-10-sure-adoption-plan.md).
