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

| LaVega weakness                                                      | Empathic cost                                                                                     | Sure answer                                                             | Workstream |
| -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- | ---------- |
| Internal transfers are heuristics, not records                       | Totals and spend are wrong whenever an own-account move is misfiled; no confirm/reject            | First-class transfer pair with matching, status, fee legs, kind         | WS1        |
| Bills are detected, not managed                                      | Forecast cannot say "this occurrence, this date, unpaid"; no mark-paid; stale series never retire | Recurring series → occurrences → payment matching → price changes       | WS2        |
| Rules are one substring → one category                               | Can't express amount/account/merchant conditions, rename, exclude, dry-run, run history           | Ordered condition/action engine with claims and dry-run                 | WS1        |
| No period budget object                                              | Category limits cannot carry over; no "available to allocate"                                     | Monthly envelope with signed carry and inheritance                      | WS2        |
| No balance sheet, income statement, net worth with liabilities       | The multi-BV owner cannot see assets minus debts from one statement                               | Account kinds + valuations + daily balance series + statements          | WS3        |
| No document/statement vault                                          | Nothing proves where a parsed number came from; no re-parse, no audit                             | SHA-256 vault, period detection, account matching, coverage             | WS3        |
| No generic import wizard                                             | Every new bank format is code; no preview, no revert                                              | Column mapping, preflight, dry-run, retained source                     | WS3        |
| No realised-gain/income report; no tax-treatment or basis provenance | Investor cannot see what was actually earned or prove cost basis                                  | Basis provenance/locks, realised gains at disposal, income by treatment | WS4        |
| No MCP/agent access; one registry missing                            | The owner's own agents cannot query the product; tools drift between surfaces                     | One typed registry, `/mcp`, read-first scopes, provenance               | WS5        |
| Interop is one-way                                                   | No portable export; vendor lock risk                                                              | Versioned export + Sure-vocabulary import/export                        | WS6        |

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

### 2.6 Export scrub rules (Phase 0)

Real financial data never enters this repository, a fixture or a commit. These
rules apply to every artifact derived from the owner's vault: an export, a
support bundle, a baseline run, a fixture, a screenshot or a log excerpt.

**Replace with synthetic values before the data leaves the owner's browser:**

| Keep                                                   | Replace with                                              |
| ------------------------------------------------------ | --------------------------------------------------------- |
| IBAN / account numbers                                 | a synthetic IBAN, or `NL00TEST0000000000`                 |
| Account holder and account names                       | `Testrekening`, `Test Spaar`, `Broker A`                  |
| Counterparties and merchant names                      | `Leverancier A`, `Winkel B`, `Werkgever`                  |
| Exact amounts, balances, prices, quantities            | round synthetic numbers that preserve sign and rough size |
| Free-text descriptions that embed any of the above     | a short synthetic description                             |
| Document ids, file names and hashes of real statements | synthetic ids/names                                       |

**Keep unchanged:** dates, signs/direction (`amount < 0` = outflow, ADR 0011),
transaction types, categories/labels, currencies, row counts and the shape of the
data. Those are what a test or metric needs; the identities are what must go.

Rules:

1. **The browser is the scrub boundary.** The vault plaintext exists only in the
   owner's browser (ADR 0009). Any scrubbing happens there or on the owner's own
   machine; no server route and no agent receives unscrubbed data.
2. **Committed fixtures are hand-built synthetic data**, not scrubbed copies.
   A scrubbed copy is still a derivative of the real vault, so it stays local.
   `__fixtures__/*.json` files must be synthetic from the start and say so in
   their header/README.
3. **Scrubbed fixtures are gitignored, never committed.** Local scrub output
   lives under `.lavega/scrub/` (gitignored). The same applies to the pinned
   reference clone (`.lavega/reference/`) and baseline aggregates
   (`.lavega/baselines/`).
4. **CI, build and test never read those paths.** A test that needs a fixture
   uses a committed synthetic one; if it cannot, the behaviour needs a
   hand-built fixture first.
5. **Before committing any fixture**, skim it for the fields above (IBAN pattern,
   a real name, an exact balance). Reviewers do the same in the diff.

### 2.7 Metric baselines (Phase 0, owner-run)

The Phase 0 baselines are measurements of the **owner's real vault**, so an agent
cannot produce them: the ledger is encrypted and client-side (ADR 0009), there is
no plaintext export, and the repository may hold aggregates only. **Do not invent
numbers; a baseline that was not measured is recorded as `pending`, not as 0.**
The runbook is in §8 (Program metrics). Aggregates are stored outside the repo in
`.lavega/baselines/phase0.json` (gitignored); once measured, the aggregate values
are also written in §9 so a later phase can compare against them.

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

