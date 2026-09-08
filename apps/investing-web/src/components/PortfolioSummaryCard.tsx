import { useEffect, useState } from "react";
import type { PortfolioMetrics, SectorExposure } from "@lavega/core";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";

export type PortfolioSummary = {
  metrics: PortfolioMetrics;
  sectors: SectorExposure[];
  topPositions: Array<{ symbol: string; weight: number }>;
};

function isPortfolioSummary(value: unknown): value is PortfolioSummary {
  if (!value || typeof value !== "object") return false;
  const summary = value as Partial<PortfolioSummary>;
  return Boolean(
    summary.metrics &&
    typeof summary.metrics === "object" &&
    Array.isArray(summary.sectors) &&
    Array.isArray(summary.topPositions),
  );
}

export async function fetchPortfolioSummary(): Promise<PortfolioSummary> {
  const response = await fetch("/api/investing/summary");
  if (!response.ok) throw new Error(`Failed to load summary: ${response.status}`);
  const payload: unknown = await response.json();
  if (!isPortfolioSummary(payload)) throw new Error("Summary has an invalid format.");
  return payload;
}

type SummaryState =
  | { status: "loading" }
  | { status: "ready"; data: PortfolioSummary }
  | { status: "error"; message: string };

export function usePortfolioSummary(): SummaryState {
  const [state, setState] = useState<SummaryState>({ status: "loading" });
  useEffect(() => {
    let current = true;
    void fetchPortfolioSummary()
      .then((data) => {
        if (current) setState({ status: "ready", data });
      })
      .catch((reason: unknown) => {
        if (current)
          setState({
            status: "error",
            message: reason instanceof Error ? reason.message : "Failed to load summary",
          });
      });
    return () => {
      current = false;
    };
  }, []);
  return state;
}

const barColors = [
  "hsl(var(--chart-blue))",
  "hsl(var(--chart-teal))",
  "hsl(var(--chart-purple))",
  "hsl(var(--chart-amber))",
  "hsl(var(--chart-coral))",
];

const percent = (value: number | null | undefined): string =>
  value === null || value === undefined
    ? "–"
    : value.toLocaleString("en-GB", {
        style: "percent",
        maximumFractionDigits: 1,
        signDisplay: "exceptZero",
      });
const decimal = (value: number | null): string =>
  value === null ? "–" : value.toLocaleString("en-GB", { maximumFractionDigits: 2 });

export function PortfolioSummaryCard({ currency }: { currency?: string }) {
  const state = usePortfolioSummary();
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
  const { metrics, sectors, topPositions } = state.data;
  const stats: Array<[string, string]> = [
    ["Annual volatility", percent(metrics.annualizedVolatility)],
    ["Beta", decimal(metrics.beta)],
    ["Alpha (annual)", percent(metrics.alpha)],
    ["Maximum drawdown", metrics.maxDrawdown === null ? "–" : percent(metrics.maxDrawdown)],
    ["Observations", `${metrics.observationDays} dagen`],
  ];
  return (
    <Card aria-label="Portfolio summary" data-dashboard-section="summary">
      <CardHeader>
        <p className="text-sm font-medium text-muted-foreground">Risk &amp; composition</p>
        <CardTitle className="text-xl">Summary</CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
          {stats.map(([label, value]) => (
            <div key={label}>
              <dt className="text-xs text-muted-foreground">{label}</dt>
              <dd className="font-semibold tabular-nums">{value}</dd>
            </div>
          ))}
        </dl>
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
