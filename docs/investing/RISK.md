# Risk and composition

## Contract

The Summary card measures historical account risk. It does not forecast the risk of current holdings. Default period is one year; six months and account history are available independently of the chart period.

Account history starts at dated account evidence: a trade, cash flow or balance/position snapshot. A market quote from 2000 cannot establish ownership in 2000. Positions inferred from a later snapshot without opening-quantity evidence are flagged as unknown before that snapshot.

For each adjacent, positive, finite account valuation, daily return is `(ending value - external cash flow) / starting value - 1`. External flows include deposits and withdrawals within the exact interval, including weekends. This uses an end-of-day flow convention. Dividends, fees and interest remain investment performance. Null flows invalidate the interval.

Dates are sorted. Duplicate dates, unknown values, non-positive values and intervals longer than four calendar days break continuity. Returns at or below -100% invalidate the interval; values are never clipped. The next valid valuation may start a new interval, but never bridges the invalid interval. The full-window risk gate still rejects the incomplete window. Beta pairs must share both their start and end dates.

The card requires a complete selected window and at least 60 valid daily returns. Missing prices, unknown cash, unsupported ownership and carried-forward prices make that window unavailable. This is deliberately conservative: multi-market holidays can also prevent a complete daily window. The UI must state each data limit, show the observation count and never display invalid numbers as valid estimates. Shorter supported periods can be selected, but the start must never silently shift to a convenient clean period.

## Metrics

| Metric | Definition | Limit |
| --- | --- | --- |
| Annual volatility | Sample standard deviation of daily adjusted returns × √252 | Historical variation, not maximum potential loss |
| Beta | Sample covariance with benchmark / benchmark sample variance | At least 60 exact interval pairs; zero benchmark variance is undefined |
| Regression alpha | 252 × (mean daily portfolio return − beta × mean daily benchmark return) | Assumes 0% cash rate; benchmark price return excludes dividends |
| Maximum drawdown | Lowest decline from a peak of compounded flow-adjusted returns | Requires continuous valid history; no balance-based drawdown |

The risk benchmark is named and selected from chart benchmarks. The first configured benchmark is the initial choice. No benchmark means beta and alpha are unavailable. A benchmark quoted in a currency other than the presentation currency is rejected for these two metrics.

Account conversion currently uses fixed latest FX rates. Currency movements are therefore excluded from historical returns. All available results are labelled estimates. These values must not be presented as full historical EUR risk, CAPM alpha or total-return benchmark alpha. Historical FX and dividend-adjusted benchmark history remain prerequisites for those definitions.

Composition uses current priced investment value, excluding cash. Missing positions are counted, estimated prices are counted, and percentages have no gain/loss sign. Sector data describes the instrument and does not look through funds to their underlying holdings.

## Confirmed source-data limits

Read-only production checks on 2026-09-10 confirmed market history predates the first account trade by more than 24 years. The account has missing USD cash history, missing historical instrument prices and opening-quantity evidence gaps. All supported risk periods can therefore correctly report unavailable. This change repairs calculation and disclosure; it does not repair or invent broker records.

To unlock reliable figures: reconcile every broker cash currency from a dated balance, complete historical order/transfer and corporate-action records, backfill missing held-date prices, then add historical FX and a total-return benchmark. Recheck against broker statements before removing quality flags. A separate current-holdings model also needs adjusted-price history and an explicit treatment of uncovered holdings; silently rescaling a covered subset is not acceptable.

## Verification cases

Axis: selected risk period. Persona: signed-in account owner. Screen: `/investing`.

1. One year: selected risk window spans one year, unavailable metrics state missing cash history, valid daily returns are zero for the checked account, and no extreme volatility/drawdown numbers appear.
2. Six months: select `6 months` in `Risk period`. Start date changes to six months before the end. Missing USD cash and unavailable metrics remain visible.
3. Account history: select `Account history`. Start is 2024-10-01 for the checked account, never 2000. Metrics remain unavailable.
4. Method disclosure: expand `How to read these metrics`. Read end-of-day cash-flow convention, fixed latest FX, 0% cash rate and price-only benchmark limits. Collapse and re-open it.
5. Current composition: read investment-only denominator, missing/estimated counts and sector limitation; percentages have no `+` gain sign.

Numeric oracles are independent hand-calculated regression fixtures: a deposit into a flat account creates no volatility or drawdown; portfolio returns `1.5 × benchmark + 0.0007` produce beta 1.5 and annual regression alpha 0.1764. Core tests also cover null flows, weekends, duplicates, negative values and mismatched intervals. API tests check validation and composition; UI tests check unavailable states and period requests.