| ID    | Task                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | Target                                                                                           | Effort |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------ | ------ |
| WS1.1 | Transfer pair model + candidate matcher (date window, amount, FX tolerance, ranking, ambiguity guard), statuses `suggested/confirmed/rejected`, rejection memory, fee legs, kind derivation (loan payment / CC payment / investment contribution / funds movement)                                                                                                                                                                                                             | `packages/core/src/transfers.ts`; `TransferPair` type; `VaultData.transfers?` + storage methods  | M      |
| WS1.2 | Transfer UI: row badge, "possible match" panel, confirm/reject; feed confirmed pairs into spend exclusion and forecast so totals never change silently                                                                                                                                                                                                                                                                                                                         | `apps/web/src/views/Transacties.tsx`, a new panel; `views.ts` exclusion path                     | M      |
| WS1.3 | Rules evaluator v2 (engine only): typed conditions (name contains/equals, amount range, account, category, type/direction, merchant, date), actions (set category/name/merchant, add tag, exclude, mark transfer; no email/split initially), ordered groups, first-match claims, stop-processing, effective date, dry-run returning the matched sample; per-attribute locks so a rule never overwrites a user-edited field (`userModified` semantics from Sure's `Enrichable`) | `packages/core/src/rules/*`; extend `Rule` additively; legacy `{match, category}` still honoured | M      |
| WS1.4 | Rules editor: conditions/actions UI, ordering, dry-run preview; migrate existing rules to the legacy-compatible form on read                                                                                                                                                                                                                                                                                                                                                   | `apps/web/src/views/Regels.tsx`                                                                  | M      |
| WS1.5 | Label normalizer + minimal merchant registry: descriptor → canonical merchant key (rail markers, dates, card numbers, noise), NL/DE/EN packs; registry stores canonical name + aliases so rules, subscriptions, forecast and reports share one key                                                                                                                                                                                                                             | `packages/core/src/labels.ts`; `VaultData.merchants?`                                            | M      |
| WS1.6 | Transaction states: optional `excluded`, `pending`, `notes`, `tags` on `Tx` (not hashed), plus one migration pass over existing vaults with defaults                                                                                                                                                                                                                                                                                                                           | `model.ts`; `apps/web` state load/save                                                           | S      |
| WS1.7 | Insights formulas into `alerts.ts` — only the ones LaVega lacks: spending anomaly vs trailing median, idle cash, savings-rate change; the subscription price increase already exists (`subscriptions.ts`) and the cash-flow warning maps to the existing forecast alert. Each new insight carries typed facts for copy and "how calculated"                                                                                                                                    | `packages/core/src/alerts.ts`, `copy/`                                                           | S      |

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
  **As built (WS1.5–WS1.7, [#284](https://github.com/Elmata2/LaVega/issues/284), 2026-11-10).**
  The three tasks landed in one slice. Divergences from the plan text, each deliberate:

- **Label normalizer** is `packages/core/src/labels.ts` with NL, DE and EN packs only
  (`en_US` and `en_GB` split, because `en_US` writes the month first). Sure ships nine packs;
  the three shipped are the ones LaVega's data meets. All packs are always active, and the
  day/month order comes from the pack whose marker matched; `region` is only the fallback.
  `KENMERK` is added to the truncators (Sure's list has no Dutch reference marker). A
  `hasName` fact keeps a reference-only descriptor from inventing a merchant: its canonical
  key is `""`, not the rail token.
- **One key, not a fork.** `canonicalMerchantKey` normalizes the descriptor first, then
  delegates to the existing `merchantKey` in `subscriptions.ts`, so an unregistered merchant
  and a registered one share one key space. The registry is the additive
  `VaultData.merchants` (replace-all `getMerchants`/`putMerchants`); alias learning UI is not
  in this slice.
- **Transaction states** are four optional `Tx` fields. `hash.ts`'s `txBase` is untouched, so
  `tx.id` cannot change and no fixture re-keys. `migrateTxStates` is the ONE pass: it runs
  inside the vault adapter on open/adopt/restore (not in `apps/web`, which keeps the #283 lane
  clear), fills the defaults only where a row is missing them, and re-seals the vault once
  only when something changed. A second open migrates nothing and writes nothing. `notes`
  defaults to `""` on purpose — it states "no note", it does not fabricate an unknown amount
  (ADR 0011 §8 governs magnitudes and rates, not text).
- **Insights** are three pure functions in `alerts.ts`, each returning typed facts plus an
  `InsightHowCalculated` block (formula id, the threshold table in force, the exact inputs).
  The spending anomaly compares the projected month against the trailing **median** of three
  complete months (Sure uses the mean; the plan asks for the median, and one outlier month
  cannot pull it). A coverage guard suppresses the insight when the ledger does not reach into
  the baseline months, instead of reading an import gap as a zero month. Idle cash covers the
  current and savings account kinds (Sure's Depository), EUR only. Savings rate is
  `(income - spending) / income` over the two last complete months; a month with no income
  suppresses rather than returning an undefined rate. They are not wired into
  `computeAlerts`/AandachtBlock in this slice: that needs copy and view work, and the
  subscription price increase already covers the existing alert surface.
- **Tests are plain vitest**, not `@effect/vitest` — same state as the #282 slice; the package
  is still not installed.

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

| ID     | Task                                                                                                                                                                                                                                                                                                                                                                                                             | Target                                                                              | Effort |
| ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- | ------ |
| WS2.1  | Bill model: type (bill/subscription/installment/income/transfer/other), amount strategy (fixed/average/last), currency, cadence, anchor day, end mode, weekend policy, account/category/merchant, status (`suggested/active/paused/inactive/ended`), tags; optional `ScheduledFlow` bridge                                                                                                                       | `packages/core/src/bills/model.ts`; `VaultData.bills?`                              | M      |
| WS2.2  | Schedule engine: weekly/monthly/yearly, interval, day-of-month incl. last, nth weekday, month of year, clamping, weekend adjust, end conditions, `occurrences_per_year`, 10-year search cap; date math on `asOf` only                                                                                                                                                                                            | `bills/schedule.ts`                                                                 | M      |
| WS2.3  | Occurrence generator: 90-day horizon extended to next occurrence/finite plan, idempotent `(series, originalDueOn)` identity, cycle-start lookback, regeneration on schedule edit without touching paid/closed rows, 6-month history backfill                                                                                                                                                                     | `bills/occurrences.ts`; storage                                                     | M      |
| WS2.4  | Payment matcher: hard filters (currency/account/sign/merchant), confidence scoring (merchant/name/amount/date/account), tiers 0.85/0.60, ambiguity margin 0.15, no auto-link for pending, no suggestions for income, rejection memory, repair of replaced entries                                                                                                                                                | `bills/match.ts`                                                                    | L      |
| WS2.5  | Allocation/close rules: partial payments, cent epsilon, price changes, learned tolerance (max 25%), name aliases, mark-paid without transaction, user close never auto-reopens                                                                                                                                                                                                                                   | `bills/allocate.ts`                                                                 | M      |
| WS2.6  | Detection adapter: reuse `forecast.ts`/`subscriptions.ts` primitives; add amount clustering (7.5% running-mean), circular expected-day median, claim-or-create, classifier keyword packs. One detector only — do not fork `detectRecurringStreams`                                                                                                                                                               | `bills/detect.ts`                                                                   | M      |
| WS2.7  | Paycheck planner: declared income only, period slicing, due vs reserved, shortfall vs cash on hand, bridge period semantics                                                                                                                                                                                                                                                                                      | `bills/paycheck.ts`                                                                 | M      |
| WS2.8  | Bills UI: calendar/list/upcoming, mark-paid, match suggestion, series edit/pause/end, price-change history; reuse `BetaalschemaBlock`                                                                                                                                                                                                                                                                            | `apps/web/src/views/*`, blocks                                                      | M–L    |
| WS2.9  | Budget model + math: period (custom month start optional), lines per category, parent/child inheritance via an explicit category-group map (LaVega categories are flat strings — add the group map first, or descope inheritance), initialized-months chain, signed carry rollover (surplus only), bills-reserved read-only, cash vs allocation separation; migrate `categoryLimits` to the first period's lines | `packages/core/src/budget.ts`; `categoryGroups` in the vault; `plan/preferences.ts` | M–L    |
| WS2.10 | Forecast integration: bills → forecast projection adapter; keep `ScheduledFlow`/`forecast.ts` output contract stable; add occurrence dates and commitment confidence to drivers; measure error before/after on own history                                                                                                                                                                                       | `forecast.ts` adapter, `plan/cashflow.ts`                                           | M      |

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

**As built (WS2.9, [#289](https://github.com/Elmata2/LaVega/issues/289), 2026-11-11).**
The budget model, its carry chain, the vault migration and the Plan reading landed in one
slice. Divergences from the plan text, each deliberate:

- **The math is `packages/core/src/budget.ts`, pure and clock-free.** `computeBudgetChain`
  takes the periods, the actuals per month and the group map, and returns the chain. No Tx is
  read there, no storage is imported, and every amount is integer cents (ADR 0011). The
  carry rule is Sure's `RolloverCalculator`: `carryOut = max(0, budgeted + carriedIn - actual)`,
  so a negative month stops at zero and a currency change or a month gap resets the carry.
  Sure keeps a row per initialized month; LaVega stores only the periods the owner has, so a
  gap in the stored chain breaks it instead of inventing a carry across a month that never
  had a budget.
- **Inheritance is descoped, the group map ships.** The plan allowed "add the group map
  first, or descope inheritance"; the map is the additive `VaultData.categoryGroups`
  (`CategoryGroup[]`: a name plus its flat category strings). A line rolls up into its group
  once for display, and a category with no group stays a top-level line: no parent is ever
  invented. There is no parent allocation, no shared-remainder inheritance and no
  `move_allocation` in this slice.
- **Two carry levels, never mixed.** The period carries its envelope (`budgetedSpending` +
  carriedIn - actual); a line carries only its own allocation surplus. `availableToAllocate`
  is `budgetedSpending - sum(lines)`. A line's availability never adds the period carry, and
  every line sits in exactly one bucket (`groups` or `topLevel`), so a ring-fenced child is
  counted once.
- **`billsReservedCents` is a typed read-only slot with a `null` default.** It is never
  derived here and nothing in the chain depends on it; issue #286 (bills) fills it. Its
  absence is "not known", not zero (ADR 0011 §8).
- **Migration is one save, on open/adopt/restore.** The pass builds the first period's lines
  from the legacy `PlanPreferences.categoryLimits`, stamped in the month of the newest limit,
  and re-seals the vault once together with the tx-state pass. After that the field exists, so
  a later open writes nothing; an older build still reads the legacy limits because they are
  never rewritten. `budgetPeriodsOf` can also compute the same first period on read, so an
  unmigrated vault (and a test double without the budget storage calls) renders identically.
- **Plan/spending reads the envelope without moving existing totals.** The spending section
  shows the budget for `asOf`'s month when it has an initialized period, else for the last
  full month: allocation, the surplus carried in, and what is left. The actual for a month in
  progress comes from a second `spendHistory` pass that includes that month; the spending
  figures themselves still rest on full months only, so no figure, status or snapshot moves
  because a budget exists. Stored periods win over the legacy limits; the limit input writes
  the current month's line and keeps the legacy record in step (two vault saves per edit; the
  migration itself stays one).
- **Custom month start is model-only.** `budgetPeriodBounds` computes the `[start, end]` range
  for a 1..28 start day, but the plan's actuals are calendar-month buckets, so the UI stores
  and reads calendar months until actuals can be re-bucketed from custom period starts.
- **No group editor, no envelope editor.** The table stays one row per category; the group
  names ride in the vault and in the core roll-up only. Editing the envelope total (money not
  yet allocated) and moving money between lines is the next slice.
- **Tests are plain vitest**, like the rest of the package. The carry fixture
  (`packages/core/src/plan/__fixtures__/budget-chain.json`) is the plan's acceptance evidence:
  surplus months carry, negative months stop at zero, the currency change breaks the chain,
  and the grouped child is not double-counted.

**As built (WS2.1–WS2.3, WS2.8 first half, [#286](https://github.com/Elmata2/LaVega/issues/286), 2026-11-11).**
The first shippable half landed: `packages/core/src/bills/{model,schedule,occurrences}.ts`,
one additive `VaultData.bills` + `VaultData.billOccurrences` section saved through a single
`putBillPlan` mutator, and a `/app/bills` screen. Divergences from the plan text, each
deliberate:

- **Six-month history backfill is opt-in, not the default.** Sure's generator is called for
  declared bills with `from = cycle_for(today).begin` and clamps it to `anchor_date`; a
  backfill is a separate call. LaVega's first half has no payment matcher, so backfilling six
  months of past occurrences would present already-paid cycles as unpaid debt. The default
  window therefore starts at the cycle containing `asOf`; `historyMonths` is the explicit
  option the detection/matcher half (WS2.6/WS2.4) passes once past rows can be closed.
- **Occurrence identity is the row id.** Instead of Sure's unique index on
  `(recurring_transaction_id, original_due_on)`, the deterministic id is
  `billId|originalDueOn`. Running the generator twice cannot duplicate, and no database
  constraint is needed. Closed and paid rows are never rewritten by an edit; the
  re-generatable future is the only thing a schedule edit drops.
- **`stoodInFor` is ported in full.** A paid row from before a due-day edit already is its
  cycle, so it stands in for the nearest occurrence within half a cycle. Without it, moving a
  bill from the 1st to the 15th would leave two rows per past month.
- **Amounts**: integer cents, direction explicit (`direction: "in" | "out"`), and an
  occurrence stores `expectedAmountCents: null` unless the owner overrode that instance. The
  series strategy (`fixed`/`average`/`last`) resolves on read, so a price edit needs no sweep
  (ADR 0011). `last` reads the previous PAID occurrence's `paidAmountCents`, never the closed
  estimate.
- **The screen answers the third question honestly.** "Short before payday" needs a payday,
  and the paycheck planner (WS2.7) is out of scope. The period ends at the next occurrence of
  an active `income` bill; with no income series the shortfall is `null`, shown as unknown,
  not zero. Cash on hand is the sum of known EUR balances; an unknown balance keeps the
  shortfall unknown. Mark-paid, match suggestions and price-change history are not here
  (#287–#290); the "Paid" section renders closed rows that the vault holds and says so when
  there are none.
- **No detector in this slice.** `forecast.ts` stays the only detector; bills do not fork
  `detectRecurringStreams`. WS2.6 claims its output later.
- **No `ScheduledFlow` bridge is written yet.** The model carries an optional
  `scheduledFlowId`; projecting occurrences into flows is WS2.10, and the flow contract stays
  untouched.
- **Storage shape.** `getBills`/`getBillOccurrences` read `[]` on a legacy vault;
  `putBillPlan` writes both in one persist, so lazy materialization on unlock is one save and
  the vault never holds a series without its rows. Materialization runs in `App.tsx`'s vault
  load, not in `packages/adapters` (the adapter has no clock and must not grow one).
- **Dates stay clock-free.** Every schedule function takes ISO dates and `asOf`; the engine
  uses Effect `DateTime` in UTC. Tests are plain vitest (the package still has no
  `@effect/vitest`), 44 of them across the cadence matrix, idempotency, regeneration and
  outlook.

**As built (WS2.4/WS2.5, WS2.8 second half, [#287](https://github.com/Elmata2/LaVega/issues/287), 2026-11-11).**
The payment matcher, the allocation/close rules and the minimal correction UI landed in
one slice: `packages/core/src/bills/match.ts`, `packages/core/src/bills/allocate.ts`, one
additive `VaultData.billDecisions` written through the existing `putBillPlan` save, and
the suggestion / mark-paid / price-history surface on the #286 Bills screen. Divergences
from the plan text, each deliberate:

- **Suggestions stay derived; only decisions persist.** `suggestBillMatches` runs over the
  current ledger on read, exactly like `suggestTransfers`: confirmed allocations, marks,
  rejections and price changes live in the sidecar, a pending suggestion does not. The
  sidecar is written by the SAME `putBillPlan` save as the occurrence rows it closes, so a
  confirmation and its paid row cannot land apart; a save without a decisions argument
  keeps what the vault holds, so a schedule edit or a lazy materialization never forgets a
  payment.
- **Sure's matcher ported with one addition the Rails query hid.** Hard filters (currency,
  account, sign, merchant/alias/name/transfer), the 0.40/0.35/0.40 party weights, the
  0.30/0.25 amount weights, the 0.20→0.05 date slope, 0.10 account, the 0.85 / 0.60 tiers,
  the 0.15 ambiguity margin, the 0.60 suggestion floor, and "no auto-link for pending, no
  suggestions for income" are Sure's. Sure pairs one entry with the nearest open
  occurrence per series in its SQL; in memory the overdue window reaches `asOf`, so without
  an explicit nearest-occurrence pass every past occurrence would compete for every later
  payment of the same series. `billMatchCandidates` therefore keeps one occurrence per
  (series, transaction) before the ambiguity guard.
- **The amount band is still a hard filter.** A payment outside `expected * max(tolerance,
learned)` is not proposed at all (Sure scores it 0 and the candidate dies). Consequence:
  a genuinely partial payment (say EUR 40 of EUR 985) is not auto-suggested; it enters
  through a manual allocation. That manual-attach UI is NOT in this slice (the plan's
  WS2.8 second half only asks for suggestion confirm/reject plus mark-paid), so partial
  payments are covered by `allocate.ts` and its tests, not by a screen path. Carried for
  the manual-match slice.
- **No cross-currency matcher, because Sure has none.** The plan's FX edge fixture is
  honoured as a hard filter: a USD row is never a candidate for a EUR series. Sure's
  allocator converts a manual allocation at the entry-date rate; this slice has no manual
  allocation to convert, so no FX history is threaded into bills. Carried with the manual
  attach.
- **Close rules are Sure's.** A single confirmed allocation within the band closes the
  occurrence; otherwise the summed allocations close it when they cover the expected
  amount minus one cent (an overpayment settles too); anything short is a partial payment
  with a remaining amount and a second payment can finish it.
- **Price changes are recorded on every single settled payment that differs.** Sure's
  `price_change_detector` compares the settled amount to the expected one, stores the
  change with its effective date and moves the series price; a `fixed` series therefore
  takes the new amount, while `average`/`last` keep deriving their own. The known
  consequence, kept rather than special-cased: a one-off overpayment that settles an
  occurrence also reads as a price change, exactly as Sure would record it. A mark-paid
  and a multi-payment settlement never record one.
- **Learning is bounded and only from the owner.** A manual match outside the band that
  settles the occurrence widens `learnedTolerancePct` to the needed percentage, capped at
  Sure's 25%; the same confirmation teaches the counterparty spelling as an alias (max 8).
  The matcher's own exact tier never learns, and the widened band is used by the next
  matcher pass.
- **User closes never reopen; auto closes are repaired.** A mark or a user confirmation
  sets `closedSource: "user"` and no later pass touches it. `reconcileBillDecisions` is
  Sure's `repair_orphan_allocations` for a content-addressed ledger: it drops decisions
  whose transaction, occurrence or series disappeared, and reopens ONLY a matcher-closed
  (`auto`) row whose payments vanished, so a replaced entry cannot leave a row paid by a
  transaction nothing can render.
- **Model additions are five optional fields on `Bill`.** `matchDaysEarly` (default 2),
  `matchDaysLate` (default 7), `amountTolerancePct` (default 7.5), `learnedTolerancePct`
  (cap 25) and `aliases`, all of which a #286 series omits and therefore keeps Sure's
  defaults. Nothing else on the existing shape moved.
- **Automation is lazy, like materialization.** `runBillMatcher` (repair → derive →
  exact tier) runs in `App.tsx` on unlock and after an import and writes only when it
  changed something; a second run over its own output adds nothing. There is no server
  cron, per ADR 0009: the personal vault is only decryptable in the browser.
- **Acceptance measurement is a labelled real-shaped vault, not the owner's vault.**
  `packages/core/src/bills/__fixtures__/real-shaped-vault.json` holds 12 months of a Dutch
  household (9 series, SEPA date jitter, groceries/transfers as noise, a pending row, an
  in-band price change, an overpayment, an ambiguous same-amount twin, an instalment paid
  in two parts) and labels every bill payment with its intended occurrence. Measured by
  `match.real-data.test.ts`: **81/81 confirmed payments (100%) landed on the intended
  occurrence, 78 of them auto-confirmed; recall was 81 of 86 labelled rows (94.2%)**. The
  5 uncovered rows are exactly the four partial instalment rows (no manual attach in this
  slice) and the twin the owner must choose. The owner's real vault is local-first and
  never enters the repo; the fixture copies its shape, not its data.
- **UI stays the #286 screen.** A suggestion line with the transaction, amount, date, score
  and (when relevant) a `pending`/`ambiguous` badge; Confirm and Reject buttons; a
  mark-paid action on every open row; the partial remainder; the close source in Paid; the
  latest price change on the series row. No redesign, no new view.
- **Tests are plain vitest**, like the rest of the package: 79 bills tests across the
  matcher tiers, the five Sure edge fixtures, allocation/close, learning, marks, repair,
  the UI interactions and the measured real-shaped run.

**As built (WS2.7, [#288](https://github.com/Elmata2/LaVega/issues/288), 2026-11-11).**
The paycheck planner landed as `packages/core/src/bills/paycheck.ts` plus the
Betaalschema/bills screen reading it. Nothing new is stored: the plan is derived from the
series, their occurrence rows and the #287 decisions, so there is no vault field and no
migration. Divergences from the plan text, each deliberate:

- **Declared income only, and no detector.** A payday is the open occurrence of an active
  series with `type: "income"` and `direction: "in"`. An active `other`/in inflow is not a
  payday even though money arrives. Detected inflows never enter: the planner has no ledger
  argument at all, so `forecast.ts` stays the only detector and WS2.6 still claims its
  output later.
- **The slice is Sure's boundary model.** Today up to the first paycheck is the leading
  window; every payday opens the next one, ending the day before the following payday.
  `periodsLimit` defaults to Sure's 3, which yields the leading window plus up to three
  income windows. When `asOf` is itself a payday there is no dedupe gap: the leading window
  starts with income and is funded by that paycheck, so it is not a bridge.
- **Due versus reserved.** Each obligation is funded from the paycheck of the window it
  falls due in. Only what that paycheck cannot cover cascades backward as a reserve, nearest
  paycheck first; the earliest income window absorbs the overflow, so a gap shows today
  instead of the week the bill lands. A bridge window has no income, so it never carries a
  reserve: it carries only what genuinely falls due inside it.
- **Shortfall is measured against cash on hand.** A bridge is short only when its known cash
  cannot cover its obligations; its shortfall is `obligation - cash`, and an unknown cash
  balance reports `shortfallCents: null` with `shortfallUnknown: true`, never zero. Nothing
  in the plan subtracts the paycheck that arrives after the bridge: future income is not
  cash. A non-bridge window is short when income minus its obligations is negative.
- **Cash on hand is a separate honest read.** `cashOnHandCents` sums the known EUR balances
  of current and savings accounts only. A credit card is a liability, an investment account
  is not cash, and an "other" account is not claimed as cash. One unknown balance makes the
  total null (a partial sum would read as "short" while the missing account might cover
  everything); no cash account at all is null, not zero. Sure additionally excludes its
  family's tax-advantaged accounts; LaVega has no such flag, so the account kind is the
  whole rule. The caller passes accounts already rolled forward to `asOf`.
- **#286's `billsOutlook` is superseded, not duplicated.** `paycheckOverview` returns the
  preview the summary card shows (due before payday, paid in the last 31 days, reserved,
  shortfall or unknown) and the full `plan` for the slice, so there is one shortfall
  implementation. Without a declared income there is no invented payday: the plan is null,
  the due figure still covers the 90-day horizon, and the shortfall is null.
- **#287's allocation decisions are the only payment truth.** A partially paid occurrence
  funds `expected - allocated`, so the plan never asks for money already paid; slips, marks
  and matcher results arrive through the same `BillDecisions` the screen already holds.
- **Other currencies are counted, never converted.** The plan counts one currency (EUR by
  default); active series in another currency are left out of every total and reported in
  `excludedCurrencyCount`, because LaVega bills have no FX path. Sure converts and counts
  what it cannot convert.
- **The screen answers from the slice, and mark-paid is unchanged.** The Bills summary card
  now reads the preview, a new "Salarisperiodes" section renders each window (income, due,
  reserved, remaining, bridge cash and gap, the items behind each number), and
  `BetaalschemaBlock` takes an optional `paycheck` preview above its agenda (Overzicht
  threads the bills lane from `App.tsx`). Mark-paid without a transaction keeps working; the
  regression test pins it after the restructure.
- **Acceptance evidence is a labelled scenario matrix.**
  `packages/core/src/bills/__fixtures__/paycheck-scenarios.json` holds six hand-worked
  scenarios: monthly income on the 25th, twice-monthly income (1st and 15th), weekly income
  with a two-paycheck reserve cascade, a reserve overflow that shows as short, a last-day
  payday whose bridge crosses month end (EUR 500 cash against EUR 1.000 due, with
  EUR 3.000 arriving after it), and the same bridge with unknown cash. `paycheck.test.ts` asserts the
  slice, the due/reserved split, the bridge shortfall against cash, the unknown-cash null,
  and payments through #287 allocations: 28 tests. The web tests add the rendered slice, the
  preview in BetaalschemaBlock and the mark-paid regression.
- **Tests are plain vitest**, like the rest of the package.

**As built (WS2.10, [#290](https://github.com/Elmata2/LaVega/issues/290), 2026-11-11).**
Bills occurrences became forecast drivers, and the change is measured against a
baseline captured before it. The adapter is `packages/core/src/bills/forecast.ts`
(`billForecastProjection`), the forecast gained two additive options, the
Forecast screen and Overzicht thread the bills lane, and the measurement lives
beside the code. Divergences from the plan text, each deliberate:

- **The baseline exists as data, not as a claim.** `plan/__fixtures__/
forecast-error-baseline-290.json` was measured and committed BEFORE the
  integration commit (`test(core): capture the forecast-error baseline ...`),
  and `plan/forecastError.test.ts` pins it. `plan/forecastError.ts` is the
  ruler: it lets the forecast see only transactions dated on or before `asOf`,
  then compares the forecast's own weekly closing points with the actual ledger
  at the 30/60/90-day checkpoints (the weekly closes on day 28/56/84; the
  forecast's public contract is weekly points, and inventing a daily point would
  measure a different model than the owner sees).
- **Measured result, same fixture and split before and after:** absolute error
  **30d EUR 92,45 -> EUR 1,50; 60d EUR 212,85 -> EUR 1,00; 90d EUR 327,36 ->
  EUR 5,39; total EUR 632,66 -> EUR 7,89**. Every checkpoint improves. The
  fixture is a real-shaped labelled household (`forecast-commitments-vault.json`,
  12 months visible + 3 months actuals), not the owner's vault: that vault is
  local-first and never enters the repo (ADR 0009), so the issue records this as
  a real-shaped measurement, not a live-ledger one.
- **The gain is occurrence dates and amounts, not tuning.** The three detected
  errors were structural: (1) a gym paused before the origin whose detected
  stream still projects for up to three cycles — the paused series has no future
  occurrence dates, so its stream is claimed and suppressed; (2) a newly
  declared health-insurance bill whose first payment is after the origin — no
  history, so no detector can see it, but its occurrence dates put it in the
  line; (3) an energy price change at the origin — the detector's amount is the
  history's median, while the occurrence carries the series' current amount.
  Calendar due dates (a phone bill on the 30th) replace 30-day stepping from the
  last actual payment. No threshold, tolerance or window was changed.
- **`ScheduledFlow` stays a closed contract; commitments are the additive path.**
  The plan's target column said "forecast.ts adapter, plan/cashflow.ts", not
  "invent a bill ScheduledFlow". Synthesizing flows would either add a member to
  `ScheduledFlow.source` (a union every consumer switches on) or label real
  bills as `manual` (a lie in the flow list). Instead `ForecastOptions` gained
  optional `commitments` and `claimedStreams`, `EntityForecast` gained optional
  `commitments`, `Driver` gained optional `dates`/`commitmentConfidence`/
  `source`, and `ForecastBasis` gained optional `commitmentsProjected`/
  `claimedStreams`. Every field is optional: a caller that passes neither gets
  byte-identical pre-#290 output, and the baseline test asserts exactly that.
  Existing consumers (`Forecast.tsx`, `Overzicht.tsx`, the agent tab context)
  keep their shape.
- **One detector, not a fork.** The adapter calls the same
  `detectRecurringStreams` the forecast calls, then claims the streams a bill
  explains by sign, party (the matcher's own `billMatchesPartyText`, shared so
  the matcher and the forecast agree on which series a row is), cadence and
  amount. Claim conflicts resolve deterministically (best score, then bill id);
  one stream feeds one series. A paused/ended series still claims its stream:
  that is how "no future occurrence" reaches the forecast. Streams no bill
  explains stay unclaimed and keep projecting exactly as before, so WS2.6
  (detection adapter) is what retires them later, not this slice.
- **Commitments carry the remaining amount, not the expected amount.** Each
  occurrence projects `expected - allocated` from the #287 decisions, so a
  partially paid bill is never asked for twice. A closed occurrence is not
  committed at all. Non-EUR series are excluded and counted (the forecast is a
  EUR projection; bills have no FX path), mirroring the paycheck planner.
- **Commitment confidence is a rule over the ledger, not a weight.** Zero
  observed matching payments before `asOf` = `low` (declared, never seen), one
  or two = `medium`, three or more = `high`. The driver shows the confidence
  word and the committed dates; the confidence grade for the whole forecast
  only counts commitments as evidence, it does not raise the grade by itself.
- **The screen says which numbers have a date behind them.** Forecast drivers
  now render the committed occurrence dates and the confidence word for bills
  drivers (NL and EN copy), and Overzicht uses the same projection for its
  position card so the two screens cannot disagree. The chart, banner, band and
  shortfall logic are untouched; a commitment adds a known amount on a known
  date and therefore no measured band variance (its uncertainty is the
  confidence word, not a fabricated spread).
- **Agent tab context is not wired.** `apps/web/src/agent/tabContext.ts` builds
  its forecast from a fields list that has no bills lane; adding one is a
  separate redaction-boundary decision, not a forecast change.
- **Tests are plain vitest**, like the rest of the package: 11 adapter tests
  (commitment dates/amounts/sign, partial remainder, closed rows, confidence,
  non-EUR exclusion, stream claiming/suppression, unclaimed streams), the
  baseline artifact test and the integrated measurement that compares the two
  artifacts and asserts every checkpoint improved.

### WS3 — Wealth view and evidence (personal)

**Goal.** One statement of assets and liabilities with a defensible audit trail, and a path
for the owner's old history.

**Sure sources.** `app/models/balance/{base,forward,reverse}_calculator.rb` (~1,450),
`balance/materializer.rb`, `balance_sheet*`, `income_statement*`, `period.rb` (~3,748 total
reports), `account_statement.rb` + `account_statement/*`, `import.rb` and
`import/*_mapping.rb`.

**Tasks.**

| ID    | Task                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | Target                                                                           | Effort |
| ----- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- | ------ |
| WS3.1 | Account kinds and valuations: extend the **existing** `Account.type` / `AccountTypeKind` (`packages/core/src/balance.ts`) with asset/liability kinds (depository, credit card, loan, property, vehicle, other asset/liability) and dated absolute valuations; optional opening balance; no amortization engine yet. Update every exhaustive switch (`Rekeningen.tsx`, `KaartenBlock.tsx`, `copy/money.ts`) and migrate stored `type` values                                                                                                                                                                    | `model.ts` + `balance.ts`; `Valuation`; `VaultData.valuations?`; `Rekeningen` UI | M      |
| WS3.2 | Balance series: port **both** Sure calculators — reverse replay from the latest anchor for linked/imported accounts, forward replay for manual accounts, selection by anchor kind; a valuation is a hard reset, never an interpolation; stale/carried valuations stay labelled; cash/non-cash split, flow factors; produce the daily series                                                                                                                                                                                                                                                                    | `packages/core/src/balanceSeries.ts`                                             | M      |
| WS3.3 | Reports: **balance sheet** and **income statement** (assets/liabilities/equity; income/spend by category per period, net savings). Reuse the existing savings-rate/month machinery (`plan/month.ts:50`), spending comparison (`plan/spending.ts:62`) and category medians (`views.ts:377`) instead of re-porting them; add only the missing balance-sheet and income-statement assemblies, with "how calculated" facts                                                                                                                                                                                         | `packages/core/src/reports.ts`; reuse existing plan modules; views               | M–L    |
| WS3.4 | Encrypted document vault: sealed bytes with the vault key in a **separate IndexedDB object store** (not inside `VaultData`; byte churn must not rewrite the whole vault blob), metadata `{sha256, kind, periodFrom/To, accountKey?, txIds?, mime, source, byteSize}`, duplicate detection by hash, a size cap per file (default 25 MB), and an **extended `.lavega` backup bundle (new format version) that includes the document store**; restore/erase must cover both. If the bundle format is not extended, the feature does not ship — a backup that silently drops documents is worse than no documents. | `packages/adapters` crypto/storage + `apps/web/src/backup.ts`; ADR in Phase 0    | L      |
| WS3.5 | Statement metadata pipeline: period detection, institution/account hints, deterministic account matching with confidence tiers and tie refusal, review queue, month coverage statuses, report-only ledger reconciliation (tolerance 0.01), no invented "verified" label                                                                                                                                                                                                                                                                                                                                        | `packages/core/src/statements/*`                                                 | M–L    |
| WS3.6 | Generic import session: CSV/Excel column mapping, date/number/sign detection, preflight, dry run, revert, retain source document; reuse parser profiles where they fit. Dedupe only within the same source format; **do not claim cross-format dedupe** — CONTEXT documents that the same account via CSV and MT940 double-counts. The wizard warns and defaults to one format per account.                                                                                                                                                                                                                    | `packages/core/src/csvImport.ts`; Import view                                    | M      |

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

**As built (WS3.1/WS3.2, [#291](https://github.com/Elmata2/LaVega/issues/291), 2026-11-11).**
Account kinds, dated absolute valuations and the daily balance series landed in one slice:
`packages/core/src/balance.ts` (kinds, classification, `Valuation`, anchors, migration),
`packages/core/src/balanceSeries.ts` (both Sure calculators, net worth), one additive
`VaultData.valuations` field, and the Rekeningen/KaartenBlock surfaces. There is no
amortization engine and no report: WS3.3 owns the balance sheet and net-worth view.
Divergences from the plan text, each deliberate:

- **Kinds are additive, the five stored strings are untouched.** `ACCOUNT_TYPES` gains
  `Lening`, `Woning`, `Voertuig`, `Overig bezit` and `Overige schuld` after the existing five,
  so a vault written before this slice reads exactly as before. `AccountTypeKind` gains
  `loan`, `property`, `vehicle`, `otherAsset` and `otherLiability` beside the existing five
  (depository stays split into `current`/`savings`, because the plan machinery and the
  savings/cash rules already key on that split). `accountClassification` is Sure's
  asset/liability rule: credit, loan and other liability are liabilities; everything else is
  an asset — including a bare `Overig`, because a liability needs the owner to say so.
  Stored-type migration maps known spellings (`Savings`, `credit card`, `Hypotheek`, …) to
  the canonical Dutch string ONCE, at vault open; an unrecognised value is left alone (it
  already reads as `other`), so the migration never renames data it does not understand.
- **A valuation is a dated absolute, never an interpolation.** `Valuation` rows live in the
  additive `VaultData.valuations` with identity `accountKey|date`, integer cents (signed like
  the account balance; a liability is negative) and kind `opening`/`reconciliation`.
  `Account.openingBalanceCents` + `openingDate` is the optional opening anchor; both halves
  are required, so half an anchor is unknown, not zero. Storage exposes replace-all
  `getValuations`/`putValuations`, like the other sidecars: a merge or delete rewrites the
  list in one save.
- **The replay direction is chosen by the anchors, not by a stored flag.** An account with an
  opening anchor replays FORWARD from it (manual account); one with only current/reconciliation
  anchors replays BACKWARD from the newest (linked/imported account); one with no anchor is
  UNKNOWN for the whole range. The reverse replay stops at the oldest ledger evidence or the
  earliest anchor — before that a gap is the honest answer, because nothing recorded a balance
  there. Days AFTER the newest anchor are extended forward from it and labelled as carried, so
  a stale valuation stays a labelled value instead of a gap. `valuationStatus` reports
  `fresh`/`stale`/`unknown` from the newest anchor's age (45 days), which the screen turns into
  a sentence.
- **Unknown is a GAP, never a zero.** A day no anchor reaches is `balanceCents: null`; the net
  worth day reports `totalCents: null` with `unknownAccounts` naming the accounts, beside a
  `knownTotalCents` partial figure that is never presented as net worth. An account with no
  anchor makes every day unknown rather than contributing zero to the total.
- **Cash and non-cash follow the kind.** A depository account is all cash; a credit, loan,
  property, vehicle or other kind is all non-cash (which is what makes a loan a debt rather
  than spendable money); an investment account's split is UNKNOWN, because holdings are not
  valued in this slice — claiming 0 cash would be a lie in the other direction. Flows are
  signed by `flowsFactor` (asset 1, liability -1) over LaVega's signed euro amounts, so a loan
  repayment raises the liability value and a purchase lowers an asset.
- **Only EUR accounts enter net worth.** A non-EUR account is excluded and counted in
  `excludedForeignCount`; no FX rate is invented for a balance series.
- **Merge and delete keep valuations consistent.** `mergeValuations` re-keys the duplicate's
  rows to the survivor; a same-date clash keeps the survivor's row and drops the duplicate's
  (counted, not silently doubled). `dropAccountValuations` is the delete path. Both are wired
  into the existing #282 merge/delete handlers in `App.tsx`, and
  `valuationsHaveNoOrphans` lets a test assert the invariant instead of trusting a comment.
- **The UI reads a liability as the amount owed, for every liability kind.** Rekeningen's saldo
  field and label use `accountIsLiability` instead of `isCardAccount`, so a loan typed as a
  positive is stored negative like a credit card. Every exhaustive `AccountTypeKind` switch
  (Rekeningen, KaartenBlock) gained the new cases, and both copy packs gained the new type
  labels plus the valuation editor copy.
- **The valuation editor is the Rekeningen panel, not a new screen.** The opening balance and
  date fields sit beside a dated valuation list with add/remove, and a status line that says
  "unknown until you add one" or labels a stale carried amount. The preview fixture seeds a
  house with one stale valuation, a mortgage with an opening anchor and a car with NO
  valuation, so the gap is visible in the app walk.
- **Acceptance evidence is a hand-worked household.**
  `packages/core/src/__fixtures__/net-worth-291.json` holds a checking and savings account
  with opening anchors, a mortgage (forward), a house with a single dated valuation (reverse,
  unknown before it) and its flows. `balanceSeries.test.ts` asserts the daily replay, the
  hard reset, the anchor-date reconciliation, the unknown gap (`totalCents: null`, named
  account, non-zero known sum), the stale/carried labels and the merge/delete invariants: 21
  tests, beside the extended storage and Rekeningen/KaartenBlock tests. The 45-day staleness
  window is a constant, not a clock read.
- **Tests are plain vitest**, like the rest of the core package.

**As built (WS3.3, [#292](https://github.com/Elmata2/LaVega/issues/292), 2026-11-11).**
The balance sheet and the income statement landed as `packages/core/src/reports.ts`,
computed inside `computePlan` (`PlanResult.reports`) and shown by a new `ReportsCard` on the
Plan page. Nothing is stored: both statements are derived from the vault arrays the plan
already reads, and there is no cash-flow statement, no Sankey and no reports route in this
slice. Divergences from the plan text, each deliberate:

- **Only the two missing assemblies are new; the pipeline is reused.** Personal scope
  (`personalView`), own-transfer and card-settlement cleaning (`cleanTxs`), the plan's copy
  of `ownAccounts` (`scopedOwn`), category derivation (`categorize`), FX conversion
  (`toEur`, `separate` mode leaves a row out and counts it) and the balance series (#291
  `accountBalanceSeries` / `netWorthSeries`) are the existing primitives. `reports.ts` adds
  the netting, the two totals, equity and the "how calculated" steps — not a second ledger.
- **The balance sheet is Sure's, with LaVega's signed ledger.** Assets sum positive; a
  liability reports the amount OWED as a positive (Sure's shape, and how Rekeningen already
  shows a debt), while each account row keeps the vault's signed balance. Equity is
  `assets − liabilities`; the #291 net-worth series is computed independently and the two
  figures are asserted equal, which is the balance check.
- **An unknown valuation is a GAP in the sheet too.** When any included account cannot be
  valued on `asOf`, `assetsCents`, `liabilitiesCents`, `equityCents` and `balanced` are
  `null`, the unknown keys are named, and the known partial sums are exposed BESIDE the gap
  and never presented as totals. A carried anchor older than the #291 stale window stays a
  labelled value (not a gap) exactly as the series says.
- **Refunds are netted per category BEFORE the sides are split**, Sure's
  `net_category_totals`: a category whose spending refunds out flips to income of that
  magnitude, and the two totals are the sums of the netted categories. Income − spend is
  therefore the netted ledger by construction; the test also asserts it against an
  independent sign-normalized ledger pass.
- **Owner-excluded and pending rows are skipped, and that is a divergence from the plan
  pipeline.** The plan's sections read `cleanTxs` without consulting the WS1.6 tx states;
  a statement must not count a row the owner excluded or that has not settled, so the
  report filters both (and says nothing about them — they are not money that moved).
- **The savings rate is net savings over income, NULL when income is not positive.** Zero
  income is unknown, never 0 and never Infinity; a negative net saving keeps its negative
  rate. This is the same `ratio` rule `plan/month.ts` uses, applied to the statement's own
  netted totals instead of the room's median months.
- **Periods are calendar months, and the month in progress is marked PARTIAL.** The card
  shows `asOf`'s month clipped at `asOf` plus the two previous full months, newest first,
  so "per period" is visible without a second call. The plan's month-coverage rule is NOT
  applied here: a statement reports what is booked, and a thin month is shown with its
  partial badge rather than hidden (a balance statement is not a forecast input).
- **Categories stay flat.** Sure nets by persisted category tree; LaVega's categories are
  flat strings (WS2.9 added an explicit group map for budgets only), so the statement
  reports the flat category names and never invents a parent.
- **The UI is a card on the existing Plan page, not a new section or route.** It reuses the
  plan frame (`Card`, `Rows`, `useSectionCopy`) and renders the engine's own calc steps in
  plain sentences, so the numbers shown are the numbers used. Both copy packs carry the
  sentences; the advice-language scan applies to them like every other plan string.
- **Acceptance evidence is a hand-worked household.**
  `packages/core/src/__fixtures__/reports-292.json` holds one partial month, two full
  months, a mixed category whose refunds net it, an owner-excluded row, a pending row, an
  unconvertible row, an own transfer pair, and a balance sheet with a house valuation.
  `reports.test.ts` asserts the cross-foot, the category-to-ledger reconciliation, the
  zero-income unknown rate, the balance-sheet balance against the #291 series, the unknown
  gap and the stale label: 15 tests. `ReportsCard.test.tsx` pins the rendered statement,
  the partial badge, the gap sentence and the how-calculated lines: 5 tests.

**As built (WS3.4/WS3.5, [#293](https://github.com/Elmata2/LaVega/issues/293), 2026-11-11).**
The encrypted document vault, the statement metadata pipeline and the document-bearing back-up
landed in one slice: an additive `VaultData.documents` metadata list, a sealed-bytes object
store in `packages/adapters`, the bundle format version 3, `packages/core/src/statements/*`,
and a documents card in the Profiel import area. Divergences from the plan text, each
deliberate:

- **Metadata in the vault, bytes OUTSIDE it.** `VaultData.documents` holds the metadata
  (identity = SHA-256, so the same bytes uploaded twice is ONE document); the sealed bytes
  live in a second IndexedDB object store `documents` inside the same per-owner database
  (schema version 2: a version-1 database upgrades in place and keeps its vault blob). A
  document upload never rewrites the vault ciphertext — the test asserts the vault blob
  object is UNCHANGED by a document write.
- **The bytes are sealed with the same audited path.** `vaultCrypto.sealBytes`/`openBytes`
  reuse AES-GCM and the vault key; the document store never holds plaintext. Restoring a
  bundle writes the SAME ciphertext (no re-encryption with a fresh IV), which is what makes a
  restored document byte-identical to the uploaded one.
- **The back-up bundle is a NEW format version (v3) and carries both stores.** The download
  is `{vault, documents: [{sha256, sealed blob}]}` sealed under the vault key; `restore`
  accepts v3, v2 and v1. A v1/v2 file cannot carry documents, so restoring one CLEARS the
  document store instead of leaving metadata pointing at bytes nothing can vouch for. The
  server backup stays vault-only: its route lives in `apps/server`, which a concurrent lane
  owns, and its shape check rejects a v3 file. Rather than silently drop the files, the
  server upload REFUSES in words ("download the full .lavega backup") whenever documents
  exist — a silent drop is the one outcome the plan forbids.
- **Erase removes BOTH halves.** `eraseDocuments()` clears the document store and the
  metadata in one call; `startFresh()` (and every restore) clears the document store too, so a
  replaced vault can never leave orphaned bytes behind.
- **The upload gate is explicit.** A 25 MB cap, a pdf/csv/xlsx allowlist and a non-empty check
  return a reason CODE (`too-large`/`type`/`empty`/`name`); the card turns it into a sentence.
  The adapter does not enforce the cap itself — it seals what the gate let through, and the
  gate is the single place both the UI and a test read.
- **The pipeline is Sure's, with the same refusal rules.** Period detection reads dates, a
  month-year, English AND Dutch month names (a deliberate addition: the statements are Dutch),
  a last-four from an "ending 1234"-style hint or an IBAN, and an institution/name hint with
  Sure's generic-filename stop list; an extracted text (or a CSV, which is text) is the content
  tier and wins over the filename. Account matching keeps Sure's weights (0.45/0.25/0.25/0.05),
  the 0.35 floor, and refuses on a tie. Reconciliation is report-only with the one-cent
  tolerance, and `verified` is true ONLY when at least one check exists and every check
  matched: no account, no period, no balances or no ledger value is `unavailable`, never a
  pass.
- **Coverage statuses fold the reconciliation outcome in.** A month with two linked statements
  is `duplicate`; one with a mismatched statement is `mismatched`; a month covered only by an
  unmatched statement stays `ambiguous`; months before the account's history are
  `not_expected`. A statement with no period stays in the review queue and never silently
  becomes "matched".
- **No PDF text extraction and no balance parsing in this slice.** The content tier works for
  CSV/text uploads; a PDF is detected from its filename only, and opening/closing balances are
  left null unless a caller supplies them. Consequence, kept honest: an uploaded PDF usually
  reconciles as "cannot be checked (no balances in the file)", which is exactly the
  no-verified-claim rule rather than a fabricated pass. Carried with the statement-parsing
  slice.
- **The UI is one card in the Profiel import area.** Upload, the review queue with the reason
  per document (suggestion, tie, no period, rejected), linking/rejecting/removing, the
  reconciliation line per document, and an erase-all with an inline confirm. No new route and
  no separate inbox screen.
- **Acceptance evidence is a hand-worked set in this file's tests.**
  `statements.test.ts` (20 tests) covers the cap/type/empty refusals, SHA-256 identity, period
  and hint detection, the 0.35 floor and tie refusal, the tolerance (1 cent matches, 2
  mismatches), the four `unavailable` reasons, coverage (covered/duplicate/ambiguous/
  mismatched/not_expected) and the no-period queue row. The adapter suite adds five tests:
  one store record per SHA-256, a full bundle restoring into a FRESH IndexedDB factory,
  erase clearing both stores, a v2 restore clearing documents, and a version-1 database
  upgrading in place. The web suite pins the v3 file parse and the card's rendering.

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

| ID    | Task                                                                                                                                                                                                                                                                                                                                                                                                     | Target                                                                 | Effort          |
| ----- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- | --------------- |
| WS4.1 | Cost-basis lot book: moving average, acquisition fee in basis, full-liquidation reset, transfer-in ⇒ whole position unknown, exact split restatement, nil on missing FX; reconcile against current `calculatePositionReturn`                                                                                                                                                                             | `packages/core/src/investing/costBasis.ts` or extend `positions.ts`    | S–M             |
| WS4.2 | Basis provenance: source priority (manual > calculated > provider), user lock, provider carry-forward, reconciler; expose "why is basis unknown" to UI                                                                                                                                                                                                                                                   | broker snapshot schema + positions builder                             | M               |
| WS4.3 | Realised gains + income report: disposal basis from the snapshot when trades are partial, exact-date FX, fee on proceeds, dividends/interest income, realised/unrealised grouped by tax treatment                                                                                                                                                                                                        | `investing/realized.ts`; dashboard/position detail; new report route   | M               |
| WS4.4 | Tax-treatment taxonomy: taxable / tax-deferred / tax-exempt / tax-advantaged plus EU wrapper labels (ISA, PEA, Pillar 3a, etc.); account metadata, no behaviour beyond grouping. LaVega has no account record — define a wrapper map keyed by `(broker, account)` in the broker snapshot (or a Neon table with RLS), with UI and unknown default                                                         | `investing/model.ts` snapshot metadata; store + UI                     | M               |
| WS4.5 | Security master: ISIN-first canonical identity, broker symbol aliases `(ticker, MIC)`, provider affinity ("assigned provider unavailable ⇒ skip, never silently replan"), provisional price flag with refetch window, listing start clamp; **thesis/symbol migration**: move ADR 0007's symbol-keyed theses to the canonical key, preserve conflicting confirmed theses for user review, update ADR 0007 | `investing/securities.ts`, price orchestrator; memory tables; ADR 0007 | M               |
| WS4.6 | Allocation ladder: cash bucket placement, unclassified as a real bucket, denominator floor `max(cash+holdings, holdings)`, parent-scoped drill-down                                                                                                                                                                                                                                                      | `investing/allocation.ts`                                              | M               |
| WS4.7 | Investment contribution classification: transfers into investment/crypto accounts count as contribution, not spending, and reconcile with personal net-worth sharing; internal investment→investment moves are funds movement. Depends on WS1.1 transfer pairs.                                                                                                                                          | `transfers.ts` kind + `personalNetWorth.ts`                            | S–M             |
| WS4.8 | Optional/conditional: persist daily holdings history via forward or reverse materializer when a broker reports only snapshots; only if WS4.3/report needs it                                                                                                                                                                                                                                             | `investing/holdingHistory.ts`                                          | L (conditional) |

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

**As built (WS4.1/WS4.2, [#295](https://github.com/Elmata2/LaVega/issues/295), 2026-11-11).**
The lot book and basis provenance landed in one slice; realised gains/income (#296),
security master (#297), contribution classification (#298), the tax-treatment taxonomy
(WS4.4) and the allocation ladder (WS4.6) stay out. Divergences from the plan text, each
deliberate:

- **The lot book is `packages/core/src/investing/costBasis.ts`, decimal, clock-free.**
  `replayCostBasis` ports Sure's `Holding::LotBook`: buys average, the acquisition fee is
  folded into the effective price (`price + fee / qty`), a sale relieves at the running
  average so the per-share figure does not move, a full liquidation resets the pool so a
  repurchase starts clean, and an oversell is capped. A transfer-in (`side: "other"` with a
  positive quantity) is a lot with an unknown cost and marks the **whole** position unknown;
  the mark releases only on a genuine downward crossing through zero. Splits restate
  quantities and per-share cost exactly while total cost stays. Missing FX is `null` with a
  typed reason, never a 1:1 conversion.
- **The builder's trades are already in current share units, so it does not pass splits
  again.** `splits.ts` restates trade units and chain-level quantities at the dashboard
  boundary before the basis is replayed; replaying them a second time would double the
  ratio. The split restatement of the book itself is ported, exercised by hand-calculated
  fixtures, and consumed by callers that replay raw trades (#296 will).
- **Returns math is untouched.** Provenance is additive metadata: the current trade replay
  in `calculatePositionReturn` remains the only source of returns, because "byte-identical
  dashboard returns for trade-only brokers" is the acceptance gate. A test asserts the lot
  book's total basis equals `remainingCostBasis` digit for digit on trade-only fixtures,
  and a golden captured from base commit `a27240c23` compares the whole returns and
  portfolio payload as a string.
- **Provenance is `Position.manualCostBasis` (integer cents + lock) plus a
  `CurrentPosition.basis` summary.** Source priority is manual > calculated > provider
  (Sure `Holding#COST_BASIS_SOURCE_PRIORITY`). A locked manual value always wins; an
  unlocked one is the user opting into recalculation, so calculated replaces it.
  `reconcileCostBasis` ports the reconciler rule including "provider zero means unknown"
  and "a transfer-in clears a stale calculated figure". `carryForwardCostBasis` runs inside
  the broker snapshot merge: a manual basis and its lock survive a provider replace, and a
  provider basis carries forward only when the row's quantity and currency did not move —
  an old total on a changed row would be a stale number, not a carry-forward.
- **Unknown is a typed reason, surfaced in the UI.** `no-history`, `transfer-in`,
  `missing-fx`, `missing-price`, `missing-fee`, `quantity-mismatch` and
  `provider-incomplete` travel to `investing-web`, which renders the cause instead of a bare
  "return unavailable". The amount stays `null` in every unknown case.
- **Still missing on purpose: the write path for a manual basis.** This slice persists,
  carries, reconciles and honours a manual value and its lock, but Lavega has no holdings
  edit surface yet, so nothing in the SPA sets one. That edit route is the remaining WS4.2
  work when the holdings/trade CRUD lands; the read side is ready for it.

**As built (WS4.3/WS4.4, [#296](https://github.com/Elmata2/LaVega/issues/296), 2026-11-11).**
Realised gains, income and the tax-treatment taxonomy landed in one slice. The
security master (#297), contribution classification (#298) and the allocation
ladder (WS4.6) stay out. Divergences from the plan text, each deliberate:

- **The report is `packages/core/src/investing/realized.ts`, and it reuses the
  lot book without forking it.** The disposal replay calls `costBasis.ts`'s
  exported primitives (`createLotBook`, `addPricedUnits`, `addUnknownUnits`,
  `applySell`, `averageCost`) and owns only the loop that records what each sale
  relieved. A buy whose exact-date FX rate is missing becomes unknown-cost units,
  exactly like a transfer-in, so a later disposal falls back to the broker
  snapshot instead of inventing a basis. An `other` outflow relieves like a sale
  but is not a disposal: an internal move has no realised gain (Sure
  `trade.rb:209-215`).
- **Disposal basis priority is calculated replay > broker snapshot.** When the
  trade history answers, the running average is the basis. When it cannot (a
  partial history, a transfer-in, a sale larger than the known pool), the latest
  snapshot row for the same `(entity, broker, account, symbol)` dated at or
  before the disposal supplies the unit cost: manual > broker cost > broker
  average price, converted at the disposal's own date. A user's manual basis is a
  current-holding assertion, so it is not applied to a historical disposal; that
  is why the disposal path does not use the full `selectCostBasis` priority.
- **Reconciliation compares the disposal's net proceeds to broker-reported cash
  where the broker reports it.** `Trade.settlement` is that cash. A difference
  beyond half a percent of proceeds is surfaced as a problem, the same tolerance
  the Trading 212 cash proof already uses for the broker's own FX. IBKR Flex
  carries no per-trade cash in LaVega's snapshot, so an IBKR disposal reads
  `broker-not-reported`; that is an absence of evidence, not a failed check. A
  missing rate reads `missing-fx` and the amount stays null, never 1:1.
- **Income is dividends plus interest cash-flow rows.** Both buckets convert at
  the entry's own date and group by kind + symbol + calendar month. The tie-out
  re-aggregates the interest rows straight from the `CashFlow` array and must
  equal the income section's interest total; there is no `COALESCE(rate, 1)`
  fallback (Sure's `InvestmentStatement::Totals` has one; this report does not).
  Both LaVega brokers book dividends outside the cash-flow array, so a dividend
  row ties to its dividend record and the cash history's own proof, not to a
  duplicate cash-flow row.
- **The taxonomy is metadata only.** `model.ts` defines the four treatments plus
  `unknown`, the EU/UK/US wrapper labels (ISA, LISA, SIPP, PEA, assurance-vie,
  Pillar 3a/3b, private pension, IRA, Roth IRA, 401(k), brokerage), the
  `(broker, account)` map and its validation. `wrapperTaxTreatment` maps a label
  to a bucket; nothing computes a tax amount. An unlabelled account resolves to
  `unknown`, never to `taxable`. Every report carries a fixed notice ("does not
  file taxes and this is not tax advice") and the copy makes no tax-filing claim.
- **The wrapper map lives in `investing.preferences`, not the broker snapshot.**
  Migration `0028_account_wrappers.sql` adds an `account_wrappers` JSONB array
  column to the existing per-tenant preferences row, which already has RLS keyed
  on `app.user_id`. The plan allowed "broker snapshot or a Neon table"; the
  snapshot is the encrypted vault, and writing a user preference there would
  couple a label edit to an unlocked vault. A file store backs the local and
  self-hosted run. An unknown label is dropped on read, like the layout's
  unknown ids.
- **The report rides the dashboard read model.** `buildInvestingDashboard`
  builds it from the same broker snapshot, FX rates and price bars the dashboard
  already reads, and `GET /api/investing/reports/realized` serves the section
  rather than loading the vault a second time. The field is optional in the
  schema so a dashboard stored before the report existed still decodes; the
  route answers such a snapshot with an empty report and a problem line. The
  trade-off: the dashboard payload grows with the disposal and income row count.
- **The UI is a fixed Reports tab, not a toggleable module.** Adding a module id
  would change every stored layout and the layout tests; reports are always
  available, like Profile. The report page groups by treatment, lists accounts
  with an account-type control (the only write), shows every disposal with its
  broker-cash check and every unknown-FX row as unknown with the reason, and
  lists income groups and the tie-out. Position detail links to it and shows the
  selected security's disposal count and realised gain.
- **Coverage.** `realized.test.ts` proves the reconciled disposal, the visible
  difference, the no-cash case, digit-for-digit agreement with
  `calculatePositionReturn`'s realised gain, the snapshot fallback for a partial
  history, missing FX as unknown (and not the 1:1 figure), income grouping and
  tie-out, unknown income FX, the taxonomy mapping, the unknown default and the
  dashboard/wire integration. Server tests prove the route, the wrapper store and
  the read wiring; the migration test proves the column.

**As built (WS4.5/WS4.6, [#297](https://github.com/Elmata2/LaVega/issues/297), 2026-11-11).**
The security master, the thesis-key migration and the allocation ladder landed in
one slice. Divergences from the plan text, each deliberate:

- **Identity is `packages/core/src/investing/securities.ts`, ISIN-first.**
  `instrumentKey` is `isin:<ISIN>` when the ISIN is well formed (ISO 6166 shape
  and check digit), else `sym:<TICKER>@<MIC>` with a canonicalised MIC, else
  `sym:<TICKER>`. `resolveSecurityIdentities` groups the broker snapshot's rows
  into one identity per ISIN, so the same ISIN from two brokers is one security
  and one thesis key; a symbol change with the same ISIN does not split history.
  Distinct share classes (distinct ISINs, one ticker) stay apart, and a ticker
  that points at two identities is reported in `ambiguousSymbols` and left out
  of the symbol map rather than silently folded into one. Sure has no ISIN
  column and treats one ticker on two venues as two securities; LaVega stores
  ISIN on positions and trades, so it can be stricter.
- **Price hardening is wired, not just declared.** `PriceCoverage` gains
  `provider`, `listingStart` and `provisionalThrough` (migration 0029; file
  store passes them through). `syncPrices` remembers the provider that earned
  the coverage and asks only that provider; when it is unavailable the symbol is
  skipped with a reason, never handed to another provider. A backfill is clamped
  to the listing start. A provisional close is re-fetched until its seven-day
  window closes. **Divergence:** the Yahoo seam returns completed daily closes,
  so no current provider emits a provisional row; the flag, window and refetch
  path are wired and tested with a stub provider, ready for an intraday or LOCF
  provider. Sure's LOCF gap-fill itself stays out (LaVega forward-fills at read
  time, see `valuation.ts`).
- **Thesis identity moves to the canonical key without ever merging a conflict.**
  Migration 0030 adds `instrument_key` (nullable) and `review_required` to
  `investing.theses`, plus a partial unique index on `(user_id, instrument_key)`
  where the row is not under review. `planThesisMigration` in core plans the
  move: theses of one instrument with an identical body and status fold into one
  row, conflicting confirmed theses keep every row and are flagged for review,
  and a thesis whose symbol the snapshot cannot place keeps a null key. The
  repository applies the plan (`applyThesisMigration`), `confirmThesis` accepts
  the canonical key and stores a second confirmed thesis for the same key under
  review instead of overwriting the first, and the turn summary matches a thesis
  by symbol OR key. The primary key stays `(user_id, symbol)` so the symbol
  remains the row's stable edit handle. The migration runs through
  `POST /api/memory/instruments/migrate`, whose identity source is the current
  broker snapshot (holdings and trades); the owner UI shows a "Needs review"
  badge. The agent memory read path is unchanged for a user with no cross-broker
  duplicates.
- **The allocation ladder is generic and the denominator rule travels with it.**
  `buildAllocationLadder` takes already-converted values, sums a labelled Cash
  bucket, folds blank/"unknown"/"unclassified" keys into one labelled
  Unclassified bucket, leaves unpriced rows without a weight, and computes
  `weight = value / max(cash + holdings, holdings)` with
  `ALLOCATION_DENOMINATOR_RULE` attached to every ladder. The dashboard carries
  `allocation.ladder` for instrument and entity (optional, so a stored payload
  still decodes) and the Allocation card renders a Ladder block with the cash
  row, the unclassified row and the rule. **Divergence:** LaVega has no
  asset-class/sub-class/region hierarchy, so the ladder's classification is the
  existing instrument/entity grouping and the parent scope is entity →
  instrument (`ladderDrillDown`); Sure's four classification dimensions are not
  ported.
- **No returns math moved.** No TWR/XIRR/risk fixture changed; the ladder and
  the identity fields are additive. The dev fixture gains a settled cash anchor
  and a legacy position with no entity, so the local run shows the Cash and
  Unclassified buckets.
- **Coverage.** `securities.test.ts` proves the ISIN check, two-broker identity,
  symbol-change continuity, share-class separation, ambiguous tickers, the
  thesis merge/review plan, provider affinity, the provisional window and the
  listing clamp. `allocation.test.ts` proves cash in the ladder, the negative-cash
  floor, the labelled unclassified bucket, unpriced rows and the drill-down.
  Price-sync tests prove affinity, clamp and the provisional refetch. Database
  tests prove the partial unique index, the review flag, the applied migration
  and summary matching by key; a server test proves the migration route.

**As built (WS4.7, [#298](https://github.com/Elmata2/LaVega/issues/298), 2026-11-11).**
Investment-contribution classification landed without a new matcher and without a new
storage shape. Divergences from the plan text, each deliberate:

- **The kind derivation already existed; this slice adds the consumers.** #282's
  `deriveTransferKind` returns `investment_contribution` for a pair whose destination is an
  investment account and `funds_movement` when both legs are investment accounts (Sure
  `transfer.rb:31-47`). #298 adds `isInvestmentAccount` (one rule for both legs),
  `isInvestmentContribution` (CONFIRMED pairs only — a suggestion must never move a total)
  and `summarizeConfirmedTransfers`, which sums confirmed pairs per kind in integer EUR
  cents. A pair in another currency is named in `unconvertedPairIds` and never converted
  1:1: a pair stores the decision day, not the movement day, so there is no honest rate
  date (ADR 0011).
- **Crypto is recognised by an explicit account type only.** LaVega's `ACCOUNT_TYPES` has
  five names and no crypto entry. An account whose owner-set/imported `type` spells crypto
  is investment scope; the name is deliberately not consulted, because a "Crypto" card is a
  card. Adding a real sixth account type would change the Rekeningen editor and every
  stored vault for one label, so that stays out.
- **Spending already excluded confirmed transfer legs; the slice keeps that predicate.**
  `applyTransferDecisions` projects both legs of a CONFIRMED pair into
  `Eigen overboeking`, which `MOVED_CATEGORIES` excludes. The contribution fixture asserts
  that the same two legs the kind derivation saw are the ones the spend surface drops, so
  contribution and spending cannot disagree. Investment → investment is excluded from
  spending for the same reason and from the contribution total because its kind is
  `funds_movement`.
- **The net-worth bridge counts each euro once by splitting the scopes.** The Personal
  share is bank money only: `personalShareAccounts` (in `investing/personalNetWorth.ts`)
  removes investment accounts, because the Investing portfolio series counts those. A
  confirmed contribution then lowers the Personal total and raises the portfolio value by
  the same cents, so `mergeInPersonalNetWorth`'s `netWorth` is unchanged. The rule is the
  same `isInvestmentAccount` the transfer classification uses, so the two sides cannot
  drift. **Divergence:** the shared total is therefore no longer identical to Overzicht's
  SaldoBlock when the owner has a `Beleggingsrekening`; DASHBOARD.md states the new
  contract. An investment account that the owner typed in Personal but never connected to
  Investing is outside the combined figure — a coverage limit of the two-ledger model, not
  a double count.
- **Coverage.** `transfers.test.ts` proves the contribution fixture (kind, spend exclusion,
  EUR cents), the investment → investment exclusion, confirmed-only counting, the non-EUR
  no-guess rule and the crypto spelling. `personalNetWorth.test.ts` proves the scope split
  and the unchanged combined net worth. `netWorthShare.test.ts` proves the bank-only
  shared total and the contribution bridge through the real `computeShareableTotalCents`.

### WS5 — Agent platform (both sides)

**Goal.** One tool contract, two surfaces; read-first external access; provenance the model
cannot fake; spend and loop guards.

**Sure sources.** `app/models/assistant/function/*` (55 files, 8,367 LOC),
`app/models/assistant/function_tool_caller.rb`, `responder.rb`, `history_trimmer.rb`,
`app/controllers/mcp_controller.rb`; `docs/llm-guides/wealth-agent-harness.md`,
`wealth-blueprint.md`; `record_valuation.rb` citation grammar.

**Tasks.**

| ID    | Task                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | Target                                                                                    | Effort           |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------- | ---------------- |
| WS5.1 | Tool registry: typed definitions `{name, description, schema, scope: read\|write, preview?, handler}`, one build function filtered per caller; descriptions carry data semantics (direction, pagination, unknown rules)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | `packages/core/src/agentTools.ts`; `apps/investing-server/src/tools/*`                    | M                |
| WS5.2 | Investing MCP endpoint (fast track, server-readable data only) + minimal tool-registry seed: JSON-RPC `initialize`/`tools/list`/`tools/call`, protocol negotiation, session id, `202` for notifications, JSON-RPC errors. **Mount it in `apps/server`**, not the bare investing server: that server has no auth and defaults to `LOCAL_TENANT_ID`. Extend `apiGuard` to accept a bearer MCP token and resolve token → tenant through a hashed token table (with an env/file fallback for no-DB installs); a token without a tenant match is 401, never local-tenant data. **Read-only tools first**, response row/byte caps, audit log. Start with the existing read models only: positions, portfolio value, trades, prices, fundamentals (consent-gated), sector exposure, risk summary, agent memory. Requires an MCP auth/mounting ADR in Phase 0. | `apps/server` route + `apiGuard.ts` + token store/migration; `docs/investing/MCP.md`; ADR | M                |
| WS5.3 | Wire investing chat tools through the registry (positions, price, portfolio value, fundamentals, sector, risk, trades, memory); remove duplicate inline definitions                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | `apps/investing-server/src/portfolioChat.ts`                                              | S–M              |
| WS5.4 | Write tools behind a separate write token + preview/dry-run pairs (`preview_rule`/`apply_rule` token TTL 30 min, dry-run on structural writes) only after WS5.2 proves read-only use                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | registry + routes                                                                         | M                |
| WS5.5 | Provenance: citation grammar `{source, grade: A\|B\|C, date, documentId?}` as structured fields (not prose); reject writes without citation where evidence is claimed; display in UI                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | `packages/core/src/provenance.ts`; valuations/invoices                                    | S–M              |
| WS5.6 | Tool-loop hardening: 8-round cap, forced text on last round, pair-safe history trim, partial turn → failed; cap tool output; error-as-data with one-retry hint, no internal details across boundary                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | `apps/server/src/agent/*`, investing chat                                                 | S                |
| WS5.7 | AI ops: per-operation usage rows including failed calls and cache tokens; capability probe (function calling, PDF extraction) with timeout; spend gate applied to MCP calls                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | `apps/server/src/agent/budget.ts`, `pricing.ts`; investing usage                          | S–M              |
| WS5.8 | Personal assistant path (design + thin slice): tools execute client-side against the vault; approval events on the timeline; adopt LaVega's assistant spec. No ledger to server. Depends on WS1–WS2 data and the approval model; can start as design while WS2 runs.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | `docs/superpowers/specs/2026-10-27-assistant-design.md` + `apps/web`                      | M (design first) |
| WS5.9 | Eval harness: fixture conversations with expected tool calls and values; run on model change; store results (Sure's eval dataset concept, not its Rails tables)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | `apps/*/test/agent-evals` or script                                                       | M                |

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

**As built (WS5.1/WS5.2, #285, 2026-11-11).** Shipped the registry seed and the
read-only `/mcp` mount in `apps/server`; docs in `docs/investing/MCP.md`.
Acceptance evidence is in `apps/server/src/mcp/*.test.ts`,
`apps/investing-server/src/tools/*.test.ts` and `packages/core/src/agentTools.test.ts`
(tools/list equals the filtered registry; a hidden write tool is refused by name
at dispatch; missing/wrong/tenantless token is 401; caps truncate and are marked;
tool errors are safe `{error, hint}` result data), plus the live curl run recorded
on the issue. Deliberate divergences and carried items:

- The registry is `packages/core/src/agentTools.ts`; the eight read tools live in
  `apps/investing-server/src/tools/investingTools.ts`. Three tenant-scoped read
  routes are new (`/api/investing/trades`, `/prices/:symbol`,
  `/fundamentals/:symbol`) because no existing route exposed the trade ledger, a
  single close or the consent-gated fundamentals brief. All other tools reuse the
  existing dashboard, sectors and memory routes, projected from the same context
  the in-app chat uses — no read-model copy in `apps/server`.
- A read-path allowlist in `apps/server/src/mcp/investingRead.ts` is a second
  write gate beyond the plan: even a bug that named a write path cannot forward
  it, because only GETs on the six read paths are admitted.
- Caps are fixed at 200 rows / 256 KiB for every tool (one shared row budget),
  not per-tool configurable yet. Per-token limit is in-process (60/min,
  `MCP_RATE_LIMIT_PER_MINUTE`), so a multi-instance deployment multiplies it;
  a shared Neon limiter is carried. Sessions are in memory (cold start = one
  re-initialize).
- Env fallback is `MCP_API_TOKEN` + `MCP_TENANT_ID` (`MCP_USER_EMAIL` accepted as
  the ADR's alias) and is disabled whenever `DATABASE_URL` is set, so it cannot
  bypass table revocation. Token creation is an operator CLI
  (`scripts/mcp-token.ts`), not an HTTP route: a settings UI is not in this issue.
- No OAuth discovery/registration endpoints (Sure has them); ADR 0012 chose an
  operator-issued hashed token instead. No write tools and no `write` scope exist
  yet — WS5.4 stays gated. WS5.3 (chat tools routed through the registry) is still
  open; the registry and the docs drift test are the seam for it.

**As built (WS5.3/WS5.4/WS5.6/WS5.7, [#299](https://github.com/Elmata2/LaVega/issues/299), 2026-11-11).**
The chat now reads the one registry, the write pair exists behind a separate
write token, the tool loop is capped and honest about failure, and the spend gate
covers every MCP call. Divergences from the plan text, each deliberate:

- **One definition set, two bindings.** `apps/investing-server/src/tools/
investingTools.ts` holds `INVESTING_TOOL_SPECS` (name, description, schema,
  scope, handler). `createInvestingTools(source)` binds them to an
  `InvestingToolSource`: `/mcp` supplies the HTTP read source, the chat supplies
  an in-process source (`tools/chatTools.ts`) over the context it already has.
  The chat's `get_positions`, `get_portfolio_value`, `get_price`,
  `get_fundamentals`, `get_sector_exposure`, `get_risk` and `get_trades` inline
  definitions are gone; `get_agent_memory` is now available to the chat too. The
  memory tools stay chat-only (owner-confirmed memory writes, not investing
  data) but are registry definitions with the same adapter, not inline tools.
  A test asserts the chat and MCP registries are the same names, descriptions,
  scopes and schemas.
- **The write pair is `preview_rule`/`apply_rule` over the account tax-treatment
  rule map.** The plan names the pair but not the rule; the one structural write
  this slice opens is the owner's own `(broker, account)` wrapper map from WS4.4,
  which is already persisted per tenant. `preview_rule` validates the entries
  with the same validator the API uses, reads the stored labels, returns the
  dry-run `changes` and a single-use `previewToken`; it changes nothing.
  `apply_rule` takes only the token, which is bound to the token identity and
  tenant, single-use and expires after **30 minutes** (`RULE_PREVIEW_TTL_MS`).
  The apply forwards one allowlisted PUT (`apps/server/src/mcp/investingWrite.ts`)
  and re-serialises the validated entries, so the caller's body is never
  forwarded. Preview tokens live in memory like sessions: a cold start
  invalidates them and the owner previews again.
- **Write is a separate credential.** The token table's `write` scope now has a
  real tool set, and the no-database fallback gains `MCP_WRITE_API_TOKEN`
  (read stays `MCP_API_TOKEN`; the read token is checked first, so one shared
  value yields read-only). `scripts/mcp-token.ts create --scopes write` issues a
  table token. A read token never lists or dispatches `preview_rule`/`apply_rule`
  — the same filtered array backs `tools/list` and dispatch. `apply_rule` is also
  `preview: true`, so a write caller must hold the write scope to see it.
- **The loop policy is pure and tested without a model.** `toolLoop.ts` caps the
  turn at **8 rounds**; the last round returns `{toolChoice: "none",
activeTools: []}`, so a provider that cached a tool schema cannot still emit a
  call, and appends the "answer in text now" instruction. History is trimmed in
  whole call/result pairs (`trimToolHistory`), and a turn that ends with no text,
  errors or is aborted is classified failed (`toolLoopTurnStatus`). The chat
  route persists a failed turn as an assistant message with
  `metadata.failed: true` (and keeps usable text, marked failed, when a provider
  errors after producing it) instead of an empty completed answer.
- **Caps and safe errors are one adapter, not per-tool code.** `toAiSdkTools`
  wraps every registry definition with `capAgentToolResult` (200 rows / 256 KiB,
  truncation marked) and the shared `safeAgentToolError` (`{error, hint}`, one
  retry, no exception text). `/mcp` uses the same two helpers, so the surfaces
  cannot answer differently for the same failure.
- **The spend gate is a peek before every MCP call.** `checkBudget(undefined,
tenantId)` runs in `tools/call` before dispatch; an over-cap call returns safe
  `budget_exhausted` data and executes nothing, and an unreadable gate fails
  closed as `budget_unavailable`. MCP calls buy no model tokens, but the same
  per-account cap bounds the endpoint. Per-operation usage rows are the existing
  `investing.mcp_audit` rows (method, tool, outcome `ok|refused|error`, duration);
  cache-token columns in `ai_usage` and usage rows for the investing chat's own
  model calls are carried, because no acceptance item needs them and the chat's
  provider usage is not exposed at this boundary yet.
- **Docs are generated from the registry.** `docs/investing/MCP.md`'s tool table
  now includes the write tools and their scopes, and
  `apps/investing-server/src/tools/docs.test.ts` fails if a documented name or
  scope drifts from the registry. The write-token rules, preview/apply semantics
  and spend gate are documented there.

**As built (WS5.5/WS5.7/WS5.9, [#300](https://github.com/Elmata2/LaVega/issues/300), 2026-11-11).**
Structured provenance, the AI-ops ledger leftovers and the offline eval harness.
Acceptance evidence is in `packages/core/src/provenance.test.ts`,
`apps/investing-server/src/tools/writeTools.test.ts`,
`apps/server/src/mcp/investingWrite.test.ts`, `apps/server/src/net-worth-routes.test.ts`,
`apps/investing-web/src/components/NetWorthPage.test.tsx`,
`packages/database/src/aiUsageOps.test.ts`, `apps/server/src/agent/pricing.test.ts`,
`apps/server/src/agent/mistral.test.ts`, `apps/server/src/agent-routes.failed-usage.test.ts`
and `apps/investing-server/src/evals/harness.test.ts`, plus the live run recorded on
the issue. Deliberate divergences and carried items:

- **Structured, not prose — and grade required.** `packages/core/src/provenance.ts`
  takes `{source, grade: A|B|C, date, documentId?, estimated?}` as typed fields,
  refuses unknown keys (a free-text `note` is how Sure's citation leaks back into
  prose) and rejects `(grade: D)`, an impossible date, a blank source and a
  capital-`E` `Estimated:`. Sure's prose grammar is parsed only at the import seam
  (`parseProvenanceCitationText`) and rendered only for display. Sure makes the
  grade optional unless `estimated:`; this requires it always.
- **The valuation write is the shared net-worth total.** LaVega has no
  account-level owner-entered valuation model yet, so the Sure `record_valuation`
  analogue writes the one persisted valuation the server has: the opted-in
  Personal total (`personal.net_worth_totals`), as EUR integer cents (ADR 0011).
  It is an MCP write tool (`record_valuation`, write scope, no preview pair
  because it is an upsert by date) and refuses a missing/malformed citation, a
  future date, a non-integer amount or a non-EUR currency BEFORE writing. The
  browser share route accepts the same optional provenance (malformed refused,
  never stored as prose); migration 0031 adds the nullable `provenance` JSONB,
  because pre-existing browser rows cite nothing.
- **Display.** The investing net worth page shows a source line built from the
  structured fields ("Personal total source: … · grade A · date · documentId")
  when the newest shared total carries a citation; no citation, no line. There is
  no separate provenance UI for invoices: invoices are client-side vault data and
  no server write path touches them.
- **AI ops ledger.** Migration 0031 adds `cache_write_tokens`, `cache_read_tokens`,
  `outcome`, `error_code` and `http_status` to `personal.ai_usage`. Provider
  usage parses the cache fields Mistral has reported; a failed provider call now
  becomes a FAILED row with the route's machine code and upstream status instead
  of deleting its reservation. The provider call sites still charge a failed call
  at its ceiling (an unrecorded spend would let a cap read "under" forever), so a
  row that was already charged KEEPS its charge and gains only the failure
  reason; an uncharged failure is stored at cost 0. Rows the browser's own
  routes never reached stay absent (bad input is not a model call).
- **Cache pricing is deliberately pessimistic and unpublished.** Mistral does not
  publish cache multipliers, so cache-read tokens are billed at the full input
  rate on top of the input tokens and cache-write tokens at +25%: overstate,
  never understate. Correct downward against a real invoice. Sure's Anthropic
  0.1x/1.25x is not copied, because the provider differs.
- **Eval harness, offline.** `apps/investing-server/src/evals/` holds three
  fixture conversations that drive the real registry with a scripted model and
  fixed data, validate the arguments against the published schema, assert the
  returned values and build the answer from them; `pnpm agent:evals` runs them
  and the contract check. `contract.json` pins every tool's name, scope,
  description and schema digest, so a tool/prompt change fails the run until it
  is reviewed and `--update-contract` regenerated; `--mutate` is the self-check
  that a deliberate tool rename fails loudly. A live-model run (real provider
  responses instead of the scripted model) is carried: CI has no key, and the
  regression this must catch is the tool contract, not the model's wording.

### WS6 — Interop, attribution, hardening

**Goal.** Leave the product portable, attributable and measurable.

| ID    | Task                                                                                                                                                                                                      | Target                                        | Effort |
| ----- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------- | ------ |
| WS6.1 | LaVega export: versioned ZIP/NDJSON + CSV using the Sure record vocabulary where it fits; manifest states binary inclusion; readback verification                                                         | `packages/core/src/interop/export.ts`; CLI/UI | M      |
| WS6.2 | Attribution pass: module headers, `NOTICE`, provenance table in this plan, `docs/research/sure/README.md`                                                                                                 | repo-wide                                     | S      |
| WS6.3 | Reference script + pin: `scripts/fetch-sure-reference.sh` (commit `562fe09`, shallow, outside tracked tree)                                                                                               | `scripts/`                                    | S      |
| WS6.4 | Metric review and cleanup: forecast error, transfer coverage, uncategorized share, statement coverage, realised-gain reconciliation, MCP usage; remove dead experiments, update `CONTEXT.md`/`BACKLOG.md` | docs + code                                   | S–M    |
| WS6.5 | Optional decisions recorded: personal MCP/API boundary, family sharing, budget product shape, whether to run a local Sure reference deployment                                                            | ADRs                                          | S      |

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

| Phase       | Content                                                                                                     | Effort (agent-days)               | Ship evidence                                                                            |
| ----------- | ----------------------------------------------------------------------------------------------------------- | --------------------------------- | ---------------------------------------------------------------------------------------- |
| 0           | Decisions, conventions, attribution scaffolding, reference pin, ADRs 0010/0011/0012, scrub rules, baselines | 2–4                               | ADRs merged; `NOTICE`; reference script; baseline numbers stored; scrub rules            |
| 1           | WS1 (12–29) + WS5.1 seed + WS5.2 MCP (2–5 + M)                                                              | 14–34                             | Transfers confirmed on real vault; rules dry-run; alerts; agents query portfolio via MCP |
| 2           | [#282](https://github.com/Elmata2/LaVega/issues/282)                                                        | WS2 (23–60; split in two halves)  | 23–60                                                                                    | Bills calendar, payment matching, paycheck plan, budget carry, forecast error vs baseline |
| 3 core      | WS3.1–3.3                                                                                                   | 6–20                              | Net worth with liabilities; balance sheet + income statement                             |
| 3 extension | WS3.4–3.6                                                                                                   | 9–25                              | Document vault with backup/restore; statement pipeline; generic import session           |
| 4           | [#284](https://github.com/Elmata2/LaVega/issues/284)                                                        | WS4.1–4.7 (11–31; +5–10 if WS4.8) | 11–31                                                                                    | Realised/income report; basis provenance; ISIN identity; allocation cash                  |
| 5 core      | WS5.1–5.7                                                                                                   | 10–31                             | Registry + MCP hardened; provenance enforced                                             |
| 5 extension | WS5.8–5.9                                                                                                   | 4–10                              | Personal assistant thin slice; eval harness                                              |
| 6           | [#286](https://github.com/Elmata2/LaVega/issues/286)                                                        | WS6                               | 3–8                                                                                      | Export round-trip; headers/`NOTICE`; metrics reviewed                                     |

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

| #   | Risk                                                     | Severity | Mitigation                                                                                 | Gate               |
| --- | -------------------------------------------------------- | -------- | ------------------------------------------------------------------------------------------ | ------------------ |
| R1  | Sign inversion corrupts totals                           | High     | explicit direction; property tests; reconcile against real vault data                      | WS1/WS2/WS3 review |
| R2  | SQL→JS behaviour drift                                   | High     | port Sure edge tests as fixtures; golden data on real vault                                | each phase         |
| R3  | Duplicate detector/logic (forecast vs bills)             | Medium   | one detector; bills claim its output; adapter boundary                                     | WS2 review         |
| R4  | Performance on real vault (rules O(n·r), matching O(n²)) | Medium   | date/account indexes, early rejects, measure before UI path                                | WS1/WS2 bench      |
| R5  | Encrypted-vault feature creep to server                  | High     | ADR 0009; personal tools client-side; investing-only MCP                                   | WS5 review         |
| R6  | Document bytes vs browser quota                          | Medium   | separate object store; per-file cap; explicit failure; backup bundle includes it           | WS3                |
| R7  | Investment return regression                             | High     | byte-identical dashboard fixture for trade-only brokers                                    | WS4 gate           |
| R8  | Licence/trademark mistake                                | Medium   | headers with change date, NOTICE in Phase 0, independent-reimplementation policy, no marks | Phase 0            |
| R9  | Sure fork drift                                          | Medium   | pinned commit; re-verify at phase start                                                    | Phase 0 policy     |
| R10 | Effort underestimate                                     | Medium   | phase ranges, extension bundles, stop after each acceptance                                | owner review       |
| R11 | Account merge orphans transfer/bill/document links       | High     | reconcile or drop with report on merge/delete; fixture per record type                     | WS1/WS3 gate       |
| R12 | MCP endpoint serves local tenant or 401s                 | High     | mount in `apps/server`; token→tenant lookup; 401 without match; ADR 0012                   | WS5 gate           |
| R13 | Backup restore loses documents                           | High     | versioned bundle includes document store; restore-first test                               | WS3 gate           |

**Program metrics** (capture the Phase 0 baseline before WS2; record after in WS6.4).
Store only aggregate counts, percentages and rates. Real amounts, names, IBANs and
transaction text stay out of the repo (scrub rules: §2.6); local detail and the
aggregate file live under `.lavega/baselines/`, which is gitignored.

| Metric                       | Definition                                                                                                                                                                                                           | Phase 0 source                                                    |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| Forecast error 30/60/90      | Median absolute percentage error of the forecast's predicted balance against the realised balance, per horizon (30, 60, 90 days), over the last 3 complete months (`packages/core/src/forecast.ts`, forecast screen) | Owner records the forecast now, compares at +30/+60/+90 days      |
| Internal-transfer match rate | Confirmed transfer pairs ÷ (confirmed + rejected + still-suggested pairs after 30 days) on the Transfers screen                                                                                                      | Owner counts from the screen over the last 3 months               |
| Uncategorized share          | Transactions with no category ÷ all transactions in the last 3 complete months (Transacties, "geen categorie" filter)                                                                                                | Owner counts from the filter                                      |
| Statement coverage           | Months with at least one statement/imported document ÷ months since the first account opened                                                                                                                         | Pending documents feature (WS3.4); record `pending`, do not guess |
| Realised-gain reconciliation | Realised gains + income from the report − the broker's own realised/cash movement; `unknown` when the broker does not report it (never 0 by default)                                                                 | Investing report vs broker statement for the last closed year     |
| MCP usage                    | Tool calls per week and tool error rate (`investing.mcp_audit` / stdout audit lines)                                                                                                                                 | Server audit, `ok                                                 | refused | error` counts |
| AI spend                     | EUR cents per operation and per account per month (`personal.ai_usage`)                                                                                                                                              | `/api/agent/budget` + ledger rows                                 |
| Time to close a month        | Wall-clock minutes from starting the month-close routine to the point the owner trusts the numbers                                                                                                                   | Owner times one close with a stopwatch                            |

**Phase 0 baseline runbook (owner, about one hour):**

1. Open the app on the owner's own machine with the real vault unlocked; do not
   share the screen or export plaintext.
2. For each row above that can be read from a screen today, note the aggregate
   only (rate, percentage, median, minutes) — never a transaction, amount, name
   or IBAN. Rows whose feature has not shipped (statement coverage) are recorded
   as `pending` with the reason.
3. Write the aggregates to `.lavega/baselines/phase0.json` (gitignored) as
   `{metric, value, unit, asOf, method}`, and paste only those aggregate values
   into §9 when they are ready.
4. Forecast error has no instant value: record the forecast at t0, then append the
   comparison at +30, +60 and +90 days. Until then it is `pending`.
5. The owner approves the completed baseline before Phase 1 is declared done.

## 9. Decisions recorded (owner, 2026-11-10)

| #   | Decision                                             | Answer                                                                                                                                                                             |
| --- | ---------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Personal app shipping                                | **Ship now.** Build WS1–WS3 for owner use first, then public; launch gates per phase.                                                                                              |
| 2   | Old Maybe/Sure historical data                       | **None.** Owner confirmed 2026-11-10: no live instance and no export. Old-history migration is out of scope; no importer is scheduled. Generic import (WS3.6) stays for new files. |
| 3   | [#283](https://github.com/Elmata2/LaVega/issues/283) | Personal server-readable data                                                                                                                                                      | **Keep the ADR 0009 boundary.** No server code decrypts the vault; personal agent/MCP work stays client-side or deferred. Investing MCP ships first.                     |
| 4   | Budget shape                                         | **Envelope with carry-over**, current category limits become defaults.                                                                                                             |
| 5   | [#285](https://github.com/Elmata2/LaVega/issues/285) | Investing priority                                                                                                                                                                 | **Depth** (basis, realised/income, tax treatment, security master). No aggregator breadth.                                                                               |
| 6   | Rules scope                                          | **Evaluator + common actions now**; splits/email/advanced actions deferred.                                                                                                        |
| 7   | [#287](https://github.com/Elmata2/LaVega/issues/287) | Issue filing                                                                                                                                                                       | **Yes.** Phase issues filed in `Elmata2/lavega`; see the issue table in §11.                                                                                             |
| 8   | [#288](https://github.com/Elmata2/LaVega/issues/288) | MCP auth/mounting                                                                                                                                                                  | **Approve the Phase 0 design**: `/mcp` in `apps/server`, bearer token → tenant via hashed token table, read-only first, separate write token later. ADR 0012 records it. |

Remaining owner input: approve the Phase 0 artifacts before Phase 1 starts; the metric
baselines need the personal app running on the owner's data (runbook §8, scrub rules §2.6).
Baseline values are `pending` until the owner runs that procedure — not zero, not estimated.

**Phase 0 audit (#303, 2026-11-11).** ADR 0011 and ADR 0012 are Accepted; `NOTICE` carries
the project, pinned commit `562fe09`, AGPL-3.0, reuse scope, non-affiliation and the source
offer; `scripts/fetch-sure-reference.sh` was run from a clean checkout and pins
`562fe096d149cb4d1fb1e6d3446527572c1ec7f6` with a one-commit shallow fetch, outside the
tracked tree and never imported by build/test; the export scrub rules are recorded in §2.6
with explicit gitignore paths; every landed derived module carries the attribution header and
Appendix A matches the files that exist. **Only the metric baselines remain owner-blocked** — an
agent cannot read the encrypted local vault (ADR 0009) and must not invent numbers.

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

| Sure asset                                                                                     | Why deferred                                                                                                                                                    | Revisit when                                  |
| ---------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------- |
| Goals with linked accounts, pledges, earmarks, months-of-expenses target (`goal*`, ~1,600 LOC) | LaVega already has a richer personal goal model (`plan/goals.ts`) and investing memory goals; Sure's earmark mechanics need the new asset/liability model first | after WS3.1/3.3 ships                         |
| Merchant registry as a first-class table with enrichment provenance                            | WS1.5 ships the minimal canonical key + aliases; full registry/enrichment is a separate product decision                                                        | if rules/reports need merchant-level identity |
| XIRR multi-root detection and error taxonomy from `portfolio/xirr.rb`                          | LaVega's solver returns null on ambiguity; Sure's is a reference only. Compare after WS4 income report, not now                                                 | WS4 review                                    |
| Loan amortization/projection (`loan*`, ~2,000 LOC)                                             | No loan accounts in the vault yet; WS3.1 adds the kind, not the engine                                                                                          | when a real loan is tracked                   |
| Family/household sharing, invitations, roles                                                   | Needs a key-ownership ADR; conflicts with one-key-per-account                                                                                                   | separate ADR                                  |
| SnapTrade/Plaid/SimpleFIN/aggregator providers, 30-connector breadth                           | Conflicts with local-first credential custody; LaVega has three first-party brokers                                                                             | never for local tier                          |
| PDF statement extraction via a model/provider                                                  | The document vault ships first; parsing stays deterministic (`pdfText`) until the vault has real files                                                          | WS3.4 follow-up                               |
| Sankey cash-flow graph and cached report tables                                                | Presentation, not truth; LaVega's dashboard already has the required views                                                                                      | only if a visual report is requested          |

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

| #   | GitHub                                                                                    | Issue                                                                                   | Phase                             | Depends |
| --- | ----------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- | --------------------------------- | ------- |
| 1   | [#303](https://github.com/Elmata2/LaVega/issues/303)                                      | Phase 0: ADRs 0010/0011/0012, NOTICE, reference script, scrub rules, metric baselines   | 0                                 | —       |
| 2   | Transfers: pair model, matcher, storage, merge/delete reconciliation, UI, spend exclusion | 1                                                                                       | 1                                 |
| 3   | Rules evaluator v2 (conditions/actions, locks, dry-run) + editor                          | 1                                                                                       | 1                                 |
| 4   | Label normalizer + merchant registry + transaction states + missing insight alerts        | 1                                                                                       | 2, 3                              |
| 5   | Investing read-only MCP (auth/tenant) + tool registry seed                                | 1                                                                                       | 1                                 |
| 6   | Bills model + schedule engine + occurrences + upcoming UI                                 | 2                                                                                       | 1; can start in parallel with 2/3 |
| 7   | Bill payment matcher + allocations + price changes                                        | 2                                                                                       | 2, 4, 6                           |
| 8   | Paycheck planner + Betaalschema integration                                               | 2                                                                                       | 6, 7                              |
| 9   | [#289](https://github.com/Elmata2/LaVega/issues/289)                                      | Budget envelopes + category groups + carry rollover + plan integration                  | 2                                 | 3, 4    |
| 10  | [#290](https://github.com/Elmata2/LaVega/issues/290)                                      | Forecast integration + error measurement vs Phase 0 baseline                            | 2                                 | 6, 7, 9 |
| 11  | [#291](https://github.com/Elmata2/LaVega/issues/291)                                      | Account kinds + valuations + balance series                                             | 3                                 | 4       |
| 12  | [#292](https://github.com/Elmata2/LaVega/issues/292)                                      | Balance sheet + income statement (reuse existing plan modules)                          | 3                                 | 11      |
| 13  | [#293](https://github.com/Elmata2/LaVega/issues/293)                                      | Encrypted document vault + statement pipeline + backup bundle                           | 3                                 | 11      |
| 14  | [#294](https://github.com/Elmata2/LaVega/issues/294)                                      | Generic import session (single-format rule)                                             | 3                                 | 4       |
| 15  | [#295](https://github.com/Elmata2/LaVega/issues/295)                                      | Cost-basis lot book + provenance/locks                                                  | 4                                 | 1       |
| 16  | [#296](https://github.com/Elmata2/LaVega/issues/296)                                      | Realised-gain + income report + tax treatment metadata                                  | 4                                 | 15      |
| 17  | [#297](https://github.com/Elmata2/LaVega/issues/297)                                      | Security master (ISIN-first) + thesis migration + provider affinity + allocation ladder | 4                                 | 1       |
| 18  | [#298](https://github.com/Elmata2/LaVega/issues/298)                                      | Investment contribution classification                                                  | 4                                 | 2, 17   |
| 19  | [#299](https://github.com/Elmata2/LaVega/issues/299)                                      | Full tool registry + MCP hardening + write tokens                                       | 5                                 | 5, 17   |
| 20  | [#300](https://github.com/Elmata2/LaVega/issues/300)                                      | Provenance grammar/fields + AI ops ledger + eval harness                                | 5                                 | 19      |
| 21  | [#301](https://github.com/Elmata2/LaVega/issues/301)                                      | Personal assistant thin slice (client-side/approval)                                    | 5                                 | 4, 6, 9 |
| 22  | [#302](https://github.com/Elmata2/LaVega/issues/302)                                      | LaVega export + attribution pass + metric review                                        | 6                                 | all     |

Labels and triage roles follow `docs/agents/` when filed; do not invent a parallel tracker.

## Appendix A — Port provenance ledger

Fill one row per ported module when it lands. Keep this table current; it is the attribution
record and the review checklist. The `NOTICE` entry lands in Phase 0, before the first module
ships. Every header carries the upstream commit, the AGPL-3.0 notice, the words "independently
reimplemented for LaVega", and the change date.

| LaVega module                                                                                    | Sure source (path)                                                                                                          | Commit  | Licence  | Change summary                                                                                                                 | Phase |
| ------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------- | ------- | -------- | ------------------------------------------------------------------------------------------------------------------------------ | ----- |
| `packages/core/src/transfers.ts`                                                                 | `app/models/family/auto_transfer_matchable.rb`, `transfer.rb`, `transaction/transferable.rb`, `rejected_transfer.rb`        | 562fe09 | AGPL-3.0 | independently reimplemented; pure TS, direction explicit, no SQL; changed 2026-11-10                                           | 1     |
| `packages/core/src/rules/{model,evaluate,compile,parse,dryrun,index}.ts`                         | `app/models/rule.rb`, `rule/**`                                                                                             | 562fe09 | AGPL-3.0 | independently reimplemented; evaluator first, no email/split actions; changed 2026-11-10                                       | 1     |
| `packages/core/src/labels.ts`                                                                    | `transaction/label_normalizer*`                                                                                             | 562fe09 | AGPL-3.0 | trimmed NL/DE/EN packs; changed 2026-11-10                                                                                     | 1     |
| `packages/core/src/alerts.ts`                                                                    | `app/models/insight/generators/*`                                                                                           | 562fe09 | AGPL-3.0 | insights section only: the three formulas LaVega lacked; changed 2026-11-10                                                    | 1     |
| `packages/core/src/bills/{model,schedule,occurrences,match,allocate,paycheck,forecast,index}.ts` | `recurring_transaction*`, `recurring_occurrence.rb`, `recurring_allocation.rb`, `recurring_transaction/paycheck_planner.rb` | 562fe09 | AGPL-3.0 | independently reimplemented date/occurrence engine, matcher/allocation and paycheck plan (#286/#287/#288); changed 2026-11-11  | 2     |
| `packages/core/src/budget.ts`                                                                    | `budget.rb`, `budget_category.rb`, `budget/rollover_calculator.rb`, `period.rb`                                             | 562fe09 | AGPL-3.0 | envelope math, no UI/share chain; changed 2026-11-11                                                                           | 2     |
| `packages/core/src/balanceSeries.ts`                                                             | `balance/{base,forward,reverse}_calculator.rb`, `balance/materializer.rb`                                                   | 562fe09 | AGPL-3.0 | independently reimplemented over vault arrays: forward/reverse replay, hard resets, gaps, net worth (#291); changed 2026-11-11 | 3     |
| `packages/core/src/balance.ts`                                                                   | `app/models/account.rb`, `account/**` (classification, balance types, valuation anchors)                                    | 562fe09 | AGPL-3.0 | asset/liability kinds, classification, dated absolute valuations; no amortization/sync; changed 2026-11-11                     | 3     |
| `packages/core/src/reports.ts`                                                                   | `income_statement*`, `balance_sheet*`, `period.rb`                                                                          | 562fe09 | AGPL-3.0 | subset: balance sheet, income statement, spending-vs-normal; changed 2026-11-11                                                | 3     |
| `packages/core/src/investing/allocation.ts`                                                      | `app/models/investment_statement.rb:82-124`                                                                                 | 562fe09 | AGPL-3.0 | allocation ladder over vault arrays; changed 2026-11-11                                                                        | 4     |
| `packages/core/src/investing/costBasis.ts`                                                       | `holding/lot_book.rb`, `holding/forward_calculator.rb`                                                                      | 562fe09 | AGPL-3.0 | moving-average lot book; changed 2026-11-11                                                                                    | 4     |
| `packages/core/src/investing/realized.ts`                                                        | `trade.rb:159-267`, `investment_statement/totals.rb`                                                                        | 562fe09 | AGPL-3.0 | realised + income report; changed 2026-11-11                                                                                   | 4     |
| `packages/core/src/investing/securities.ts`                                                      | `security.rb`, `security/price/importer.rb`                                                                                 | 562fe09 | AGPL-3.0 | ISIN-first canonical identity; changed 2026-11-11                                                                              | 4     |
| `packages/core/src/agentTools.ts`                                                                | `assistant/function/*`, `assistant.rb`, `function_tool_caller.rb`                                                           | 562fe09 | AGPL-3.0 | typed registry, read-first scopes; changed 2026-11-11                                                                          | 5     |
| `packages/core/src/provenance.ts`                                                                | `assistant/function/record_valuation.rb`, `Provenance::Citation.parse!`                                                     | 562fe09 | AGPL-3.0 | structured citation grammar; changed 2026-11-11                                                                                | 5     |
| `apps/investing-server/src/tools/{investingTools,chatTools,writeTools}.ts`                       | `assistant/function/*`, `function_tool_caller.rb`                                                                           | 562fe09 | AGPL-3.0 | one definition set bound to chat and `/mcp`; changed 2026-11-11                                                                | 5     |
| `apps/investing-server/src/toolLoop.ts`                                                          | `assistant/responder.rb`, `assistant/history_trimmer.rb`                                                                    | 562fe09 | AGPL-3.0 | round cap, forced text, pair-safe trim, failed-turn status; changed 2026-11-11                                                 | 5     |
| `apps/investing-server/src/evals/harness.ts`                                                     | `llm-evals.yml`, eval dataset concept (`docs/research/sure/02-platform-ai.md` §1.7)                                         | 562fe09 | AGPL-3.0 | offline fixture harness + reviewed contract snapshot; changed 2026-11-11                                                       | 5     |
| `apps/server/src/mcp/{routes,protocol,sessions,tokens}.ts`                                       | `app/controllers/mcp_controller.rb`                                                                                         | 562fe09 | AGPL-3.0 | JSON-RPC transport, sessions, bearer token → tenant, stricter auth; changed 2026-11-11                                         | 5     |
| `packages/database/src/mcpTokens.ts`                                                             | `app/controllers/mcp_controller.rb`, `app/models/llm_usage.rb`                                                              | 562fe09 | AGPL-3.0 | hashed token table + audit row; failed-call and cache columns; changed 2026-11-11                                              | 5     |

Rows are added when a module lands, not when it is planned. Three earlier rows
were removed because their modules have not landed and the ledger must not read as
attribution of shipped code: `packages/core/src/statements/*` (#293, in flight),
`packages/core/src/csvImport.ts` (#294) and `packages/core/src/interop/export.ts`
(WS6.1). Add them back when the file exists; verify existence before citing a row.

If text from the MIT-licensed `docs/llm-guides/wealth-blueprint.md` is adapted, add a separate
row and notice: "Blueprint text © 2026 diegomarino, MIT" (do not fold MIT text into the AGPL
notice; MIT requires its own notice).

## Appendix B — Where to read what

| Need                                           | File                                                                      |
| ---------------------------------------------- | ------------------------------------------------------------------------- |
| Raw Sure core-domain detail and citations      | `docs/research/sure/00-core-domain.md`                                    |
| Raw Sure investing detail and formulas         | `docs/research/sure/01-investing.md`                                      |
| Raw Sure agent/API/import/ops detail           | `docs/research/sure/02-platform-ai.md`                                    |
| LaVega current state, capability matrix, seams | `docs/research/sure/03-lavega-state.md`                                   |
| Consolidated teardown and verdict              | `docs/research/2026-11-10-sure-teardown.md`                               |
| Decision record                                | `docs/adr/0010-sure-as-port-source-not-runtime.md`                        |
| Money/direction convention                     | `docs/adr/0011-money-direction-and-integer-cents.md` (created in Phase 0) |
| MCP mount/auth/tenant                          | `docs/adr/0012-mcp-auth-and-tenant-resolution.md` (created in Phase 0)    |
| Sure source                                    | local clone at pinned commit `562fe09`; never imported                    |
