# Research: Sure teardown — investing / portfolio domain

_Source: [`we-promise/sure`](https://github.com/we-promise/sure) community fork of Maybe Finance, local shallow clone at `/tmp/sure`, commit `562fe09` (2026-11-10, "Replace the cost-basis tracker with an in-memory lot book (#4495)"), AGPL-3.0. Read-only. All `path:line` citations are relative to the Sure clone unless prefixed `lavega:`; LaVega paths are relative to this repository. No Rails server, test suite, bundle or Docker was run — every claim about behaviour below was read from the code._

This document answers one question: what, if anything, should LaVega's investing side take from Sure's investment domain? Sure is a wide personal-finance app whose investment side is a Rails-native, database-materialized portfolio tracker with twelve broker/crypto connectors, a persisted daily holdings/balance series, and a carefully reconciled average-cost engine. LaVega's investing side is TypeScript/Effect, in-memory-first, with three first-party brokers, TWR/XIRR/risk/benchmarks already built. The two overlap on the portfolio math and not much else.

**Headline: mine the materialization and cost-basis algorithms, adopt a handful of concepts, and skip the Rails runtime, the bank-balance machinery and the broad aggregator surface.** Sure is weaker than LaVega on returns (no TWR, no benchmark comparison, no risk metrics, XIRR implemented but not wired to any page), so nothing on the returns path should be imported.

## Snapshot caveats that shape every finding

The clone is not a released build. It is a moving development tree: this HEAD replaces a `CostBasisTracker` with `Holding::LotBook` (#4495), and several investment features sit behind preview gates or are half-landed:

- `Holding::CostBasisTracker` is now a five-line alias of `LotBook` (`app/models/holding/cost_basis_tracker.rb:1-5`).
- `Portfolio::Xirr` is a complete 478-line solver with tests (`app/models/portfolio/xirr.rb:51-478`, `test/models/portfolio/xirr_test.rb:3`) but **no caller anywhere in `app/`** — grep finds only the class and its test (`app/models/portfolio/xirr.rb:51`); the class header itself says the rendering caller "is a later PR" (`app/models/portfolio/xirr.rb:46-47`).
- `Security::Split` exists with rational ratios, validations and calculator support, but no code in `app/` or `lib/` creates one; only tests and a SnapTrade repair tool read/move them (`test/models/holding/forward_calculator_test.rb:474`, `test/models/holding/reverse_calculator_test.rb:602`, `app/models/snaptrade_account/split_security_repair.rb:262`). Splits are handled but not *ingested* at this commit.
- `Security`'s asset-class / sub-class / sector / region columns are "schema only for now: nothing writes these columns yet" (`app/models/security.rb:44-51`), so the allocation grouping that reads them (`app/models/investment_statement.rb:126-170`) reports almost everything as `unclassified` on today's data.
- The portfolio hub is preview-gated by user preference (`app/controllers/portfolios_controller.rb:4`, `app/controllers/concerns/preview_gateable.rb:8-16`).

Pin anything adopted to this commit and re-verify before relying on it.

## 1. Investment data model

### 1.1 Accounts and the investment accountable

There is no `Account::Investment` model. `Account` is a polymorphic shell (`belongs_to :accountable`) and `Investment` / `Crypto` are the accountable types that mark an account as investment-side:

- `Investment` carries 70+ tax-region subtypes (`app/models/investment.rb:9-97`): brokerage/401k/Roth/IRA/529/HSA (us), ISA/LISA/SIPP/workplace pension (uk), TFSA/RRSP/FHSA/RESP (ca), super/SMSF (au), assurance-vie/PEA/Pillar 3a/Riester (eu), NPS/EPF/PPF/FD/… (in), plus generic pension/retirement/mutual fund/gold/trust/other. Each subtype maps to one of `taxable | tax_deferred | tax_exempt | tax_advantaged` (`app/models/investment.rb:99-101`), surfaced through `TaxTreatable` (`app/models/concerns/tax_treatable.rb:6-19`).
- `Crypto` has wallet/exchange subtypes and a `tax_treatment` enum, default taxable (`app/models/crypto.rb:7-18`).
- `Account#balance_type` returns `:investment` for `Investment` and `Crypto`, `:cash` for depository/credit card, `:non_cash` for property/vehicle/loan (`app/models/account.rb:904-912`). This single switch drives cash-vs-holdings accounting throughout.
- `AccountProvider` is the polymorphic join between a Sure account and a provider row (Plaid/SimpleFIN/SnapTradeAccount/IBKR/…), with `holdings` nullified on unlink (`app/models/account_provider.rb:1-28`). Provider adapters are resolved through `Provider::Factory` (`app/models/account_provider.rb:26-34`).

LaVega difference: LaVega has no tax-treatment taxonomy and no provider-row provenance on accounts. Its `Position`/`Trade` carry `broker`/`account` strings (`lavega:packages/core/src/investing/model.ts:7-24`, `:104-132`), which is the same idea without a relational model.

### 1.2 `Holding` — persisted daily position snapshot

One row per `(account, security, date, currency)`; unique index plus a partial unique `(account_id, external_id)` (`db/schema.rb`, `create_table "holdings"`). Columns: `qty` decimal(34,18), `price`/`amount` decimal(19,4), `cost_basis` decimal(19,4), `cost_basis_source`, `cost_basis_locked`, `security_locked`, `account_provider_id`, `provider_security_id`, `external_id`.

Key behaviour:

- `weight` = `amount_in_account_currency / account.balance * 100` (1 when balance 0) (`app/models/holding.rb:37-42`).
- `avg_cost`: stored `cost_basis` if known; otherwise preloaded batch answer; otherwise compute from trades (`app/models/holding.rb:56-68`). `known_cost_basis` requires positive unless locked (locked 0 is a valid airdrop/gift basis) (`app/models/holding.rb:44-49`).
- `trend` = `Trend(current: amount_money, previous: qty * avg_cost)`; nil without basis (`app/models/holding.rb:182-184`, `:386-395`).
- `day_change` compares to the latest earlier snapshot for the same security+currency (`app/models/holding.rb:186-201`).
- Cost-basis provenance priority: `manual (3) > calculated (2) > provider (1) > nil (0)`; not replaceable when `cost_basis_locked`; unlocking a manual basis only lets `calculated` replace it (`app/models/holding.rb:7-14`, `:221-251`).
- Security remap moves all account trades for the old security to the new one, merges colliding `(date,currency)` snapshots by weighted-average cost (`((c1*q1)+(c2*q2))/(q1+q2)`), locks merged rows, and records `provider_security_id` for reset (`app/models/holding.rb:267-363`).

LaVega difference: LaVega computes positions in memory per dashboard read from the encrypted broker snapshot + price store (`lavega:packages/core/src/investing/positions.ts:286-375`). It has no persisted holding rows, no cost-basis provenance, no user override/lock, and no remap flow.

### 1.3 Securities

- Identity is `(ticker, exchange_operating_mic)`; ticker uniqueness is case-insensitive within the MIC (`app/models/security.rb:93-94`), backed by an expression unique index (`db/schema.rb`, `securities`). MIC aliases are canonicalised (e.g. `WAR` → `XWAR`) and legacy rows upgrade on lookup (`app/models/security.rb:12-16, 179-232`).
- **No ISIN column.** Trading212's resolver takes ISIN but notes "the securities table has no isin column; isin is accepted but unused" (`app/models/trading212_account/data_helpers.rb:79-87`). LaVega stores ISIN on `Position`/`Trade` (`lavega:.../model.ts:14,119`) and uses OpenFIGI.
- `kind`: `standard` or `cash`; synthetic per-account cash securities are created per currency for non-primary cash (`app/models/security.rb:116-127`, uses `CASH-<account>-<currency>` tickers). This is how multi-currency cash appears as a holding.
- Provider assignment: `price_provider` per security, validated against currently-enabled securities providers (`app/models/security.rb:20-25`, `:96`); `offline` + `offline_reason` + `failed_fetch_count` + `first_provider_price_on` handle dead listings (`db/schema.rb`, `securities` columns; `app/models/security/provided.rb:187-199`). Price-provider health is a separate daily batch (`app/models/security/health_checker.rb:12-45`).
- Classification columns (`asset_class`, `asset_sub_class`, `sector`, `region`, `country_code`) exist with DB check constraints and a four-source provenance set (`provider/manual/ai/default`) but nothing writes them yet (`app/models/security.rb:44-99`; `db/schema.rb` check constraints).

### 1.4 Prices and splits

- `Security::Price` is unique per `(security, date, currency)`, with a `provisional` flag: LOCF-filled recent prices are provisional and re-fetched for 7 days (`app/models/security/price.rb:1-14`, `app/models/security/price/importer.rb:5, 329-343`).
- `Security::Split` stores an exact rational: `numerator/denominator`, ex-date unique per security, `source`, DB check `numerator <> denominator` and both positive (`app/models/security/split.rb:8-54`; `db/schema.rb`). `Security::Split.scale/unscale` round to the holdings `qty` scale of 18 so a scaled-then-unscaled quantity cannot drift into a position that never reaches exactly zero (`app/models/security/split.rb:21-47`). A split is applied at the **open** of its ex-date, before that day's trades (`app/models/security/split.rb:1-7`, `app/models/holding/forward_calculator.rb:75-86`).

### 1.5 Trades, income, fees, transfers

There is one `Trade` entryable, not a type hierarchy (`app/models/trade.rb:1-11`; `db/schema.rb` `trades`):

- Direction is the **sign of `qty`**: `buy? = qty.positive?`, `sell? = qty.negative?` (`app/models/trade.rb:59-71`).
- `activity_label` from `Transaction::ACTIVITY_LABELS` drives semantics: `Buy, Sell, Reinvestment, Sweep In, Sweep Out, Exchange, Contribution, Withdrawal, Transfer, Dividend, Interest, Fee, Other` (`app/models/trade.rb:11`, `app/models/portfolio/flow_classifier.rb:64-78`; `app/models/trade/create_form.rb:4-20`).
- Dividends and interest are trades with `qty: 0, price: 0` and a signed negative `entry.amount` (money in convention) (`app/models/trade/create_form.rb:95-150`); providers that book income as a labelled `Transaction` instead are normalised by the statement's SQL (`app/models/investment_statement/totals.rb:40-60, 71-73`).
- Fee: `trades.fee`, folded into purchase basis (`price + fee/qty`) and into entry amount (`app/models/holding/trade_calculator_helpers.rb:23-42`; `app/models/account/provider_import_adapter.rb:683-753`).
- Carried FX rate per trade: `extra["exchange_rate"]` (e.g. IBKR `fx_rate_to_base`), validated as finite > 0 (`app/models/trade.rb:37-54`, `:175-184`).
- Internal ownership-preserving movements are only `Transfer`, `Sweep In`, `Sweep Out` — deliberately not `Exchange`, because a security-for-security exchange can realise a gain (`app/models/trade.rb:13-31`).
- No dividend entity, no split trade type, no tax-lot or realised-gain table. Realised/unrealised are computed (`Trade#unrealized_gain_loss`, `Trade#realized_gain_loss`).

LaVega difference: LaVega has separate `Trade` (side buy/sell/other), `Dividend`, `CashFlow`, `CashBalance` types (`lavega:.../model.ts:39-132`, `.../dividend.ts:1-14`), which is cleaner typing; it does not carry per-trade FX rates or activity labels.

### 1.6 Valuations and balances (the account ledger)

An `Entry` is the unified ledger row (date, account, currency, amount, name, `entryable`); `Trade`, `Transaction` and `Valuation` are entryables. On top of entries, Sure materializes:

- `Valuation`: an entryable with kinds `reconciliation | opening_anchor | current_anchor` (`app/models/valuation.rb:1-41`). The opening anchor is the account's starting balance; the current anchor is the latest provider-reported total (`app/models/account/current_balance_manager.rb:36-53`); reconciliations are user "truth" resets. This is what makes reverse calculation possible: a linked account has a known ending total, and history is reconstructed backwards.
- `Balance`: one row per `(account, date, currency)` with `balance`, `cash_balance`, `start_cash_balance`, `start_non_cash_balance`, `cash/non_cash_inflows`, `cash/non_cash_outflows`, `cash/non_cash_adjustments`, `net_market_flows`, `flows_factor` (`app/models/balance.rb:1-24`). For investment accounts the split is: **cash = total − holdings value** (`app/models/balance/base_calculator.rb:54-62`), holdings value = Σ holding.amount converted to account currency at each holding's own date (`app/models/balance/sync_cache.rb:51-77`). `net_market_flows = Δholdings_value − net_non_cash_buys` (`app/models/balance/base_calculator.rb:81-94`) — i.e. price P&L excluding purchases.

### 1.7 Read-model statements (POROs, not tables)

- `InvestmentStatement` (`app/models/investment_statement.rb:3-598`): portfolio value, cash, holdings value, current holdings (DISTINCT ON latest provider day, else latest per security: `app/models/holding/current_for_investment_accounts.rb:9-47`), top holdings, allocation, unrealised gains/trend, period return, day change, contributions/dividends/interest totals, allocation ladder.
- `InvestmentStatement::Totals` (`app/models/investment_statement/totals.rb:1-121`): one SQL aggregate over a date range, cached by family/user/currency/period/`entries_cache_version` (`app/models/investment_statement.rb:582-593`).
- `InvestmentFlowStatement` (`app/models/investment_flow_statement.rb:1-77`): cash-style contribution/withdrawal total from labelled transactions (plus transfer-matched legs), distinct from buy/sell gross in `Totals`.

## 2. Materialization pipeline

This is the most portable idea in Sure. `Account::Syncer#perform_sync` calls `import_market_data` (best-effort) then `Balance::Materializer#materialize_balances`, using strategy `:reverse` for linked accounts and `:forward` for manual ones (`app/models/account/syncer.rb:8-38`). `Balance::Materializer` runs, in one transaction (`app/models/balance/materializer.rb:16-30`):

1. `Holding::Materializer#materialize_holdings` (`app/models/balance/materializer.rb:33-35`).
2. `Balance::(Forward|Reverse)Calculator#calculate` over the holdings rows.
3. Upsert balances in 2,000-row batches on `(account, date, currency)`.
4. Purge stale balances.
5. For forward strategy, refresh cached `account.balance` / `cash_balance` from the latest balance row (`app/models/balance/materializer.rb:37-65`).

At a glance, the full sync is one deterministic pipeline per account:

```text
provider sync (raw payload JSON on the item)
  └─ item processor per account
       ├─ update balance / anchor        (CurrentBalanceManager#set_current_balance)
       ├─ HoldingsProcessor              → Account::ProviderImportAdapter#import_holding
       └─ ActivitiesProcessor            → ProviderImportAdapter#import_trade / #import_transaction
  └─ Account::Syncer#perform_sync
       ├─ MarketDataImporter (best effort, rescues; never fails the sync)
       └─ Balance::Materializer (one transaction)
            ├─ Holding::Materializer   strategy = account.linked? ? :reverse : :forward
            │    ├─ calculator (Forward|Reverse) → Holding.gapfill
            │    ├─ reconcile cost basis, carry provider basis, split-adjust
            │    ├─ upsert_all holdings (2k chunks) + purge/cleanup
            ├─ Balance::(Forward|Reverse)Calculator (holdings + entries → daily cash/non-cash)
            ├─ upsert_all balances (2k chunks) + purge stale
            └─ forward only: refresh account.balance / cash_balance cache
```

The properties worth noting are (a) one strategy switch (`account.linked?`) selects the whole reconstruction direction, (b) everything is upserted on natural keys so a crashed/retried sync converges, and (c) provider rows are never overwritten by calculated ones (`app/models/account/syncer.rb:8-38`; `app/models/balance/materializer.rb:16-30`; `app/models/holding/materializer.rb:52-157`).

### 2.1 `Holding::Materializer` (`app/models/holding/materializer.rb:1-334`)

- Chooses the calculator: reverse if `strategy == :reverse` and a `PortfolioSnapshot` exists, else forward (`:326-333`).
- Persists with `upsert_all(unique_by: %i[account_id security_id date currency])`, 2,000 rows per flush (`:6-7, 52-157`).
- Provider-sourced rows are authoritative and never overwritten (`:77-83`).
- Cost basis is reconciled through `Holding::CostBasisReconciler` with incoming source `"calculated"` (`:85-89`). When an earlier calculated basis must be cleared because the position now includes a transfer-in, it writes `cost_basis = nil, cost_basis_source = nil` (`:106-118`).
- If the calculator produced no basis, it carries forward the most recent provider basis for that security (per-share, split-adjusted to the holding's share count, FX-converted at the provider snapshot date) (`:126-150`, `:241-259`, `:269-284`).
- Cleans up calculated rows that collide with provider snapshots (same security+date, currency ignored) and rows on the latest provider snapshot date (`:184-225`).
- Purges non-provider rows outside `[start_date, today]` or for securities no longer traded (`:309-324`).

`Holding::CostBasisReconciler.reconcile` encodes the write rule: provider 0/nil is "unknown"; locked never overwritten; else `Holding#cost_basis_replaceable_by?` decides by source priority; no-op when value and source are unchanged (`app/models/holding/cost_basis_reconciler.rb:9-66`).

`Account::ProviderImportAdapter#import_holding` is the provider write path — it matches by `external_id`, then by `provider_security`, then by `(security,date,currency)`, guards cross-provider collisions, carries user corrections from the previous snapshot day, respects `security_locked`/`cost_basis_locked`, and only deletes future holdings when every provider on the account allows it (`app/models/account/provider_import_adapter.rb:427-681`). `delete_future_holdings` is used by snapshot-style providers (Plaid) so a shorter position list removes stale rows.

### 2.2 Forward calculator — trades are the source of truth

`app/models/holding/forward_calculator.rb:19-34`:

```
for date in account.start_date..today:
    portfolio = apply_splits(portfolio, date)          # scale qty at open
    portfolio = apply_trades(portfolio, trades(date))  # qty += signed trade qty
    emit holding per security: qty, price, amount=qty*price, basis=lot_book.avg_cost
```

- Starting portfolio is empty and prices are read from `Holding::PortfolioCache` (DB prices priority 1, trade prices priority 2, holding prices priority 3, income trades with `qty == 0` excluded from price sourcing) (`app/models/holding/portfolio_cache.rb:38-117, 119-140`).
- Same-day, same-created-at trades are replayed **acquisitions before disposals**, because a sale must precede the purchase it sells from only if id order says so (`app/models/holding/portfolio_cache.rb:115-122`).
- A transfer-in marks the security unknown until a genuine downward crossing through zero (`app/models/holding/forward_calculator.rb:96-128`).
- Days without a price emit no holding; `Holding.gapfill` then carries the previous snapshot forward, restating through any split ex-date in the gap (`app/models/holding/gapfillable.rb:5-49, 63-82`).

### 2.3 Reverse calculator — provider snapshot is the source of truth

`app/models/holding/reverse_calculator.rb:1-245`. Used for linked accounts, which give current positions but often no trade history.

- Starts from `Holding::PortfolioSnapshot`: the latest provider holding date per security, or the latest row per security for accounts with no provider snapshot; includes trade-only securities at qty 0 (`app/models/holding/portfolio_snapshot.rb:12-57`). Provider quantities are brought forward through any splits between the observed date and today (`app/models/holding/reverse_calculator.rb:50-75`).
- Walks `Date.current.downto(account.start_date)`: at each date it subtracts the day's trades, then undoes any split that went ex that day (split effective at the open, so reversing happens after the day's trades are undone) (`:36-45`, `:77-99`).
- Today's holdings use the provider's own holding price (what the provider sent); historical rows use market-data prices (`:40-41`, `:101-123`).
- Cost basis is precomputed forward through the trade replay: buys raise the running average, sells relieve at it, a full liquidation resets, and a transfer-in opens an "unknown" span that closes only on a genuine downward crossing through zero (`:125-212`). Basis at a date is found by binary search over that security's basis snapshots (`:227-244`).
- Because the account may hold shares before its first imported trade, the replay seeds running positions by walking the snapshot back through every trade and split (`:140-159`).

Honest limits, stated in the code: the reverse calculator assumes the snapshot already includes trades it has no record of ("this calculator has always assumed the snapshot already includes them, and nothing here changes that", `:56-61`); the cost-basis replay of historical disposals uses reconstructed quantities, not broker-reported lots.

## 3. Portfolio math (exact formulas)

### 3.1 Quantity history

Trade delta is signed `trades.qty` (positive buy, negative sell); splits are quantity rescales, not trades. Forward: `q(d) = Σ_{t.date ≤ d} qty_t` applied on top of repeated split scaling. Reverse: `q(d−1) = unscale(q(d) − Σ trades(d), ratio(d))`, with the split applied at that day's open (`app/models/holding/reverse_calculator.rb:77-99`). Split scaling is exact rational arithmetic rounded once to `QTY_SCALE = 18` (`app/models/security/split.rb:41-47`), and gap-fill restates price and per-share basis by the inverse ratio while recomputing `amount = qty * price` rather than carrying it (`app/models/holding/gapfillable.rb:63-82`).

### 3.2 Cost basis — average cost with lot provenance (not FIFO)

`Holding::LotBook` (`app/models/holding/lot_book.rb:1-150`) is authoritative for trade-derived basis:

- Buys: `C += price_eff * qty`, `Q += qty`; a lot is recorded with `source_id`, `acquired_on`, `qty`, `unit_cost`. Unknown price sets `@unknown = true` (`:46-54`).
- `price_eff = FX_{trade.date}(trade.price, to account currency) + FX(fee)/qty` — an acquisition fee is part of the basis; disposal fees are not (they belong on the proceeds side) (`app/models/holding/trade_calculator_helpers.rb:23-57`).
- Sells: `c̄ = C/Q`; `relieved = min(|qty|, Q)`; `C −= c̄ * relieved`; `Q −= relieved`; if `Q ≤ 0` the pool resets so a repurchase starts clean (`app/models/holding/lot_book.rb:64-80`). So **average cost never changes on a sale under average costing** — this is the textbook moving-average method, expressed as a running pool with pro-rata lot relief for display.
- Splits: total cost stays; `Q ← scale(Q, ratio)`; each lot's `unit_cost ← unit_cost * denominator/numerator` (`:85-93`).
- `average_cost = C/Q` (nil when Q=0 or the pool contains an unknown-cost unit) (`:96-101`).
- Internal inbound transfer: lot with `nil` unit_cost, position basis reported unknown **as a whole** — averaging purchases alone over units that were not bought is rejected as fabrication; an outbound transfer relieves at the running average like a sell (`app/models/holding/forward_calculator.rb:104-128`, `app/models/holding/lot_book.rb:56-62`; reasoning at `:1-25`).

Batch fallback when a holding has no stored basis: one SQL query over positive-qty trades up to the holding date,
`Σ((trades.price*trades.qty + trades.fee) * COALESCE(trades.extra->>'exchange_rate', exchange_rates.rate)) / Σ(trades.qty)`,
with an internal-movement guard returning nil and a missing/non-positive FX rate returning nil rather than 1:1 (`app/models/holding.rb:89-164`, `:399-427`). Preloading for many holdings shares the exact same SQL so a page cannot answer differently per row (`app/models/holding.rb:96-118`).

LaVega difference: LaVega already implements moving-average basis over the trade replay, with commission in the buy leg and average-cost relief on sells (`lavega:packages/core/src/investing/positions.ts:79-183`). It returns `broker-unrealized` when the trade set does not reconcile to the broker quantity (`:183-206`, `:79-93`). It does **not** model internal transfers as basis-unknown spans (any `side: "other"` forces the broker-cost fallback, `:109-112`), nor lock/manual overrides, nor split restatement of basis.

### 3.3 Realised and unrealised P&L

- Unrealised, per holding: `U = amount − qty*avg_cost`; percent = `U / (qty*avg_cost)` (`app/models/holding.rb:386-395`; `app/models/trend.rb:49-63`, which divides by `|previous|`).
- Per trade (legacy helper, not what the report uses): `current = price_now*qty`, `previous = price*qty + fee` (`app/models/trade.rb:80-89`).
- Realised, per disposal `t` (`app/models/trade.rb:159-267`):

```
H       = latest holding snapshot with same security and date ≤ t.entry.date
c̄       = H.avg_cost                       # Money in H.currency
basis   = c̄ * |qty_t|
proceeds = FX_{t.currency → H.currency, date = t.entry.date}(price_t*|qty_t| − fee_t)
realized = proceeds − basis
```

The exact-date conversion is deliberate: the trade's own `extra.exchange_rate` wins, otherwise `exchange_rates(from,to,exact date)`; a missing or non-positive rate returns **nil**, not zero and not 1:1 (`app/models/trade.rb:231-267`). Internal movements return nil (no realised gain for an asset moved to another account you own) (`:209-215`). A disposal fee reduces proceeds (`:221-222`), while the acquisition fee was already in the basis (`trade_calculator_helpers.rb:33-42`).

Report assembly: sells in the period are preloaded with holdings and FX rates (one query for both) (`app/controllers/reports_controller.rb:552-572`), then grouped by account tax treatment into `{unrealized, realized, total, per-trade}` (`:613-649`). Unrealised converts at today's FX, realised at each trade's own date (`:582-610`). This is the only place in Sure that reports realised gains.

LaVega difference: LaVega computes realised gain in the trade replay (`gross_eur − removed − fee_eur`) and unrealised as `marketValue − remainingCostBasis`, with dividends added to total return and per-position XIRR (`lavega:.../positions.ts:114-183`). Sure's distinguishing value is the *snapshot-based* basis source (works when trade history is partial) and the tax-treatment report grouping.

### 3.4 Returns — what exists, what does not

No TWR. No benchmark. No risk metrics (grep for `time.weighted`, `money.weighted`, `benchmark` across `app/` finds only the XIRR comment, goals-pace wording, and provider/eval code). What exists:

- **Period "return"** (`InvestmentStatement#period_return_trend`, `app/models/investment_statement.rb:216-285`):

```
R  = Σ_{d in period} balance_d.net_market_flows * FX_d(account → family)
V0 = Σ_account end_balance of latest balance row with date < period_start, converted at period_start
Trend(current: V0 + R, previous: V0)  →  displayed percent = R / |V0|
```

`net_market_flows` is price-only P&L (`Δ holdings value − net buys`, `app/models/balance/base_calculator.rb:81-94`), so this is a holding-period market return over the opening balance. It does **not** chain subperiods, does not remove intraperiod contributions from the denominator, and returns nil when `V0 == 0`. It is not a TWR and should never be presented as one.

- **Unrealised trend** (`app/models/investment_statement.rb:195-214`): sum family-converted `amount` minus sum family-converted `qty*avg_cost`, over holdings with a known basis; percent = gap over cost.
- **Day change** (`app/models/investment_statement.rb:288-306`; `app/models/holding.rb:186-201`): sum of (today amount − previous snapshot amount) at today's FX.
- **XIRR** (`app/models/portfolio/xirr.rb:51-478`), complete but unwired:

```
NPV(r) = Σ_i a_i / (1+r)^{t_i},  t_i = (date_i − date_0)/365
negative a = money leaving the investor, positive = returning; terminal portfolio value is the final positive flow
same-date flows are summed before solving
root: Newton from r=0.1, then bisection over [low_endpoint, 1e7]
  low_endpoint is derived per series by walking up from -1+EPSILON until NPV is finite (never a fixed floor)
  residual tolerance = 1e-12 * Σ|a_i| (scale-invariant); rate tolerance 1e-9
  geometric 128-step sub-bracket scan if the outer bracket shows no sign change
raise NoSignChangeError / NoDurationError / ConvergenceError; #ambiguous? = Descartes sign-change count > 1 (conservative)
```

`days_per_unit` lets a caller ask for a period rate rather than an annualised one (`:117-134`). Multiple roots are a known, documented choice; `ambiguous?` exists so a renderer can hedge (`:22-47, 142-155`). Caveat: the file header says "the caller that renders this is a later PR" (`:46-47`), and grep confirms no caller.

LaVega difference: LaVega is **ahead** here. It has gap-safe TWR chaining (`lavega:docs/investing/DASHBOARD.md:109-126`, `lavega:packages/core/src/investing/benchmarks.ts:103-160`), since-window XIRR (`benchmarks.ts:180-249, 253-274`), benchmark XIRR/beta/alpha/drawdown/volatility (`benchmarks.ts:300-414`, `risk.ts:32-258`). Sure's XIRR is still useful as a reference implementation for multi-root detection and error taxonomy; its higher-level return logic is a regression risk if imported.

What Sure does **not** have — verified absent by grep and by reading the reports/statement code:

- **TWR.** No subperiod chaining, no deposit-neutral return. The only period figure is market-P&L / opening balance (`app/models/investment_statement.rb:216-285`).
- **Benchmark comparison.** No benchmark selection, no benchmark series, no beta/alpha versus an index. "Benchmark" appears in goals only (`app/controllers/goals_controller.rb:308-320`).
- **Risk metrics.** No volatility, Sharpe, max drawdown, beta. Trailing return stats do not exist outside the goal pace.
- **IRR/MWR on screen.** `Portfolio::Xirr` exists but no controller/statement/partial calls it (`app/models/portfolio/xirr.rb:46-47` plus grep).
- **Money-weighted-by-account attribution.** XIRR is family-level when it lands; there is no per-account money-weighted return.
- **FIFO / tax lots.** Average cost only; no lot selection, no wash-sale or withholding-tax handling.
- **Income classification beyond Dividend/Interest.** Distributions, staking rewards, return of capital etc. are mapped into those two buckets or `Other` by each connector (`app/models/snaptrade_account/activities_processor.rb:51-66`), not modelled as income types.
- **Multi-currency return decomposition.** FX effects are not separated from security performance in the period return.

### 3.5 Cash, contributions, dividends, interest

`InvestmentStatement::Totals` (`app/models/investment_statement/totals.rb:33-121`), one aggregate keyed on entry date range:

```
contributions = Σ |entry.amount * FX_entry_date|   where trade.qty > 0 and label not in ('Dividend','Interest')
withdrawals   = Σ |entry.amount * FX_entry_date|   where trade.qty < 0 and label not income
dividends     = −Σ entry.amount * FX_entry_date    where label = 'Dividend'     (income is stored negative)
interest      = −Σ entry.amount * FX_entry_date    where label = 'Interest'
trades_count  = COUNT(trades.id)
```

Income can live on a labelled `Transaction` rather than a trade (Trading212/IBKR/Questrade/SnapTrade/Indexa/Kraken fiat earn); the SQL joins both entryables and excludes pending transactions (`:40-70, 75-103`). Missing FX falls back to 1:1 **here** (`COALESCE(er.rate, 1)`), unlike the realised-gain path — an inconsistency to be aware of.

`InvestmentFlowStatement` answers a different question — external money in/out, not gross buys/sells — from `Contribution`/`Withdrawal`-labelled transactions and transfer-matched legs, excluding moves between investment/crypto accounts (`app/models/investment_flow_statement.rb:23-76`).

`Portfolio::FlowClassifier` is the canonical five-class split used by allocation/income/contribution-room paths (`external_inflow`, `external_outflow`, `income`, `fee`, `internal`) with both a Ruby `#classify` and a generated SQL `#sql_case`, plus a parity test (`app/models/portfolio/flow_classifier.rb:1-324`). Rules: excluded/pending → nil; a transfer's standard leg → fee; labels decide income/fee/internal; `Contribution`/`Withdrawal` resolve to internal when the linked transfer's counterpart account is inside the given scope; a security transfer is internal only when the opposite-quantity `Transfer` trade exists on the same date in another in-scope account; otherwise direction comes from trade quantity sign or transaction amount sign (negative = money in) (`:64-78, 167-186, 223-264`).

### 3.6 FX conversion

- `exchange_rates(from, to, date)` unique; rate must be positive (DB check) (`db/schema.rb`). Provider rows are validated before storage; zero/NaN/negative are rejected as failed lookups (`app/models/provider/exchange_rate_concept.rb:11-59`).
- Per-trade rate priority: trade `extra["exchange_rate"]` first, then the table's rate for that exact date (`app/models/holding/trade_calculator_helpers.rb:44-57`; `app/models/holding.rb:70-87`).
- Cost basis converts at the trade date and never re-drifts; missing rate = unknown basis, not 1:1 (`trade_calculator_helpers.rb:44-57`).
- Family-currency aggregation converts at today's rate, with `|| 1` fallback for aggregation only, explicitly labelled as potentially wrong (cash) or silently wrong (statements) (`app/models/investment_statement.rb:320-343`; `app/models/balance/sync_cache.rb:51-77`).
- The market-data importer derives exact pairs: every non-account entry currency → account currency *and* family currency, account currency → family, and each foreign price currency → account currency, then imports each pair from its earliest needed date (`app/models/account/market_data_importer.rb:15-60, 91-121`).

### 3.7 Allocation

By security (`app/models/investment_statement.rb:82-124`): roll up current holdings per security in family currency, sort descending, weight = `value / max(portfolio_value, holdings_total) * 100`. The `max(...)` is a floor over stale cached balances and margin-negative cash (`:519-533`) — weights are % of the invested part and sum below 100 when cash exists.

By classification (`:126-170, 376-517`): `asset_class`, `asset_sub_class`, `sector`, `region`, each with:
- `security.<column>.presence || "unclassified"` (a real bucket, so a fully unclassified portfolio is told exactly that) (`:138, 479-483`);
- account cash placed where the grouping says cash belongs: `liquidity`/`cash` for asset class/sub-class, `unclassified` for sector/region, one row per portfolio for cash (`:376-436, 451-468`);
- per-account cash = `max(balance − Σ holdings, 0)` per account, converted at latest FX, never netted across accounts, never `Account#cash_balance` (which can double-count holdings) (`:438-457`);
- sub-class drill-down scoped by parent asset class because `unclassified` repeats across classes (`:146-158, 485-494`).

LaVega difference: LaVega's allocation is instrument/entity only (`lavega:.../allocation.ts:4-87`) plus sector exposure from fundamentals/corrections (`summary.ts:232-314`); no cash bucket, no asset-class ladder, no region. LaVega does not have tax treatments.

### 3.8 Splits (handled, but not ingested)

Where splits affect math: forward/backward quantity scaling, basis restatement (total cost unchanged, per-share basis inverse), gap-fill crossing an ex-date, provider cost-basis carry-forward restated across splits between snapshot and holding date, snapshot brought forward to today, and split-aware replay ordering (split before trades on its ex-date) (`app/models/holding/forward_calculator.rb:75-86`; `app/models/holding/gapfillable.rb:52-82`; `app/models/holding/materializer.rb:269-307`; `app/models/holding/reverse_calculator.rb:62-99, 214-221`). LaVega handles split adjustment of *share units* at the dashboard boundary from Yahoo bars (`lavega:.../splits.ts:1-27`), not basis.

### 3.9 Benchmarks / risk — absent

No benchmark concept, no comparison series, no volatility/beta/alpha/drawdown. Goals use "benchmark" only in the sense of a monthly pace target (`app/controllers/goals_controller.rb:308-320`). Nothing to port; LaVega should not regress.

## 4. Market data and price providers

`Provider::Registry` is a concept registry: `exchange_rates`, `securities`, `llm`, `property_valuations`, `classification` (`app/models/provider/registry.rb:6-19`).

- Securities providers: `twelve_data, yahoo_finance, tiingo, eodhd, alpha_vantage, mfapi, binance_public, moex_public, tinkoff_invest, mansa` (`app/models/provider/registry.rb:233-249`).
- Exchange-rate providers: `twelve_data, yahoo_finance, moex_public, frankfurter` (`:235-236`).
- Provider instances are memoised by the registry and filtered by `Setting.enabled_securities_providers` (`app/models/security/provided.rb:8-29`).
- Security search fans out across all enabled providers concurrently with a shared 8 s deadline, keeps partial results when one provider times out, dedupes on `ticker|MIC|provider`, and ranks exact ticker > prefix > name > rest, country match second (`app/models/security/provided.rb:48-114, 149-169`).
- A security resolves through a stamped `price_provider`; if that provider becomes unavailable it is **skipped rather than silently queried against a different provider** (`app/models/security/provided.rb:178-199`). This is exactly the provider-affinity rule LaVega's router wants.
- `find_or_fetch_price` caches a single day's quote into `security_prices`; failures are logged once per security per day (`app/models/security/provided.rb:201-248`).
- `Security::Price::Importer` is the real workhorse: provider fetch clamped to `max_history_days` and to listing start (`first_provider_price_on`), per-day LOCF gap fill, provisional flag for recent LOCF rows, preserve user-edited non-provisional rows, upsert on `(security,date,currency)` (`app/models/security/price/importer.rb:19-149, 157-173, 220-362`). The listing-start fallback (IPO/listing later than the trade) and `first_provider_price_on` persistence are a real correctness idea (`:33-76, 129-148`).
- Manual closes for untracked securities: batch upsert with all-or-nothing validation, max 1,000 rows, only for offline/untracked securities (`app/models/security/manual_price_import.rb:1-60`).
- Provider implementations: Yahoo is the largest (1,292 lines) with cookie+crumb auth, health-state caching/throttling, browser UA pool, 10-year lookback, FX via `<FROM><TO>=X` symbols, and chart-based price fetch (`app/models/provider/yahoo_finance.rb:3-58, 121-190, 330-386, 940-1129`). TwelveData/Tiingo/EODHD/AlphaVantage/MFAPI/BinancePublic/MOEX/Tinkoff/Mansa all implement the same `SecurityConcept` interface (`search_securities`, `fetch_security_info`, `fetch_security_price(s)`, optional `max_history_days`) (`app/models/provider/security_concept.rb:1-37`). Frankfurter v2 is the ECB-style FX option, keyless, 201 currencies, server-side weekend carry (`app/models/provider/frankfurter.rb:1-60`).

LaVega difference: LaVega routes market data through its own provider seam (`lavega:docs/investing/STACK.md:27-39`) with Yahoo local, marketstack hosted, Frankfurter FX, OpenFIGI ISIN resolution. Sure's contribution is not the provider list but the importer's failure semantics (LOCF + provisional + listing clamp + provider affinity) and the search/ranking/health behaviours.

## 5. Broker / securities connectors

All connectors share: `Provider::Factory` registry, item/account tables storing raw payload JSON, a syncer that imports then processes, `Account::ProviderImportAdapter` for normalisation, per-row `rescue` → `DebugLogEntry`, and item `status: :requires_update` on auth failure. The `Sync` record is an AASM state machine (`pending → syncing → completed | failed | stale`) with parent/child syncs and sync stats (`app/models/sync.rb:1-80`). Bank-investment hybrids (Plaid/SimpleFIN/Lunchflow/EnableBanking) implement `Investments::HoldingsProcessor`, `BalanceCalculator`, `TransactionsProcessor` per provider under `app/models/<provider>_account/investments/`.

| Connector | Auth model | Data pulled | Sync / normalisation | Positions vs trades | Failure handling |
|---|---|---|---|---|---|
| SnapTrade | OAuth 2.0: authorization-code+PKCE (browser) or RFC 8628 device code (public client); per-item access/refresh tokens stored encrypted; Bearer data calls (`app/models/provider/snaptrade.rb:1-60`; `app/models/snaptrade_item/provided.rb:14-59`) | Accounts, positions, activities (365-day chunks, max 3 years) for linked accounts only (`app/models/snaptrade_item/importer.rb:7-13, 21-42`) | Activity-type rule table maps ~50 SnapTrade types to Sure labels and cash-flow direction (`app/models/snaptrade_account/activities_processor.rb:7-70`); cash-equivalent positions de-duplicated against the API's cash figure (`app/models/snaptrade_account/processor.rb:100-125`); non-primary-currency cash becomes synthetic cash holdings (`app/models/snaptrade_account/holdings_processor.rb:42-76`) | Both. Positions → holdings; activities → trades/transactions; options/futures/CFDs filtered out (`app/models/provider/snaptrade.rb:54-58`) | Per-row rescue + debug log; auth → `requires_update`; incremental sync only after 10 stored activities (`app/models/snaptrade_item/importer.rb:11-13`) |
| IBKR Flex | Flex Web Service token + numeric Query ID; two-step `SendRequest` → poll `GetStatement` every 3 s, max 20 attempts, exponential-backoff retries on network errors (`app/models/provider/ibkr_flex.rb:19-28, 50-143`) | One XML with FlexStatements per account: open positions (lots), trades, cash transactions, cash report, position values, equity summary (`app/models/ibkr_item/report_parser.rb:6-17, 25-90`) | Positions grouped by `(conid, currency, report_date)`; quantity and basis aggregated only over lots with both parseable position and `cost_basis_price`; amount = qty × mark price (`app/models/ibkr_account/holdings_processor.rb:26-115`). Trades: signed qty from `buy_sell`, commission folded into `trades.fee` and entry amount, carried `fx_rate_to_base`; legacy standalone commission entry destroyed to avoid double count (`app/models/ibkr_account/activities_processor.rb:36-95, 137-207`) | Both. Cash transactions only `DEPOSITS/WITHDRAWALS` and `DIVIDENDS` (`:4, 97-135, 228-247`); dividends require conid | Rows not matching support predicates are skipped silently; auth/config errors set `requires_update` (`app/models/ibkr_item/syncer.rb:51-57`); balance anchor dated to statement date, with rollback on failure (`app/models/ibkr_account/processor.rb:25-99`) |
| Trading 212 | HTTP Basic `API_KEY:API_SECRET`, live or demo base URL (`app/models/provider/trading212.rb:19-48, 80-96`) | Account summary, positions, instruments metadata, paged order history, dividends, transactions (`:50-72`) | Page limit 50, `nextPagePath` cursor, `sleep(10)` between history pages against 6 req/min, cap 200 pages (`:98-116`); fills are the trade unit (one trade per fill, amount = fill.price × fill.quantity); signed amount by order side; GBX→GBP conversion; position `averagePricePaid` becomes cost basis; instrument ticker `AAPL_US_EQ` reduced to `AAPL` (`app/models/trading212_account/activities_processor.rb:46-109`; `holdings_processor.rb:30-79`; `data_helpers.rb:36-53`) | Both. Positions are current-day only; orders/dividends/transactions give history | Per-row debug log; instrument fetch failure reuses cached payload (`app/models/trading212_item/importer.rb:49-61`); auth errors → `requires_update` |
| Sharesight | OAuth2 client-credentials (id+secret → 30-min bearer, re-fetched once on 401) (`app/models/provider/sharesight.rb:34-86`) | Portfolios, performance report (`include_sales: true`), trades, payouts, cash accounts, cash transactions (`:46-72`) | Holdings + trades + cash routing + funding mirror (`app/models/sharesight_account/processor.rb:12-27`); cash drift computed as `cash_anchor − Σ entries`; foreign trades converted with trade rate or dated table rate (`:35-82`) | Both; sold holdings retained to locate trades; "limited" holdings on cheaper plans skipped | Drift notices compare held vs traded units at 8 dp (`:84-109`); per-entry debug logging |
| Indexa Capital | Username/document/password session or pre-generated API token (`app/models/provider/indexa_capital.rb:23-32`) | Fiscal results (positions with cost basis), portfolio fallback, performance NAV, me (`:34-84`) | No activities endpoint at all — treated as positions-only (`:86-91`); holdings payload may be time series, so API total preferred and per-security latest snapshot deduped (`app/models/indexa_capital_account/processor.rb:72-110`) | Positions only | Provider errors per call; balance anchor set from reported total |
| Questrade | OAuth: **single-use rotating refresh token** valid 7 days, access ~30 min, `api_server` returned per exchange; exchange must be serialised and the new refresh token persisted immediately (`app/models/provider/questrade.rb:1-26`); activities capped at 31-day windows (`:22-25`) | Accounts, positions, activities | Activities processor maps Questrade actions to labels; data helpers resolve securities by symbol (`app/models/questrade_account/activities_processor.rb`, `holdings_processor.rb`) | Both | Token rotation is the main failure surface; auth errors handled in syncer |
| Coinbase | API key + secret (v2 accounts/transactions/buys) (`app/models/provider/coinbase.rb:29-60`) | Accounts, buys, sells, transactions; staking/interest/transfers mapped to Dividend/Interest/Transfer/Exchange; fiat deposits/withdrawals deliberately unhandled because crypto accounts have zero cash (`app/models/coinbase_account/processor.rb:1-41`) | `PartialResultError` carries earlier pages when a later page rate-limits, so a fetch does not discard good data (`app/models/provider/coinbase.rb:10-21`) | Transactions → trades; balance from accounts | Partial results surfaced; per-row debug log |
| Kraken | API key + secret, signed private calls, nonce generator, rate-limitable (0.5 pt/s decay; 1 pt/call; history endpoints 4 pts each paced at 8 s) (`app/models/provider/kraken.rb:1-44`) | BalanceEx, TradesHistory, Ledgers (paged up to 200) | Ledger processor: skips `trade` (handled by TradesHistory) and margin/transfer types to avoid double count; fiat ledger rows → cash Transactions, crypto rows → Trades with qty and zero amount, fee-only rows split so transfer matching works (`app/models/kraken_account/ledger_processor.rb:1-30, 100-210`) | Both | Per-entry idempotency by prefixed external id, loaded once in memory for ~10k-entry syncs (`:46-56`) |
| Binance | API key + secret, HMAC-signed GETs; spot/margin/simple-earn/futures (`app/models/provider/binance.rb:15-60`) | Spot, margin, Earn flexible/locked, futures positions and paged trades; converted to USD then to account currency (`app/models/binance_item/importer.rb:18-30`; `app/models/binance_account/processor.rb:12-15, 60-130`) | Trade windows (24 h spot / 7 d futures) with `fromId` pagination; commission converted (base asset via trade price) (`:171-230, 514-527`) | Both | Per-market errors skipped; contract/futures symbol set from raw payload |
| CoinSpot, CoinStats, on-chain | CoinSpot key/secret; CoinStats key + linked exchanges/wallets; on-chain public address per chain, optional explorer key (`app/models/provider/onchain_wallet_adapter.rb:1-50`) | On-chain: `Snapshot(assets, movements, truncation flags)` for bitcoin + 6 EVM chains (Ethereum, Base, Arbitrum, Optimism, Polygon, Gnosis) + Solana (SPL) + Cosmos + Polkadot; contracts case-sensitive only for non-EVM (`app/models/onchain/chains.rb:77-141`; `app/models/onchain/snapshot.rb:1-57`) | One adapter interface per chain; downstream is chain-free (`app/models/onchain/chains.rb:5-8`); holdings that disappear are zeroed, not deleted (`app/models/provider/onchain_wallet_adapter.rb:46-50`) | Snapshot + movements | Truncation flags reported instead of silently truncated; chain errors normalised to Unreachable/RateLimited (`app/models/onchain/chains.rb:11-18`) |
| Plaid / SimpleFIN / Lunchflow / EnableBanking / Wise | Institution OAuth/aggregator tokens (`app/models/plaid_item/provided.rb`, `simplefin_item/provided.rb`, `lunchflow_item/provided.rb`, `enable_banking_item/provided.rb`); Wise token + statement replay (`app/models/wise_item/balance_replay.rb`) | Investments endpoints for the first four: holdings, transactions, balances (`app/models/plaid_account/investments/*.rb`, `app/models/simplefin_account/investments/*.rb`, `app/models/lunchflow_account/investments/*.rb`) | Provider-specific holdings/transactions processors feed the same `ProviderImportAdapter`; reverse calculation is the norm because these give current positions, not full history | Mostly positions + transactions; no trade-level certainty | Per-item `requires_update`; `Sync` state machine; stale after 24 h (`app/models/sync.rb:1-8`) |

Contrast with LaVega's connectors: LaVega has exactly three first-party adapters (DeGiro CSV, IBKR Flex, Trading 212 API) behind a one-method read-only `BrokerAccessAdapter` with explicit per-section `complete/partial/unavailable` states and `cashHistory` coverage (`lavega:docs/investing/CONNECTORS.md:39-60`, `:122-150`). Sure's model is broader but weaker on provenance: a single `problems` channel is largely Rails logs/DebugLogEntry rather than typed per-section results, and there is no `cashHistory` equivalent. LaVega's typed `BrokerResult` and cash-coverage contract are better than Sure's; Sure's normalisation layer (`ProviderImportAdapter`) and its per-connector activity-type maps are the parts worth reading.

## 6. Feature inventory (investment-facing)

- **Portfolio hub** (preview-gated): one page backed by `InvestmentStatement`, sections registered via `Portfolio::SectionRegistry`, currently a single `accounts` section of balance cards, user-orderable/collapsible through preferences (`app/controllers/portfolios_controller.rb:1-40`; `app/models/portfolio/section_registry.rb:16-91`; `app/views/portfolios/_accounts.html.erb:1-8`).
- **Account holdings tab**: table of brokerage cash row + holdings with weight, average cost, market value, return; missing-price tooltip; crypto quantity formatting (`app/views/holdings/index.html.erb:28-53`; `_cash.html.erb:1-38`; `_holding.html.erb:1-56`).
- **Holding drawer/actions**: edit per-share cost basis (locks it; total basis accepted and divided by qty; zero valid for gifted shares), unlock to recalculate, delete holdings+entries when the provider allows, remap to another security (combobox search), reset to provider security, sync 31 days of prices for one holding (`app/controllers/holdings_controller.rb:7-154`).
- **Trade CRUD**: create buy/sell/reinvestment/sweep/transfer, dividend, interest, fee, deposit/withdrawal; edit with user-modified protection; unlock for sync (`app/controllers/trades_controller.rb:1-120`; `app/models/trade/create_form.rb:27-183`).
- **Reports → Investment performance** card: portfolio value, total return (unrealised trend), period return, period contributions/withdrawals, top 5 holdings with weights and returns, gains by tax treatment split into realised/unrealised and per-security/per-trade detail, accounts summary (`app/controllers/reports_controller.rb:516-650`; `app/views/reports/_investment_performance.html.erb:1-234`).
- **Reports → Investment flows**: contributions, withdrawals, net flow for the period (`app/models/investment_flow_statement.rb:23-48`; `_investment_flows.html.erb:1-44`).
- **Investment accounts**: tax-region-aware subtype picker, tax treatment badge, brokerage cash split per account through the balance machinery (`app/models/investment.rb:9-150`; account balance logic above).
- **Goals**: goals can be funded by `Investment`/`Crypto` accounts (`FUNDABLE_ACCOUNT_TYPES`, `app/models/goal.rb:105`); an investment-backed goal auto-switches to the "contributions basis" so a market swing does not move it (`:1377-1384`), where progress uses `basis = max(balance − Σ balances.net_market_flows, 0)`, floored at 0, with shared-pool earmark math across concurrent goals (`:1120-1180`).
- **CSV trade import**: date/ticker/exchange/currency/qty/price columns; qty sign → Buy/Sell; rows import-locked against sync (`app/models/trade_import.rb:1-108`).
- **AI assistant tooling**: `get_holdings` (paged, filter by account/security, returns value/cost basis), `get_valuations`, `record_valuation` (`app/models/assistant/function/get_holdings.rb:1-60`).
- **API v1**: read/write holdings, trades, securities, security prices, balances, valuations (`app/controllers/api/v1/{holdings,trades,securities,security_prices,balances,valuations}_controller.rb`).

LaVega feature difference: LaVega has a dashboard (positions, net worth, agents), risk/benchmarks, a portfolio agent, personal-net-worth merge. It has no tax-treatment view, no realised-gains report, no holdings/trade CRUD, no goals linkage, no cost-basis editing. Sure has no TWR/risk/benchmark/agents. Complementary, not substitutable.

## 7. Code quality, tests, limitations

**Good**
- Tests are deep and targeted: 1,183 Minitest files (`find test -name '*_test.rb' | wc -l`), including per-calculator, per-provider and property-ish tests: `test/models/holding/lot_book_test.rb` (457 lines of arithmetic edge cases), `test/models/holding/forward_calculator_test.rb`, `test/models/holding/reverse_calculator_test.rb`, `test/models/holding/materializer_test.rb`, `test/models/portfolio/xirr_test.rb`, per-connector processor/parser tests (`test/models/ibkr_item_report_parser_test.rb`, `test/models/trading212_*_test.rb`, `test/models/snaptrade_item_oauth_test.rb`, …). Plus 36 RSpec request specs including `spec/requests/api/v1/holdings_spec.rb`, `trades_spec.rb`, `securities_spec.rb`.
- The code documents its own invariants and failure modes at unusual length (basis unknowns, FX direction, split timing, negative-quantity oversells, provisional prices). That is a free spec for any port.
- Idempotent write paths: `upsert_all` on natural keys, external-id-scoped entries, `find_or_initialize_by(external_id, source)`, commission de-duplication, cash-equivalent de-duplication.

**Limitations / caveats**
- Moving-average only. No FIFO/LIFO/specific-lot, no tax-lot table, no wash-sale handling, no dividend withholding tax. The `Lot` records exist for pro-rata relief but no lot-selection policy.
- No TWR, no benchmark, no risk metrics; period "return" is a market-P&L ratio over opening value (`app/models/investment_statement.rb:216-285`).
- XIRR unwired; splits unwritten; asset classification columns unwritten; portfolio hub preview-gated. The investment domain is a feature branch in flight, not a finished product.
- Reverse-calculated history is an inference. Snapshot-first accounts assume the snapshot already includes all trades not imported; gap-fill invents unchanged-qty rows for unpriced days. It is honest about this in comments but the output is still reconstructed.
- FX inconsistency: cost basis and realised gains refuse to guess (nil), while family totals/statement aggregation fall back to 1:1 (`COALESCE(er.rate, 1)`, `|| 1`). Two different answers for the same missing rate depending on the reader.
- Raw SQL and `upsert_all` bypass model validations (the statement itself notes negative holdings can reach the DB this way, `app/models/investment_statement.rb:496-505`); many invariants live only in comments/tests.
- Several mutations are per-row best-effort with `rescue => e` and a debug log (SnapTrade, Trading212, IBKR); a failed row is invisible unless the user opens debug logs. There is no typed per-connector problem list.
- No ISIN identity; same ticker on two venues is deliberately two securities (`app/models/security.rb:93-94` comment context and unique index), and the connectors' ticker normalisation can merge listings (e.g. T212 `standard_ticker` takes the first underscore segment, `app/models/trading212_account/data_helpers.rb:49-53`).
- No live-payload verification here; parser shapes are only as good as the code.

## 8. Reuse map for LaVega

Legend: **PORT** = translate the algorithm to TypeScript; **ADOPT CONCEPT** = take the design idea, write new code; **SKIP** = not applicable / worse than what LaVega has. Effort S/M/L. See `lavega:docs/investing/STACK.md:124-132` for the existing vendoring policy: MIT may be vendored verbatim; Sure is AGPL-3.0 like LaVega, so copying is licence-compatible but the policy as written only blesses MIT vendor drops. Safest is independent reimplementation from these algorithms with an attribution note, not verbatim copying into first-party source.

| # | Sure artefact | Verdict | Effort | Where it lands in LaVega | Rationale |
|---|---|---|---|---|---|
| 1 | `Holding::LotBook` moving-average engine incl. acquisition-fee-in-basis, full-liquidation reset, unknown-cost transfers, exact split restatement (`app/models/holding/lot_book.rb:26-150`) | **PORT** | S | new `packages/core/src/investing/costBasis.ts` (or extend `positions.ts`) | LaVega's replay has basis math but no internal-transfer/unknown semantics and no split restatement of basis. The pool formulation is ~100 lines of tool-agnostic arithmetic. |
| 2 | Basis provenance + priority + lock + provider carry-forward (`app/models/holding.rb:7-14, 216-251`; `app/models/holding/cost_basis_reconciler.rb:1-66`; `app/models/holding/materializer.rb:241-307`) | **ADOPT CONCEPT** (PORT if LaVega persists positions) | M | broker snapshot schema + positions builder | Useful only once LaVega allows user-overridden cost basis. The priority rule and "locked manual basis survives sync" semantics are the takeaway. |
| 3 | Forward holding materialization: replay splits→trades per day, emit qty/price/amount, gap-fill, purge (`app/models/holding/forward_calculator.rb:19-137`; `app/models/holding/gapfillable.rb:1-83`) | **PORT** | M | `quantityOnDate`/series builder extension | LaVega's quantity walk is equivalent for quantity; the gap-fill-through-splits and "no price → carry forward" behaviours are the additions. |
| 4 | Reverse holding materialization from provider snapshot + split bring-forward + backward trade/split replay + cost-basis snapshot binary search (`app/models/holding/reverse_calculator.rb:1-245`; `app/models/holding/portfolio_snapshot.rb:1-58`) | **PORT if** LaVega ever persists daily history; otherwise **SKIP** | L | new `holdingHistory.ts` | The only principled way to get history for a snapshot-only broker. LaVega today computes on demand from the snapshot + trades; if that never changes, this is dead weight. |
| 5 | Two-strategy materialization + provider-row authority + shadow cleanup (`app/models/holding/materializer.rb:1-334`; `app/models/account/provider_import_adapter.rb:427-681`) | **ADOPT CONCEPT** | M | broker snapshot merge/apply path | LaVega already replaces snapshots whole (`lavega:docs/investing/STACK.md:76-90`); if it moves to incremental, the cross-provider collision guards and "provider row wins" rule are proven. |
| 6 | Realised gain at disposal from holding basis + exact-date FX + fee on proceeds (`app/models/trade.rb:159-267`) | **PORT** (small delta) | S | `positions.ts` trade replay | LaVega has realised-at-replay. Missing pieces: basis source when trades are partial, always-convert-proceeds-to-basis-currency, nil-on-missing-FX semantics (LaVega throws `MissingFxRateError` and falls back). |
| 7 | `Portfolio::FlowClassifier` label→class table + transfer-scope resolution, Ruby/SQL parity (`app/models/portfolio/flow_classifier.rb:1-324`) | **ADOPT CONCEPT** | S/M | external-flow classification for TWR | LaVega already builds `externalCashFlows`; compare its classifier with this rule table. The "transfer is internal only if the other leg is in scope; security transfer identified by opposite qty same date" rule is worth copying. |
| 8 | Tax-treatment taxonomy and tax-treatment grouping of gains (`app/models/investment.rb:9-101`; `app/controllers/reports_controller.rb:541-650`) | **ADOPT CONCEPT** | M | account metadata + returns report | LaVega investment accounts have no tax treatment. Low engineering cost, real product value for EU wrappers (ISA/PEA/Pillar 3a/…). |
| 9 | Allocation ladder: classification groupings, cash bucket placement, unclassified bucket, parent-scoped drill-down, weight denominator floor (`app/models/investment_statement.rb:82-170, 376-533`) | **ADOPT CONCEPT + partial PORT** | M | `allocation.ts` extension | LaVega allocates by instrument/entity only. Cash placement, unclassified-as-real-bucket and `max(portfolio, holdings)` denominator are concrete improvements. Sector source differs (LaVega has fundamentals/corrections). |
| 10 | Period contribution/income totals SQL incl. income-as-transaction (`app/models/investment_statement/totals.rb:1-121`; `app/models/investment_flow_statement.rb:1-77`) | **ADOPT CONCEPT** | S | summary/report layer | The split between "gross buys/sells" and "external contributions/withdrawals" is exactly the distinction LaVega needs if it ever shows cash flow. |
| 11 | `Portfolio::Xirr` Newton+bisection, relative residual, derived low endpoint, `ambiguous?`, error taxonomy (`app/models/portfolio/xirr.rb:51-478`) | **ADOPT CONCEPT (compare)** / **SKIP** if LaVega is satisfied | S | `benchmarks.ts#solveXirr` | LaVega's solver requires exactly one bracket and returns null otherwise; Sure finds the lowest root and can say "may be ambiguous". Port only the multi-root detection and scale-invariant tolerance if LaVega wants to adjust semantics. |
| 12 | Price importer LOCF + provisional flag + listing clamp + `first_provider_price_on` (`app/models/security/price/importer.rb:1-376`; `app/models/security/price.rb:1-14`) | **ADOPT CONCEPT** | M | price orchestrator/PriceStore | LaVega already has coverage + split re-read. The additions: explicit provisional status for recent forward fills (so they refetch), and a persisted per-symbol listing start so IPO-era trades do not refetch forever. |
| 13 | Provider affinity: assigned price provider unavailable ⇒ skip, never silently replan (`app/models/security/provided.rb:172-199`); fan-out search with deadline + ranking (`:48-114, 142-169`) | **ADOPT CONCEPT** | S | provider router | LaVega's router already prioritises; the explicit "do not substitute a provider" rule prevents mispricing. |
| 14 | Manual price import for untracked securities (`app/models/security/manual_price_import.rb:1-60`) | **SKIP for now / note** | S | PriceStore | Only matters once LaVega supports private/untracked instruments. |
| 15 | SnapTrade aggregator + OAuth device flow (`app/models/provider/snaptrade.rb`; `app/models/snaptrade_item/provided.rb`) | **SKIP** | L | — | Conflicts with LaVega's local-first, first-party-credential-custody stance (`lavega:docs/investing/CONNECTORS.md:72-90`); sends broker data to a third party. |
| 16 | Rails account/balance/valuation machinery (Balance rows, anchors, reconciliation) | **SKIP** | L | — | Solves a different problem (bank-account truth over time) with ActiveRecord/DB coupling. LaVega has cash anchors + a computed dashboard series. |
| 17 | 12-connector breadth (Plaid/SimpleFIN/Lunchflow/EnableBanking/Coinbase/Kraken/Binance/CoinSpot/Coinstats/on-chain/Wise/Questrade/Indexa/Sharesight/Trade Republic) | **SKIP (selectively ADOPT CONCEPT)** | L each | adapters | Each is an independent integration with ToS/custody/auth cost. Sure's `ProviderImportAdapter` is the reusable abstraction, not the connectors. |
| 18 | Activity-label taxonomy + internal-movement rule + income-as-trade/transaction dual handling (`app/models/trade.rb:11-31`; `app/models/portfolio/flow_classifier.rb:64-78`; `app/models/investment_statement/totals.rb:40-73`) | **ADOPT CONCEPT** | S | `model.ts` broker normalisation | LaVega has `side: buy/sell/other` and separate Dividend/CashFlow kinds; the label vocabulary (incl. `Reinvestment`, sweep, Exchange) is useful for cash-walk classification. |
| 19 | Tax-treatment / subtype data set (`app/models/investment.rb:9-97`) | **ADOPT CONCEPT (data)** | S | account metadata | Pure data, no code risk, immediately useful for an EU-first app. |
| 20 | Reports investment performance card (top holdings, realised/unrealised by treatment) | **ADOPT CONCEPT** | M | investing-web | Product shape worth matching where LaVega lacks realised gains. |
| 21 | Goals contribution-basis logic (`market gain excluded, floored at 0`; pooled earmarks) (`app/models/goal.rb:1120-1180, 1377-1384`) | **ADOPT CONCEPT** | M | future goals feature | LaVega's investing side has no goals; if added, "investment goals track contributions, not market value" is the right default. |
| 22 | Cost-basis unknown-vs-nil distinction (`app/models/holding/holding_data.rb:1-9`; `materializer.rb:102-118`) | **PORT** | S | cost basis state | The distinction between "calculator produced nothing" and "this position contains a transfer so no basis can exist" prevents stale calculated figures. Forms the core of item 1/2. |

### 8.1 Suggested order if anything is taken

1. **Basis correctness, no new storage** (weeks, items 1, 6, 22): add the average-cost pool with transfer-unknown spans and exact-date FX to `packages/core`, behind tests adapted from `test/models/holding/lot_book_test.rb`. This changes no schema and fixes the largest class of wrong numbers (transfers, partial histories, FX).
2. **Provider snapshot merge concepts** (items 5, 12, 13): adoption is cheap and incremental — provider-affinity skips, provisional price refetch, listing-start clamp. These harden existing behaviour without new features.
3. **Data-model concepts with product value** (items 8, 9, 18): tax treatment on accounts, allocation by asset class/sector/region with cash bucket, activity-label vocabulary. Requires product sign-off on new account metadata.
4. **Only then storage** (items 2, 3, 4): persisted holding/balance history + reverse reconstruction. This is a design change to LaVega's in-memory read model and should be its own ADR, not a teardown follow-up.
5. **Never** (items 15, 16, 17): SnapTrade/aggregators, Rails balance machinery, bulk connector breadth.

## 9. Open questions, risks, unverified

1. **Snapshot volatility.** HEAD is a refactor commit that replaces the cost-basis implementation; XIRR has no UI caller; splits have no production writer; asset-class columns have no writer. Anything ported must be re-checked against a released tag before it is treated as stable. Treat the code as a design document, not a frozen spec.
2. **Licence path.** Sure is AGPL-3.0, same as LaVega. Copying is licence-compatible, but LaVega's vendoring policy (`lavega:docs/investing/STACK.md:124-132`) only covers MIT verbatim vendoring. A decision is needed: a recorded AGPL-origin attribution exception, or independent reimplementation from the algorithms (recommended; the code is Rails-bound anyway).
3. **Return-path regression risk.** Sure has no TWR, no benchmark comparison, no risk metrics. LaVega's `docs/investing/DASHBOARD.md:109-143` already specifies stricter semantics. Do not import `period_return_trend` or `InvestmentStatement#unrealized_gains_trend` as "portfolio return".
4. **Average-cost edge cases are where bugs live.** The port must preserve: transfer-in ⇒ whole position unknown until liquidated; provider 0 basis ⇒ unknown; full liquidation resets the pool; split ratio exact and applied at the open before that day's trades; acquisition fee in basis, disposal fee on proceeds; missing FX ⇒ unknown, never 1:1. Every one of these has a test on the Sure side worth adapting.
5. **Reverse inference.** If LaVega ever persists history for snapshot-only brokers, the reverse calculator's assumption (snapshot already includes unknown trades) is a modelling decision with a visible failure mode. Do not adopt it implicitly.
6. **SnapTrade/aggregator custody.** Sure's broad coverage comes from routing broker credentials/data through third parties (SnapTrade, Plaid, SimpleFIN, CoinStats, …). That is incompatible with LaVega's local-first hard constraint; only the normalisation patterns transfer.
7. **Unverified here:** live payload shapes for every connector (parsers read, no network); whether Sure's asset classification is populated by an out-of-repo job; whether `preview_features_enabled` defaults on hosted Sure; whether a production split writer exists outside `app/`/`lib/` (none found at this commit); behaviour under the Rails test suite (not run, as instructed). Confirm before treating those claims as product facts.
8. **Where LaVega is already stronger:** TWR/XIRR/benchmarks/beta/alpha/drawdown/volatility (`lavega:packages/core/src/investing/benchmarks.ts`, `risk.ts`), typed broker results + cash-history coverage (`lavega:docs/investing/CONNECTORS.md:39-60`), local-first credential model, market-data licensing discipline, provider seam for EU coverage. Keep those; take Sure's basis/materialisation machinery and its tax/classification/data-model concepts.
