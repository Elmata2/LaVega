# Sure adoption plan: what LaVega implements, in what order, and how

Date: 2026-11-10. Status: **approved 2026-11-10**; Phase 0 may start. Base: current
worktree (`master` + investing plans 001–005 merged). Owner: Alexander (personal) + cofounder
(investing).

Inputs:

- Consolidated teardown: [`docs/research/2026-11-10-sure-teardown.md`](../../research/2026-11-10-sure-teardown.md)
- Raw notes: [`docs/research/sure/`](../../research/sure/README.md) — core domain, investing,
  agent/platform, LaVega current state.
- Sure source: `we-promise/sure` commit `562fe09` (2026-11-10), AGPL-3.0, local clone only.
- LaVega constraints: [`docs/CONTEXT.md`](../../CONTEXT.md), `ADR 0004`, `ADR 0007`, `ADR 0008`,
  `ADR 0009`, [`docs/investing/STACK.md`](../../investing/STACK.md).

## 0. Decision in one paragraph

Adopt Sure as a **design and algorithm source**, not as a runtime dependency. Reimplement
its strongest deterministic pieces in TypeScript/Effect, in six workstreams ordered by
value and risk: (1) ledger truth — transfers, rules depth, labels, transaction states,
insights; (2) bills and budgets — the commitment model the forecast is missing; (3) wealth
view and evidence — valuations, assets/liabilities, balance series, reports, encrypted
statement vault and a generic import session; (4) investing depth —
cost-basis provenance, realised/income reporting, security master, allocation; (5) agent
platform — one tool registry, read-first MCP, provenance grammar, spend governance;
(6) interop and hardening. Do not port Rails, Sure's provider breadth, its family/sharing
model, or its investment return stack (LaVega is ahead there). Estimated volume: ~7,000–11,000
new TypeScript lines (personal ports ~5,000–7,000; investing and agent platform ~2,000–4,000)
plus storage/UI. Core program ~69–188 focused agent-days: ~11–30 weeks with two parallel
lanes, ~14–38 weeks with one. Extensions add 18–45 agent-days. These are ranges, not
commitments; re-estimate at each phase gate.

**Reuse intent (owner, 2026-11-10).** The goal is Sure's **feature set, workflow understanding
and problem-solving**, implemented for LaVega's use case — not a line-by-line Ruby
translation. Where LaVega's privacy model, Dutch tax/catalogue domain, data model or UI
requires, the port must diverge and be rebuilt in TypeScript/Effect. The Ruby is a
specification and a source of edge cases; it is not a scaffold to preserve.

**Why not a sidecar.** Sure is Postgres + Redis + Sidekiq + Rails with family-scoped data
and a US/UK-shaped provider stack. Running it next to LaVega creates a second source of
truth, breaks the encrypted-vault promise on the personal side, and adds no Dutch tax,
card-catalogue or invoice logic. A local reference deployment is not part of the plan.

## 1. What we are solving

LaVega is strong where Sure is weak (deterministic forecast, Dutch tax/catalogue, investing
TWR/XIRR/risk/sectors, local-first privacy, typed judgments). It is weak exactly where Sure
is strong:

| LaVega weakness | Empathic cost | Sure answer | Workstream |
|---|---|---|---|
| Internal transfers are heuristics, not records | Totals and spend are wrong whenever an own-account move is misfiled; no confirm/reject | First-class transfer pair with matching, status, fee legs, kind | WS1 |
| Bills are detected, not managed | Forecast cannot say "this occurrence, this date, unpaid"; no mark-paid; stale series never retire | Recurring series → occurrences → payment matching → price changes | WS2 |
| Rules are one substring → one category | Can't express amount/account/merchant conditions, rename, exclude, dry-run, run history | Ordered condition/action engine with claims and dry-run | WS1 |
| No period budget object | Category limits cannot carry over; no "available to allocate" | Monthly envelope with signed carry and inheritance | WS2 |
| No balance sheet, income statement, net worth with liabilities | The multi-BV owner cannot see assets minus debts from one statement | Account kinds + valuations + daily balance series + statements | WS3 |
| No document/statement vault | Nothing proves where a parsed number came from; no re-parse, no audit | SHA-256 vault, period detection, account matching, coverage | WS3 |
| No generic import wizard | Every new bank format is code; no preview, no revert | Column mapping, preflight, dry-run, retained source | WS3 |
| No realised-gain/income report; no tax-treatment or basis provenance | Investor cannot see what was actually earned or prove cost basis | Basis provenance/locks, realised gains at disposal, income by treatment | WS4 |
| No MCP/agent access; one registry missing | The owner's own agents cannot query the product; tools drift between surfaces | One typed registry, `/mcp`, read-first scopes, provenance | WS5 |
| Interop is one-way | No portable export; vendor lock risk | Versioned export + Sure-vocabulary import/export | WS6 |

## 2. Rules of engagement

These apply to every phase. Violating one of them is a review failure even if the feature
works.

### 2.1 Direction and money (hard)

- Sure stores **outflow positive**. LaVega stores **negative = outflow** (`docs/CONTEXT.md`).
- New ported modules take an explicit `direction: "in" | "out"` internally, or convert once
  at the boundary. No ported formula may read a raw `amount` sign without a comment that
  names the convention. Unit-test direction in every module that crosses the boundary.
- New money math uses **integer cents**. `Tx.amount` stays a float for compatibility
  (changing it changes `tx.id`); convert at input and output. Never compare floats for
  equality; never introduce `BigDecimal` into core.
- Missing FX, missing price, missing basis and unknown coverage are `null`/typed `unknown`,
  never `0` and never `1:1`. This is product principle 1.

### 2.2 Storage

- Personal data stays in the encrypted vault (`ADR 0009`). New collections are **optional
  fields** on `VaultData` (`packages/adapters/src/storage/encryptedStorage.ts`) plus
  `get*/put*` methods, replace-all like `rules`. Legacy vaults decrypt unchanged.
- The `ADR 0009` invariant is precise: the vault key is sealed with `LAVEGA_ENCRYPTION_KEY`,
  and **no server code decrypts the vault**. The server can technically decrypt; the promise
  is policy plus absent code, not mathematics. Any feature that needs a server-side reader
  needs a new ADR, and the policy text must say so. Do not write "the server cannot read it".
- Account merges re-key `tx.id` (`packages/core/src/accounts.ts`). Transfer pairs, bill
  matches, document links and any record that stores a tx id must be reconciled on merge and
  delete, or dropped with an explicit report. Re-keying alone silently orphans them.
- Do not change `tx.id` or its hash inputs (`packages/core/src/hash.ts`). Identity of new
  records is separate: `transfer` keyed by the two tx ids; bill/occurrence by content-hash;
  document by SHA-256.
- Investing tables: new numbered migration, rerunnable, checksummed in the ledger, RLS +
  `lavega_runtime` grants (`db/migrations/`, `db/runtime-role.sql`). New tables only when the
  data is server-readable by design.
- No server-side reader for personal ledger data. Any feature that needs one stops and
  records an ADR first.

### 2.3 Code shape

- Effect 4 for all new logic (`ADR 0008`): `Schema` for models and untrusted input,
  `Schema.TaggedError`, `Context.Service` + static layer where stateful, `Effect.fn`.
  Core stays clock-free: take `asOf: string`.
- Pure core, no I/O. Storage/broker/network work lives in `packages/adapters`; routes and
  tenancy in the servers; JSX stays plain React.
- Ported algorithms take plain data and return data + typed gaps. They never import storage.
- One contract, one test owner (`docs/CONTEXT.md` §Testing discipline). Ported core logic is
  tested in `packages/core`; vault round-trips in `packages/adapters`; routes in servers.
  **Do not** re-test core from `apps/*`.
- Ports use `@effect/vitest` (`it.effect`) — they will be the first modules to do so and set
  the pattern.

### 2.4 Attribution and licence

- Sure is AGPL-3.0; LaVega is AGPL-3.0. Derivation is compatible if notices and changes
  travel.
- Preferred shape: **independent reimplementation from the Ruby algorithm and its tests**, not
  verbatim source copy. Say "independent reimplementation", not "clean-room": the method
  reads the Ruby and its tests, so the clean-room claim would be false. Each ported module
  gets a header:
  `Ported from Sure (we-promise/sure) commit 562fe09 — AGPL-3.0 — independently reimplemented for LaVega; changed 2026-11-10`.
