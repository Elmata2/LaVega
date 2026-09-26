# LaVega investing dashboard

_This specification defines the investing dashboard in `apps/investing-web`, its read model in `packages/core`, and the supporting API and sync behavior in `apps/investing-server`. Read `docs/CONTEXT.md`, `docs/investing/STACK.md`, and `docs/investing/CONNECTORS.md` first._

The [Interactive investing dashboard](https://github.com/Elmata2/LaVega/issues/68) map produced this specification. Each section links to the ticket that made the decision. UI text is Dutch. Code, API names, and documentation are English. The dashboard presents one merged portfolio across entities in EUR.

## Scope

The dashboard answers four questions:

1. What is the portfolio worth?
2. How did it perform after deposits and withdrawals are removed from the return?
3. What does the portfolio hold now?
4. What produced the return for one position?

The overview contains these views:

- A portfolio chart in EUR value mode or indexed-return mode.
- A compact allocation donut.
- A current-positions table.
- A separate stacked net-worth chart for invested value and cash.
- A detail page for each open or closed position.

All market charts use daily end-of-day data. Do not add candlesticks, OHLC controls, or intraday behavior. The dashboard does not change the personal-finance dashboard.

## Money and portfolio records

Broker snapshots remain authoritative for current positions. Trade history reconstructs historical holdings. Cash uses broker-reported balances as anchors and dated cash movements as history ([Model cash and cash flows](https://github.com/Elmata2/LaVega/issues/71)).

Add these records to the investing model:

```ts
type CashBalance = {
  tenantId: string;
  entity: string;
  broker: string;
  currency: string;
  amount: number;
  asOf: string;
};

type CashFlowKind = "deposit" | "withdrawal" | "interest" | "fee" | "other";

type CashFlow = {
  id: string;
  tenantId: string;
  entity: string;
  broker: string;
  date: string;
  currency: string;
  amount: number;
  kind: CashFlowKind;
  description?: string;
  brokerFlowId?: string;
};
```

`CashFlow.amount` is positive for cash in and negative for cash out. Each broker adapter normalizes its source values to this convention. Trades and dividends remain separate record types. Add `broker` to `Dividend` so cash reconstruction can attribute a dividend to the correct broker and currency.

Treat a dividend as positive cash in its recorded currency. Match it to cash by `tenantId`, `entity`, `broker`, and `currency`. Deduplicate cash flows by `brokerFlowId` when present and by `id` otherwise. Deduplicate dividends by their existing identity contract before the cash walk. If required FX is unavailable, mark that broker-currency cash leg unknown; do not use an unconverted amount in the EUR total.

Store `cashBalances` and `cashFlows` in each broker's `RuntimeBrokerDataSnapshot`. Do not add a cash-specific storage seam. The encrypted broker snapshot already owns broker facts and persists the whole snapshot ([ADR 0002](../adr/0002-encrypted-local-broker-snapshots.md)).

Broker coverage differs ([Research: broker cash and cash-flow reporting](https://github.com/Elmata2/LaVega/issues/70)):

- IBKR Cash Report supplies balance anchors. Statement of Funds supplies dated deposits, withdrawals, fees, and dividends. Users can add both sections to their existing Flex query without changing the token and Query ID setup.
- Trading 212 `/api/v0/equity/account/summary` supplies current available cash. `/history/transactions` and `/history/dividends` supply dated activity. Official documentation now exposes these schemas. Sanitized live-response verification remains required for provider sign behavior, `TRANSFER` direction, and account-specific history retention. Until verified, ambiguous transfers become explicit problems and non-zero `inPies` or `reservedForOrders` prevents an unsafe total-cash anchor.
- If flow history cannot reach a requested date, return unknown. Never fabricate an opening cash balance.
- Flow history reaches a date only inside the window the adapter proves complete (`CashHistoryCoverage`, see `CONNECTORS.md`). IBKR proves its Flex statement period. Trading 212 proves nothing yet, so its cash is known from its latest balance date onwards and unknown before it.

## Historical portfolio value

Reconstruct daily value from trades and prices, not from today's open-position set ([Rebuild the portfolio value series from trades](https://github.com/Elmata2/LaVega/issues/73)).

Implementation status: core and investing-server expose this cash-aware read model. IBKR and Trading 212 adapters ingest cash anchors and activity into encrypted broker snapshots. If an adapter cannot prove an anchor or complete available history, `cashValue` stays unknown instead of defaulting to zero.

Use the union of symbols in trades and current positions. For each date, calculate quantity as the running sum of signed trades through that date. A buy adds quantity. A sell removes quantity. This rule includes closed positions only while they were held. The series starts on the first trade date.

Build the date axis from a shared Monday-to-Friday calendar plus all price-bar dates, from the first trade through today. Do not add an exchange-holiday table. A holiday or exchange-specific closure is a missing price day and follows the same forward-fill rule as any other gap.

For a held symbol with no close on a business day:

- Reuse its last close for at most five consecutive business days.
- Add the symbol to `forwardFilled` only while no later close exists yet (a session still settling). A gap followed by a later close was a closed market, and the reused close is the true value.
- After five business days, exclude the symbol from `positionsValue` and add it to `unpriced`.
- Never replace missing value with zero.

Compute cash on each date by walking from each `CashBalance` anchor through signed `CashFlow` and dividend records. Return `null` when the recorded history cannot reach that date. Add the affected `broker:currency` keys to `cashUnknown`.

The portfolio series has this contract:

```ts
type PortfolioValuePoint = {
  date: string;
  positionsValue: number | null;
  cashValue: number | null;
  value: number | null;
  unpriced: string[];
  forwardFilled: string[];
  cashUnknown: string[];
};
```

`value` is `positionsValue + cashValue`. It is `null` only when neither leg is reachable. Convert each monetary value to EUR with the latest FX rate on or before the point date.

## Return definitions

Portfolio comparison uses time-weighted return (TWR), not deposits or a benchmark price rescaled to portfolio euros ([Define deposit-neutral portfolio return](https://github.com/Elmata2/LaVega/issues/72)).

For each subperiod bounded by external cash flows, calculate:

```text
subperiod return = (end value - start value - net external flow) / start value
cumulative TWR = product(1 + subperiod return) - 1
```

Apply deposits and withdrawals at end of day. Calculate that day's market return first. Fold the flow into value after the return, then start the next subperiod from post-flow value. A deposit-only day therefore returns 0%.

Net all deposits and withdrawals on the same date into one end-of-day external flow. The first reachable positive portfolio value establishes cumulative return at 0%. A subperiod with a zero or negative start value returns `null`, because its percentage return is undefined. Resume only from a later positive start value; do not chain across the undefined subperiod.

Treat dividends, interest, fees, trades, and other internal movements as portfolio performance or internal allocation changes, not owner-contributed capital. A dividend already increases cash value. Do not also subtract it as an external TWR flow.

Return `null` before cash history becomes reachable. Keep gaps visible. Do not shorten the series by silently moving its start.

The crosshair also reports money-weighted return as XIRR. Calculate XIRR from the start of the selected visible window through the hovered date:

- Add a synthetic outflow equal to portfolio value on the window's first date.
- Include real `deposit` and `withdrawal` cash flows inside the window.
- Add portfolio value on the hovered date as the terminal inflow.
- Exclude trades, dividends, interest, fees, and `other` flows.
- Return `null` when start or terminal value is unknown or the solver does not converge.

Calculate benchmark XIRR with the same dated owner flows as if each flow had bought the benchmark at its price on that date. This makes the comparison answer: “What if this money had bought the benchmark instead?”

Benchmark XIRR is `null` when a required flow-date price or terminal-date price is missing. Do not skip a flow, move it to another date, or substitute a price beyond the shared five-business-day forward-fill rule.

Use these result shapes:

```ts
type ReturnPoint = { date: string; cumulativeReturn: number | null };
type MwrPoint = { date: string; xirr: number | null };
```

## Price backfill and dashboard refresh

Price backfill runs on the server, separate from broker sync ([Backfill set and sync orchestration](https://github.com/Elmata2/LaVega/issues/74)). Remove the browser's page-open `POST /api/prices/sync` call and the hardcoded S&P 500 request.

After broker sync completes, start the price orchestrator. Its symbol set is every traded symbol, including closed positions, plus the selected benchmarks. Backfill a position symbol from its first trade. Backfill a benchmark from the portfolio's first trade.

Run at most one price orchestration per tenant. A trigger received during an active run joins that run instead of starting overlapping Yahoo requests. The browser waits for that run to settle, then starts a fresh discovery so a benchmark chosen during the run is included. A paused slice also includes selected benchmarks, including ones chosen since the previous slice. Trigger after broker sync returns, including a partial or empty result, so existing symbols still receive their daily top-up. Per-broker problems do not suppress price sync for cached symbols.

Fetch in this order:

1. Selected benchmarks.
2. Current holdings.
3. Closed holdings.

Wait 300 ms between symbol requests. Keep the existing Yahoo request retry and exponential-backoff behavior. Do not cap the number of symbols in one run.

Each symbol's cache records its coverage: the dates the provider answered, and the listing and currency it quoted them in. A sync asks only for the dates before and after that coverage. A day inside it without a bar is a closed market, so it is never asked for again. A failed request keeps the cached bars and coverage, and a failed earlier range does not stop the later range from being stored.

The broker's currency is not evidence of a stale cache, because a listing can quote in another currency. When the provider quotes another listing or currency than the coverage records, or reports a split after it, refetch the whole covered history and make the answer the only rows in that window. A cached session the new answer lacks is deleted, so a holiday on the old listing cannot mark the cache stale on every later sync. This repairs historic GBX-versus-GBP mistakes on the next sync without a manual cache purge. Caches written before coverage existed take it from their bars once.

Expose price progress separately from broker progress at `GET /api/prices/sync/status`. Use the same status vocabulary as `BrokerSyncProgress`. Show remaining symbols and running or waiting state in the dashboard right rail.

Render cached partial data while backfill continues. A failed symbol retries on the next orchestrator run because it has no completed cache range. Benchmark lines appear and extend as their own histories arrive. They never block the portfolio line.

`GET /api/investing/dashboard` returns a valid empty dashboard with a problem message when the read model cannot be assembled. It must not return 503 for broker, snapshot, price-cache, FX, or benchmark-read failures, because the dashboard shell also contains reconnect and resync controls. The server logs the redacted failure under `investing.dashboard_read.problems`; the browser keeps the dashboard open and shows the problem banner.

Maintain an in-memory `dataVersion`. Increment it after broker data is applied and after a price-store upsert completes. Cache the last `InvestingDashboardData` with its version. Recompute only when the version changes.

### Dashboard latency and resumed history

The Neon dashboard reads all requested price histories in one tenant-scoped transaction.
File and in-memory stores retain the bounded per-symbol reader. A failed bulk read returns
the existing degraded-data warning rather than issuing a second wave of individual queries.
Dashboard cache entries expire after 15 seconds. Hosted workers keep only tenant-keyed
dashboard data across requests. Each request still creates and closes its own Neon pool.
Broker and price writes invalidate cached data. Concurrent identical dashboard reads share
one build.
Frankfurter latest and historical FX calls have a five-second limit. On expiry the dashboard
uses its cached/fallback FX data and reports the FX problem; it never delays broker positions.

Trading 212 resumed history batches are incremental, including the final batch. Completion
does not make that final page a full snapshot: earlier trades, dividends, and cash flows
must remain present. A fresh, complete sync still replaces historical collections. Data
already lost by the old final-page replacement requires a fresh complete broker sync.

The September 6, 2026 production probe measured a dashboard response at 34.8 seconds before
these changes. A direct tenant-scoped database read found 358,756 price rows for 144 symbols.
Broker history also has provider rate limits; rewriting calculation code in Rust does not
remove those limits. These are baseline measurements, not post-deployment speed claims.
Production verification requires an authenticated session.

A read-only comparison against those same 358,756 live rows took 24,541 ms with the
three-worker per-symbol reader and 2,549 ms with the bulk reader (about 9.6 times faster).
This measures the database read from the development machine, not total browser latency.
The report is stored at `/tmp/lavega-verify-investing/evidence/price-read-benchmark.json`.
Broker snapshots are saved before resume cursors advance; failed saves leave the previous
cursor available for retry. Sync merges the latest persisted snapshot rather than a warm
instance's older copy. Concurrent broker syncs across server instances still lack a shared
lease; serial syncs are covered by these changes.

## Overview layout

Use the chart-and-right-rail layout selected by the dashboard prototype ([Dashboard layout](https://github.com/Elmata2/LaVega/issues/78)).

Implementation status: production overview uses this responsive reading order. KPI values and broker, price, vault, and cache states stay in the right rail on wide screens and follow the performance chart on narrow screens. Refresh failures keep the last valid dashboard payload visible.

On wide screens:

- Put the portfolio chart in the main column.
- Put a compact right rail beside it. Order right-rail content as KPIs, allocation donut, then sync, vault, and price-cache status chips.
- Put the positions table at full width below the chart and rail.
- Put the stacked net-worth chart at full width below the positions table.

The KPI block shows current portfolio value, daily change, and total return. Status controls must not compete visually with these values.
When portfolio history is still empty but current positions do have market values, show the priced-positions total in that value slot and state that it excludes cash and history.

On narrow screens, use this order: portfolio chart, KPIs, allocation donut, status chips, positions table, net-worth chart. Keep tables and charts full width. Do not hide required information behind a desktop-only hover state.

Prototype reference: [`prototype-layout-78`](https://github.com/Elmata2/LaVega/tree/prototype-layout-78).

## Portfolio chart modes

Derive chart mode from benchmark selection ([Chart modes: euros or indexed return](https://github.com/Elmata2/LaVega/issues/75)):

- No selected benchmark: show portfolio value in EUR.
- One or more selected benchmarks: show portfolio and benchmarks as indexed returns rebased to 0% at the first date of the visible window.

Do not add a manual mode switch. A benchmark price and portfolio euros cannot share one meaningful Y axis.

EUR mode uses an autoscaled euro axis without a forced zero line. Indexed mode uses an autoscaled percentage axis with a visually emphasized 0% line. Show the persistent mode label `Portefeuillewaarde` or `Geïndexeerd rendement`. When mode changes, cross-fade axis labels. Respect reduced-motion settings and use an immediate state change when requested.

In indexed mode, the tooltip shows each visible series as a percentage and adds one supplementary portfolio-value row in EUR. Do not present a benchmark price as if it were portfolio money.

Remove `PortfolioBenchmarkPoint` and `normalizeBenchmarkSeries`. Derive return from already-windowed values:

```ts
type ChartMode = "euros" | "indexed";

function deriveChartMode(benchmarkIds: string[]): ChartMode;

function computeReturnSeries(points: { date: string; value: number | null }[]): ReturnPoint[];

type IndexedSeriesPoint = {
  date: string;
  portfolioReturn: number | null;
  benchmarkReturns: Record<string, number | null>;
  portfolioValue: number | null;
  benchmarkValues: Record<string, number | null>;
  portfolioXirr: number | null;
  benchmarkXirr: Record<string, number | null>;
  unpriced: string[];
  cashUnknown: string[];
};
```

If the visible window starts with unknown portfolio value, return `null` until the original start anchor becomes valid. Do not move the anchor forward.

## Benchmark selection

Allow zero to three benchmarks ([Benchmark selection](https://github.com/Elmata2/LaVega/issues/76)). Put a chip row under the portfolio-chart header. `+ Vergelijk` opens an inline combobox. Each selection becomes a removable chip. Hide `+ Vergelijk` when three benchmarks are selected and show it again after removal.

Implementation status: selection store contract now has one-row-per-tenant IndexedDB storage plus file-backed Docker storage at `.lavega/benchmarks.json` (or `INVESTING_BENCHMARK_STORE_FILE`). Runtime exposes get and replace-whole APIs, searches Yahoo with curated European fallback, includes selected symbols in server price orchestration, and renders EUR or indexed chart mode from selection. Hosted database storage remains a hosted-runtime implementation of same contract.

Search Yahoo through `GET https://query1.finance.yahoo.com/v1/finance/search`, using the existing `YahooHttpClient` crumb, cookie, retry, and backoff behavior ([Research: Yahoo Finance instrument search](https://github.com/Elmata2/LaVega/issues/69)). Use live search first and the curated European benchmark list as fallback. Search results do not include currency. Confirm EUR denomination with a quote or chart request when required. Update Yahoo consent disclosure to say that accepted use includes interactive search; do not add a second consent gate.

Persist order-preserving selection in a dedicated seam:

```ts
type BenchmarkSelection = { tenantId: string; symbols: string[] };

interface BenchmarkSelectionStore {
  get(tenantId: string): Promise<BenchmarkSelection>;
  set(selection: BenchmarkSelection): Promise<void>;
}
```

Enforce the three-symbol cap in `set`, not only in the UI. Local storage uses one IndexedDB row. Hosted storage uses one database row. Expose `GET /api/investing/benchmarks` and idempotent replace-whole `PUT /api/investing/benchmarks`.

The store is authoritative across reloads. Do not mirror benchmark selection in the URL. URL-backed state applies to positions-table sorting, not benchmark selection.

Assign benchmark colors by current selection order: `chart-blue`, `chart-purple`, then `chart-teal`. Reflow colors when a selection is removed. Keep coral unused because it conflicts with the negative color. The legend shows name and color for the portfolio and each benchmark. A legend entry toggles line visibility. Wrap only when horizontal space is insufficient.

Render missing benchmark history as `null` with disconnected line segments. Keep its legend entry visible while its backfill progresses.
Price sync requests selected benchmarks before holdings, including when a paused run resumes, so a large portfolio backfill does not leave the comparison line last in the queue.

## Portfolio chart interaction

Implementation status: core calculates gap-safe TWR and since-window portfolio and benchmark XIRR. Dashboard uses one visible-window state for range presets, pointer drag, chart-local wheel zoom, and typed dates. Crosshair, keyboard navigation, exact-value list, unknown-value announcements, zoom clearing, multi-benchmark outperformance readout, and reduced-motion behavior follow this section.

The chart supports direct drag-to-zoom, scroll-wheel zoom, and typed date input ([Interaction model for the portfolio chart](https://github.com/Elmata2/LaVega/issues/77)). This decision deliberately overturns the earlier “no zoom, pan, or brush” ruling.

- Drag horizontally on the plot to select a zoom window.
- While the pointer is over the chart, scroll to zoom by about 5% of the current window per wheel tick. Wheel events outside the chart keep normal page scrolling.
- Provide `from` and `to` date inputs beside the range controls.
- Store all three inputs in one zoom state.
- Show a zoom-state pill. Escape clears zoom regardless of its source.
- Do not add a separate brush strip.

Direct manipulation must respond during the gesture. Capture the pointer so dragging continues outside plot bounds. Keep the interaction interruptible. Range or zoom changes update the visible window and indexed-return anchor together.

Window transitions follow these rules. `chartWindowReducer` in `useChartWindow.ts` owns them, and each chart keeps its own instance.

- Zooming out never narrows the window. It stops at full history and stays there; it does not jump back to the preset.
- The wheel ignores a chart that has fewer points than its wheel minimum.
- Escape and the zoom pill restore the preset the custom window started from.
- One pointer owns a drag. A second pointer cannot take it over. Pointer cancel and lost pointer capture end the drag without zooming.
- A drag holds dates, not indices. If the chart data is replaced during a drag, the drag ends without zooming.

The tooltip flips before it reaches the right card edge. Trade markers use click or keyboard activation for drilldown. Hover never performs navigation.

Keyboard behavior:

- Tab moves focus into the chart.
- Left Arrow and Right Arrow move the crosshair by one point.
- Home and End move to the first and last visible point.
- Escape clears zoom.
- Typed dates provide equivalent zoom control without a pointer.

Keep an accessible chart name and a screen-reader-only list of exact values. Announce data gaps as unknown, not zero. Prototype reference: [`prototype-interaction-77`](https://github.com/Elmata2/LaVega/tree/prototype-interaction-77/apps/investing-chart-prototype).

## Crosshair return readout

Lead with outperformance, not six equally weighted raw values ([Prototype: TWR/MWR crosshair readout](https://github.com/Elmata2/LaVega/issues/84)).

For each visible benchmark, show portfolio minus benchmark spread in percentage points for TWR and XIRR. Keep an always-visible summary above the chart. It follows the active crosshair date and falls back to the latest visible date when no point is active.

Use a blue `TWR` badge and an amber `XIRR p.j.` badge. Keep number color for positive or negative meaning. Cap displayed XIRR above `+999%` and below `-99%`. Keep raw portfolio value, benchmark value, portfolio and benchmark TWR, and portfolio and benchmark XIRR as smaller secondary rows. Preserve raw values for every visible benchmark even when headline space requires wrapping or progressive disclosure.

Prototype reference: [`prototype-crosshair-84`](https://github.com/Elmata2/LaVega/tree/prototype-crosshair-84/apps/investing-chart-prototype).

## Allocation donut

Show current allocation by instrument and by entity. Keep it compact in the right rail. Do not label entity grouping as broker grouping. `Position` has no reliable broker field, and broker grouping remains deferred ([Fix bucketAllocationByBroker](https://github.com/Elmata2/LaVega/issues/83)).

Use priced portfolio value as denominator. Make unpriced positions visible as incomplete data instead of silently treating them as zero.

Build slices from the same current EUR values as the positions table: use current closes, permit forward-fill through five business days, and reject prices after that cap. Omit unpriced positions from donut slices and percentage denominator. Show their symbols in an adjacent `Waarde onbekend` warning. Do not fall back to broker snapshot market values and do not create a zero-sized or estimated `Onbekend` slice.

## Positions table

Implementation status: current-holding rows now use Yahoo-derived EUR values, explicit price-quality states, URL-backed sorting, and the weighted-average dividend-inclusive return model described below.

Show current open holdings only ([Positions table: columns, sorting, grouping](https://github.com/Elmata2/LaVega/issues/79)). Closed positions remain in portfolio history and can still be opened through a direct detail route.

Use these columns:

- `Instrument`: name or ticker, plus entity.
- `Waarde`: current value in EUR.
- `% portefeuille`: weight against priced portfolio value.
- `Totaal rendement`: `+€X (+Y%)` from the position-return model.

Default to `Waarde` descending. Numeric columns sort numerically. `Instrument` sorts alphabetically. Store sort column and direction in the URL so back navigation restores the table.

Do not add grouping in v1. The whole row links to `/positions/:symbol`, is keyboard focusable, and has visible hover and focus states.

Use these data-quality states:

- A close forward-filled within five business days remains usable and shows `Geschatte koers`.
- After the cap, show `Waarde onbekend`; do not show weight.
- When cost basis is missing, keep value and quantity and show `Rendement niet beschikbaar` with the import action defined below.
- When every held broker leg has a denominated current cost but trade history is incomplete, show `Ongerealiseerd rendement` only. Do not show total return, realized gain, or return percentage.

## Position return

Calculate each position in EUR with weighted-average cost ([Position return: average cost, euros and percent](https://github.com/Elmata2/LaVega/issues/80)).

- A buy adds gross trade value and commission, converted at trade-date FX.
- A sell removes the current average cost per share from remaining basis.
- Sell commission reduces realized gain.
- `unrealizedGain` is current market value minus remaining cost basis.
- `realizedGain` is sale proceeds minus removed basis and sell commission.
- `dividendsReceived` is dividends for the symbol, converted at dividend-date FX.
- `totalReturn` is unrealized gain plus realized gain plus dividends received.

Broker cost supports current unrealized gain only when every nonzero holding has an explicitly denominated cost. A missing or legacy denomination makes all basis-dependent facts unavailable. Broker cost never establishes realized gain or lifetime total return.

Show `+€X (+Y%) totaal rendement`. Use `remainingCostBasis + realizedCostBasisRemoved` as percentage denominator. This equals cost assigned to all bought shares under the weighted-average model and remains defined after partial sells. Return percentage is unavailable when that denominator is zero. Keep `Sinds eerste aankoop: +Z% vanaf YYYY-MM-DD` separate because it answers a different question.

Calculate `Sinds eerste aankoop` as cumulative money-weighted return. Use dated EUR cash flows: buys are negative gross value plus commission, sells are positive gross value minus commission, dividends are positive, and an open position's current value is the terminal positive flow. Solve XIRR, then convert the annual rate to the elapsed first-buy-to-valuation period with `(1 + xirr) ^ elapsedYears - 1`. Use the latest close as an open-position valuation date and the final activity date for a closed position. Show `Niet beschikbaar` when no valid root exists.

For incomplete trade history, do not estimate. Show `Niet beschikbaar` and `Importeer eerdere transacties of koppel je andere brokers om rendement te berekenen.`

## Position detail page

The route `/positions/:symbol` supports open and closed positions ([Position detail page](https://github.com/Elmata2/LaVega/issues/81)).

Implementation status: detail lookup resolves symbols from current snapshots, trades, dividends, and loaded price history. Open and closed pages expose EUR statistics, weighted-average return components, quantity history, daily-price interaction, full marker payloads, and newest-first activity. Incomplete cost or FX history remains explicit and never becomes an estimate.

Show current value, daily change, and total return in EUR as primary values. Show quantity, average cost, current price, unrealized gain in EUR and percent, realized gain, dividends received, and first-buy date as secondary values.

Detail values follow the same valuation freshness policy as the positions table, so one symbol never shows a value on one surface and none on the other ([Apply one valuation freshness policy to list and detail](https://github.com/Elmata2/LaVega/issues/111)).

- Only closes dated at or before today can back a value. A future-dated bar never becomes the current price.
- A close forward-filled within five business days stays usable and shows its quote date. After the cap, current value, current price, and daily change are all unavailable, while the chart keeps its full history.
- Daily change needs a prior close that is itself within five business days of the backing close. A multiweek gap between observations yields no daily change rather than a fabricated one-day move.
- Both closes convert at today's FX rate, so daily change reports price movement rather than same-day FX revaluation.

Quantity expands to a dated history of quantity changes and their reason. Use an explicit control with `aria-expanded`; do not make plain text the only affordance.

The chart shows daily end-of-day price only. Reuse the portfolio chart's range controls, crosshair, zoom model, keyboard behavior, and accessible exact-value list. Do not add position-value or position-return chart modes. Do not compare a position with the portfolio or a benchmark in v1.

Show buy, sell, and dividend markers. One date-level tooltip lists the close and every event on that date. Include available quantity, execution price, amount, commission, dividend amount, and currency. Multiple events remain separate rows.

Below the chart, show newest-first activity grouped by date. Columns are date, type, quantity, execution price, amount, commission, and currency. Use timestamps for same-date ordering when available. Otherwise preserve stable broker or import order.

`Trade.date` remains an ISO day for daily grouping. `Trade.executionAt` is optional. Trading 212 values use UTC instants. IBKR values preserve broker-local clock time because Flex does not provide an offset. Date-only trades keep their source slots; LaVega does not invent execution times or order events across incomparable time bases.

A closed position shows closed state, realized gain, dividends, first-buy date, chart, and activity history. Omit current value or show zero only where the label makes that meaning explicit.

Provide `← Terug naar posities`. Browser Back and this link return to the URL-backed positions sort state. Missing cost basis and incomplete history use the explicit import prompt. Never generate an estimated return.

## Net-worth chart

Put a separate full-width stacked-area card below the positions table ([Design stacked/layered net-worth chart layout](https://github.com/Elmata2/LaVega/issues/85)). Stack `positionsValue` below `cashValue` and draw a `Totaal` overlay line.

Implementation status: production net-worth card reads the existing range-specific `PortfolioValuePoint` series directly. It preserves null position, cash, and total legs; textures forward-filled position dates; exposes excluded symbols and unknown cash; and owns range, typed-date, wheel, drag, crosshair, and keyboard state independently from the performance chart.

Apply a hatched or dashed texture to the positions area on dates where `forwardFilled` is non-empty. List `unpriced` symbols in the tooltip so excluded value is visible. Do not silently absorb missing positions into the total.

The net-worth chart has its own range, crosshair, and zoom state. Do not synchronize these controls with the portfolio-return chart.

Prototype reference: [`prototype-networth-85`](https://github.com/Elmata2/LaVega/tree/prototype-networth-85/apps/investing-chart-prototype).

## Loading, empty, and error states

Keep broker sync, price sync, vault, cache, market-data, and incomplete-history states distinct. One failed broker or symbol must not hide valid cached data from other sources. Sync-status polling runs only while broker or price sync is active; idle, completed, and problem states must not keep a serverless function warm with one request per second.

One module, `apps/investing-web/src/lib/syncSession.ts`, owns sync polling for the web app. Every start path (app open, manual **Start sync**, credential save, vault unlock, benchmark selection) calls `startBrokerSync` or `continuePriceSync` there, and every status reader subscribes to the same snapshot. The module keeps these rules:

- At most one status read is in flight. A wake during a read queues one rerun; a wake while a timer waits replaces the timer. Repeated wakes never start parallel loops.
- While a broker or price run is known to be active, the module reads status every second. Active means a broker or price row that is `running` or `waiting`, or a start this page still owns. A `paused` price row counts only while this page is posting the next round; a paused row on its own (a cron slice, or a run that hit the round limit) is at rest and does not poll. A failed read during an active run retries with backoff (2, 4, 8, 16, then 30 seconds) and the status rail shows **Connection: Reconnecting**. The next good read returns to the one-second rhythm without a reload.
- Idle, completed, and problem states stop polling. A failed read with no active run also stops and shows **Connection: Offline** until the next wake (a new subscriber or a sync start).
- The dashboard is invalidated once per price round this page posts, because each round stores new bars, and once when a channel this page saw unfinished reaches completed or problem. A final price round that is also that transition invalidates once, not twice. A failed status read or a recovery from one does not invalidate.
- One subscriber that unmounts removes only its listener. Polling stops when the last subscriber leaves.
- Price continuation that reaches its round limit returns an explicit `incomplete` outcome. The status rail shows **Price history: Incomplete** with a message to start sync again.

- Loading: preserve card geometry where practical and expose `role="status"`.
- No broker data: show broker connection or import action.
- Price backfill running: show progress and cached partial charts.
- Unpriced or unknown cash: label affected values as unknown and expose symbols or broker-currency keys.
- Failed request: show a concise Dutch problem message and keep any valid stale data visible.
- Yahoo consent missing: request consent before the first search or price call. Persist the tenant decision in local server storage, version it with the disclosure, and require a new decision when disclosure changes. Search and price endpoints return HTTP 428 until consent is accepted.

Status changes must not depend on animation. Pressable controls respond immediately. Honor `prefers-reduced-motion`. Preserve visible focus, adequate touch targets, and keyboard equivalence for pointer actions.

## Portfolio agent conversation

The overview agent panel links each investor persona to `/agents/:agentId`. The route keeps a
conversation on the left and shows the current account positions on the right. Each user message
calls `POST /api/agents/portfolio/conversation` with selected `agentId`, `prompt`, and recent
browser-memory history. Server rebuilds tenant-scoped dashboard snapshot, runs TypeSafe System One
judgment for all six personas, and passes selected typed judgment with full compact position list to
OpenRouter text model. Response returns written answer with source snapshot hash and model metadata.
Messages remain in browser memory.

Typed System One `no_view` means no judgment signal. It never replaces written chat answer.

## Future work

Map-wide future work:

- A dashboard-wide USD presentation toggle. EUR remains the only presentation currency.
- More than three selected benchmarks. The current cap is three.
- Intraday quotes and intraday charts. Daily end-of-day data remains the source.

v1 deferrals:

- Broker grouping in the allocation donut or positions table. `Position.broker` exists but is optional on older persisted snapshots.
- Position-versus-benchmark or position-versus-portfolio comparison.
- A separate closed-position history or transaction browser.
