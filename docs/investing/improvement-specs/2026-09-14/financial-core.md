# Financial domain and adapter implementation specifications

Baseline: `/Users/jortwiebrens/Documents/LaVega`, master `7a566c4`. Paths below are repository-relative. Review only; no production edits. FIN-01, FIN-03, FIN-05 and FIN-06 include executed synthetic probes using `pnpm exec tsx`; other findings are established from call-path inspection unless stated otherwise. Read `AGENTS.md`, `docs/CONTEXT.md`, `docs/investing/{STACK,CONNECTORS,DASHBOARD}.md`, ADR-0001 and ADR-0002 before implementation. Preserve broker symbols, EUR presentation, daily quotes, read-only broker access, encrypted snapshots, local-first operation and existing unsupported-history states.

## FIN-01 — Preserve independent broker holding timelines

Priority P1. Confirmed. Recommendation Strong.

### Problem and evidence

`packages/core/src/investing/model.ts:3` and the Trade type omit broker/account ownership. `packages/core/src/investing/portfolio.ts:124` keys holdings by symbol and entity; lines 135–137 sum snapshots on the same date but treat snapshots on different dates as successive anchors. Current rows instead sum holdings in `packages/core/src/investing/positions.ts` (`buildCurrentPositions`). Independent broker snapshots can replace one another only in portfolio history.

Executed fixture: positions `{entity:'x',symbol:'A',quantity:1,currency:'EUR',asOf:'2026-09-11'}` and same entity/symbol with quantity 2, asOf Sep 14; quote A=€10 on Sep 14; no trades. Dashboard current row is €30 but latest portfolio positionsValue is €20. Remaining Position fields in fixture: averagePrice/marketPrice/marketValue 10.

### Required change

Carry broker/account provenance through adapter output, persisted snapshot, Trade and Position. A minimal ownership identifier combines entity, broker and optional actual account identifier; preserve the enclosing broker key for existing single-account snapshots. Reconstruct quantity for each independent ownership key plus broker symbol, then aggregate for presentation. Never infer that two different dated anchors describe the same account merely because entity/symbol match.

Interface invariants: each ownership timeline selects its own anchors; table/detail/chart quantities agree at the same valuation date; unknown pre-anchor ownership remains explicit; broker symbol remains portfolio identity. Do not add automatic ISIN consolidation.

### Acceptance and implementation phases

1. Add failing domain fixtures for different-date broker snapshots, same-date snapshots, one broker selling while another holds, and the same symbol in two entities.
2. Add provenance at adapter/snapshot entry, with compatibility reading for legacy snapshots. Do not silently rewrite persisted trade identities.
3. Apply ownership grouping in quantity reconstruction and check dashboard parity. Existing same-broker successive snapshots must still replace rather than sum.

Run targeted portfolio/dashboard tests, adapter tests for changed mappings, and investing typecheck. Persist/reload a legacy snapshot in a synthetic integration test. Snapshot format evolution needs an explicit compatible migration; account provenance cannot be invented if absent, so preserve a documented legacy bucket.

Dependencies: none. Enables FIN-08 and makes broker event identity reliable. Non-goals: new brokers, multi-account connection UI, grouping UI, corporate-action support.

Depth/deletion test: deleting `tradeDelta` only moves arithmetic. Deepen the holdings module instead: one interface hides ownership-aware anchor reconstruction. This creates locality and leverage across chart, detail and return calculations without another thin adapter wrapper.

## FIN-02 — Preserve last-good IBKR data after failed or partial reports

Priority P1. Confirmed call path. Recommendation Strong.

### Problem and evidence

`packages/adapters/src/brokers/ibkr/flexAdapter.ts:10` returns empty arrays with a problem on fetch failure. `packages/adapters/src/brokers/ibkr/flexParser.ts:14` has no completeness metadata; line 298 onward skips invalid rows. `packages/adapters/src/brokers/BrokerAccessAdapter.ts:69` defaults missing completeness flags to true. `apps/investing-server/src/index.ts:253` consequently treats failed/partial IBKR results as complete and replaces cached histories; its position branch can clear holdings too. `scheduledSync.ts:130` preserves problem-bearing results for cache application. This conflicts directly with ADR-0002.

### Required change

Give the broker snapshot interface explicit availability/completeness for each independently replaceable section. Distinguish a successful empty section from missing, failed or partially parsed sections. Entire-request failure must mark every section unavailable. Cache application must preserve last-good positions/cash when unavailable and merge partial historical records by stable identity. Complete, valid empty holdings can clear old holdings. Persist and reload exactly the same resulting snapshot.

A discriminated section shape such as `{status:'complete'|'partial'|'unavailable', rows:T[]}` is one acceptable design; do not add it as a second parallel contract while retaining ambiguous booleans. Existing callers must migrate together. If booleans remain, make required states unambiguous and test each combination.