- Add the `NOTICE` entry **in Phase 0**, before any ported module ships: project name,
  upstream URL, commit, AGPL-3.0, scope of reuse, statement of non-affiliation, and the
  AGPL source-offer pointer (the LaVega repo). Keep a provenance table in this plan
  (Appendix A). Keep Sure's original notices where fixtures are adapted.
- If text from the MIT-licensed `docs/llm-guides/wealth-blueprint.md` is adapted (the
  agent-harness guidance in WS5), attribute it separately: "Blueprint text © 2026
  diegomarino, MIT", with the MIT notice reproduced. Do not fold it into the AGPL notice.
- Never use "Maybe" or "Sure" as a LaVega product name or logo. State non-affiliation in
  `NOTICE`.
- LaVega's current vendor policy only blesses MIT verbatim vendor drops; this program uses
  attribution + reimplementation instead, and does not widen that policy.
- The LaVega distribution keeps its AGPL source offer. `NOTICE` points at the repository and
  the commit, so a recipient can obtain the corresponding source.
- Reference clone stays outside the repo. Add `scripts/fetch-sure-reference.sh` (pin commit,
  shallow clone into `.lavega/reference/sure` or `/tmp`) and never import from it.

### 2.5 Reference fidelity

- Pin commit `562fe09`. The tree is a moving development branch (cost-basis refactor,
  unwired XIRR, unwritten classification columns). Re-verify behaviour at the start of each
  phase against that commit; do not follow `main` mid-phase.
- Port Sure's behavioural tests as fixtures where they encode edge cases (FX tolerance,
  ambiguity, month-end clamp, split rounding, partial payments). Do not port Rails specs
  that only exercise ActiveRecord.

## 3. Workstreams

Each workstream lists: Sure source, target, tasks, storage/UI, acceptance evidence, effort,
dependencies and risks. Effort uses the repo convention: **S** ≤ 1 day, **M** 2–5 days,
**L** 5–10 days, measured in focused agent-days (implementation + tests, excluding owner
review and rework). Workstream totals are the arithmetic sum of their task ranges; phase
totals add the workstreams and the shared tasks. Treat a range, not its lower bound, as the
planning number.

### WS1 — Ledger truth (personal)

**Goal.** Every euro is classified correctly: transfers are records, rules are explainable,
labels are normalized, and alerts are derived from the same primitives.

**Sure sources.** `app/models/family/auto_transfer_matchable.rb`,
`app/models/transfer.rb`, `app/models/rejected_transfer.rb`, `app/models/transaction/transferable.rb`
(~1,390 LOC); `app/models/rule.rb` + `app/models/rule/**` (~3,800 LOC);
`app/models/transaction/label_normalizer*` (~730 LOC);
`app/models/insight/generators/*` (~810 LOC).

**Tasks.**

