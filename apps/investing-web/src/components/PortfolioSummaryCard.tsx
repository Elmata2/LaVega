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
  if (!response.ok) throw new Error(`Samenvatting laden mislukt: ${response.status}`);
  const payload: unknown = await response.json();
  if (!isPortfolioSummary(payload)) throw new Error("Samenvatting heeft ongeldig formaat.");
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
            message: reason instanceof Error ? reason.message : "Samenvatting laden mislukt",
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
    : value.toLocaleString("nl-NL", {
        style: "percent",
        maximumFractionDigits: 1,
        signDisplay: "exceptZero",
      });
const decimal = (value: number | null): string =>
  value === null ? "–" : value.toLocaleString("nl-NL", { maximumFractionDigits: 2 });

export function PortfolioSummaryCard({ currency }: { currency?: string }) {
  const state = usePortfolioSummary();
  if (state.status === "loading")
    return (
      <Card aria-busy="true">
        <CardContent>
          <p className="p-5 text-sm text-muted-foreground">Samenvatting laden…</p>
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
    ["Jaarvolatiliteit", percent(metrics.annualizedVolatility)],
    ["Beta", decimal(metrics.beta)],
    ["Alpha (jaar)", percent(metrics.alpha)],
    ["Maximale daling", metrics.maxDrawdown === null ? "–" : percent(metrics.maxDrawdown)],
    ["Waarnemingen", `${metrics.observationDays} dagen`],
  ];
  return (
    <Card aria-label="Portefeuillesamenvatting" data-dashboard-section="summary">
      <CardHeader>
        <p className="text-sm font-medium text-muted-foreground">Risico &amp; samenstelling</p>
        <CardTitle className="text-xl">Samenvatting</CardTitle>
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
          <p className="mb-2 text-xs font-medium text-muted-foreground">Grootste posities</p>
          <ul aria-label="Grootste posities" className="space-y-2 text-sm">
            {topPositions.length === 0 && (
              <li className="text-muted-foreground">Nog geen geprijsde posities.</li>
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
          <p className="mb-2 text-xs font-medium text-muted-foreground">Sectorverdeling</p>
          <ul aria-label="Sectorverdeling" className="space-y-2">
            {sectors.length === 0 && (
              <li className="text-sm text-muted-foreground">Nog geen sectorgegevens.</li>
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
        {currency && <p className="text-xs text-muted-foreground">Bedragen in {currency}.</p>}
      </CardContent>
    </Card>
  );
}