### Acceptance and implementation phases

1. Seed a cache with two trades, a holding and cash. Feed adapter network error: all last-good values survive.
2. Repeat with malformed XML, missing Open Positions, one invalid Trade among valid rows and invalid Cash Report. Each independent good section may update; incomplete history cannot shrink stored history.
3. Feed a valid complete zero-position report: holding closes correctly. Verify scheduled state and persisted/reloaded results.

Test through adapter → scheduled sync → cache → snapshot storage, not parser alone. Coordinate modifications to cache application with the runtime review owner. No real vault or production data needed.

Migration: existing persisted snapshots stay readable; legacy sync metadata must not be interpreted as proof that a failed new result is complete. Dependencies: none; shared cache changes should land before FIN-08. Non-goals: scheduler rewrite, retry-policy redesign, new XML framework.

Depth/deletion test: a pass-through parser wrapper would only move complexity. Deepen broker snapshot application so one interface owns replacement rules for real IBKR and Trading 212 adapters. This restores locality and provides leverage for every future partial sync.

## FIN-03 — Normalize signed executions and retain available timestamps

Priority P1. Signed-quantity bug reproduced; timestamp loss confirmed by inspection. Recommendation Strong.

### Problem and evidence

`packages/adapters/src/brokers/ibkr/flexParser.ts:259` preserves signed SELL quantity. `packages/core/src/investing/quantity.ts:5` negates sell quantity again, while `positions.ts:119` rejects non-positive quantity. Trading 212 already uses `Math.abs` at `adapter.ts:387`. Trade stores only date (`model.ts`); T212 `filledAt` and IBKR dateTime are reduced to day. `positions.ts:86` sorts by date only, which can change weighted-average results if same-day execution input is newest-first.

Executed XML fixture: `<FlexStatements><Trade symbol="A" tradeDate="20260803" buySell="SELL" quantity="-2" tradePrice="10" proceeds="20" ibCommission="0" currency="EUR" /></FlexStatements>`. Parser emits sell quantity -2 and `tradeDelta` returns +2.

### Required change

Normalized buy/sell quantity is a strictly positive magnitude; side determines direction. Preserve optional execution timestamp from supported adapters without altering ISO-day grouping. One deterministic ordering rule must serve cost reconstruction and activity: chronological timestamp when available, stable provider/import order when unavailable. Document mixed timestamp/date-only behavior and do not fabricate times. Validate invalid/zero quantities as unsupported/problem records according to existing ingestion rules.

### Acceptance and implementation phases

1. Add parser-to-core fixture for buy 10, sell -2; quantity must end at 8 and realized basis must remove two shares.
2. Add same-date fills returned newest-first, with buy timestamp 09:00 and sale timestamp 10:00; weighted-average return must use execution chronology.
3. Add legacy date-only fixture and verify stable source order and existing IDs remain unchanged.

Run IBKR/T212 adapter, position-return, markers and dashboard tests. Add migration compatibility for optional timestamp. Audit persisted cached negative SELL quantities: normalize on versioned read or explicit snapshot migration, not only on the next adapter fetch.

Dependencies: none; coordinate ownership fields with FIN-01. Non-goals: shorts, splits, transfers, options lifecycle and invented event order.

Depth/deletion test: unify economic normalization, not provider syntax. Two real adapters establish the execution seam. A narrow normalized execution interface gives locality and leverage; more tiny arithmetic modules fail the deletion test.

## FIN-04 — Apply dated FX to historical economics

Priority P1. Confirmed; current test explicitly permits incorrect policy. Recommendation Strong.

### Problem and evidence

`packages/core/src/investing/portfolio.ts:24` selects FX, line 31 falls forward to the earliest future rate. `convertCurrency.test.ts:12` asserts this fallback. `apps/investing-server/src/index.ts:627` obtains FX and line 645 passes `fxResult.rate` into `buildInvestingDashboard` at line 630 (verified by rg in this review). `docs/investing/DASHBOARD.md:354` requires trade-date FX. A current quote therefore reprices historic purchase cost, dividends and cashflows.

### Required change

Supply investing calculations with historical FX coverage for required economic dates. The conversion interface must select an observation on or before the requested date with an explicit bounded weekend/holiday carry policy; never use future FX for historical cost. Missing historical FX produces unavailable basis/return while available current value remains usable. If current valuation needs a different policy, represent it explicitly rather than changing historical conversion semantics globally. Preserve GBX/GBP minor units.

### Acceptance and implementation phases