| ID | Task | Target | Effort |
|---|---|---|---|
| WS1.1 | Transfer pair model + candidate matcher (date window, amount, FX tolerance, ranking, ambiguity guard), statuses `suggested/confirmed/rejected`, rejection memory, fee legs, kind derivation (loan payment / CC payment / investment contribution / funds movement) | `packages/core/src/transfers.ts`; `TransferPair` type; `VaultData.transfers?` + storage methods | M |
| WS1.2 | Transfer UI: row badge, "possible match" panel, confirm/reject; feed confirmed pairs into spend exclusion and forecast so totals never change silently | `apps/web/src/views/Transacties.tsx`, a new panel; `views.ts` exclusion path | M |
| WS1.3 | Rules evaluator v2 (engine only): typed conditions (name contains/equals, amount range, account, category, type/direction, merchant, date), actions (set category/name/merchant, add tag, exclude, mark transfer; no email/split initially), ordered groups, first-match claims, stop-processing, effective date, dry-run returning the matched sample; per-attribute locks so a rule never overwrites a user-edited field (`userModified` semantics from Sure's `Enrichable`) | `packages/core/src/rules/*`; extend `Rule` additively; legacy `{match, category}` still honoured | M |
| WS1.4 | Rules editor: conditions/actions UI, ordering, dry-run preview; migrate existing rules to the legacy-compatible form on read | `apps/web/src/views/Regels.tsx` | M |
| WS1.5 | Label normalizer + minimal merchant registry: descriptor → canonical merchant key (rail markers, dates, card numbers, noise), NL/DE/EN packs; registry stores canonical name + aliases so rules, subscriptions, forecast and reports share one key | `packages/core/src/labels.ts`; `VaultData.merchants?` | M |
| WS1.6 | Transaction states: optional `excluded`, `pending`, `notes`, `tags` on `Tx` (not hashed), plus one migration pass over existing vaults with defaults | `model.ts`; `apps/web` state load/save | S |
| WS1.7 | Insights formulas into `alerts.ts` — only the ones LaVega lacks: spending anomaly vs trailing median, idle cash, savings-rate change; the subscription price increase already exists (`subscriptions.ts`) and the cash-flow warning maps to the existing forecast alert. Each new insight carries typed facts for copy and "how calculated" | `packages/core/src/alerts.ts`, `copy/` | S |

**Acceptance evidence.**

- On the owner's real vault: every same-account-pair candidate within 4 days is either
  auto-confirmed (exact two-leg proof) or suggested; at least 90% of obvious internal
  transfers resolve without manual category editing. Monthly spend excludes all confirmed
  transfers; regression fixtures cover BV↔private crossings and must not be swallowed
  (`crossScope.ts` owns that boundary).
- Rules: dry-run shows the same winner as execution; legacy rules produce byte-identical
  categorization on the existing test corpus; run log records rule id and matched fields.
- Alerts: each new insight has a threshold table and a test at the boundary; an unknown input
  suppresses the alert instead of guessing.
- Merge/delete: merging two accounts re-keys transactions and reconciles or explicitly drops
  every transfer pair, bill match and document link that pointed at them; the report lists
  what was dropped. Fixture: merge two accounts, assert no orphan references.
- Locks: a rule never overwrites a field the owner edited by hand, and the UI can show which
  field is locked and why.
- Core tests only in `packages/core`; one UI interaction test per view.

**Effort.** WS1.1 M + WS1.2 M + WS1.3 M + WS1.4 M + WS1.5 M + WS1.6 S + WS1.7 S =
**12–29 agent-days** (~2.5–6 weeks). WS1.3/WS1.4 can run while WS1.1/WS1.2 is under review.
**Depends on** Phase 0.

**Risks.** Transfer matcher O(n²) in a date window (index by date + candidate set); rules
regex DoS (document dialect, length cap, timeout or linear-time engine); double-counting with
`crossScope.ts` (make one predicate: confirmed transfer pair is authoritative); account merge
orphans references (see §2.2); UI cost of two match panels (co-locate on Transacties).

**As built (WS1.1/WS1.2, [#282](https://github.com/Elmata2/LaVega/issues/282), 2026-11-10).**
The two tasks below landed in one slice. Divergences from the plan text, each deliberate:

- **Suggestions are derived, not stored.** `suggestTransfers()` runs over the current ledger on
  read; only decisions (`confirmed`, `rejected`) persist in `VaultData.transfers`. A stored
  pending row would go stale on the next import, so Sure's pending table becomes a pure
  function. Rejection memory is a stored `rejected` pair, exactly Sure's pair-keyed
  `rejected_transfers` join: it suppresses that combination only, and its legs stay matchable
  with other rows.
- **Auto-confirm is only the unambiguous exact two-leg proof:** same currency, equal to the
  cent, two different accounts, `|date diff| <= 4` days, and no competing candidate for either
  leg. FX pairs and ambiguous exact pairs are suggestions the owner decides. (Sure itself
  inserts even exact matches as pending; the plan's acceptance evidence asks for the stronger
  auto-confirm.)
- **One authoritative predicate on read:** `applyTransferDecisions()` projects the two legs of
  a confirmed pair into `Eigen overboeking`, which every existing spend surface already
  excludes (`MOVED_CATEGORIES`, forecast incidentals, `cleanTxs`, `categoryComparison`, plan
  `movedCategories`). Nothing is rewritten in the vault, so rejecting restores what each row
  said before.
- **`crossScopeTransfers` accepts `transfers`** and consumes a confirmed pair as the
  authoritative two-legged crossing before its own heuristic; a BV<->private link is measured,
  never swallowed. The archived Belasting/Grens screen does not pass the list yet; its route
  is archived today, so the wiring belongs with that screen's return, not this slice.
- **Merge safety:** `mergeAccounts` now also returns `txIdRemap` (old id -> new id, or null
  when an overlap was absorbed). `reconcileTransfers()` re-keys or drops pairs and their fee
  legs; Rekeningen prints how many links a merge/delete dropped.
- **Fee legs** exist on the record and survive reconciliation, but nothing creates them in
  this slice: Sure only creates them through the manual creator, and this slice has no manual
  create flow.
- **`loan_payment`** needs an account that reads as a loan. LaVega has no liability account
  kind before WS3.1, so derivation requires explicit account type `Overig` AND a loan-like
  name; everything else that is not credit, investment or savings stays `funds_movement`.
- **Tests are plain vitest, not `@effect/vitest`** (§2.3): the package is not installed and
  Phase 0 did not add it. The first `it.effect` suite is still an open convention.

**As built (WS1.3/WS1.4, [#283](https://github.com/Elmata2/LaVega/issues/283), 2026-11-11).**
The engine and the editor landed in one slice. Divergences from the plan text, each deliberate:

- **One canonical shape at the boundary.** `Rule = LegacyRule | RuleV2`. `upgradeRules` parses
  the stored array once when the vault opens and lowers legacy `{match, category}` to
  `text contains + setCategory + stopProcessing`. The OLD categorize body is embedded verbatim
  as an oracle in `rules/legacy.test.ts` and compared against the new engine over the real
  fixture corpus, so byte-identity is proven, not assumed. Storage keeps the union: a legacy
  row is not rewritten until the owner saves a rule, so a downgraded build still reads it.
- **Array order is the only priority.** There is no `priority` field and no named rule group;
  a second ordering authority drifts, and LaVega has one owner per vault, so a rule group would
  be a sharing scope this plan does not have. The editor shows the stored order and moves rows
  with Up/Down; the old alphabetical display (and its "the top row is not the winner" note) is
  gone because the order is now editable.
- **`effectiveFrom` gates on the transaction date, not on `asOf`.** A rule written today must
  not relabel last year's rows, and the categorization pass has to stay re-runnable. Comparing
  `tx.date` keeps core clock-free (§2.3) and makes the dry run and execution agree by
  construction. The consequence is stated in the editor: "geldt voor transacties vanaf".
- **Claims, not writes.** Attribute claims are first-wins across rules; `stopProcessing` ends
  the walk; `addTag` accumulates. Only the CATEGORY claim is applied to a transaction. Display
  name, merchant, tags, exclude and transfer are evaluated, shown in the dry run, and never
  persisted: `tx.id` hashes counterparty/description (ADR 0011), so renaming a tx through a
  rule would re-key it and orphan transfer pairs. The `Tx` fields and the totals wiring belong
  to WS1.5/WS1.6. The editor and the preview say this in plain words.
- **Locks are per attribute, but only the category can be locked today.** `tx.manual` is the
  only owner-edited attribute on `Tx`; `locksForTx` is the single extension point WS1.6
  widens. A manual row with an EMPTY category keeps its old fall-through to the rules
  (byte compatibility); a manual stored category short-circuits before the engine, as before.
- **Category conditions read the transaction's stored category.** The tier chain returns a
  stored category before the engine, so an `equals` category condition mainly helps ordered
  preview chains, it cannot re-label a row that already holds a category.
- **`run log` is derived, not stored.** `dryRunRules` returns one entry per matched rule with
  the condition fields that held and the attributes it claimed; the same trace is available
  from execution through `categorizeDetailed`. Persisting a duplicate would go stale the way
  the WS1.1 pending rows would have.
- **`changed` in the dry run is measured against the built-in tiers, not the stored category.**
  Categories are derived on read, so every imported row stores `""`; comparing to storage
  reported "131 of 131 changed" in the browser pass. Comparing a rule decision to what the
  built-ins would have said is the number the owner can act on.
- **No regex dialect.** Text conditions are literal normalized comparisons (`matchNorm`, the
  same normalizer the legacy loop used), so the plan's rules-regex-DoS risk (#R4) does not
  exist in this implementation; the only rule-count cost is O(n·r), unchanged from before.

### WS2 — Bills and budgets (personal, the wedge)

**Goal.** LaVega manages commitments, not just detects them: series → occurrences → payment
matching → paycheck plan → budget envelopes → forecast. This is the strongest single
adoption and the direct upgrade to roadmap item 2.

**Sure sources.** `app/models/recurring_transaction.rb` (964), `recurring_transaction/schedule.rb`
(415), `occurrence_generator.rb` (133), `recurring_occurrence.rb` (190), `allocator.rb` (401),
`matcher.rb` (441), `identifier.rb` (612), `classifier.rb` (130), `paycheck_planner.rb` (312),
`price_change_detector.rb` (75), `cleaner.rb` (53), `frequency_preset.rb` (278);
`app/models/budget.rb` (594), `budget_category.rb` (461), `budget/rollover_calculator.rb` (226).

**Tasks.**

| ID | Task | Target | Effort |
|---|---|---|---|
| WS2.1 | Bill model: type (bill/subscription/installment/income/transfer/other), amount strategy (fixed/average/last), currency, cadence, anchor day, end mode, weekend policy, account/category/merchant, status (`suggested/active/paused/inactive/ended`), tags; optional `ScheduledFlow` bridge | `packages/core/src/bills/model.ts`; `VaultData.bills?` | M |
| WS2.2 | Schedule engine: weekly/monthly/yearly, interval, day-of-month incl. last, nth weekday, month of year, clamping, weekend adjust, end conditions, `occurrences_per_year`, 10-year search cap; date math on `asOf` only | `bills/schedule.ts` | M |
| WS2.3 | Occurrence generator: 90-day horizon extended to next occurrence/finite plan, idempotent `(series, originalDueOn)` identity, cycle-start lookback, regeneration on schedule edit without touching paid/closed rows, 6-month history backfill | `bills/occurrences.ts`; storage | M |
| WS2.4 | Payment matcher: hard filters (currency/account/sign/merchant), confidence scoring (merchant/name/amount/date/account), tiers 0.85/0.60, ambiguity margin 0.15, no auto-link for pending, no suggestions for income, rejection memory, repair of replaced entries | `bills/match.ts` | L |
| WS2.5 | Allocation/close rules: partial payments, cent epsilon, price changes, learned tolerance (max 25%), name aliases, mark-paid without transaction, user close never auto-reopens | `bills/allocate.ts` | M |
| WS2.6 | Detection adapter: reuse `forecast.ts`/`subscriptions.ts` primitives; add amount clustering (7.5% running-mean), circular expected-day median, claim-or-create, classifier keyword packs. One detector only — do not fork `detectRecurringStreams` | `bills/detect.ts` | M |
| WS2.7 | Paycheck planner: declared income only, period slicing, due vs reserved, shortfall vs cash on hand, bridge period semantics | `bills/paycheck.ts` | M |
| WS2.8 | Bills UI: calendar/list/upcoming, mark-paid, match suggestion, series edit/pause/end, price-change history; reuse `BetaalschemaBlock` | `apps/web/src/views/*`, blocks | M–L |
| WS2.9 | Budget model + math: period (custom month start optional), lines per category, parent/child inheritance via an explicit category-group map (LaVega categories are flat strings — add the group map first, or descope inheritance), initialized-months chain, signed carry rollover (surplus only), bills-reserved read-only, cash vs allocation separation; migrate `categoryLimits` to the first period's lines | `packages/core/src/budget.ts`; `categoryGroups` in the vault; `plan/preferences.ts` | M–L |
| WS2.10 | Forecast integration: bills → forecast projection adapter; keep `ScheduledFlow`/`forecast.ts` output contract stable; add occurrence dates and commitment confidence to drivers; measure error before/after on own history | `forecast.ts` adapter, `plan/cashflow.ts` | M |

**Acceptance evidence.**

- Cadence matrix: weekly/biweekly/monthly/quarterly/yearly, 31st/30th/29th, last-day,
  end-after-count, end-on-date, weekend skip/before/after, DST-free ISO dates.
- Idempotency: running the generator twice produces no duplicate occurrence; editing a
  schedule does not rewrite paid history.
- Matching: Sure's own edge fixtures ported (ambiguous same-amount twins, partial payments,
  overpayment, pending, cross-currency) pass; on real data, ≥ 95% of confirmed payments land
  on the intended occurrence.
- Forecast: measured absolute error at 30/60/90 days improves or stays equal against the
  baseline captured before this workstream starts; every change is explained by occurrence
  dates, not statistical tuning. No baseline, no acceptance.
- Budget: carry-chain fixture matches Sure's behaviour for surplus months, negative months
  stop at zero, currency change breaks the chain, child ring-fence is not double-counted;
  a category with no group behaves as a top-level line, not as an invented parent.
- UX: one screen answers "what is due, what is paid, what is short before payday".

**Effort.** WS2.1 M + WS2.2 M + WS2.3 M + WS2.4 L + WS2.5 M + WS2.6 M + WS2.7 M +
WS2.8 M–L + WS2.9 M–L + WS2.10 M = **23–60 agent-days** (~5–12 weeks; plan on 6–9).
**Depends on** WS1.1/WS1.5 for matching and labels; WS2.1–WS2.3 are pure date math and can
start in parallel with WS1. Capture the forecast-error baseline before WS2.10 starts.

**Risks.** This is the largest single port; split it into two shippable halves — schedule +
occurrences + upcoming view first, matcher/allocation/paycheck second. Detection duplication
is the main product risk: keep `forecast.ts` as the only detector source and let bills claim
its output. Payment initiation stays out of scope by constraint. No server process decrypts
the personal vault (`ADR 0009`: no server code decrypts), so occurrence materialization must
be lazy: it runs on vault unlock/import and writes one vault save. That is sufficient because
the owner can only see the plan when the app is open; do not add a server cron that would
need the decrypted ledger.

### WS3 — Wealth view and evidence (personal)

**Goal.** One statement of assets and liabilities with a defensible audit trail, and a path
for the owner's old history.

**Sure sources.** `app/models/balance/{base,forward,reverse}_calculator.rb` (~1,450),
`balance/materializer.rb`, `balance_sheet*`, `income_statement*`, `period.rb` (~3,748 total
reports), `account_statement.rb` + `account_statement/*`, `import.rb` and
`import/*_mapping.rb`.

**Tasks.**

| ID | Task | Target | Effort |
|---|---|---|---|
| WS3.1 | Account kinds and valuations: extend the **existing** `Account.type` / `AccountTypeKind` (`packages/core/src/balance.ts`) with asset/liability kinds (depository, credit card, loan, property, vehicle, other asset/liability) and dated absolute valuations; optional opening balance; no amortization engine yet. Update every exhaustive switch (`Rekeningen.tsx`, `KaartenBlock.tsx`, `copy/money.ts`) and migrate stored `type` values | `model.ts` + `balance.ts`; `Valuation`; `VaultData.valuations?`; `Rekeningen` UI | M |
| WS3.2 | Balance series: port **both** Sure calculators — reverse replay from the latest anchor for linked/imported accounts, forward replay for manual accounts, selection by anchor kind; a valuation is a hard reset, never an interpolation; stale/carried valuations stay labelled; cash/non-cash split, flow factors; produce the daily series | `packages/core/src/balanceSeries.ts` | M |
| WS3.3 | Reports: **balance sheet** and **income statement** (assets/liabilities/equity; income/spend by category per period, net savings). Reuse the existing savings-rate/month machinery (`plan/month.ts:50`), spending comparison (`plan/spending.ts:62`) and category medians (`views.ts:377`) instead of re-porting them; add only the missing balance-sheet and income-statement assemblies, with "how calculated" facts | `packages/core/src/reports.ts`; reuse existing plan modules; views | M–L |
| WS3.4 | Encrypted document vault: sealed bytes with the vault key in a **separate IndexedDB object store** (not inside `VaultData`; byte churn must not rewrite the whole vault blob), metadata `{sha256, kind, periodFrom/To, accountKey?, txIds?, mime, source, byteSize}`, duplicate detection by hash, a size cap per file (default 25 MB), and an **extended `.lavega` backup bundle (new format version) that includes the document store**; restore/erase must cover both. If the bundle format is not extended, the feature does not ship — a backup that silently drops documents is worse than no documents. | `packages/adapters` crypto/storage + `apps/web/src/backup.ts`; ADR in Phase 0 | L |
| WS3.5 | Statement metadata pipeline: period detection, institution/account hints, deterministic account matching with confidence tiers and tie refusal, review queue, month coverage statuses, report-only ledger reconciliation (tolerance 0.01), no invented "verified" label | `packages/core/src/statements/*` | M–L |
| WS3.6 | Generic import session: CSV/Excel column mapping, date/number/sign detection, preflight, dry run, revert, retain source document; reuse parser profiles where they fit. Dedupe only within the same source format; **do not claim cross-format dedupe** — CONTEXT documents that the same account via CSV and MT940 double-counts. The wizard warns and defaults to one format per account. | `packages/core/src/csvImport.ts`; Import view | M |

**Acceptance evidence.**

- Net worth: the opening plus daily series reconciles to the sum of account balances on every
  day where a valuation exists; an unknown valuation leaves a gap, not a zero.
- Reports: cross-foot (income − spend = net savings), category totals match the ledger under
  sign normalization, savings rate handles zero income as unknown.
- Documents: same bytes uploaded twice is one document; a `.lavega` backup taken after
  upload restores the bytes on a new browser profile; erase removes metadata **and** bytes;
  a file above the cap is refused with a reason; a statement with no period stays unmatched
  and is visible in the review queue.
- Import: a CSV/Excel file maps, previews, imports and reverts; the same file re-imported is
  detected within the same format; a second format for the same account shows the documented
  double-count warning and is refused by default; revert removes exactly the records the
  import created.
- Tests: core reports/import tests; adapter crypto/store tests; one UI flow.

**Effort.** Core (WS3.1 M + WS3.2 M + WS3.3 M–L) = **6–20 agent-days**. Extension
(WS3.4 L + WS3.5 M–L + WS3.6 M) = **9–25 agent-days**. **Depends on** WS1 (`Tx` states);
WS3.3 reuses the plan period machinery. The core can ship without the document/import
extension.

**Risks.** Browser storage quota for document bytes (measure; store PDFs only, refuse
truncated writes, cap per file); backup format migration (must be tested restore-first);
encryption correctness (reuse `vaultCrypto`); import identity vs `tx.id` (never hash foreign
ids into identity); merge re-key orphaning document/statement links; report scope creep
(two statements + reused comparisons, no more).

### WS4 — Investing depth (investing)

**Goal.** Make the existing investment dashboard defensible for tax and income: basis
provenance, realised gains, dividend/interest reporting, canonical security identity,
cash-aware allocation. Do **not** touch TWR/XIRR/risk/benchmark math.

**Sure sources.** `app/models/holding/lot_book.rb`, `holding/forward_calculator.rb`,
`holding/materializer.rb`, `holding/cost_basis_reconciler.rb`, `holding/gapfillable.rb`,
`trade.rb:159-267`, `investment_statement.rb`, `investment_statement/totals.rb`,
`portfolio/flow_classifier.rb`, `security.rb`, `security/price/importer.rb`,
`investment.rb:9-101`.

**Tasks.**

| ID | Task | Target | Effort |
|---|---|---|---|
| WS4.1 | Cost-basis lot book: moving average, acquisition fee in basis, full-liquidation reset, transfer-in ⇒ whole position unknown, exact split restatement, nil on missing FX; reconcile against current `calculatePositionReturn` | `packages/core/src/investing/costBasis.ts` or extend `positions.ts` | S–M |
| WS4.2 | Basis provenance: source priority (manual > calculated > provider), user lock, provider carry-forward, reconciler; expose "why is basis unknown" to UI | broker snapshot schema + positions builder | M |
| WS4.3 | Realised gains + income report: disposal basis from the snapshot when trades are partial, exact-date FX, fee on proceeds, dividends/interest income, realised/unrealised grouped by tax treatment | `investing/realized.ts`; dashboard/position detail; new report route | M |
| WS4.4 | Tax-treatment taxonomy: taxable / tax-deferred / tax-exempt / tax-advantaged plus EU wrapper labels (ISA, PEA, Pillar 3a, etc.); account metadata, no behaviour beyond grouping. LaVega has no account record — define a wrapper map keyed by `(broker, account)` in the broker snapshot (or a Neon table with RLS), with UI and unknown default | `investing/model.ts` snapshot metadata; store + UI | M |
| WS4.5 | Security master: ISIN-first canonical identity, broker symbol aliases `(ticker, MIC)`, provider affinity ("assigned provider unavailable ⇒ skip, never silently replan"), provisional price flag with refetch window, listing start clamp; **thesis/symbol migration**: move ADR 0007's symbol-keyed theses to the canonical key, preserve conflicting confirmed theses for user review, update ADR 0007 | `investing/securities.ts`, price orchestrator; memory tables; ADR 0007 | M |
| WS4.6 | Allocation ladder: cash bucket placement, unclassified as a real bucket, denominator floor `max(cash+holdings, holdings)`, parent-scoped drill-down | `investing/allocation.ts` | M |
| WS4.7 | Investment contribution classification: transfers into investment/crypto accounts count as contribution, not spending, and reconcile with personal net-worth sharing; internal investment→investment moves are funds movement. Depends on WS1.1 transfer pairs. | `transfers.ts` kind + `personalNetWorth.ts` | S–M |
| WS4.8 | Optional/conditional: persist daily holdings history via forward or reverse materializer when a broker reports only snapshots; only if WS4.3/report needs it | `investing/holdingHistory.ts` | L (conditional) |

**Acceptance evidence.**

- Basis: Sure's lot-book edge cases ported (fee in basis, oversell capped, transfer-in
  unknown, split restatement, missing FX nil) pass against hand-calculated fixtures; current
  positions' basis is unchanged for trade-only brokers (regression gate).
- Realised: every disposal reconciles to broker-reported cash minus fees where the broker
  reports both; missing FX shows unknown, never 1:1.
- Income: dividends/interest group by symbol and period; totals tie to cash flows.
- Identity: the same ISIN from two brokers resolves to one security and one thesis key; a
  symbol change does not split history; a migration fixture proves existing confirmed theses
  survive as one key or are surfaced for review, never silently merged.
- Allocation: cash appears in the ladder; unclassified bucket is labelled; weights sum to
  ≤100% and the denominator rule is documented.
- No change to TWR/XIRR/risk fixtures.

**Effort.** WS4.1 S–M + WS4.2 M + WS4.3 M + WS4.4 M + WS4.5 M + WS4.6 M + WS4.7 S–M =
**11–31 agent-days** (~2–6 weeks); WS4.8 conditional L adds 5–10. **Depends on** Phase 0 and
WS1.1 for WS4.7; otherwise independent of personal work.

**Risks.** Return regression is the big one — add a guard test that dashboard returns are
byte-identical before/after WS4.1 for trade-only fixtures. Snapshot-only brokers may need
WS4.8; treat it as a decision gate, not a default. Tax treatment is metadata only; no tax
filing claims.

### WS5 — Agent platform (both sides)

**Goal.** One tool contract, two surfaces; read-first external access; provenance the model
cannot fake; spend and loop guards.

**Sure sources.** `app/models/assistant/function/*` (55 files, 8,367 LOC),
`app/models/assistant/function_tool_caller.rb`, `responder.rb`, `history_trimmer.rb`,
`app/controllers/mcp_controller.rb`; `docs/llm-guides/wealth-agent-harness.md`,
`wealth-blueprint.md`; `record_valuation.rb` citation grammar.

**Tasks.**

| ID | Task | Target | Effort |
|---|---|---|---|
| WS5.1 | Tool registry: typed definitions `{name, description, schema, scope: read\|write, preview?, handler}`, one build function filtered per caller; descriptions carry data semantics (direction, pagination, unknown rules) | `packages/core/src/agentTools.ts`; `apps/investing-server/src/tools/*` | M |
| WS5.2 | Investing MCP endpoint (fast track, server-readable data only) + minimal tool-registry seed: JSON-RPC `initialize`/`tools/list`/`tools/call`, protocol negotiation, session id, `202` for notifications, JSON-RPC errors. **Mount it in `apps/server`**, not the bare investing server: that server has no auth and defaults to `LOCAL_TENANT_ID`. Extend `apiGuard` to accept a bearer MCP token and resolve token → tenant through a hashed token table (with an env/file fallback for no-DB installs); a token without a tenant match is 401, never local-tenant data. **Read-only tools first**, response row/byte caps, audit log. Start with the existing read models only: positions, portfolio value, trades, prices, fundamentals (consent-gated), sector exposure, risk summary, agent memory. Requires an MCP auth/mounting ADR in Phase 0. | `apps/server` route + `apiGuard.ts` + token store/migration; `docs/investing/MCP.md`; ADR | M |
| WS5.3 | Wire investing chat tools through the registry (positions, price, portfolio value, fundamentals, sector, risk, trades, memory); remove duplicate inline definitions | `apps/investing-server/src/portfolioChat.ts` | S–M |
| WS5.4 | Write tools behind a separate write token + preview/dry-run pairs (`preview_rule`/`apply_rule` token TTL 30 min, dry-run on structural writes) only after WS5.2 proves read-only use | registry + routes | M |
| WS5.5 | Provenance: citation grammar `{source, grade: A\|B\|C, date, documentId?}` as structured fields (not prose); reject writes without citation where evidence is claimed; display in UI | `packages/core/src/provenance.ts`; valuations/invoices | S–M |
| WS5.6 | Tool-loop hardening: 8-round cap, forced text on last round, pair-safe history trim, partial turn → failed; cap tool output; error-as-data with one-retry hint, no internal details across boundary | `apps/server/src/agent/*`, investing chat | S |
| WS5.7 | AI ops: per-operation usage rows including failed calls and cache tokens; capability probe (function calling, PDF extraction) with timeout; spend gate applied to MCP calls | `apps/server/src/agent/budget.ts`, `pricing.ts`; investing usage | S–M |
| WS5.8 | Personal assistant path (design + thin slice): tools execute client-side against the vault; approval events on the timeline; adopt LaVega's assistant spec. No ledger to server. Depends on WS1–WS2 data and the approval model; can start as design while WS2 runs. | `docs/superpowers/specs/2026-10-27-assistant-design.md` + `apps/web` | M (design first) |
| WS5.9 | Eval harness: fixture conversations with expected tool calls and values; run on model change; store results (Sure's eval dataset concept, not its Rails tables) | `apps/*/test/agent-evals` or script | M |

**Acceptance evidence.**

- `tools/list` for an external token equals the registry for that caller; a tool hidden by
  filter is also refused by name at dispatch.
- Read token cannot call a write tool; missing token is 401; response caps enforced; every
  tool error maps to safe `{error, hint}`.
- Provenance citation rejected when malformed; a valuation without a citation is refused in
  the agent path.
- Loop test: forced text on round 8; partial turn persisted as failed.
- Eval fixtures pass for model and prompt changes; cost per operation logged.

**Effort.** Core (WS5.1 M + WS5.2 M + WS5.3 S–M + WS5.4 M + WS5.5 S–M + WS5.6 S +
WS5.7 S–M) = **10–31 agent-days** (~2–6 weeks); extension (WS5.8 M + WS5.9 M) adds 4–10.
**Depends on** Phase 0; WS5.2 can run in parallel with WS1 after the MCP ADR, because
investing data is already server-readable. Personal assistant slice depends on WS1–WS2 data
but not on MCP.

**Risks.** Sure's MCP is write-capable with one coarse scope and no spend cap — do not copy;
use read-first, per-tool scopes, budget gate, row caps, audit. The mounting/tenant path is a
blocker, not a detail: without the token→tenant lookup the endpoint either 401s or serves
`LOCAL_TENANT_ID` data. Do not start WS5.2 before the Phase 0 MCP ADR. MCP contract docs
drift from code — generate the tool list from the registry. Personal data must not reach the
server; a personal MCP needs a recorded ADR and probably a local daemon, not a server route.

### WS6 — Interop, attribution, hardening

**Goal.** Leave the product portable, attributable and measurable.

| ID | Task | Target | Effort |
|---|---|---|---|
| WS6.1 | LaVega export: versioned ZIP/NDJSON + CSV using the Sure record vocabulary where it fits; manifest states binary inclusion; readback verification | `packages/core/src/interop/export.ts`; CLI/UI | M |
| WS6.2 | Attribution pass: module headers, `NOTICE`, provenance table in this plan, `docs/research/sure/README.md` | repo-wide | S |
| WS6.3 | Reference script + pin: `scripts/fetch-sure-reference.sh` (commit `562fe09`, shallow, outside tracked tree) | `scripts/` | S |
| WS6.4 | Metric review and cleanup: forecast error, transfer coverage, uncategorized share, statement coverage, realised-gain reconciliation, MCP usage; remove dead experiments, update `CONTEXT.md`/`BACKLOG.md` | docs + code | S–M |
| WS6.5 | Optional decisions recorded: personal MCP/API boundary, family sharing, budget product shape, whether to run a local Sure reference deployment | ADRs | S |

**Effort.** ≈ **1 week**.

## 4. Sequencing and phases

```
Phase 0  Foundations (ADRs, NOTICE, reference pin, scrub rules, baselines)
   │
   ├── Phase 1  Ledger truth (WS1) + investing read MCP (WS5.1 seed + WS5.2)
   │       │
   │       ├── Phase 2  Bills + budgets (WS2)  ── the wedge
   │       │       │
   │       │       └── Phase 3  Wealth + evidence (WS3)
   │       │
   │       └── Phase 4  Investing depth (WS4)      [parallel lane after Phase 0]
   │               WS4.7 also needs WS1.1 transfer pairs
   │
   └── Phase 5  Agent platform (WS5 core, then WS5 extension)   [after 1 + 4]
           │
           └── Phase 6  Interop + hardening (WS6)
```

| Phase | Content | Effort (agent-days) | Ship evidence |
|---|---|---|---|
| 0 | Decisions, conventions, attribution scaffolding, reference pin, ADRs 0010/0011/0012, scrub rules, baselines | 2–4 | ADRs merged; `NOTICE`; reference script; baseline numbers stored; scrub rules |
| 1 | WS1 (12–29) + WS5.1 seed + WS5.2 MCP (2–5 + M) | 14–34 | Transfers confirmed on real vault; rules dry-run; alerts; agents query portfolio via MCP |
| 2 | [#282](https://github.com/Elmata2/LaVega/issues/282) | WS2 (23–60; split in two halves) | 23–60 | Bills calendar, payment matching, paycheck plan, budget carry, forecast error vs baseline |
| 3 core | WS3.1–3.3 | 6–20 | Net worth with liabilities; balance sheet + income statement |
| 3 extension | WS3.4–3.6 | 9–25 | Document vault with backup/restore; statement pipeline; generic import session |
| 4 | [#284](https://github.com/Elmata2/LaVega/issues/284) | WS4.1–4.7 (11–31; +5–10 if WS4.8) | 11–31 | Realised/income report; basis provenance; ISIN identity; allocation cash |
| 5 core | WS5.1–5.7 | 10–31 | Registry + MCP hardened; provenance enforced |
| 5 extension | WS5.8–5.9 | 4–10 | Personal assistant thin slice; eval harness |
| 6 | [#286](https://github.com/Elmata2/LaVega/issues/286) | WS6 | 3–8 | Export round-trip; headers/`NOTICE`; metrics reviewed |

**Scope bundles.** The **core program** is Phase 0 + WS1 + WS2 + WS3 core + WS4.1–4.7 +
WS5 core + WS6: **69–188 focused agent-days**. The **extensions** add WS3.4–3.6,
WS4.8 and WS5.8–5.9: **18–45 more**. With two parallel lanes at 5 agent-days/week the core
critical path is ~11–30 weeks (median ~18); one lane is ~14–38 weeks. Re-estimate at every
phase gate; the range is wide because agent throughput and review time are the unknown, not
the task count.

**Recommended first block (concrete):**

1. Days 0–2: Phase 0 — ADR 0010/0011/0012, `NOTICE`, reference script, scrub rules, baseline
   capture; decide §9 questions 1–3.
2. Days 3–10: WS1.1–WS1.2 transfers in parallel with the WS5.2 MCP auth/tenant slice.
3. Days 10–20: WS1.3–WS1.5 rules engine + labels + WS1.7 insights; review with the owner on
   real data before starting WS2.

## 5. Workflow integration (how this enters the current stream)

**Personal ingest pipeline.** Today: parser → `ingest()` normalize/dedupe → views/forecast.
Adopt Sure's post-ingest order as pure stages, run in the browser after the vault opens:

```
ingest (unchanged)
 → transfer match (WS1)
 → label normalize (WS1)
 → rules run (WS1)
 → categorize fallback (existing)
 → bill occurrence generate + match (WS2)
 → insights/alerts (WS1)
 → forecast + reports (existing + WS2/WS3 projections)
```

All stages are pure functions over vault arrays with an explicit `asOf`; the vault write is one
save. No server read of the ledger.

**Views.** `Transacties` gains a match panel and badges; `Regels` becomes condition/action
editor; `Overzicht` keeps its cards but draws from bills/budget/reports; `BetaalschemaBlock`
becomes the bill calendar/paycheck preview; `Plan` sections consume budget/report outputs;
`Rekeningen` gains valuations and document attach. Old widgets keep working through adapters.

**n8n and invoices.** n8n remains the mail/PDF transport. The invoice queue writes into the
vault as today; WS3 adds retained documents and links an invoice to its statement/receipt.
The corrected n8n workflow can be imported unchanged; no new webhook contract is required.

**Investing.** Dashboard cards unchanged until WS4 reports land; then add "Income" and
"Realised gains" cards. The sync contract stays `BrokerAccessAdapter`; WS4.2 adds basis
provenance to the snapshot, WS4.5 canonical identity. Personal↔investing net worth sharing
keeps its opt-in daily totals, extended with liabilities when WS3 lands.

**Agents.** The existing investing agents keep their tools; WS5 moves definitions into the
registry without changing their behaviour. External agents (Claude Code, Codex, DSH, n8n)
gain `/mcp` read access to investing first. Personal agent chat stays in the planned
client-side/approval design; it must not ship a server-side ledger tool.

## 6. Data model changes

Personal vault (`VaultData`, all optional, old vaults decrypt unchanged):

```ts
transfers?: TransferPair[];       // WS1: {id, outflowTxId, inflowTxId, status, kind, feeTxIds?, createdAt, decidedAt}
merchants?: Merchant[];           // WS1: canonical name + aliases
rules?: Rule[];                   // WS1: existing field, additive condition/action shape
bills?: Bill[];                   // WS2
billOccurrences?: BillOccurrence[]; // WS2
billPriceChanges?: BillPriceChange[]; // WS2
billRejections?: BillMatchRejection[]; // WS2
budgetPeriods?: BudgetPeriod[];   // WS2
categoryGroups?: CategoryGroup[]; // WS2: explicit parent map; LaVega categories are flat strings
valuations?: Valuation[];         // WS3: {id, accountKey, date, amountCents, kind, source}
documentIndex?: DocumentMeta[];   // WS3: index only; sealed bytes live in a separate object store
exports?: ImportRecord[];         // WS3: import session history + readback results
```

Merge rule: every record that stores a `tx.id` (transfer pair, bill match, document link)
must be reconciled or explicitly dropped when `mergeAccounts` re-keys ids. Add a fixture per
record type. The `.lavega` backup bundle gains a version that includes the document object
store; restore without the documents is not acceptable.

`Tx` additive fields (not hashed): `excluded?: boolean`, `pending?: boolean`,
`notes?: string`, `tags?: string[]`, `sourceId?: string`, `source?: "bank" | "csv" | "sure-import" | ...`.
No change to `tx.id` inputs.

Investing: new Neon tables only where server-readable by design: `investing.api_tokens`
(hashed token, scopes, tenant id, last-used; WS5), optionally `investing.holdings_daily`
(WS4.8 conditional), optionally an account-tax-treatment table keyed by `(user_id, broker,
account)` (WS4.4). Everything else stays in the encrypted broker snapshot / price store.

MCP mount: the endpoint lives in `apps/server` and resolves tenant from the bearer token.
`apps/investing-server` alone has no auth and defaults to the local tenant, so it must not
serve `/mcp` without that resolution.

## 7. Historical data

Owner confirmed on 2026-11-10 that there is **no live Maybe/Sure instance and no historical
export to migrate**. The old-history migration track is removed from the plan and the issues:

- no Sure/Maybe export importer is scheduled;
- no real-export fixture is required;
- no phase or issue depends on old data.

Generic import (WS3.6) remains, because new bank/broker files still need a mapping wizard,
pre-flight, dry run and revert. It imports ordinary CSV/Excel into the encrypted vault in the
browser. It warns and refuses by default when the same account arrives in a second format,
because CONTEXT documents that CSV and MT940 double-count.

If a historical export appears later, the Sure export format is documented in the research
notes (`docs/research/sure/02-platform-ai.md` §4) and can become a separate opt-in issue.
Do not add it to the roadmap without new owner input.

## 8. Risks, measures, and quality gates

| # | Risk | Severity | Mitigation | Gate |
|---|---|---|---|---|
| R1 | Sign inversion corrupts totals | High | explicit direction; property tests; reconcile against real vault data | WS1/WS2/WS3 review |
| R2 | SQL→JS behaviour drift | High | port Sure edge tests as fixtures; golden data on real vault | each phase |
| R3 | Duplicate detector/logic (forecast vs bills) | Medium | one detector; bills claim its output; adapter boundary | WS2 review |
| R4 | Performance on real vault (rules O(n·r), matching O(n²)) | Medium | date/account indexes, early rejects, measure before UI path | WS1/WS2 bench |
| R5 | Encrypted-vault feature creep to server | High | ADR 0009; personal tools client-side; investing-only MCP | WS5 review |
| R6 | Document bytes vs browser quota | Medium | separate object store; per-file cap; explicit failure; backup bundle includes it | WS3 |
| R7 | Investment return regression | High | byte-identical dashboard fixture for trade-only brokers | WS4 gate |
| R8 | Licence/trademark mistake | Medium | headers with change date, NOTICE in Phase 0, independent-reimplementation policy, no marks | Phase 0 |
| R9 | Sure fork drift | Medium | pinned commit; re-verify at phase start | Phase 0 policy |
| R10 | Effort underestimate | Medium | phase ranges, extension bundles, stop after each acceptance | owner review |
| R11 | Account merge orphans transfer/bill/document links | High | reconcile or drop with report on merge/delete; fixture per record type | WS1/WS3 gate |
| R12 | MCP endpoint serves local tenant or 401s | High | mount in `apps/server`; token→tenant lookup; 401 without match; ADR 0012 | WS5 gate |
| R13 | Backup restore loses documents | High | versioned bundle includes document store; restore-first test | WS3 gate |

**Program metrics** (capture the baseline in Phase 0/1 before WS2; record after in WS6.4).
Store only aggregate counts, percentages and rates. Real amounts, names, IBANs and transaction
text stay out of the repo; local detail belongs in a gitignored file.

- forecast absolute error at 30/60/90 days on own history;
- share of internal transfers matched/confirmed vs manually edited;
- share of transactions categorized by rules vs AI vs manual;
- statement coverage (months covered / months expected);
- realised-gain reconciliation difference vs broker cash (should be zero or unknown);
- MCP tool calls per week and tool error rate;
- AI spend per operation and per user per month;
- time to produce a month close (manual minutes).

## 9. Decisions recorded (owner, 2026-11-10)

| # | Decision | Answer |
|---|---|---|
| 1 | Personal app shipping | **Ship now.** Build WS1–WS3 for owner use first, then public; launch gates per phase. |
| 2 | Old Maybe/Sure historical data | **None.** Owner confirmed 2026-11-10: no live instance and no export. Old-history migration is out of scope; no importer is scheduled. Generic import (WS3.6) stays for new files. |
| 3 | [#283](https://github.com/Elmata2/LaVega/issues/283) | Personal server-readable data | **Keep the ADR 0009 boundary.** No server code decrypts the vault; personal agent/MCP work stays client-side or deferred. Investing MCP ships first. |
| 4 | Budget shape | **Envelope with carry-over**, current category limits become defaults. |
| 5 | [#285](https://github.com/Elmata2/LaVega/issues/285) | Investing priority | **Depth** (basis, realised/income, tax treatment, security master). No aggregator breadth. |
| 6 | Rules scope | **Evaluator + common actions now**; splits/email/advanced actions deferred. |
| 7 | [#287](https://github.com/Elmata2/LaVega/issues/287) | Issue filing | **Yes.** Phase issues filed in `Elmata2/lavega`; see the issue table in §11. |
| 8 | [#288](https://github.com/Elmata2/LaVega/issues/288) | MCP auth/mounting | **Approve the Phase 0 design**: `/mcp` in `apps/server`, bearer token → tenant via hashed token table, read-only first, separate write token later. ADR 0012 records it. |

Remaining owner input: approve the Phase 0 artifacts before Phase 1 starts; the metric
baselines need the personal app running on the owner's data.

## 10. What we explicitly will not do

- Run Sure as a runtime dependency or sidecar for product features.
- Copy Rails/ActiveRecord/Sidekiq/Hotwire/Active Storage/Doorkeeper code.
- Import Sure's investment return/risk stack (it has no TWR/benchmarks/risk; LaVega does).
- Add payer/payment initiation, order placement, or any write to a bank/broker.
- Add a server-side reader of personal ledger plaintext without a recorded ADR.
- Port family/household sharing before a key-ownership ADR.
- Port Sure's provider breadth or aggregator custody model.
- Let an external agent write to data without per-tool scope, budget gate and human approval
  where the action is material.
- Use "Maybe" or "Sure" branding or trademarks.

### Deliberately deferred (not dropped by accident)

| Sure asset | Why deferred | Revisit when |
|---|---|---|
| Goals with linked accounts, pledges, earmarks, months-of-expenses target (`goal*`, ~1,600 LOC) | LaVega already has a richer personal goal model (`plan/goals.ts`) and investing memory goals; Sure's earmark mechanics need the new asset/liability model first | after WS3.1/3.3 ships |
| Merchant registry as a first-class table with enrichment provenance | WS1.5 ships the minimal canonical key + aliases; full registry/enrichment is a separate product decision | if rules/reports need merchant-level identity |
| XIRR multi-root detection and error taxonomy from `portfolio/xirr.rb` | LaVega's solver returns null on ambiguity; Sure's is a reference only. Compare after WS4 income report, not now | WS4 review |
| Loan amortization/projection (`loan*`, ~2,000 LOC) | No loan accounts in the vault yet; WS3.1 adds the kind, not the engine | when a real loan is tracked |
| Family/household sharing, invitations, roles | Needs a key-ownership ADR; conflicts with one-key-per-account | separate ADR |
| SnapTrade/Plaid/SimpleFIN/aggregator providers, 30-connector breadth | Conflicts with local-first credential custody; LaVega has three first-party brokers | never for local tier |
| PDF statement extraction via a model/provider | The document vault ships first; parsing stays deterministic (`pdfText`) until the vault has real files | WS3.4 follow-up |
| Sankey cash-flow graph and cached report tables | Presentation, not truth; LaVega's dashboard already has the required views | only if a visual report is requested |

## 11. Execution model

This document is a program spec, not an executable task list. Turn it into work as follows:

1. **Phase 0 first.** Record ADR 0010 (proposed), write ADR 0011 (direction/money) and ADR
   0012 (MCP mount/auth), create `NOTICE` and `scripts/fetch-sure-reference.sh`, define the
   export scrub rules, capture the metric baselines, and get answers to §9 decisions 1–3.
2. **One executable plan per phase**, written with the repo's `writing-plans` flow and stored
   in `docs/superpowers/plans/`. Each plan names: tasks, files, tests, acceptance evidence,
   STOP conditions, and the owner lane (personal / investing / shared).
3. **One lane owner per phase.** Personal and investing phases may run in parallel only when
   their write scopes are disjoint (`apps/web` + personal core vs `apps/investing-server` +
   `packages/core/src/investing`). Shared files (`model.ts`, `encryptedStorage.ts`,
   `docs/CONTEXT.md`, `NOTICE`) need one owner and a review by the other lane.
4. **Gate every phase** before the next:
   - `pnpm typecheck`, `pnpm lint`, `pnpm format`, `pnpm test` green;
   - the phase's acceptance evidence recorded in the phase plan;
   - attribution ledger row(s) added;
   - owner review on real data for any UI/personal behaviour;
   - metrics baseline or update recorded (WS6.4 owns the metric page).
5. **Port review checklist** for every derived module: direction comment, integer cents,
   `asOf`-only time, no storage/I/O in core, `Schema` at boundaries, typed errors, unknown is
   not zero, tests ported from Sure edge cases, header + ledger row + change date, no real
   financial data in fixtures or commits, no Rails concepts leaked into names.
6. **Stop rule.** If a phase cannot meet its acceptance evidence on real data, stop and
   reopen the design; do not continue to the next phase with an unverified foundation.

**Suggested issue breakdown** (titles, dependencies; file on owner approval):

GitHub issues: epic [#281](https://github.com/Elmata2/LaVega/issues/281). The table below
maps each plan item to its filed issue.

| # | GitHub | Issue | Phase | Depends |
|---|---|---|---|---|
| 1 | [#303](https://github.com/Elmata2/LaVega/issues/303) | Phase 0: ADRs 0010/0011/0012, NOTICE, reference script, scrub rules, metric baselines | 0 | — |
| 2 | Transfers: pair model, matcher, storage, merge/delete reconciliation, UI, spend exclusion | 1 | 1 |
| 3 | Rules evaluator v2 (conditions/actions, locks, dry-run) + editor | 1 | 1 |
| 4 | Label normalizer + merchant registry + transaction states + missing insight alerts | 1 | 2, 3 |
| 5 | Investing read-only MCP (auth/tenant) + tool registry seed | 1 | 1 |
| 6 | Bills model + schedule engine + occurrences + upcoming UI | 2 | 1; can start in parallel with 2/3 |
| 7 | Bill payment matcher + allocations + price changes | 2 | 2, 4, 6 |
| 8 | Paycheck planner + Betaalschema integration | 2 | 6, 7 |
| 9 | [#289](https://github.com/Elmata2/LaVega/issues/289) | Budget envelopes + category groups + carry rollover + plan integration | 2 | 3, 4 |
| 10 | [#290](https://github.com/Elmata2/LaVega/issues/290) | Forecast integration + error measurement vs Phase 0 baseline | 2 | 6, 7, 9 |
| 11 | [#291](https://github.com/Elmata2/LaVega/issues/291) | Account kinds + valuations + balance series | 3 | 4 |
| 12 | [#292](https://github.com/Elmata2/LaVega/issues/292) | Balance sheet + income statement (reuse existing plan modules) | 3 | 11 |
| 13 | [#293](https://github.com/Elmata2/LaVega/issues/293) | Encrypted document vault + statement pipeline + backup bundle | 3 | 11 |
| 14 | [#294](https://github.com/Elmata2/LaVega/issues/294) | Generic import session (single-format rule) | 3 | 4 |
| 15 | [#295](https://github.com/Elmata2/LaVega/issues/295) | Cost-basis lot book + provenance/locks | 4 | 1 |
| 16 | [#296](https://github.com/Elmata2/LaVega/issues/296) | Realised-gain + income report + tax treatment metadata | 4 | 15 |
| 17 | [#297](https://github.com/Elmata2/LaVega/issues/297) | Security master (ISIN-first) + thesis migration + provider affinity + allocation ladder | 4 | 1 |
| 18 | [#298](https://github.com/Elmata2/LaVega/issues/298) | Investment contribution classification | 4 | 2, 17 |
| 19 | [#299](https://github.com/Elmata2/LaVega/issues/299) | Full tool registry + MCP hardening + write tokens | 5 | 5, 17 |
| 20 | [#300](https://github.com/Elmata2/LaVega/issues/300) | Provenance grammar/fields + AI ops ledger + eval harness | 5 | 19 |
| 21 | [#301](https://github.com/Elmata2/LaVega/issues/301) | Personal assistant thin slice (client-side/approval) | 5 | 4, 6, 9 |
| 22 | [#302](https://github.com/Elmata2/LaVega/issues/302) | LaVega export + attribution pass + metric review | 6 | all |

Labels and triage roles follow `docs/agents/` when filed; do not invent a parallel tracker.

## Appendix A — Port provenance ledger

Fill one row per ported module when it lands. Keep this table current; it is the attribution
record and the review checklist. The `NOTICE` entry lands in Phase 0, before the first module
ships. Every header carries the upstream commit, the AGPL-3.0 notice, the words "independently
reimplemented for LaVega", and the change date.

| LaVega module | Sure source (path) | Commit | Licence | Change summary | Phase |
|---|---|---|---|---|---|
| `packages/core/src/transfers.ts` | `app/models/family/auto_transfer_matchable.rb`, `transfer.rb`, `transaction/transferable.rb` | 562fe09 | AGPL-3.0 | independently reimplemented; pure TS, direction explicit, no SQL; changed 2026-11-10 | 1 |
| `packages/core/src/rules/*` | `app/models/rule.rb`, `rule/**` | 562fe09 | AGPL-3.0 | independently reimplemented; evaluator first, no email/split actions; changed 2026-11-10 | 1 |
| `packages/core/src/labels.ts` | `transaction/label_normalizer*` | 562fe09 | AGPL-3.0 | trimmed NL/DE/EN packs | 1 |
| `packages/core/src/bills/*` | `recurring_transaction*`, `recurring_occurrence.rb`, `recurring_allocation.rb` | 562fe09 | AGPL-3.0 | independently reimplemented pure date/score engine; changed 2026-11-10 | 2 |
| `packages/core/src/budget.ts` | `budget.rb`, `budget_category.rb`, `budget/rollover_calculator.rb`, `period.rb` | 562fe09 | AGPL-3.0 | envelope math, no UI/share chain | 2 |
| `packages/core/src/balanceSeries.ts` | `balance/{base,forward,reverse}_calculator.rb` | 562fe09 | AGPL-3.0 | re-expressed over vault arrays | 3 |
| `packages/core/src/reports.ts` | `income_statement*`, `balance_sheet*`, `period.rb` | 562fe09 | AGPL-3.0 | subset: balance sheet, income statement, spending-vs-normal | 3 |
| `packages/core/src/statements/*` | `account_statement*`, `account_statement/*` | 562fe09 | AGPL-3.0 | client-side encrypted store, no Active Storage | 3 |
| `packages/core/src/csvImport.ts` | `import.rb`, `import/row.rb`, `import/mapping.rb` | 562fe09 | AGPL-3.0 | column mapping/preflight subset | 3 |
| `packages/core/src/investing/costBasis.ts` | `holding/lot_book.rb`, `holding/forward_calculator.rb` | 562fe09 | AGPL-3.0 | moving-average lot book | 4 |
| `packages/core/src/investing/realized.ts` | `trade.rb:159-267`, `investment_statement/totals.rb` | 562fe09 | AGPL-3.0 | realised + income report | 4 |
| `packages/core/src/investing/securities.ts` | `security.rb`, `security/price/importer.rb` | 562fe09 | AGPL-3.0 | ISIN-first canonical identity | 4 |
| `packages/core/src/agentTools.ts` | `assistant/function/*`, `assistant.rb` | 562fe09 | AGPL-3.0 | typed registry, read-first scopes | 5 |
| `apps/server/src/mcp.ts` | `mcp_controller.rb` | 562fe09 | AGPL-3.0 | JSON-RPC transport, stricter auth | 5 |
| `packages/core/src/provenance.ts` | `assistant/function/record_valuation.rb` | 562fe09 | AGPL-3.0 | structured citation grammar | 5 |
| `packages/core/src/interop/export.ts` | `family/data_exporter.rb` | 562fe09 | AGPL-3.0 | LaVega export, Sure vocabulary; changed 2026-11-10 | 6 |

If text from the MIT-licensed `docs/llm-guides/wealth-blueprint.md` is adapted, add a separate
row and notice: "Blueprint text © 2026 diegomarino, MIT" (do not fold MIT text into the AGPL
notice; MIT requires its own notice).

## Appendix B — Where to read what

| Need | File |
|---|---|
| Raw Sure core-domain detail and citations | `docs/research/sure/00-core-domain.md` |
| Raw Sure investing detail and formulas | `docs/research/sure/01-investing.md` |
| Raw Sure agent/API/import/ops detail | `docs/research/sure/02-platform-ai.md` |
| LaVega current state, capability matrix, seams | `docs/research/sure/03-lavega-state.md` |
| Consolidated teardown and verdict | `docs/research/2026-11-10-sure-teardown.md` |
| Decision record | `docs/adr/0010-sure-as-port-source-not-runtime.md` |
| Money/direction convention | `docs/adr/0011-money-direction-and-integer-cents.md` (created in Phase 0) |
| MCP mount/auth/tenant | `docs/adr/0012-mcp-auth-and-tenant-resolution.md` (created in Phase 0) |
| Sure source | local clone at pinned commit `562fe09`; never imported |
