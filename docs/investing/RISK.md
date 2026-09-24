# Risk and composition

## Contract

The Summary card measures historical account risk. It does not forecast the risk of current holdings. Default period is one year; six months and account history are available independently of the chart period.

Risk refreshes on period/benchmark selection and with the explicit Refresh risk button. Background sync version changes must not reload the card or remove its controls. Use Refresh risk after broker or price updates. Browser verification caught a background-refresh regression; a UI regression test covers keeping loaded controls stable across parent renders and explicitly refreshing data. `apps/investing-web/src/lib/summaryResource.ts` owns the summary request, its decoding and the explicit refresh; the card only renders. The decoder rejects a malformed nested field (risk lists, benchmarks, sectors, top positions, the text fields and return counts the card shows) or a body that is not JSON as "Summary has an invalid format." before rendering. A failed network request shows "Failed to load summary: network error." A new period, benchmark, revision or refresh aborts the request in flight, so an older response never replaces a newer one.

Account history starts at dated account evidence: a trade, cash flow or balance/position snapshot. A market quote from 2000 cannot establish ownership in 2000. Positions inferred from a later snapshot without opening-quantity evidence are flagged as unknown before that snapshot.

For each adjacent, positive, finite account valuation, daily return is `(ending value - external cash flow) / starting value - 1`. External flows include deposits and withdrawals within the exact interval, including weekends. This uses an end-of-day flow convention. Dividends, fees and interest remain investment performance. Null flows invalidate the interval.

Dates are sorted. Duplicate dates, unknown values, non-positive values and intervals longer than four calendar days break continuity. Returns at or below -100% invalidate the interval; values are never clipped. The next valid valuation may start a new interval, but never bridges the invalid interval. The full-window risk gate still rejects the incomplete window. Beta pairs must share both their start and end dates.

The card measures the most recent run of complete dates inside the selected range and needs at least 60 valid daily returns in it. A date with a missing price, unknown cash or unsupported ownership ends that run; earlier dates are left out, and the card states the date the window starts and why. A day a market was closed is not a gap: when a later close exists, the last close is the true value. Only a close carried past the latest one (a session still settling, usually today) is an estimate, and trailing estimated days are left out of the window. The start may move later than the range start, but never silently: `risk.from` and a reason name it. The UI must state each data limit, show the observation count and never display invalid numbers as valid estimates.

## Metrics

| Metric            | Definition                                                               | Limit                                                                  |
| ----------------- | ------------------------------------------------------------------------ | ---------------------------------------------------------------------- |
| Annual volatility | Sample standard deviation of daily adjusted returns × √252               | Historical variation, not maximum potential loss                       |
| Beta              | Sample covariance with benchmark / benchmark sample variance             | At least 60 exact interval pairs; zero benchmark variance is undefined |
| Regression alpha  | 252 × (mean daily portfolio return − beta × mean daily benchmark return) | Assumes 0% cash rate; benchmark price return excludes dividends        |
| Maximum drawdown  | Lowest decline from a peak of compounded flow-adjusted returns           | Requires continuous valid history; no balance-based drawdown           |

The risk benchmark is named and selected from chart benchmarks. The first configured benchmark is the initial choice. No benchmark means beta and alpha are unavailable. A benchmark quoted in a currency other than the presentation currency is rejected for these two metrics.

Account conversion currently uses fixed latest FX rates. Currency movements are therefore excluded from historical returns. All available results are labelled estimates. These values must not be presented as full historical EUR risk, CAPM alpha or total-return benchmark alpha. Historical FX and dividend-adjusted benchmark history remain prerequisites for those definitions.

Composition uses current priced investment value, excluding cash. Missing positions are counted, estimated prices are counted, and percentages have no gain/loss sign. Sector data describes the instrument and does not look through funds to their underlying holdings.

## Confirmed source-data limits

Production checks on 2026-09-23 show a one-year risk estimate using 73 returns from 2026-06-12 through 2026-09-23. Three instruments still lack historical prices. A complete order-history rebuild added broker wallet settlements to all 545 trades after 2025-09-23; the cash walk changed from EUR -575.32 to EUR -564.19 on that date. Cash remains negative on 27 dates inside the risk window. A live scan of 997 broker transactions found no omitted post-date transaction type. Trading 212 cash cannot be negative, so estimated returns may use incorrect account values. The remaining gap needs a historical broker cash statement or pie activity records; do not clamp or invent cash values.

The risk report now states how many dates in its measured window have negative cash, so the estimate shows this limitation beside other data warnings.

Since FIN-08 ([#113](https://github.com/Elmata2/LaVega/issues/113)) Trading 212 reports its cash history as unproven. Trading 212 cash before its latest balance date is now unknown instead of negative, so those dates end a risk run rather than feed it. The latest balance carries forward, so the current value keeps its cash. The production figures above predate this change and were not re-measured.

To unlock reliable figures: reconcile every broker cash currency from a dated balance, complete historical order/transfer and corporate-action records, backfill missing held-date prices, then add historical FX and a total-return benchmark. Recheck against broker statements before removing quality flags. A separate current-holdings model also needs adjusted-price history and an explicit treatment of uncovered holdings; silently rescaling a covered subset is not acceptable.

## Verification cases

Axis: selected risk period. Persona: signed-in account owner. Screen: `/investing`.

1. One year: risk window starts at 2026-06-12 for the checked account, with 73 returns as of 2026-09-23. Volatility and drawdown show estimates; the cash reconciliation caveat above still applies.
2. Six months: select `6 months` in `Risk period`. Confirm the selected range and any stated data limits; do not infer cash coverage from a non-null value alone.
3. Account history: select `Account history`. History starts at the first dated account evidence, not the earliest market quote. Confirm the stated risk start and data limits.
4. Method disclosure: expand `How to read these metrics`. Read end-of-day cash-flow convention, fixed latest FX, 0% cash rate and price-only benchmark limits. Collapse and re-open it.
5. Current composition: read investment-only denominator, missing/estimated counts and sector limitation; percentages have no `+` gain sign.

Numeric oracles are independent hand-calculated regression fixtures: a deposit into a flat account creates no volatility or drawdown; portfolio returns `1.5 × benchmark + 0.0007` produce beta 1.5 and annual regression alpha 0.1764. Core tests also cover null flows, weekends, duplicates, negative values and mismatched intervals. API tests check validation and composition; UI tests check unavailable states and period requests.
