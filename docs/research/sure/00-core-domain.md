# Sure teardown — core finance domain

Source: shallow clone at `/tmp/sure`, HEAD `562fe096d149cb4d1fb1e6d3446527572c1ec7f6`
(2026-11-10, "Replace the cost-basis tracker with an in-memory lot book (#4495)").
Read-only inspection; no Rails/bundle/tests were run. Line citations are from that commit.
License: AGPL-3.0 (`/tmp/sure/LICENSE:1-8`). Provenance: community fork of the abandoned
Maybe Finance project (`README.md:26-30`), so every "Maybe" concept is inherited + extended.

Scale measured in the clone: 312 files under `app/models` (159,999 LOC), 209,555 LOC in
`app` + `lib`, 1,183 test files / 277,221 lines (Minitest per `AGENTS.md:13-16`).
Rails 8.1 + PostgreSQL + Redis + Sidekiq (`Gemfile:6,9,10,38`).
This note targets the personal side; investing is covered only where it touches the balance model.

---

## 0. TL;DR

| # | Candidate | Sure source LOC | TS effort | Verdict |
|---|---|---|---|---|
| 1 | Transfer model + auto/manual matching + confirm/reject | ~1,390 (`family/auto_transfer_matchable.rb`, `transfer*.rb`) | M | PORT — directly missing in LaVega |
| 2 | Rules engine: conditions, actions, ordering, claims, dry-run | ~3,190 (`rule*`) | L | PORT in phases (model+eval first) |
| 3 | Recurring schedule → occurrences → matcher → allocations ("Bills") | ~4,530 (`recurring_transaction*`) | L | PORT scheduler+occurrences first (M), matcher second |
| 4 | Balance materialization (anchors, forward/reverse daily balances) | ~1,450 (`balance/*`) | M | PORT — needed for any historical net-worth line |
| 5 | Budget envelope math + signed carry rollover | ~1,280 (`budget*`) | M | PORT math; keep UI concept only |
| 6 | Label normalizer (bank descriptor → merchant) | ~730 (`transaction/label_normalizer*`) | M | PORT — cheap win for dedupe/categorize |
| 7 | Income statement/netting/medians/spending-vs-normal | ~2,610 (`income_statement*`, `period.rb`) | M | PORT subset; skip Sankey/SQL |
| 8 | CSV import column mapping + date/number detection + preflight | ~1,500 (subset of `import*`) | M | ADOPT concept + port mapping/preflight |
| 9 | Goals + pledges + runway/projection | ~1,930 (`goal*`) | M-L | ADOPT concept; port formulas only |
| 10 | Loan amortization/projection engine | ~2,010 (`loan*`) | M | SKIP v1 (no loans in LaVega vault yet) |
| 11 | Insights generators (8) | ~810 (`insight*`) | S-M | ADOPT formulas, not the AI body writer |
| 12 | FX (Money class, ExchangeRate nearest-rate cache) | ~880 | S | ADOPT concept; LaVega `fx.ts` covers most |
| 13 | Provider sync architecture / 28 provider adapters / PDF vault / AI assistant | huge | — | SKIP |