1. Fixture: buy $100 when EURUSD=1; current EURUSD=2. Basis remains €100 after latest FX changes; it must not become €50.
2. Supply only future EURUSD=2: historical cost unavailable. EUR→EUR remains available without any FX payload.
3. Cover weekend carry, cap expiry, missing currency, GBP/GBX, trade fees and dividend-date conversion.
4. Implement retrieval/cache wiring for coverage and replace the test that enshrines forward fallback. Run targeted FX, portfolio, positions and dashboard tests plus investing typecheck.

Migration: cached price bars need no rewrite; any cached derived read models require invalidation/version bump. Historical FX persistence, if introduced, needs its own compatible storage shape. Do not alter personal-side conversion policy as incidental cleanup.

Dependencies: none; coordinate server data-loading interface owner. Non-goals: intraday FX, provider fee estimation, reporting in additional currencies.

Depth/deletion test: current helper hides an unsafe policy without sufficient depth. A dated-valuation module owns rate coverage and selection behind an explicit interface, improving locality and leverage for all historical calculations. A helper that only forwards a rate does not qualify.

## FIN-05 — Require complete, correctly denominated broker cost basis

Priority P1. Partial-cost bug reproduced; currency mapping defect confirmed. Recommendation Strong.

### Problem and evidence

`packages/core/src/investing/positions.ts:208` drops unknown cost legs. Line 230 accepts any remaining leg; line 250 subtracts that partial basis from full market value. `packages/adapters/src/brokers/trading212/adapter.ts:430` substitutes walletImpact.totalCost/quantity for averagePricePaid, then line 444 labels it with instrument currency even when wallet amounts use account currency.

Executed fixture: two EUR holdings each quantity 1, first averagePrice 10, second averagePrice null; no trades; combined marketValue 40. `calculatePositionReturn(2,40,[],[],'EUR',undefined,{brokerCost:brokerCostLegs(positions)})` returns basis 10, totalReturn 30 and percentage 3 (300%). Unknown cost is silently treated as zero.

### Required change

Broker-basis interface must carry complete coverage of held quantity plus amount denomination. Any unknown nonzero holding leg makes aggregate basis-dependent facts unavailable. Preserve known current value independently. Never label account-currency wallet cost as instrument-currency average price: introduce an explicit broker-cost money field or omit the unsafe fallback until denomination can be represented.

Broker-average results also cannot claim complete lifetime total return while realizedGain is null. Keep useful broker-derived unrealized information under explicit partial coverage/label. Reconcile DASHBOARD's incomplete-history rule with this documented behavior; do not remove useful broker cost merely because historical realized gain is unknown.

### Acceptance and implementation phases

1. Reproduce partial-cost fixture; result must show unknown aggregate basis, not 300% gain.
2. All-complete legs sum correctly; zero-quantity legs do not invalidate basis.
3. EUR wallet totalCost=90, USD instrument, quantity 1, null averagePricePaid: cost remains €90, never $90 converted again.
4. Partial sale with unknown realized gain must not display a complete lifetime return. Test both list and detail.

Run positions/dashboard and T212 adapter tests. Snapshot migration must preserve old fields while distinguishing unknown original denomination; do not guess it. Coordinate changes to return status with web consumers and agent snapshot consumers.

Dependencies: none; align FX policy with FIN-04. Non-goals: tax-lot accounting, FIFO, corporate-action estimation.

Depth/deletion test: deepen position-return module around coverage-aware basis interface. Deleting brokerCostLegs alone just moves the flawed omission; keeping coverage with the calculation restores locality and leverage.

## FIN-06 — Apply one valuation freshness policy to list and detail

Priority P1. Confirmed synthetic reproduction. Recommendation Strong.

### Problem and evidence

`packages/core/src/investing/positions.ts:318` applies `isPriceFresh`. `packages/core/src/investing/dashboard.ts:291` values detail from latest bar without age/future-date checks; line 315 compares prior bar without validating observation gap.

Executed fixture: today 2026-09-14; position A quantity 1, currency EUR, asOf today; latest bar 2026-08-03 at €20. `buildInvestingDashboard` with selectedSymbol A returns list marketValue null but detail currentValue 20. Stale value also enters detail return calculation.

### Required change

Deepen valuation module with one interface accepting valuation date, bars, quantity and FX and returning quote quality plus nullable monetary facts. List and detail use the same five-business-day rule and filter future bars. Preserve historical chart bars. Expose forward-filled status in detail. Define daily-change eligibility explicitly when prior observation is not the preceding supported close; do not label a multiweek gap as one-day movement.

### Acceptance and implementation phases

1. Same-symbol list/detail fixture at 0, 5 and 6 business days must agree on availability.
2. Future-dated bar must not become current value. Test weekend, missing FX and closed positions.
3. Detail retains old chart history while current value/return remains unavailable; missing prior quote does not fabricate daily change.

