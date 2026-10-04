import type { RiskRange } from "@lavega/core";
import type { SummaryState } from "../lib/summaryResource.js";
import { shortDate } from "../lib/dates.js";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";

const percent = (value: number | null | undefined): string =>
  value === null || value === undefined || !Number.isFinite(value)
    ? "Unavailable"
    : value.toLocaleString("en-GB", {
        style: "percent",
        maximumFractionDigits: 1,
      });
const decimal = (value: number | null): string =>
  value === null || !Number.isFinite(value)
    ? "Unavailable"
    : value.toLocaleString("en-GB", { maximumFractionDigits: 2 });

/** Presentational: Overview owns the range/benchmark selection and the single
 *  `usePortfolioSummary` read shared with SectorAllocationCard (the endpoint
 *  is the slowest call on the page), so this card only renders `state` and
 *  reports the reader's choices back through `onRangeChange`/`onBenchmarkChange`. */
export function PortfolioSummaryCard({
  currency,
  stillLoading = false,
  state,
  refresh,
  range,
  onRangeChange,
  benchmark,
  onBenchmarkChange,
}: {
  currency?: string;
  /** A broker or price sync is in flight, so the reasons below are a status
   *  rather than a verdict. Passed in rather than read here: this card is
   *  presentational, and subscribing to the sync session from inside it made
   *  mounting it start polling — which an existing test caught by counting
   *  four fetches where it expects one. */
  stillLoading?: boolean;
  state: SummaryState;
  refresh: () => void;
  range: RiskRange;
  onRangeChange: (range: RiskRange) => void;
  benchmark: string;
  onBenchmarkChange: (benchmark: string) => void;
}) {
  if (state.status === "loading")
    return (
      <Card aria-busy="true" data-dashboard-section="risk">
        <CardContent>
          <p className="p-5 text-sm text-muted-foreground">Loading summary…</p>
        </CardContent>
      </Card>
    );
  if (state.status === "error")
    return (
      <Card role="alert" data-dashboard-section="risk">
        <CardContent>
          <p className="p-5 text-sm text-muted-foreground">{state.message}</p>
        </CardContent>
      </Card>
    );
  const { metrics, topPositions, risk, composition } = state.data;
  const drawdownCaption =
    risk.drawdownFrom && risk.drawdownFrom !== risk.from
      ? `since ${shortDate(risk.drawdownFrom)}`
      : null;
  const today = new Date().toISOString().slice(0, 10);
  const asOfCaption = risk.to && risk.to < today ? ` (as of ${shortDate(risk.to)})` : "";
  const stats: Array<[string, string, string | null]> = [
    ["Annual volatility", percent(metrics.annualizedVolatility), null],
    ["Beta", decimal(metrics.beta), null],
    ["Regression alpha (annual)", percent(metrics.alpha), null],
    ["Maximum drawdown", percent(metrics.maxDrawdown), drawdownCaption],
    ["Valid daily returns", `${metrics.observationDays}`, null],
    ["Benchmark pairs", `${metrics.pairedObservationDays}`, null],
  ];
  return (
    <Card aria-label="Portfolio summary" data-dashboard-section="risk">
      <CardHeader>
        <p className="text-sm font-medium text-muted-foreground">Risk &amp; composition</p>
        <CardTitle size="md">Summary</CardTitle>
      </CardHeader>
      <CardContent spacing="loose">
        <div className="flex flex-wrap gap-3 text-sm">
          <button type="button" className="self-end rounded-md border px-2 py-1" onClick={refresh}>
            Refresh risk
          </button>
          <label className="flex flex-col gap-1">
            <span className="text-xs text-muted-foreground">Risk period</span>
            <select
              aria-label="Risk period"
              className="rounded-md border bg-background px-2 py-1"
              value={range}
              onChange={(event) => onRangeChange(event.target.value as RiskRange)}
            >
              <option value="6M">6 months</option>
              <option value="1Y">1 year</option>
              <option value="All">Account history</option>
            </select>
          </label>
          {risk.benchmarks.length > 0 && (
            <label className="flex min-w-0 flex-col gap-1">
              <span className="text-xs text-muted-foreground">Risk benchmark</span>
              <select
                aria-label="Risk benchmark"
                className="max-w-full rounded-md border bg-background px-2 py-1"
                value={benchmark || risk.benchmark?.symbol || ""}
                onChange={(event) => onBenchmarkChange(event.target.value)}
              >
                {risk.benchmarks.map((item) => (
                  <option key={item.symbol} value={item.symbol}>
                    {item.name} ({item.currency})
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>
        <div className="space-y-2 text-xs text-muted-foreground">
          <p className="font-medium text-foreground">
            {risk.basis === "holdings" ? "Historical holdings risk" : "Historical account risk"} ·{" "}
            {risk.status === "unavailable"
              ? stillLoading
                ? "Still loading"
                : "Unavailable"
              : "Estimate, currency moves excluded"}
            {asOfCaption}
          </p>
          {/* "Unavailable" NAAST EEN LIJST REDENEN LEEST ALS EEN OORDEEL, en zo
              stond het er ook terwijl de prijsgeschiedenis nog gewoon binnenkwam:
              "Prices missing for 113 instruments" is dan geen tekortkoming maar
              een stand van zaken van een minuut geleden. Het verschil tussen
              "dit kan niet" en "dit kan nog niet" is precies het verschil tussen
              iets repareren en even wachten, en dat hoort het scherm te zeggen. */}
          {stillLoading && risk.status === "unavailable" ? (
            <p>
              Your history is still downloading, so there is not enough of it to measure risk
              against yet. The figures below fill in on their own once it finishes — nothing here
              needs fixing.
            </p>
          ) : (
            <p>Use Refresh risk after broker or price updates.</p>
          )}
          {risk.from && risk.to && (
            <p>
              {risk.from} to {risk.to} · {risk.currency}
            </p>
          )}
          {risk.reasons.length > 0 && (
            <ul aria-label="Risk data limits" className="list-disc space-y-1 pl-4">
              {risk.reasons.map((reason) => (
                <li key={reason}>{reason}</li>
              ))}
            </ul>
          )}
          {(risk.missingPrices.length > 0 || risk.missingHoldings.length > 0) && (
            <details>
              <summary className="cursor-pointer">Affected instruments</summary>
              <div className="mt-2 max-h-36 space-y-2 overflow-y-auto wrap-break-word">
                {risk.missingPrices.length > 0 && (
                  <p>Missing prices: {risk.missingPrices.join(", ")}</p>
                )}
                {risk.missingHoldings.length > 0 && (
                  <p>Incomplete ownership: {risk.missingHoldings.join(", ")}</p>
                )}
              </div>
            </details>
          )}
        </div>
        <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
          {stats.map(([label, value, caption]) => (
            <div key={label}>
              <dt className="text-xs text-muted-foreground">{label}</dt>
              <dd className="font-semibold tabular-nums">{value}</dd>
              {caption && <dd className="text-xs text-muted-foreground">{caption}</dd>}
            </div>
          ))}
        </dl>
        <details className="text-xs text-muted-foreground">
          <summary className="cursor-pointer text-foreground">How to read these metrics</summary>
          <div className="mt-2 space-y-2 leading-relaxed">
            <p>
              Historical account returns, not a forecast for today’s holdings. Deposits and
              withdrawals are removed using an end-of-day cash-flow convention. Fees, dividends and
              interest remain in returns.
            </p>
            <p>
              Annual volatility measures daily return variation, scaled by √252. It is not a maximum
              possible loss.
            </p>
            <p>
              Beta compares matching daily returns with the named benchmark. A beta of 1 means
              similar market sensitivity; 2 means twice the sensitivity. This is not a forecast.
            </p>
            <p>
              Regression alpha is the annualized regression intercept, assuming a 0% cash rate. The
              benchmark uses price returns, excluding dividends. This is not total-return or
              risk-free-rate-adjusted alpha.
            </p>
            <p>
              Maximum drawdown measures the largest fall in the cash-flow-adjusted growth index, not
              in the account balance.
            </p>
            <p>
              Currency conversion uses fixed latest exchange rates. Historical currency gains and
              losses are excluded. Complete dates and at least 60 valid daily returns are required.
              Volatility, beta, alpha and the observation counts use every day in the selected
              range, skipping only the daily intervals that touch a missing price, unknown cash or
              unknown ownership. Maximum drawdown still uses only the most recent unbroken stretch
              of complete dates. A day the market was closed keeps its last close. A still-settling
              close, usually today, is dropped and the estimate is measured through the last
              complete date instead.
            </p>
          </div>
        </details>
        <p className="text-xs text-muted-foreground">
          Current composition · percentages of priced investments, excluding cash.
          {composition &&
            ` ${composition.pricedHoldings} priced holdings; ${composition.missingHoldings} unpriced; ${composition.estimatedHoldings} estimated prices.`}
        </p>
        <div>
          <p className="mb-2 text-xs font-medium text-muted-foreground">Largest positions</p>
          <ul aria-label="Largest positions" className="space-y-2 text-sm">
            {topPositions.length === 0 && (
              <li className="text-muted-foreground">No priced positions yet.</li>
            )}
            {topPositions.map((position) => (
              <li key={position.symbol} className="flex items-center justify-between gap-3">
                <span className="min-w-0 flex-1 truncate">
                  <span className="block truncate">{position.description ?? position.symbol}</span>
                  {position.description && (
                    <span className="block truncate text-xs text-muted-foreground">
                      {position.symbol}
                    </span>
                  )}
                </span>
                <span className="shrink-0 font-semibold tabular-nums">
                  {percent(position.weight)}
                </span>
              </li>
            ))}
          </ul>
        </div>
        {currency && <p className="text-xs text-muted-foreground">Amounts in {currency}.</p>}
      </CardContent>
    </Card>
  );
}
