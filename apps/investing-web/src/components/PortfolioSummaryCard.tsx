import { useEffect, useState } from "react";
import type { HistoricalRisk, PortfolioMetrics, RiskRange, SectorExposure } from "@lavega/core";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";

export type PortfolioSummary = {
  metrics: PortfolioMetrics;
  sectors: SectorExposure[];
  topPositions: Array<{ symbol: string; weight: number }>;
  risk: HistoricalRisk;
  composition?: { pricedHoldings: number; missingHoldings: number; estimatedHoldings: number };
};

function isPortfolioSummary(value: unknown): value is PortfolioSummary {
  if (!value || typeof value !== "object") return false;
  const summary = value as Partial<PortfolioSummary>;
  return Boolean(
    summary.metrics &&
    typeof summary.metrics === "object" &&
    summary.risk &&
    Array.isArray(summary.risk.reasons) &&
    Array.isArray(summary.sectors) &&
    Array.isArray(summary.topPositions),
  );
}

export async function fetchPortfolioSummary(
  range: RiskRange = "1Y",
  benchmark = "",
): Promise<PortfolioSummary> {
  const query = new URLSearchParams({ range });
  if (benchmark) query.set("benchmark", benchmark);
  const response = await fetch(`/api/investing/summary?${query}`);
  if (!response.ok) throw new Error(`Failed to load summary: ${response.status}`);
  const payload: unknown = await response.json();
  if (!isPortfolioSummary(payload)) throw new Error("Summary has an invalid format.");
  return payload;
}

type SummaryState =
  | { status: "loading" }
  | { status: "ready"; data: PortfolioSummary }
  | { status: "error"; message: string };

export function usePortfolioSummary(
  range: RiskRange,
  benchmark: string,
  revision: string,
): SummaryState {
  const requestKey = JSON.stringify([range, benchmark, revision]);
  const [state, setState] = useState<{ key: string; result: SummaryState }>({
    key: "",
    result: { status: "loading" },
  });
  useEffect(() => {
    let current = true;
    void fetchPortfolioSummary(range, benchmark)
      .then((data) => {
        if (current) setState({ key: requestKey, result: { status: "ready", data } });
      })
      .catch((reason: unknown) => {
        if (current)
          setState({
            key: requestKey,
            result: {
              status: "error",
              message: reason instanceof Error ? reason.message : "Failed to load summary",
            },
          });
      });
    return () => {
      current = false;
    };
  }, [range, benchmark, requestKey]);
  return state.key === requestKey ? state.result : { status: "loading" };
}

const barColors = [
  "hsl(var(--chart-blue))",
  "hsl(var(--chart-teal))",
  "hsl(var(--chart-purple))",
  "hsl(var(--chart-amber))",
  "hsl(var(--chart-coral))",
];

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

export function PortfolioSummaryCard({
  currency,
  revision = "",
}: {
  currency?: string;
  revision?: string;
}) {
  const [range, setRange] = useState<RiskRange>("1Y");
  const [refresh, setRefresh] = useState(0);
  const [selection, setSelection] = useState({ value: "", revision });
  const benchmark = selection.revision === revision ? selection.value : "";
  const state = usePortfolioSummary(range, benchmark, `${revision}:${refresh}`);
  if (state.status === "loading")
    return (
      <Card aria-busy="true">
        <CardContent>
          <p className="p-5 text-sm text-muted-foreground">Loading summary…</p>
        </CardContent>
      </Card>
    );
  if (state.status === "error")
    return (
      <Card role="alert">
        <CardContent>
          <p className="p-5 text-sm text-muted-foreground">{state.message}</p>
        </CardContent>
      </Card>
    );
  const { metrics, sectors, topPositions, risk, composition } = state.data;
  const stats: Array<[string, string]> = [
    ["Annual volatility", percent(metrics.annualizedVolatility)],
    ["Beta", decimal(metrics.beta)],
    ["Regression alpha (annual)", percent(metrics.alpha)],
    ["Maximum drawdown", percent(metrics.maxDrawdown)],
    ["Valid daily returns", `${metrics.observationDays}`],
    ["Benchmark pairs", `${metrics.pairedObservationDays}`],
  ];
  return (
    <Card aria-label="Portfolio summary" data-dashboard-section="summary">
      <CardHeader>
        <p className="text-sm font-medium text-muted-foreground">Risk &amp; composition</p>
        <CardTitle className="text-xl">Summary</CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="flex flex-wrap gap-3 text-sm">
          <button
            type="button"
            className="self-end rounded-md border px-2 py-1"
            onClick={() => setRefresh((value) => value + 1)}
          >
            Refresh risk
          </button>
          <label className="flex flex-col gap-1">
            <span className="text-xs text-muted-foreground">Risk period</span>
            <select
              aria-label="Risk period"
              className="rounded-md border bg-background px-2 py-1"
              value={range}
              onChange={(event) => setRange(event.target.value as RiskRange)}
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
                onChange={(event) => setSelection({ value: event.target.value, revision })}
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
            Historical account risk ·{" "}
            {risk.status === "unavailable" ? "Unavailable" : "Estimate, currency moves excluded"}
          </p>
          <p>Use Refresh risk after broker or price updates.</p>
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
              <div className="mt-2 max-h-36 space-y-2 overflow-y-auto break-words">
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
          {stats.map(([label, value]) => (
            <div key={label}>
              <dt className="text-xs text-muted-foreground">{label}</dt>
              <dd className="font-semibold tabular-nums">{value}</dd>
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
              Missing or carried-forward prices, unknown cash and unsupported ownership history
              prevent calculation.
            </p>
          </div>
        </details>
        <p className="text-xs text-muted-foreground">
          Current composition · percentages of priced investments, excluding cash. Funds are grouped
          by their reported sector; underlying holdings are not included.
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
                <span className="truncate">{position.symbol}</span>
                <span className="font-semibold tabular-nums">{percent(position.weight)}</span>
              </li>
            ))}
          </ul>
        </div>
        <div>
          <p className="mb-2 text-xs font-medium text-muted-foreground">Sector allocation</p>
          <ul aria-label="Sector allocation" className="space-y-2">
            {sectors.length === 0 && (
              <li className="text-sm text-muted-foreground">No sector data yet.</li>
            )}
            {sectors.map((sector, index) => (
              <li key={sector.sector}>
                <div className="flex items-center justify-between gap-3 text-sm">
                  <span className="truncate">{sector.sector}</span>
                  <span className="font-semibold tabular-nums">{percent(sector.weight)}</span>
                </div>
                <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-secondary">
                  <div
                    aria-hidden="true"
                    className="h-full rounded-full"
                    style={{
                      width: `${Math.min(100, sector.weight * 100)}%`,
                      backgroundColor: barColors[index % barColors.length],
                    }}
                  />
                </div>
              </li>
            ))}
          </ul>
        </div>
        {currency && <p className="text-xs text-muted-foreground">Amounts in {currency}.</p>}
      </CardContent>
    </Card>
  );
}