Run positions/dashboard tests, then changed web consumers' typecheck. Snapshot migration unnecessary; derived read-model cache requires invalidation if applicable. Coordinate freshness status rendering with UI owner.

Dependencies: none; cooperate with FIN-04 and FIN-05 on shared valuation/return types. Non-goals: chart interaction rewrite, intraday data.

Depth/deletion test: consolidating duplicate valuation policy removes implementation complexity. One testable module interface gives locality and leverage across list/detail; adding a forwarding wrapper would not.

## FIN-07 — Repair price-cache historical coverage and currency provenance

Priority P2. Confirmed code path. Recommendation Strong.

### Problem and evidence

`packages/adapters/src/market-data/priceSync.ts:31` chooses latest cached date; lines 33–35 request only from latest+1 except for currency mismatch. Earlier backfillFrom cannot fill an uncached prefix. The mismatch helper at line 70 compares provider bars against broker currency. `yahoo/priceProvider.ts:35` deliberately permits actual quote currency to differ from broker currency, so legitimate alternate listings are repeatedly treated as corrupt.

### Required change

The cache synchronization interface must describe required historical coverage and resolved listing/provider denomination. Fetch missing prefix and suffix ranges. Track successful requested intervals if needed to distinguish market holidays from missing cache coverage. Invalidate currency data only for proven listing/normalization change, not broker-vs-listing currency inequality. Retain cached bars on failed fetch.

### Acceptance and implementation phases

1. Seed Jan–Sep cache; expand backfillFrom to preceding June. Provider receives missing prefix request and earlier bars become available.
2. Same request twice with complete coverage makes no redundant historical fetch.
3. Broker USD/listing EUR: second sync does not refetch entire history merely for currency mismatch.
4. Explicit listing/normalization change refreshes affected history. Empty holiday interval does not trigger endless backfill. Failed prefix retains valid suffix.

Use in-memory PriceStore and stub providers; run priceSync and PriceStore contract tests. If coverage/provenance metadata is persisted, implement compatible defaults for existing price-only stores and test migration. Follow ADR-0001; no default-provider change.

Dependencies: none. Non-goals: new market-data vendor, generic cache framework, whole database redesign.

Depth/deletion test: deepen syncPrices around coverage; keep real PriceStore adapter seam. One coherent interface improves locality and leverage. Another wrapper around getRange/upsert fails the deletion test.

## FIN-08 — Establish cash-event coverage before reconstructing returns

Priority P2. Coverage gap confirmed; provider settlement mapping requires sanitized fixture verification. Recommendation Worth exploring.

### Problem and evidence

`packages/core/src/investing/portfolio.ts:291` constructs cash events only from CashFlow and Dividend. T212 `adapter.ts:365` maps fills to trades, without explicit cash settlement; transaction mapping at line 280 handles deposits/withdrawals/interest/fees. IBKR fixtures (`flexParser.test.ts:19`) already contain separate trade-cash Statement of Funds rows. Core `portfolio.ts:101` treats first observed cash event as sufficient evidence for backward cash coverage. A first retained event does not prove intervening history complete.

Do not assert a live T212 trade-cash omission until a sanitized payload proves stream semantics. Blindly adding every trade amount globally would double-count IBKR.

### Required change and evidence gate

First obtain sanitized representative T212 responses or authoritative checked-in contract fixtures showing whether execution settlement/fees appear in transactions, fills or both, and in which currency. No production writes or live credentials in fixtures. Based on that evidence, normalize settlement once and retain execution identity/provenance. Broker snapshot interface must carry proven cash-history coverage; core reports unknown outside it. Preserve ambiguous transfer warnings.

### Acceptance and implementation phases

1. Evidence gate: document fields and duplicate relationships in synthetic/sanitized fixtures. If mapping remains unknown, implement explicit unknown coverage rather than invented cash.
2. €1,000 deposit, €200 purchase, €800 closing cash, €200 holding: reconstructed net worth is €1,000, not €800 or €1,200.
3. Equivalent IBKR trade with Statement of Funds is counted once. Test EUR account/USD execution, fees, repeated import and stable deduplication.
4. Incomplete pagination/retention and ambiguous transfer preserve unknown cash state and cannot generate complete performance metrics.

Run adapter-to-portfolio integration tests. Update CONNECTORS' outstanding verification notes with actual evidence. Migration adds coverage metadata conservatively: absence means unknown, never complete. Do not estimate old missing settlements.

Dependencies: FIN-01 provenance and FIN-02 section completeness; FIN-04 for currency-date conversion. Non-goals: broker transfers UI, reconciliation guesses, payment execution.

Depth/deletion test: real IBKR/T212 cash differences justify the cash-event seam. Deepen the normalized cash module only after fixtures establish requirements. Locality and leverage come from one coverage/deduplication interface, not a speculative generic accounting framework.