Highest-value first port: **transfer matching** (self-contained, pure SQL → pure TS, immediately
fixes LaVega's "Eigen overboeking" blind spot) then **rules engine** and **recurring occurrences**.

---

## 1. Architecture and conventions

- Monolith: business logic in models + POROs (`app/models/**`), thin controllers
  (`AGENTS.md:7`). Query objects live beside models (`app/models/income_statement/*`,
  `app/models/balance/*`). Background work is ActiveJob on Sidekiq (`app/jobs/`, `Gemfile:38`).
- Tenancy is `Family` (household / multi-entity container) with `User` members and per-account
  sharing. All queries are family-scoped through `Current.family` / `Current.user` (`AGENTS.md:9`; `app/models/current.rb`).
- Every money-bearing row is `BigDecimal` `decimal(19,4)` except share quantities
  `decimal(34,18)`. Money is a hand-rolled `lib/money.rb` (no gem), with `exchange_to`, a `ConversionError`, and strict-currency mode in dev/test only
  (`lib/money.rb:1-120`, `config/initializers/money.rb:1-6`).
- Entry is a polymorphic envelope: `entries.entryable_type` ∈ {Transaction, Trade, Valuation}
  (`app/models/entry.rb:33`; `app/models/concerns/accountable.rb:4` for the account side).
- Long-lived invariants are enforced twice: DB check constraints + model validations (e.g.
  reconciled-at, exchange-rate positivity `db/schema.rb:844`, goal enums `db/schema.rb:1181-1185`).
- Comment style: intent/edge-case essays above dense code. This is the best part of the
  codebase for a port — most non-obvious decisions are documented inline (e.g.
  `family/auto_transfer_matchable.rb:1-23`, `recurring_transaction/matcher.rb:1-9`).

### Sign conventions (critical, opposite of LaVega)

Sure stores **outflow positive, inflow negative**:

- `Entry#classification`: `amount.negative? ? "income" : "expense"` (`app/models/entry.rb:325-327`).
- Rule type filter: `income` = `entries.amount < 0`, `expense` = `entries.amount >= 0` (`app/models/rule/condition_filter/transaction_type.rb:22-33`).
- Transfer validation: inflow `amount < 0` and outflow `amount > 0`, equal magnitude in the same currency (`app/models/transfer.rb:279-293`).
- Balance maths: on an asset, negative amount means value increased; on a liability, negative
  means debt decreased (`app/models/balance/base_calculator.rb:76-79`, `forward_calculator.rb:149-156`).
- LaVega is the opposite: `amount /* negative = outflow */` (`docs/CONTEXT.md` datamodel).

→ **Any port must flip sign at one boundary and nowhere else.** Suggest LaVega keeps its own
convention in `Tx` and the ported algebra takes a normalized `signedAmount` or explicit
`direction` field. Do not copy Sure formulas verbatim without flipping.

---

## 2. Data model (from `db/schema.rb`)

157 tables. Core tables and invariants:

### accounts (`db/schema.rb:99-139`)
- `accountable_type/id` delegated type: Depository, Investment, Crypto, Property, Vehicle,
  OtherAsset, CreditCard, Loan, OtherLiability (`concerns/accountable.rb:4`). `classification` is a
  stored generated column: liability for Loan/CreditCard/OtherLiability, else asset (`db/schema.rb:105`).
- `balance`/`cash_balance` are denormalized values written by balance materialization
  (`balance/materializer.rb:37-65`); `currency` per account. `family_id`, `owner_id`, status
  draft|active|disabled|pending_deletion, `exclude_from_reports`, `locked_attributes` jsonb,
  provider link columns. `manual?` = no provider links (`account.rb:714-718`).
- Balance component type: cash = Depository/CreditCard, non-cash = Property/Vehicle/OtherAsset/Loan/OtherLiability, investment = Investment/Crypto
  (`account.rb:905-918`).

### entries (`db/schema.rb:709-748`)
- One row per movement: `account_id`, `amount decimal(19,4)` non-null, `currency`, `date`, `name`,
  `notes`, `entryable_type/id`, `excluded`, `parent_entry_id` (splits), `external_id`+`source`
  (provider identity), `idempotency_key` (manual transfer double-submit guard), `import_locked`,
  `user_modified`, `locked_attributes`, `reconciled_at`.
- Unique `(account_id, source, external_id)` and `(account_id, idempotency_key)`
  (`db/schema.rb:735,737`). Split parent `excluded=true`; children carry amounts and must sum to
  the parent; parent cannot be un-excluded (`entry.rb:574-623,749-753`).
- `scheduled?` = date > today, excluded from balances/reports until then
  (`entry.rb:118-121,396-398`). Sync-overwrite precedence excluded > user_modified >
  import_locked (`:477-486`). Cleared = provider-acknowledged; reconciled = statement matched (`:400-434`).

### transactions and transfers (`db/schema.rb:2846-2880, 2247-2255`)
- Transaction is the cash-flow entryable: `category_id`, `merchant_id`, `transfer_id`, `kind`,
  `investment_activity_label`, `extra` jsonb (provider metadata, `exchange_rate`, merge records).
- `kind`: standard, funds_movement, cc_payment, loan_payment, one_time, investment_contribution
  (`transaction.rb:70-77`). `TRANSFER_KINDS = funds_movement, cc_payment, loan_payment,
  investment_contribution`; `BUDGET_EXCLUDED_KINDS = funds_movement, one_time, cc_payment`
  (loan and investment contributions ARE budgeted expenses); `UNCATEGORIZED_EXCLUDED_KINDS = funds_movement, cc_payment` (`:81-103`).
- Pending is derived from `extra[provider]["pending"]` by one canonical SQL predicate plus a Ruby
  twin, deliberately not a boolean cast (`transaction.rb:114-220`).
- `transfers`: pair join row `inflow_transaction_id`/`outflow_transaction_id` (unique each),
  `amount >= 0`, status pending|confirmed (`db/schema.rb:2867-2880`). `rejected_transfers` is the
  user's "not a transfer" memory keyed on the pair (`:2247-2255`).

### valuations and balances (`db/schema.rb:257-282, 3018-3023`)
- `Valuation` entryable kinds: reconciliation (resets balance that date), opening_anchor (seeds
  history), current_anchor (provider "balance now") (`valuation.rb:4-8`; `account/current_balance_manager.rb:1-40`).
- `balances`: one row per account/date/currency. Generated columns: `start_balance = start_cash + start_non_cash`;
  `end_cash_balance = start_cash + (cash_in - cash_out) * flows_factor + cash_adjustments`;
  `end_non_cash_balance = start_non_cash + (non_cash_in - non_cash_out) * flows_factor +
  net_market_flows + non_cash_adjustments`; `end_balance = end_cash + end_non_cash` (`db/schema.rb:267-275`). `flows_factor` = 1 asset / -1 liability
  (`balance/base_calculator.rb:76-79`).

### budgets, categories, merchants (`db/schema.rb:364-419, 1661-1677, 2727-2735`)
- `budgets`: family, optional user (personal vs household), period, currency, `budgeted_spending`, `expected_income`; `budget_categories`: allocation,
  `rollover_enabled`, materialized `rolled_over_amount >= 0`, frozen currency.
- Categories family-scoped, one nesting level (`parent_id`), `last_used_at`, color/icon; synthetic
  uncategorized/other-investments objects are read-time (`category.rb:243-289`). Tags:
  family name/color + polymorphic `taggings`. Merchants: STI FamilyMerchant|ProviderMerchant,
  unique per family/name resp. provider id/source+name (`merchant.rb:1-43`).

### recurring bills (`db/schema.rb:2055-2201`)
- `recurring_transactions` (series): amount, currency, strategy fixed|average|last,
  `amount_tolerance_pct` 7.5, expected_amount min/max/avg, expected day 1..31, anchor (required for
  interval > 1), end_mode never|on_date|after_count (count <= 600), weekend_adjust
  none|skip|before|after, match_days_early 2 / late 7, status suggested|active|paused|inactive|
  ended, bill_type bill|subscription|installment|income|transfer|other, manual, autopay, dates,
  merchant/category, account pair for transfers, `matcher_hints` (detected name, aliases, learned
  tolerance, schedule pin). Partial unique identity includes `dedup_scope` for price tiers (`:2188-2194`).
- `recurrence_rules`: ordered weekly|monthly|yearly, interval, day_of_month (-1 = last),
  weekday/ordinal, month; check constraints enforce one day spec (`:2055-2075`).
- `recurring_occurrences`: identity `(series, original_due_on)`, weekend-adjusted `due_on`,
  snooze, status scheduled|paid|skipped|missed, close state auto|user, frozen
  `expected_amount` (`:2108-2129`). `recurring_allocations`: payment with allocated amount
  (occurrence currency), source amount/currency, state suggested|confirmed, source
  auto_matched|user_confirmed|user_created, confidence/signals, paid_on (`:2077-2097`). Plus `recurring_match_rejections`, `recurring_price_changes`.

### rules and imports (`db/schema.rb:2257-2320, 1272-1421`)
- `rules`: resource_type (only transaction), ordered position, group, active, effective_date,
  stop_processing; `rule_conditions` self-nesting parent_id (one compound level),
  type/operator/value; `rule_actions` action_type + value (JSON for split, CSV for tags);
  `rule_runs` audit counts/status/error; `rule_groups` share the position sequence.
- `imports`: 12 subclasses; column labels (date/amount/name/category/tags/account/currency/notes +
  trade ticker/price/qty/entity/MIC), col_sep, number_format, date_format, signage_convention,
  amount_type_strategy signed_amount|custom_column + inflow identifiers, rows_to_skip,
  raw/normalized CSV, mappings jsonb, sha256 checksum, status lifecycle. `import_rows` staging; `import_mappings` key→mappable with create_when_empty;
  `import_sessions` + `import_source_mappings` chunked upload with source→target id map.
  `account_statements` + `family_documents` are the PDF/CSV/XLSX statement vault feeding `PdfImport` (`account_statement.rb:1-60`).

### remaining tables
- FX: `exchange_rates` unique (from,to,date), positive-rate check; `exchange_rate_pairs` backfill tracking (`db/schema.rb:824-845`).
- Goals: target amount/currency, kind one_off|maintained, target_mode fixed|months_of_expenses,
  target_date, progress_basis, consumed amount, frozen completed amount; `goal_accounts` (allocated_amount); `goal_pledges` (`:1158-1186`).
- Investments: `securities` (ticker+MIC unique), `security_prices`, `security_splits`,
  `holdings` (qty decimal(34,18), price, amount, cost_basis), `trades` (`:1188-1212,2322-2385,
  2793-2808`). Latest commit moved cost basis to in-memory `Holding::LotBook` (150 LOC).
- `insights` (dedup key per family, type, priority, facts/meta, period, status);
  `syncs` (polymorphic syncable, parent/children, status, window dates); `sync_schedules`
  (interval + next run); `notification_deliveries` unique (rule, transaction) email watermark
  (`:1474-1497,2694-2715`; `notification_delivery.rb:9-34`).
- `families`: currency, timezone, locale, month_start_day 1..28, personal/household budget flags,
  `investment_contributions_as_spending`, recurring/auto-transfer disable flags, categorization
  provider + confidence/shadow settings, enabled_currencies (`:847-888`). Users:
  guest|member|admin|super_admin (`user.rb:63`); `account_shares` permission full_control|read_write|read_only + include_in_finances (`:34-46`).

---

## 3. Feature inventory

| Area | Present in Sure | Where |
|---|---|---|
| Accounts | 9 accountable types, subtypes, manual vs linked, disable, shares, owner, per-account currency, logos | `account.rb`, `concerns/accountable.rb` |
| Entries | transactions, trades, valuations; splits; excluded; scheduled; reconciliation; attachments | `entry.rb`, `valuation.rb`, `trade.rb` |
| Transfers | auto-match (exact + FX tolerance), manual match dialog, reject memory, confirm before budgets change, fees, recurring transfers, kind derivation | `transfer.rb`, `family/auto_transfer_matchable.rb` |
| Rules | 9 condition filters × text/number/select operators incl regex, 13 actions (set category/merchant/name/tags/investment label, exclude, set-as-transfer, split, email, AI), ordered groups, stop-processing, top-rule-wins, dry-run counts, run audit | `rule*` |
| Recurring/bills | frequency presets, recurrence rules, occurrence generation, matcher with confidence tiers, partial-payment allocations, price-change detection, classifier, history backfill, staleness cleaner, bill feed token, upcoming/payable scopes, paycheck planner | `recurring_transaction*`, `recurring_occurrence.rb` |
| Budgets | monthly/custom-month envelopes, parent/child categories, per-category rollover, bills-reserved read hook, personal vs household, template copy, YNAB-style move allocation | `budget.rb`, `budget_category.rb`, `budget/rollover_calculator.rb` |
| Reports | income statement, net-category netting, cash-flow Sankey, balance sheet, net-worth series + velocity/momentum, spending vs normal, savings rate, investment flows, period catalog | `income_statement*`, `balance_sheet*`, `period.rb` |
| Insights | 8 deterministic generators (spending anomaly, cash-flow warning, net-worth milestone, subscription audit, savings-rate change, idle cash, budget, maintained goal depleted) + AI body writer | `insight*` |
| Categorization | rules, naive Bayes (configurable multinomial/complement, amount/merchant/account/direction features), LLM categorizer (OpenAI/Anthropic/JEV/custom), confidence threshold + shadow evaluation, merchant detector, similar-merchant filler | `family/bayes_categorizer.rb`, `family/auto_categorizer.rb`, `provider/openai/*` |
| Label cleanup | deterministic bank-descriptor normalizer, regional marker dictionary, merchant-name suggestion from history | `transaction/label_normalizer*`, `name_suggestion.rb` |
| Imports | CSV wizard (12 types), QIF, PDF statements (AI extraction), Sure/Mint/Monarch/YNAB/Actual exports, category/rule/merchant/tag/account/trade imports, revert, chunked sessions, dedupe against provider rows | `import*`, `pdf_import.rb`, `qif_import.rb` |
| FX | rates table, provider fetch with nearest-rate reuse, batch conversion, custom per-transaction rate | `exchange_rate*`, `lib/money.rb` |
| Goals | one-off/maintained, linked-account earmarks, whole-account links, pledges, consumption, runway/projection payload, months-of-expenses target | `goal.rb` |
| Loans | amortization schedule, payoff chart/projection, extra-repayment simulator, insurance/rate resolvers | `loan*` |
| Sync | family→children sync tree, per-account reverse/forward balance sync, schedules, cancellation, stale sweeps, post-sync transfer matching + rules | `sync.rb`, `concerns/syncable.rb`, `family/syncer.rb` |
| Multi-entity | family + members + account shares + per-user finance scoping | `family.rb`, `account_shares` |
| Notifications | rule email watermarks, Web Push subscriptions, APNs device push, bills feed token | `notification_delivery.rb`, `push_subscription*` |
| Other | AI assistant/chat/MCP tooling, demo generator, SSO/OIDC/WebAuthn, admin, hosted billing | `assistant*`, `demo/*`, `sso_*`, `subscription.rb` |

Deliberately absent: a general-purpose cash-flow forecast/projection engine. Projections exist
only as (a) loan payoff simulation, (b) goal pace/projection, (c) 30-day low-balance warning,
(d) account `projected_balance_money` from scheduled entries (`account.rb:66-80`).

---

## 4. Deep dives

### 4.1 Transfer auto-matching (highest value)

Files: `family/auto_transfer_matchable.rb` (500), `transfer.rb` (302),
`transaction/transferable.rb` (70), `transfer/creator.rb` (256), `transfer/matcher.rb` (154),
`transfer/investment_kind_reconciler.rb` (75), `rejected_transfer.rb`.

**Candidate query is one SQL statement with two UNION branches** (`auto_transfer_matchable.rb:346-485`):

1. Exact same-currency branch (`match_rank = 0`):
   - `inflow.amount < 0`, `outflow.amount > 0`, same currency, `outflow.amount = -inflow.amount`, different accounts, both accounts family-owned and
     status in (draft, active), date within `date_window` days either side,
     neither side already linked to a transfer, not excluded, splits excluded via `entryable_type='Transaction'` + `excluded=false`.
2. Cross-currency branch (`match_rank = 1`), only when:
   - currencies differ, and
   - `|inflow.amount / (outflow.amount * rate)| ∈ [1-tol, 1+tol]`, where `rate` is the direct
     `outflow.currency -> inflow.currency` rate on the outflow date; if missing, the derived
     cross rate `(outflow->family)/(inflow->family)`; family currency legs use 1 (`auto_transfer_matchable.rb:465-470`).
3. Order: `match_rank ASC, date_diff ASC` (`:483`). The auto-matcher consumes greedily and marks
   pairs used, so rank must dominate (`:337-342` comment).
4. Automatic path restricts cross-currency pairs to accounts with a live provider link **or** a
   user-confirmed transfer route, and to accounts that share a writer, and excludes same-Wise-item pairs (`:114-158, 251-305, 306-345`).

Tolerances: default 10%, max 50%, env override `TRANSFER_MATCH_EXCHANGE_RATE_TOLERANCE`; manual
dialog tolerance 10% + 30-day window; inline "Transfer?" hint 2 days / 3% (`:6-23`).

**Output** is `Transfer.new(pending)` rows (`find_or_create_transfer!`, `:202-230`). Auto matches
start **pending**: kinds are NOT changed until `Transfer#confirm!`, so budgets/reports ignore
suggestions (`transfer.rb:186-206`). Confirm:
- inflow leg kind := `funds_movement`;
- outflow kind := destination-account-derived (`Transfer.kind_for_account`): Loan → `loan_payment`; CreditCard/other liability → `cc_payment`;
  Investment/Crypto → `investment_contribution` unless source is also investment/crypto →
  `funds_movement`; else `funds_movement` (`transfer.rb:31-47`);
- investment contribution also gets the "Investment Contributions" category.

Validation: opposite signs, equal magnitude same-currency, different accounts, same family,
date delta <= 4 days pending / 30 days confirmed (`transfer.rb:269-301`).
Reject writes the pair into `rejected_transfers` then destroys the transfer (`transfer.rb:179-184`).
Destroy releases surviving legs back to `standard` and clears idempotency keys (`:241-267`).
Manual match to an account creates the missing counterpart with the opposite amount
(`transfer/matcher.rb:70-89`); a rule action does the same (`rule/action_executor/set_as_transfer_or_payment.rb:18-55`).

Edge cases handled explicitly: excluded/split/pending legs, concurrent inserts (savepoint +
unique index), greedy rank ordering, one-transaction-per-account uniqueness, stale provider kinds
repaired by `Transfer::InvestmentKindReconciler` (`:1-75`).

Port notes: pure function
`matchTransfers(entries, rates, opts) -> TransferSuggestion[]` with an explicit claim set, plus a
`Transfer` storage record and lifecycle (`pending/confirmed/rejected`). Exact and FX branches can
both be tested from fixtures. **Effort M** (~600-800 TS LOC + storage/migration).

### 4.2 Rules engine

Files: `rule.rb` (567), `rule/runner.rb` (211), `rule/condition.rb` (144),
`rule/condition_filter.rb` (181) + 9 filters, `rule/action.rb` (240),
`rule/action_executor.rb` (113) + 13 executors, `rule/registry/transaction_resource.rb` (99),
`rule/safe_regex.rb` (104), `rule/layout.rb` (143), `rule_import.rb` (501).

**Evaluation model is set-based SQL, not per-row Ruby.** A rule becomes an ActiveRecord scope:
- base scope: `family.transactions.visible.with_entry` minus split parents, `entry.date >= effective_date` (`registry/transaction_resource.rb:42`);
- each condition `prepare`s joins then `apply` filters the SQL where-clause
  (`rule.rb:375-396`); compound groups evaluate AND (reduce) or OR (`condition.rb:133-143`);
- regex conditions cannot stay in SQL safely, so they are executed under a Postgres
  `statement_timeout` (5s), their ids plucked, then re-scoped (`rule.rb:388-396`, `safe_regex.rb:48-59`).

Condition types: transaction_name, transaction_amount (ABS compare), transaction_type
(income/expense/transfer), transaction_merchant, transaction_category, transaction_tag,
transaction_details (recursive JSONB string/number search), transaction_notes, transaction_account
(`registry/transaction_resource.rb:2-12`). Operators per type in
`condition_filter.rb:14-40`: text contains/not_contains/starts/ends/matches_regex/=/!=/
null; number >,>=,<,<=,=,!=; select =,!=,null. Text values are whitespace-normalized on both
sides; `!=` uses `IS DISTINCT FROM`; "does not contain" also matches NULL
(`condition_filter.rb:107-180`). Regex safety: max 200 chars, backreferences banned, compile probe
at save (`safe_regex.rb:20-104`). PG ARE semantics (e.g. `\m`, `~*` case-insensitive).

Actions: set_transaction_category, set_transaction_tags (additive, merge), set_transaction_merchant,
set_transaction_name, set_investment_activity_label, exclude_transaction, set_as_transfer_or_payment,
split_transaction, send_email_notification, fill_similar_merchants, bayes_categorize,
auto_categorize, auto_detect_merchants (`registry/transaction_resource.rb:17-31`).

**Execution order** (`rule/runner.rb`):
1. Run rules in `position, created_at, id` order (`rule.rb:27`); active rules above requested
   rules run first; inactive ones skipped (`runner.rb:50-65`).
2. For each rule: compute matched ids under a family advisory lock; then apply every action to
   `scope_for_transaction_ids(matched_ids)` so an action changing a condition field cannot hide its own sibling actions (`runner.rb:90-132`).
3. **Top rule wins per attribute**: each action declares `claimed_attributes`
   (e.g. category_id, merchant_id, name, tags claim nothing); a claimed attribute's ids are
   excluded from lower rules in the same run (`rule.rb:291-318`; `runner.rb:67-88`).
   Additive actions (tags) claim nothing; AI actions do not reserve claims (`action_executor/auto_categorize.rb:35-39`).
4. `stop_processing` rules remove their matched ids from all lower rules (`runner.rb:76`).
5. Every rule writes a `RuleRun` audit row, per-rule failure contained; async actions report counts later (`runner.rb:90-188`).
6. A rule re-applied manually first runs active rules above it, so a single-rule apply matches a full run (`rule.rb:230-234`; `runner.rb:9-13`).
7. Attribute locks: user edits set `locked_attributes`, `Enrichable#enrich_attribute` refuses to
   overwrite locked fields unless `ignore_locks`; provenance is recorded in `data_enrichments`
   with source (`concerns/enrichable.rb:54-147`; `data_enrichment.rb:5-31`).
8. Split rule config validates percentages sum to 100 ± 0.01 or fixed shares sum exactly to an
   "Amount =" condition; fixed splits first, percentages split the remainder; children created
   with parent excluded (`rule/action_executor/split_transaction.rb:1-50`, `entry.rb:574-612`).

Email rule watermarking: on rule creation/activation/criteria change, all currently matching
transactions are recorded in `notification_deliveries` without sending; only later matches email
(`rule.rb:44-72,543-554`; `rule/action.rb:43-67,224-239`).

Port notes: model as data (`Rule { resource, conditions tree, actions[] }`) and evaluate over
`Tx[]` in memory, or compile to a predicate. Keep: ordering + claim sets + stop_processing +
effective_date + lock semantics. Drop: Rails enums/AR scopes/async AI executors v1.
JS regex is not PG ARE — port `matches_regex` with a documented dialect + length cap + worker
timeout (no catastrophic backtracking in main thread). **Effort L** (engine M + actions M).

### 4.3 Recurring transactions / Bills

Files: `recurring_transaction.rb` (964), `identifier.rb` (612), `matcher.rb` (441),
`schedule.rb` (415), `allocator.rb` (401), `occurrence_generator.rb` (133),
`pipeline.rb` (79), `classifier.rb` (130), `cleaner.rb` (53), `history_backfiller.rb` (57),
`frequency_preset.rb` (278), `price_change_detector.rb` (75), `paycheck_planner.rb` (312),
`recurring_occurrence.rb` (190), `recurring_allocation.rb` (41).

#### Schedule engine (`schedule.rb`)
- A series has N `RecurrenceRule`s (weekly/monthly/yearly, interval, day_of_month incl -1 last,
  nth weekday, month). If none, implicit "monthly on expected_day_of_month" (`:51-67,232-237`).
- Every generated occurrence is a **pair** `(original_due_on, due_on)`: the raw schedule date is
  the permanent identity; `due_on` is weekend-adjusted (`:100-124`). Weekend modes: skip → no
  occurrence; before → Sat-1/Sun-2; after → Sat+2/Sun+1 (`:293-302`).
- Date math: weekly steps from anchor weekday; monthly matches `(month_index - anchor)%interval`;
  yearly matches `(year - anchor)%interval`; day-of-month clamps to month end; nth weekday skips months without a 5th occurrence (`:304-393`).
- `DAY_MATCH_TOLERANCE = 2` days and circular 31-day distance so a day-31 bill matches Feb 28
  (`:15,71-84`). SQL twin `day_window_sql` is used for prefiltering candidates (`:80-84`).
- `occurrences_per_year = sum(365.25/(7*interval) | 12/interval | 1/interval)` (`:160-168`).
- End conditions: on_date truncates; after_count counts from anchor using raw dates (`:271-291`). `search cap` 10 years (`:21-23`).

#### Occurrence generation (`occurrence_generator.rb`)
- Horizon: 90 days, extended to next occurrence and to the full finite plan for `after_count`
  (`:57-70`). Starts at current cycle start (so an unpaid recently-due row exists); a manual bill's anchor is the floor (`:20-34`).
- Idempotent `insert_all` with `unique_by: idx_recurring_occurrences_identity` (series + original_due_on) (`:72-95`).
- Schedule edits delete only future scheduled rows with no allocations and regenerate
  (`:38-46`); `stood_in_for` prevents two rows for one cycle when a due day moved (`:109-124`).
- History backfill: materialize 6 months, match exact-tier, then prune past uncovered
  occurrences instead of marking them missed (`history_backfiller.rb:16-55`).

#### Detection (`identifier.rb`)
Input: 3 months of non-transfer, non-Investment/Crypto Transaction entries (`:210-224`).
1. Group by identity = (merchant_id | normalized name) × currency × account (`:231-237`).
2. Cluster amounts: sort by amount, add to current cluster while within 7.5% of the cluster's
   running mean; else start new cluster. Mean (not neighbour) prevents drift chaining
   (`:289-311`). Each cluster ≥ 3 occurrences, last occurrence within 45 days, all day-of-month
   values within circular distance 2 of the computed expected day (`:242-252,552-558`).
3. Expected day: try 31 rotations, choose rotation minimizing span, take median, unrotate (handles [29,30,31,1,2]) (`:568-605`).
4. Pattern amount = most recent occurrence (current price); min/max/avg for variance band (`:256-269`).
5. Claim-or-create: existing series with same identity and amount within tolerance is refreshed;
   manual rows get variance refresh only; ended rows are tombstones; unmatched patterns create
   `suggested` series (`:106-152,452-491`). Second price tier distinguished by `dedup_scope`
   (`:483-491`). Classifier assigns bill_type/category/autopay (`classifier.rb:52-128`):
   keyword lists (subscription/BILL/installment/ACH/autopay), flat modest card charge heuristic.
6. `income_source_candidates` uses source grouping only (variable paychecks), not amount clustering (`:57-103`).
Candidate UI patterns require only 2 occurrences and expose candidates not already covered
(`:42-55,62-103`).

#### Matching payments (`matcher.rb`)
Hard filters: currency, account, sign (series positive = expense vs entry positive), merchant or
known-name alias; transfer series identified by destination account (`:359-379`).
Confidence score max ~1.0:
```
merchant/name/transfer  0.40 / 0.35 / 0.40
amount: exact (<0.01)   0.30
        within band     (0.25 - distance/band * 0.10)   band = expected * max(amount_tolerance_pct, learned_tolerance)/100
        outside band    0 (candidate dies)
date:  due date         0.20, linear to 0.05 at window edge
account: right/scoped   0.10
```
(`:394-439`). Window: `due ± min(match_days_early|late, half cycle)`; each side capped at half the
cycle so adjacent occurrences cannot claim one entry; overdue occurrences extend to today
(`:313-329`). One entry pairs with the nearest open occurrence per series; cross-series
ambiguity guard.

Tiers: exact ≥ 0.85 **and** not pending **and** beats runner-up by ≥ 0.15 → write confirmed
allocation; high ≥ 0.60 → suggestion (income series get no suggestions) (`:11-18,140-165`).
Greedy sort by `[-confidence, occurrence.id, entry.id]`; each entry/occurrence at most once
(`:111-138`).

#### Allocations (`allocator.rb`)
- Only write path; row lock on occurrence, advisory lock on entry, capacity bounded by entry's
  unallocated amount in entry currency (supports one entry paying many bills) (`:49-91,287-399`).
- Cross-currency: converts at entry date rate; explicit amount or capped by remaining; missing rate raises (`:234-285`).
- **Close rules** (`:217-232`):
  - single confirmed allocation within `expected * tolerance%` of expected → paid;
  - otherwise sum >= expected - 0.01 (cent epsilon) → paid;
  - `remaining_amount` is exact; partial payments allowed; user-closed rows never auto-reopen.
- Learning: a manual attach outside the band widens `learned_tolerance_pct` (max 25%) only when
  that single payment settles the occurrence; name aliases are learned (`:324-351`).
- `mark_paid!` settles without a transaction; `reject_suggestion!` records `recurring_match_rejections` so the matcher won't re-propose (`:144-181`).

#### Price changes (`price_change_detector.rb`), cleaner, pipeline
- Price change = a settled payment amount different from previous amounts; stored with
  effective date, updates series amount from then on, future open occurrences inherit
  (`recurring_transaction.rb:267-282`, `price_change_detector.rb`).
- Staleness: last occurrence older than max(2 missed cycles, floor 2 months auto / 6 manual) →
  inactive; old inactive auto rows deleted after 6 months (`recurring_transaction.rb:792-807`; `cleaner.rb:20-51`).
- Pipeline order: identify → generate active occurrences → repair orphan allocations → match →
  detect price changes → optional 6-month history backfill; one family advisory lock (`pipeline.rb:20-47`).

Edge cases: income sign, transfers without shared names, pending transactions never auto-linked,
one transaction funding several bills, overpayment, price tiers, custom month start only shapes
budgets not bills, `after_count` identity based on raw dates.

Port notes: port `Schedule` + `OccurrenceGenerator` first (pure date math, no DB) = **M**; then
allocator/matcher = **M**; detection = **M**. Full Bills = **L**. LaVega already has
`detectRecurringStreams` + `detectSubscriptions` (`packages/core/src/forecast.ts`,
`subscriptions.ts`), so spend effort on the schedule/occurrence/commitment model rather than
re-detection.

### 4.4 Budget math and rollover

Files: `budget.rb` (594), `budget_category.rb` (461),
`budget/rollover_calculator.rb` (226), `period.rb` (269).

Period: calendar month or custom month start day (family `month_start_day` 1..28);
`period_for` computes [custom start, custom end] (`budget.rb:42-54`; `family.rb:419-441`).
Budgets only exist for initialized months (`budgeted_spending` present); limits 2 years back and
2 years forward (`budget.rb:93-105`).

Actuals come from the income statement, not raw entries:
- `budget_category_actual_spending = max(expense_total - refund_total, 0)` per category, where
  refunds are income booked to the same category (`budget.rb:418-423`).
- `actual_spending = net_totals.total_net_expense` (net of refunds); `income_totals` = actual income for the period (`budget.rb:410-423,509-515`).
- `estimated_spending/income` = median over the trailing window, not this month (`budget.rb:410-412,509-511`; formula below in 4.6).
- `bills_reserved`: open recurring bill occurrences due in the period and not yet paid, converted
  to the budget currency; unconvertible ones are counted, not silently dropped (`budget.rb:427-450`; `budget_category.rb:1-17,420-437`).

Derived figures (`budget.rb:460-540`):
```
available_to_spend     = budgeted_spending - actual_spending
allocated_spending     = sum(non-subcategory budget_categories.budgeted_spending)
available_to_allocate  = budgeted_spending - allocated_spending
percent_of_budget_spent= actual / budgeted * 100
remaining_expected_income = expected_income - actual_income
surplus_percent        = |remaining_expected_income| / expected_income * 100 when negative
```
Cash figures are deliberately separate: `available_cash` = sum of visible Depository balances
converted at today's rate (missing rate excluded and tracked, 0 not 1:1);
`earmarked_for_goals` = goal backing restricted to the same accounts; `free_cash = max(0,
available - earmarked)` (`budget.rb:200-251,543-551`).

Category hierarchy:
- Parent `budgeted_spending` always contains its funded subcategories + own reserve (`sync_parent_budgeted_spending!`, `budget_category.rb:439-460`).
- Subcategory with no own allocation "inherits" the parent budget; its available is the parent's shared remainder (`budget_category.rb:237-286`).
- `available_to_spend` for parents includes ring-fenced children's carry without double counting (`:276-286`).
- `move_allocation!` (YNAB "roll with punches") locks rows in ascending id, refuses
  parent/child moves, uncategorized, insufficient funds; caller must run rollover after (`:69-147`).

Rollover (`budget/rollover_calculator.rb`):
- Forward pass over initialized budgets of one chain (household = user nil, or one user's personal budgets); advisory lock; cached input fingerprint.
- `incoming = previous month's outgoing carry` (0 if toggle off or currency changed);
  `outgoing = max(0, budgeted_spending + incoming - actual_spending)`; ring-fenced children are
  subtracted from the parent so money carries once (`:100-123,209-224`).
- Only surplus carries; negative balances stop at the month (`:209-211`). A budget currency
  change breaks the chain (carry resets 0) (`:64-69`). Toggle-off kills both incoming and
  outgoing carry (`:96-107`). Materialized via `upsert_all(update_only: rolled_over_amount,
  updated_at)` so a concurrent allocation edit is not clobbered (`:113-123`).
- Rollover flag is a standing preference: new months inherit from the most recent initialized
  budget; changing it propagates forward (`budget.rb:140-155`; `budget_category.rb:175-184`).

Port notes: pure `computeBudget({period, allocations, actuals, rolloverFlags, previousCarry})`.
Keep the "initialized months only" chain and the currency break. **Effort M**.

### 4.5 Balance and valuation materialization

Files: `balance/materializer.rb` (124), `base_calculator.rb` (186),
`forward_calculator.rb` (167), `reverse_calculator.rb` (168), `sync_cache.rb` (160),
`account/anchorable.rb`, `opening_balance_manager.rb`, `current_balance_manager.rb`,
`reconciliation_manager.rb`, `holding/materializer.rb` (334).

Two anchors:
- **Opening anchor** valuation: balance at (usually) oldest entry date - 1 day (`opening_balance_manager.rb:8-75`). Must precede oldest entry.
- **Current anchor** valuation: provider-reported balance "now"; used by reverse calculation (`current_balance_manager.rb:13-40`).

Strategy selection: linked account → reverse; manual account → forward
(`account/syncer.rb:21-24`).

Forward (`balance/forward_calculator.rb`):
- Window `calculation_start_date = min(opening_anchor_date, oldest non-pending entry, today)`
  (`base_calculator.rb:41-43`), end = max(last non-future entry date, last holding date, today) (`forward_calculator.rb:141-147`).
- For each date: if a valuation exists, end balance is hard-reset to it; else
  `end_cash = start_cash + signed cash flows`; `end_non_cash = start_non_cash + signed non-cash
  flows` (+ holdings value for investment accounts); compute `cash_adjustments`,
  `non_cash_adjustments`, `net_market_flows` to make the generated end columns reconcile (`forward_calculator.rb:17-63`).
- Incremental sync seeds from the persisted balance of `window_start_date - 1`; falls back to full
  recompute when the prior row has non-cash component or the account has foreign-currency
  entries/family-currency mismatch (missing rates could have been used at 1:1 earlier) (`:74-108`).

Reverse (`balance/reverse_calculator.rb`): start from current anchor balance/date and walk
backwards; opening anchor resets the day; reconciliation valuation hard-resets the end-of-day
balance while the start is derived from that day's flows (so a same-day transaction is counted
once); opening-boundary adjustment makes the first derived day reconcile explicitly
(`:18-89,115-167`).

Flows (`base_calculator.rb:96-137`):
- transactions: negative = inflow, positive = outflow (asset view);
- trades split into regular (qty != 0) and income-only (qty == 0); a buy is cash outflow + non-cash inflow (inverse);
- Loan non-cash accounts special-case payments into non-cash inflows;
- investment `net_market_flows = Δholdings value - net buys/sells` (`:84-94`);
- holdings value = Σ `holding.amount` converted to account currency at holding date; missing rate
  falls back to 1:1 and is reported (`sync_cache.rb:51-80`);
- entries with no convertible rate are **dropped** from the balance and reported (policy differs from holdings fallback) (`sync_cache.rb:82-128`).
- `flows_factor`: asset 1, liability -1 (`:76-79`).

Materializer upserts per `(account, date, currency)` in batches, purges rows outside the computed
range (incremental preserves pre-window rows), then writes `account.balance`/`cash_balance` from
the newest balance on/before today (`materializer.rb:16-123`).

`account.balance` is therefore denormalized; the source of truth for history is `balances`.
`account.projected_balance_money` adds signed future scheduled entries converted to account
currency, excluding non-cash accounts and non-cash trade legs (`account.rb:66-80,943-990`).

Port notes: LaVega currently computes `currentBalance(account, txs, asOf)` on demand
(`packages/core/src/balance.ts:85-105`). A daily-balance series + anchors is the missing piece for
net-worth history. Port: anchor resolve, forward/reverse loop, adjustment components, scheduled
exclusion. No DB needed if vault replays txs; keep the incremental-sync concept out.
**Effort M** (~500-700 TS LOC).

### 4.6 Reports

#### Income statement (`income_statement.rb` + `income_statement/*`)
- Applies: visible transactions, excluding pending (`extra[provider].pending`), excluding
  scheduled (future) rows, date range, accounts not excluded from reports, status draft/active,
  not tax-advantaged, and (when scoped) user's finance accounts (`income_statement.rb:20-36,153-174`; `scoped_transactions_query.rb:78-90`).
- Excludes `BUDGET_EXCLUDED_KINDS` (transfers, CC payments, one_time); a family that does not
  count investing as spending ALSO excludes `investment_contribution` (`family.rb:650-654`; SQL uses `budget_excluded_kinds_sql`).
- Classification per row: `investment_contribution` → expense or "investment"; `loan_payment` → expense;
  `amount < 0` → income; else expense (`scoped_transactions_query.rb:18-21`).
- Conversion: `amount = amount * COALESCE(er.rate, 1)`, where `er` is the exchange rate
  `entry.currency -> family.currency` on the entry date; contribution/loan outflows are ABS'd
  (`:23-28`). Missing rate silently becomes 1:1 — a real limitation.
- Totals aggregate by (category, parent, classification) with `SUM` and `COUNT`; category totals
  add children into parents; weights are percentage of classification total (`totals.rb:33-83`; `income_statement.rb:211-254`).
- Net category totals: `net = expense_total - income_total` per category; positive → expense
  side, negative → income side; refunds therefore reduce spending (`income_statement.rb:62-123`).
- Medians (`FamilyStats`/`CategoryStats`): period bucketing with `date_trunc(:interval)`,
  then `PERCENTILE_CONT(0.5)` and `AVG` over period totals, ABS
  (`family_stats.rb:36-63`; `category_stats.rb:37-68`). `interval` is "month"/"week"/"day".
- Daily series: same scoping, grouped per day; cached on `entries_cache_version`, `accounts_status_version`, currency, max exchange-rate updated_at,
  and `investment_contributions_as_spending` (`income_statement.rb:130-151,337-363`).

#### Balance sheet (`balance_sheet.rb`, `balance_sheet/*`)
- Classification groups assets/liabilities; account groups by accountable type; per-account
  converted balance uses today's rate batch (`account_totals.rb:92-108`).
- Totals count only accounts included in the viewer's finances and not excluded from reports
  (`classification_group.rb:23-32`). Net worth = assets - liabilities (`balance_sheet.rb:13-39`).
- Net worth series is a balance-series query over historical accounts, with disabled accounts
  truncated to day before disable (`net_worth_series_builder.rb:7-59`).
- Velocity = (last - first) / days * 365.2425/12 (monthly pace); momentum = velocity - prior
  window velocity; withheld (nil) unless all accounts' first history date <= window start (`net_worth_velocity.rb:20-102`).

#### Cash flow / savings rate (`income_statement/cash_flow.rb`)
- Month-to-date totals; cumulative daily spending vs previous month's same number of days;
  `savings_rate = (income - spending) / income * 100` when income > 0.
- Sankey (`income_statement/sankey.rb`): net category groups; center capacity
  `max(income, spending + invested)`; net surplus/deficit node; invested node when investing is not spending.

#### Spending vs normal (`income_statement/spending_comparison.rb`)
- Net per category = expense - refunds (income to same category), clamped positive.
- Baseline = up to 1 year before period (min 28 days of history). Whole period:
  `normal = baseline_net * period_days / baseline_days`. In-progress period: average of the same
  `period_days` window starting at each of the 12 prior month starts; no rescale (`:199-225`).
- `change = total - normal`, `ratio = change / normal`; changes < 1 unit dropped; subcategory
  rows plus a "direct" parent row so children sum to parent; treemap guards overstatement (`:26-37,152-182`).

#### Investment flows (`investment_flow_statement.rb`)
- Contribution/withdrawal totals from `investment_activity_label`, including matched transfer
  legs moving money between investment and non-investment accounts; internal investment-to- investment movements excluded (`:1-77`).

Port notes: LaVega already has `forecast.ts` and `views.ts`. Port only the delta: median
baselines, netting, spending-vs-normal, savings rate, net-worth velocity. Skip the SQL builder,
Sankey, account-share scoping. **Effort M**.

### 4.7 Insights (`insight*`, ~810 LOC)

Eight deterministic generators, each produces typed `facts`/`metadata`, dedup key, priority,
period:
- spending anomaly: current-month pace projected (`month_days / elapsed_days`) vs 3-month
  baseline; flag |deviation| ≥ 25%, high at ≥ 50%, min baseline 50, min 7 elapsed days, top 3 (`spending_anomaly_generator.rb:1-40`).
- cash-flow warning: 30-day projection of Depository balances = start balance - daily residual
  spending - scheduled recurring expenses; residual = max(median monthly expense - recurring
  expenses, 0)/30; low point < 500 (family-currency caveat documented) → medium/high (`cash_flow_warning_generator.rb:1-80`).
- net-worth milestone, subscription audit, savings-rate change, idle cash, budget, maintained
  goal depleted (`insight/generators/*`, registry `insight/generator_registry.rb:7-16`).
Registry catches per-generator failures so a crashing generator can't wipe healthy insights.
`build_insight` writes deterministic body from templates (`insight/generator.rb`), LLM body
writer is optional (`insight/body_writer.rb`).

Port notes: formulas are cheap; port 3-4 highest-signal ones. **Effort S-M**.

### 4.8 Categorization and label normalization

**Label normalizer** (`transaction/label_normalizer.rb`:238 + `dictionary.rb`:466):
deterministic bank-descriptor cleaner, no LLM. Pipeline (`:108-133`):
strip rail marker (card/direct_debit/refund/...), strip nested rail on refunds, truncate at
SEPA/ACH reference fields, extract operation date (slashed `DD/MM`, `DDMMYY` after DU,
alpha month names; day/month order from region pack), strip terminal id, strip payment
aggregators (`PAYPAL*`, `STRIPE*`, ...), remove noise (masked PAN, auth codes, terminal ids,
contract numbers, ACH SEC codes), tidy whitespace, keep original if result < 2 chars.
Result = `{name, rail, operation_date}`. Dictionary packs hold regional markers; all packs active
(`dictionary.rb`). Casing preserved (bank labels often uppercase, acronyms matter) (`:19-21`).
This is a direct fix for LaVega's dedupe/merchant grouping weakness (cross-source spellings).

**Naive Bayes categorizer** (`family/bayes_categorizer.rb:1-20`):
- trains per family on already-categorized transactions; guard ≥ 20 training rows and ≥ 2 categories; model version `bayes-2`.
- default multinomial NB over name/notes/merchant tokens, add-1 smoothing, uniform prior.
- tunable to complement NB (Lidstone), with independent factors:
  `P(c) × P(words|c) × P(merchant|c) × P(account|c) × P(direction|c) × N(log10|amount|; c, direction, currency)`
  — each factor its own distribution so a long description cannot outvote merchant/amount.
- tokens: letter/digit runs joined by single symbols; drops pure numbers, short tokens, mixed
  code tokens; optional bigrams; optional binary; optional token-spread filter.
- amount: log10 magnitude, z capped at 3, variance shrunk by prior, floor variance.
- writes only when confidence ≥ family threshold; `lock_results` option locks attribute; records `data_enrichments` provenance (`:89-129`).
- Time-split evaluation exists (`family/bayes_evaluation.rb`, 480 LOC) for tuning.

**LLM categorizer** (`family/auto_categorizer.rb`:319 + providers):
batches per call, sends id + descriptor + category list, expects exact category name or null;
withholds low-confidence decisions rather than locking guesses; shadow provider records
`categorization_comparisons` for agreement stats (`:1-120`; `categorization_comparisons` schema
`:421-436`). Prompt variants for small models, plus per-family prompt override
(`provider/openai/auto_categorizer.rb:1-80`). Merchant detector: separate LLM action; provider
merchants vs family merchants resolved by `FamilyMerchantAssociation`.

**Enrichment/provenance model** (`concerns/enrichable.rb`): every auto-assignment is
`data_enrichments(attribute_name, value jsonb, source, metadata)`; user edits lock attributes;
`clear_ai_cache` only unlocks when the current value still equals what AI set. This is the
mechanism that makes rules/Bayes/LLM coexist safely and is worth porting as a concept even if
storage shape changes.

Port notes: label normalizer = **M** (mostly data + regexes; trim to NL/DE/EN);
Bayes = **M** (LaVega already has deterministic `CATEGORY_RULES` in `categories.ts`);
LLM path = ADOPT concept only (LaVega has its own AI layer).

### 4.9 CSV import and dedupe

Files: `import.rb` (871), `import_session.rb` (497), `transaction_import.rb` (187),
`import/row.rb` (162), `import/preflight.rb` (411), `import/mapping` subclasses (~340),
`account/provider_import_adapter.rb` (1,233), `family/data_exporter.rb` (947),
`family/data_importer.rb` (1,781), `sure_import.rb` (395), `qif_import.rb` (600),
`pdf_import.rb` (596).

CSV settings (stored on the import row, schema `:1364-1421`):
- `col_sep` comma/semicolon; `rows_to_skip` (preamble); `CSV.parse(headers: true,
  liberal_parsing: true)`, values stripped; duplicate normalized headers are a validation error (`import.rb:190-198,667-690`).
- `number_format` ∈ {"1,234.56", "1.234,56", "1 234,56", "1,234"}; `sanitize_number` strips the
  configured delimiter/edge currency symbols, converts the separator to ".", rejects non-numeric
  output; handles NBSP for the space format (`:56-61,707-759`).
- `date_format` ∈ 12 family formats (`family.rb:26-40`) + CSV-only `DD/MM/YY`; auto-detection
  scores candidates by parse count then "reasonable range" 1970..today+5y (`:67-69,200-243`).
- `signage_convention` inflows_positive|inflows_negative and `amount_type_strategy`
  signed_amount|custom_column (+ identifier/inflow values). `signed_amount` multiplies by -1 when
  inflows_positive; custom column flips when the entity type equals the inflow identifier (`import/row.rb:97-127`).
- Column labels per field (date/amount/name/category/tags/account/currency/notes + trade
  ticker/qty/price/entity/MIC); header lookup normalizes case, `*`, whitespace/dash
  (`import.rb:647-694`). Row validation: required columns, exact date parse within 30y..today,
  numeric amount, valid currency (`import/row.rb:129-161`; `entry.rb:634-636`).
- Mapping phase resolves/creates Category, Tag, Account, merchant, rule per distinct key;
  `create_when_empty` marks will-create; dry run counts; publish requires valid rows+mappings
  (`import.rb:362-374,418-470`; `import/mapping.rb:1-45`). Publish is one transaction; reaper
  handles killed workers; revert destroys created data (`import.rb:136-188,276-348,481-489`).
- Chunked upload: `import_sessions` groups imports by sequence/sha256 checksum with a
  source→target id map for resumable/idempotent imports (`import_session.rb:1-120`).
- **Dedupe** (`provider_import_adapter.rb:797-845`): same account, Transaction entryable, exact
  amount+currency, same date (±window), no `external_id` unless opted in, not a split child,
  optional exact name; nearest date then oldest created. Variants: scheduled manual entry within
  7 days where `created_at < date` (`:846-864`); pending→posted within 8 days (`:866-899`).
  CSV import updates duplicates in place and locks them (`transaction_import.rb:47-68`).
- Export round-trip headers: `date, account_name, amount, name, category, tags, notes, currency`
  (`family/data_exporter.rb:6`); tag escaping rules (`import/row.rb:39-90`). PDF imports
  (statement vault + AI extraction + reconciliation) skip for LaVega.

Port notes: LaVega already has per-bank CSV parsers (`packages/core/src/parsers/*`) and a
transaction hash. Port the **wizard semantics** (column mapping, format detection, signage,
duplicate headers, per-row validation, preflight counts, dedupe against existing) as a
`csvImport.ts` module. **Effort M**.

### 4.10 FX and Money

`lib/money.rb` (166) + `lib/money/{arithmetic,currency,formatting}.rb`:
custom Money with BigDecimal amount, currency object, `exchange_to(other, date:, custom_rate:)`,
`ConversionError` when no usable rate; strict-currency mode raises on cross-currency arithmetic in
dev/test, reports in production (`lib/money.rb:1-120`; initializer `:1-6`).

`ExchangeRate::Provided`:
- `find_or_fetch_rate(from,to,date)`: exact row, else nearest cached rate within
  `NEAREST_RATE_LOOKBACK_DAYS = 5` (weekend/holiday reuse), else provider fetch, else nil; caches
  fetched rates keyed `(from,to,date)` (`exchange_rate/provided.rb:12-56`).
- `rates_for(currencies, to:, date:)`: exact batch → nearest batch → fetch missing; missing falls back to rate 1 with a warning (`:60-100`).
- import provider rates uses owner-token Rails.cache lock per (pair,start_date) to avoid duplicate provider calls (`:103-140`).
- `Money#exchange_to` raises when no rate; callers choose between raise, 1:1 (balance sheet
  holdings), or 0/exclude (budgets, income statement joins fall back 1:1 in SQL).

Port notes: LaVega `fx.ts` has `FxRate`, `crossRate`, `rateOn`, `toEur`, `FX_RATE_FALLBACK`.
Adopt the 5-day nearest-rate lookup, per-call explicit policy for missing rates, and the
"strict math in tests" idea. **Effort S**.

### 4.11 Goals and loan projections (brief)

Goals (`goal.rb`:1,492): linked accounts with fixed earmarks or whole-account remainder;
`current_balance = sum(backing)` (frozen `completed_amount` after completion);
`remaining = max(target - current_balance - consumed, 0)`;
`progress = current_balance + consumed`;
`months_remaining = max((target_date - today)/30, 0)`;
`monthly_target = remaining / months_remaining` (remaining when 0);
`pace = -(sum 90-day net inflows) / 3` converted at today's rate;
`months_of_runway = current_balance / pace`; `projection_end = current_balance + pace × months`;
months-of-expenses target = family median monthly expense × target_months
(`goal.rb:392-470,496-575,687-795,821-875`). Pledges: transfer-kind resolves on a synced deposit;
manual_save on a positive valuation delta; date/amount tolerance reconciler
(`goal_pledge/reconciler.rb`).

Loans (`loan/*`, 2,009 LOC): monthly accrual, two rates per period (accrual at period-open rate,
payment sizing at payment-date rate), day-count 30/360|actual/365|actual/actual,
`MAX_PERIODS = 1200`, strategies reamortize|hold|scheduled; payoff projection pays contract
repayment against today's balance (overpayers finish early); extra-repayment simulation
weekly/fortnightly/monthly (`loan/simulator.rb:1-110`; `loan/payoff_projection.rb:1-50`).
Port notes: goal formulas = ADOPT; loans = SKIP until vault models debt accounts.

### 4.12 Sync architecture (concept only)

`Sync` state machine (pending/syncing/completed/failed/stale) with parent/children tree, window
dates, cooperative cancel, 24h stale sweep, post-sync hook (`sync.rb:31-56,179-303`).
`Syncable#sync_later` keeps one recent sync per syncable, expands the window, enqueues `SyncJob`;
family fans out to provider items + manual accounts (`syncable.rb:54-88`; `family/syncer.rb:8-28`).
Family post-sync: auto-match transfers → logo backfill → `ApplyRulesJob`; account post-sync:
auto-match transfers for it (`family/syncer.rb:22-28`; `account/syncer.rb:16-18`). Account sync:
market data → materialize balances (reverse linked / forward manual) → provider balance overrides
(`account/syncer.rb:8-24`). Schedules: per-syncable interval_minutes + next_run_at.
Cache invalidation: explicit family version strings (`entries_cache_version`,
`accounts_status_version`, `categories_version`, `recurring_transactions_version`;
`family.rb:787-860`); entry saves sync from the earliest affected date
(`entry.rb:344-359`).
Port notes: ADOPT CONCEPT (post-ingest pipeline: transfer match → rules → recurring match →
insights, version-keyed invalidation). SKIP the Sidekiq/AR state machine.

### 4.13 Family, permissions, notifications (brief)

Family is household + multi-entity container: one family currency, per-account currencies, custom
month start, locale/date/number settings, budget/AI/categorization flags (`family.rb:1-100`).
Permissions: owner + account shares (full_control/read_write/read_only, `include_in_finances`) +
roles guest/member/admin/super_admin; Pundit policies. Notifications: rule email watermarked by
unique `(rule_id, transaction_id)` inserted with `insert_all ... returning`
(`notification_delivery.rb:9-34`); Web Push + APNs device push exist; bills feed token gives a
read-only feed (`families.bills_feed_token`).

---

## 5. Code quality, tests, bugs and limitations

Strengths: exceptional test volume (1,183 Minitest files / 277k lines, fixtures + Mocha/VCR,
`AGENTS.md:13-16`; measured), deterministic algorithms documented in headers with rejected
alternatives (`recurring_transaction/schedule.rb:1-11`, `identifier.rb:542-558`,
`balance/reverse_calculator.rb:1-15`, `portfolio/xirr.rb:1-40`), deliberate concurrency handling
(advisory locks for rules/rollover/recurring/transfers, savepoints around unique-index races,
partial unique indexes, `insert_all ... returning`, owner-token cache locks for FX), and
BigDecimal money with explicit rounding + cent epsilon (`recurring_occurrence.rb:16-19`).

Weaknesses / bugs / traps noticed:
1. **SQL-embedded business rules.** Transfers (`auto_transfer_matchable.rb:346-485`), income
   statement, balance sheet and net-worth series are raw SQL. Porting means re-expressing, not
   translating; the FX branch and NULL/`NOT IN` semantics are easy to get subtly wrong.
2. **Inconsistent missing-rate policies.** `COALESCE(rate,1)` in the income statement
   (`scoped_transactions_query.rb:27`), drop in balances (`sync_cache.rb:99-112`), 1:1 for
   holdings (`sync_cache.rb:57-66`), exclude in budgets (`budget.rb:543-551`) and goals
   (`goal.rb:451-480`). Unify into one explicit per-surface policy.
3. **Model bloat / callbacks.** `goal.rb` 1,492 LOC, `account.rb` 1,087, `family.rb` 1,027,
   `user.rb` 1,058, `recurring_transaction.rb` 964; `Entry` schedules syncs, jobs, name generation,
   split locks in callbacks (`entry.rb:55-61,344-350`). Keep pure math separate in TS.
4. **Regex/rules performance.** Regex runs in Postgres under a 5s statement timeout and is probed
   at save; `total_affected_resource_count` plucks ids per rule. JS port must run user regex off the main thread.
5. **Greedy matchers.** Transfer auto-match and recurring matcher are first-claim greedy; tests
   pin current behavior, a global-optimal assignment could differ.
6. **Approximate rule metrics / read-only hooks.** Async AI actions report queued counts later
   (`RuleRun#complete_job!`); `count_modified_resources` falls back to `previous_changes`.
   `bills_reserved` is read-only by design — adding it to `available_to_spend` double counts (`budget_category.rb:1-17`).
7. Provider metadata lives in `extra` JSONB across 28 `*_item` models / 103 provider files; a port
   should define its own provider-metadata schema or drop it. Some balance/import defensiveness is
   explained by that combinatorics, not by personal-budget complexity.

## 6. Reuse map for LaVega personal side

LaVega baseline today (verified in this worktree): `Tx = {id, accountKey, date, amount (negative =
outflow), currency, counterparty, description, category, manual}`; `Rule = {id, match, category}`;
`Account = {key, iban, name, bank, entity, currency, balance}`; storage is
`StorageAdapter` (accounts/txs/rules/entityProfiles, IndexedDB now, Postgres later)
(`docs/CONTEXT.md`; `packages/core/src/model.ts:6-119`;
`packages/adapters/src/storage/StorageAdapter.ts:3-21`). Existing relevant modules:
`balance.ts` (current balance), `forecast.ts` (recurring detection + forecast),
`subscriptions.ts` (deep subscription detection), `ingest.ts` (dedupe), `fx.ts`, `categorize.ts`,
`categories.ts`, `crossScope.ts` (personal↔business two-leg transfers), `plan/`, `advisor/`.

### PORT (logic + tests, TS/Effect)

| Sure | What to port | LaVega target | LOC (TS est.) | Effort | Deps |
|---|---|---|---|---|---|
| `family/auto_transfer_matchable.rb` + `transfer.rb` + `transaction/transferable.rb` | exact + FX-tolerant pair matching, ranking, pending→confirm lifecycle, reject memory, kind derivation, fee legs | `packages/core/src/transfers.ts`; `Transfer` in `model.ts`; storage adapter methods; rules action in `rules.ts` | 600-800 | M | `fx.ts`, new `Transfer` record, account types |
| `rule.rb`, `rule/condition*`, `rule/action*`, `rule/runner.rb`, `rule/registry.rb` | condition tree, operators, ordered execution, claim sets/top-rule-wins, stop_processing, effective_date, enrichment locks, split action | `packages/core/src/rules/*.ts` (pure evaluator) + Effect service `RuleRunner` at server/ingest boundary | 900-1,200 | L | Tx model extension (category/merchant/tags/kind/transfer), tests |
| `recurring_transaction/schedule.rb` + `occurrence_generator.rb` + `recurring_occurrence.rb` | recurrence rules, weekend adjust, end modes, occurrence identity pairs, 90-day horizon, regeneration rules | `packages/core/src/recurring/schedule.ts` + `occurrences.ts`; storage tables | 350-500 | M | integer-cents date math |
| `recurring_transaction/matcher.rb` + `allocator.rb` | confidence scoring, windows, tiering, partial payments, close rules, learning hints | `packages/core/src/recurring/match.ts`; storage for allocations/occurrences | 500-700 | M | schedule/occurrences, fx |
| `recurring_transaction/identifier.rb` + `classifier.rb` | amount clustering, day clustering, circular-median expected day, claim/create semantics, classifier keywords | extend `forecast.ts`/`subscriptions.ts` or `recurring/detect.ts` | 400-600 | M | existing dedupe/merchant keys |
| `balance/{base,forward,reverse}_calculator.rb` + `materializer` concept + `anchorable` | anchors, daily balance series, cash/non-cash split, flows factor, adjustments, scheduled exclusion | `packages/core/src/balanceSeries.ts` + extend `balance.ts` | 500-700 | M | tx replay, fx |
| `budget.rb` + `budget_category.rb` + `rollover_calculator.rb` | envelope math, parent/child inheritance, ring-fenced rollover, carry chain, bills-reserved hook | `packages/core/src/budget.ts`; storage `Budget`/`BudgetCategory` | 450-600 | M | period/custom month, reports actuals |
| `income_statement.rb` + `family_stats`/`category_stats` + `spending_comparison.rb` | classification rules, netting, medians, spending-vs-normal, savings rate | `packages/core/src/reports.ts` (extend), reuse `forecast.ts` primitives | 450-650 | M | tx categorization, fx, period |
| `transaction/label_normalizer.rb` + dictionary (trimmed) | rail/date/noise stripping, regional packs NL/DE/EN, operation date | `packages/core/src/labels.ts` | 350-500 | M | merchant key normalization |
| `family/bayes_categorizer.rb` | NB feature model + confidence thresholds (optional; LaVega already has deterministic rules) | `packages/core/src/categorizeBayes.ts` | 300-450 | M | categorized history |
| `import.rb` mapping/preflight/detection subset + `import/row.rb` | column mapping, date/number detection, signage, validation, dry run, dedupe check | `packages/core/src/csvImport.ts`; UI wizard in `apps/web` | 400-600 | M | `ingest.ts`, parsers, storage |
| `insight/generators/{spending_anomaly,cash_flow_warning,subscription_audit,savings_rate_change}` | formulas only | `packages/core/src/insights.ts` | 250-350 | S-M | reports/forecast primitives |
| `exchange_rate/provided.rb` | 5-day nearest-rate reuse, explicit missing-rate policy, batch conversion | extend `fx.ts` (`rateOn`, `crossRate`) | 60-120 | S | fx payload |
| `goal.rb` formulas + `goal_pledge` matches | remaining/progress/pace/runway/projection | `packages/core/src/goals.ts` | 250-400 | M | balance/forecast |

### ADOPT CONCEPT ONLY

- Rule groups + run audit (`rule_runs` fields) → logging/observability, not a port.
- `Enrichable`/`DataEnrichment` provenance and attribute-lock semantics → LaVega needs a
  "who set this field" policy once rules/Bayes land; store as `source`/`lockedBy` on Tx rather than a separate table if the vault stays JSON.
- Budget "initialized months only" + personal vs household chain.
- Custom month start (`month_start_day` 1..28) and `Period` catalog (`Period::PERIODS`, `period.rb:12-100`).
- Scheduled/future-dated entry exclusion from actuals.
- Rule email watermark + notification dedupe (if notifications come later).
- Sync post-step pipeline order (ingest → transfer match → rules → recurring match → insights).
- Loan amortization math (when debt accounts exist): two-rate accrual, day-count conventions.

### SKIP

- Provider sync architecture, 28 provider adapters, Plaid/SimpleFIN/Enable Banking clients —
  LaVega has its own `BankAccessAdapter` (`packages/adapters/src/banking`).
- PDF statement vault + AI extraction + reconciliation statements.
- AI assistant/chat/MCP, SSO/OIDC/WebAuthn, admin, demo generator, hosted billing.
- Income statement/Sankey/cash-flow SQL query objects; balance sheet SQL; report UI.
- Holdings/trades/cost-basis/investment statements — investing is owned by the cofounder's side;
  only `Transfer.kind_for_account`'s investment-contribution classification is relevant.
- Rails-specific concurrency (advisory locks, savepoints) — keep the intent, use single-writer vault semantics/Effect.

### License / attribution

- Sure is AGPL-3.0 (`/tmp/sure/LICENSE:1-8`); LaVega is AGPL-3.0 too, so porting is
  license-compatible. AGPL §5 requires derivative files to carry prominent notices of changes and
  the date, and the whole work to remain AGPL. Recommended: file-header comment
  `Ported from Sure (we-promise/sure) commit 562fe09 — AGPL-3.0 — heavily modified for LaVega`
  plus a `NOTICE`/`docs/research/sure/README` attribution page; keep LaVega's AGPL LICENSE and
  README license section. Also note Sure itself is a fork and its README asks downstream forks to
  keep the original AGPLv3 license and state non-affiliation (`README.md:26-30,55-60`). This is engineering guidance, not legal advice.

### Suggested sequencing (personal side)

1. Extend `Tx`/storage with `category` + direction + link fields required by rules/transfers (schema change, migration in `packages/database`).
2. Port `transfers.ts` + minimal rules evaluator (name/amount/type/merchant, set category/name/
   exclude, permute order + claims). This gives immediate value: unmatched internal transfers stop
   polluting spend, and categorization rules replace the single `match` string.
3. Port recurring schedule + occurrences + commitment view; defer allocations until bills UI.
4. Port balance series (historical net worth) then budget envelopes/rollover.
5. Port label normalizer + spending-vs-normal + 2-3 insight formulas.
6. Only then consider Bayesian categorization and import wizard upgrades.

---

## 7. Open questions and risks

1. **Sign convention flip** (Sure positive = outflow; LaVega negative = outflow) is the top
   correctness risk. Normalize at one boundary, unit-test direction, and decide integer cents
   before porting budget/recurring math (LaVega `amount` is a float in `model.ts`; Sure uses 4-decimal BigDecimal).
2. **SQL → in-memory re-expression.** Matching/rules/reports depend on Postgres SQL and indexes.
   LaVega computes over arrays, so pure functions are viable, but transfer matching is O(n²) in a
   date window and rules are O(rules × txs). Measure on real vault size before UI-time evaluation;
   if needed, keep a server/SQL implementation behind the pure interface.
3. **Regex dialect and DoS.** Sure uses PG ARE (`~*`) with backreference rejection and statement
   timeout. JS RegExp differs (`\m`, lookbehind, catastrophic backtracking). Rules with user
   regex need a documented dialect, length cap, and worker/Effect timeout (or linear-time engine).
4. **Tenancy/date/FX scope mismatch.** Sure's family + account-share + `include_in_finances`
   scoping threads through reports; LaVega's `entity` is a different axis. Do not port scoping;
   define one "accounts that count" predicate. Likewise replace `Date.current`/family timezone
   with an explicit `asOf` and port month-end/weekend clamping. LaVega `fx.ts` has a different FX
   model (`FxRate`, `ConversionMode`); pick one missing-rate policy per surface.
5. **Recurring detection duplication and transfer semantics.** LaVega already has
   `detectRecurringStreams`/`detectSubscriptions` with other assumptions; port the
   schedule/occurrence/commitment model rather than a second detector. A general transfer matcher
   must not swallow a BV↔privé crossing into "Eigen overboeking" — `crossScope.ts` treats that boundary deliberately.
6. **Budget vs cash separation.** Sure keeps `available_cash`/`free_cash` outside budget
   allocation arithmetic and `bills_reserved` read-only; preserve the separation.
7. **Effort realism.** The PORT rows sum to roughly 5,000-7,000 TS LOC plus storage migrations and
   UI. Do not do it in one change. LOC/effort are rough estimates from Ruby size, not measured TS.
8. **Not verified here:** no code was executed; no Rails runtime, tests or database were run;
   provider adapters, jobs, controllers and UI were inventoried by file/comment only. Legal review
   of AGPL derivation is not done. Runtime behavior may differ from the (unusually detailed) comments.
