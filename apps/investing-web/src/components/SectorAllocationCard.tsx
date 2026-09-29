import { useEffect, useRef, useState } from "react";
import type { SectorCoverage } from "@lavega/core";
import type { SummaryState } from "../lib/summaryResource.js";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card.js";

const barColors = [
  "hsl(var(--chart-blue))",
  "hsl(var(--chart-teal))",
  "hsl(var(--chart-purple))",
  "hsl(var(--chart-amber))",
  "hsl(var(--chart-coral))",
];

/** Caps a single mount's background classification run: each server call
 *  classifies at most 10 symbols (SECTOR_INFERENCE_BATCH_SIZE, Task 10), so
 *  a few rounds cover a typical portfolio without ever spinning forever on
 *  one that keeps reporting progress. */
const MAX_INFER_ATTEMPTS = 3;

const percent = (value: number | null | undefined): string =>
  value === null || value === undefined || !Number.isFinite(value)
    ? "Unavailable"
    : value.toLocaleString("en-GB", { style: "percent", maximumFractionDigits: 1 });

const COVERAGE_LABELS: Record<keyof SectorCoverage, string> = {
  provider: "from provider data",
  inferred: "inferred",
  correction: "your corrections",
  unknown: "unknown",
};

/** Renders as "82% from provider data · 10% inferred · 3% your corrections
 *  · 5% unknown", dropping any share that rounds to zero. */
function coverageLine(coverage: SectorCoverage): string | null {
  const parts = (Object.keys(COVERAGE_LABELS) as Array<keyof SectorCoverage>)
    .map((key) => ({ key, pct: Math.round((coverage[key] ?? 0) * 100) }))
    .filter(({ pct }) => pct > 0)
    .map(({ key, pct }) => `${pct}% ${COVERAGE_LABELS[key]}`);
  return parts.length > 0 ? parts.join(" · ") : null;
}

/** Fires the bounded background classification run once per summary load
 *  that reports both inference switched on and unknown coverage, then
 *  refreshes so the newly classified symbols show up. A ref keyed on the
 *  `state.data` identity stops it re-running for the same load — including
 *  React StrictMode's double effect invocation — while still re-arming for
 *  the next distinct summary (initial load, a manual refresh, a poll). */
function useSectorInference(state: SummaryState, refresh: () => void): void {
  const [enabled, setEnabled] = useState(false);
  useEffect(() => {
    let current = true;
    fetch("/api/investing/sector-inference")
      .then((response) => (response.ok ? response.json() : { enabled: false }))
      .then((body: { enabled?: unknown }) => current && setEnabled(body.enabled === true))
      .catch(() => current && setEnabled(false));
    return () => {
      current = false;
    };
  }, []);

  const ranFor = useRef<unknown>(null);
  useEffect(() => {
    if (!enabled || state.status !== "ready") return;
    const unknown = state.data.sectorCoverage?.unknown ?? 0;
    if (unknown <= 0) return;
    if (ranFor.current === state.data) return;
    ranFor.current = state.data;
    let cancelled = false;
    (async () => {
      let classifiedAny = false;
      for (let attempt = 0; attempt < MAX_INFER_ATTEMPTS && !cancelled; attempt += 1) {
        const response = await fetch("/api/investing/sectors/infer", { method: "POST" }).catch(
          () => null,
        );
        if (!response || response.status === 428 || !response.ok) break;
        const body: { classified?: unknown; remaining?: unknown } = await response
          .json()
          .catch(() => ({}));
        if (typeof body.classified === "number" && body.classified > 0) classifiedAny = true;
        else break;
        if (typeof body.remaining === "number" && body.remaining <= 0) break;
      }
      if (classifiedAny && !cancelled) refresh();
    })();
    return () => {
      cancelled = true;
    };
  }, [enabled, state, refresh]);
}

/** Presentational: `/api/investing/summary` is the slowest call on the page,
 *  so Overview reads it once and shares the result with PortfolioSummaryCard
 *  (risk) rather than mounting a second copy of this fetch here. Sectors
 *  describe current holdings rather than a period, so this card is happy
 *  with whichever range that shared read happens to use. */
export function SectorAllocationCard({
  currency,
  state,
  refresh,
}: {
  currency?: string;
  state: SummaryState;
  refresh: () => void;
}) {
  useSectorInference(state, refresh);
  if (state.status === "loading")
    return (
      <Card aria-busy="true" data-dashboard-section="sectors">
        <CardContent>
          <p className="p-5 text-sm text-muted-foreground">Loading sectors…</p>
        </CardContent>
      </Card>
    );
  if (state.status === "error")
    return (
      <Card role="alert" data-dashboard-section="sectors">
        <CardContent>
          <p className="p-5 text-sm text-muted-foreground">{state.message}</p>
        </CardContent>
      </Card>
    );
  const { sectors, sectorCoverage } = state.data;
  const coverage = sectorCoverage ? coverageLine(sectorCoverage) : null;
  return (
    <Card data-dashboard-section="sectors">
      <CardHeader>
        <p className="text-sm font-medium text-muted-foreground">Composition</p>
        <CardTitle className="text-xl">Sector allocation</CardTitle>
      </CardHeader>
      <CardContent>
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
        {sectors.length > 0 && (
          <p className="mt-3 text-xs text-muted-foreground">
            Fund holdings are looked through to their published sector weights; a small residual
            may still show as Unknown.
          </p>
        )}
        {coverage && <p className="mt-1 text-xs text-muted-foreground">{coverage}</p>}
        {currency && <p className="mt-3 text-xs text-muted-foreground">Amounts in {currency}.</p>}
      </CardContent>
    </Card>
  );
}
