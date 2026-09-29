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

/** Caps this component instance's total background classification calls —
 *  across every summary refresh the run itself triggers, not just one
 *  effect invocation (#135 final review, C1). A server that mis-reported
 *  classified > 0 for symbols that actually failed once made this loop
 *  forever: each refresh produced a new summary object, which re-armed a
 *  fresh 3-attempt budget. Counting attempts in a ref that survives across
 *  state changes closes that off — at most this many paid classifier calls
 *  per page mount, full stop. */
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

/** Largest-remainder rounding: round every share down first, then hand the
 *  leftover whole points (the gap between that and the shares' true total)
 *  to whichever shares lost the most to flooring. Plain per-share rounding
 *  can under- or overshoot the total by a point or two (three even 1/3
 *  shares would each round to 33%, one point short); this keeps the
 *  displayed parts summing to the shares' actual total. */
function largestRemainderRound(shares: number[]): number[] {
  const scaled = shares.map((share) => share * 100);
  const floors = scaled.map(Math.floor);
  const remainder = Math.round(
    scaled.reduce((sum, value) => sum + value, 0) - floors.reduce((sum, value) => sum + value, 0),
  );
  const byRemainingFraction = scaled
    .map((value, index) => ({ index, fraction: value - floors[index]! }))
    .sort((left, right) => right.fraction - left.fraction);
  const rounded = [...floors];
  for (let i = 0; i < remainder && i < byRemainingFraction.length; i += 1) {
    rounded[byRemainingFraction[i]!.index] += 1;
  }
  return rounded;
}

/** Renders as "82% from provider data · 10% inferred · 3% your corrections
 *  · 5% unknown", dropping any share that rounds to zero. */
function coverageLine(coverage: SectorCoverage): string | null {
  const keys = Object.keys(COVERAGE_LABELS) as Array<keyof SectorCoverage>;
  const pcts = largestRemainderRound(keys.map((key) => coverage[key] ?? 0));
  const parts = keys
    .map((key, index) => ({ key, pct: pcts[index]! }))
    .filter(({ pct }) => pct > 0)
    .map(({ key, pct }) => `${pct}% ${COVERAGE_LABELS[key]}`);
  return parts.length > 0 ? parts.join(" · ") : null;
}

/** Fires the bounded background classification run once per summary load
 *  that reports both inference switched on and unknown coverage, then
 *  refreshes so the newly classified symbols show up. A ref keyed on the
 *  `state.data` identity stops it re-running for the same load — including
 *  React StrictMode's double effect invocation — while still re-arming for
 *  the next distinct summary (initial load, a manual refresh, a poll).
 *
 *  Two refs make the loop resilient instead of infinite (#135 final review,
 *  C1). `attemptsRef` counts POSTs for the component's whole lifetime, not
 *  per effect run, so a chain of refreshes — each handing back a new
 *  `state.data` that still reports unknown coverage — can't re-arm a fresh
 *  budget forever. `excludeRef` accumulates symbols the server reports as
 *  failed this session and is sent back as `exclude`, so a handful of
 *  always-failing symbols (head-of-line in the server's candidate list)
 *  don't crowd out ones that might actually resolve. The route only
 *  refreshes when `classified > 0`, so a classifier that fails every
 *  symbol never triggers a refresh at all.
 *
 *  `refresh` is read through a ref rather than listed as an effect
 *  dependency: usePortfolioSummary memoizes it, but this run's own
 *  correctness never depended on that — an unrelated parent re-render
 *  handing down a new `refresh` closure must not cancel an in-flight
 *  classification loop and lose its post-inference refresh. */
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

  const refreshRef = useRef(refresh);
  useEffect(() => {
    refreshRef.current = refresh;
  }, [refresh]);

  const ranFor = useRef<unknown>(null);
  const attemptsRef = useRef(0);
  const excludeRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (!enabled || state.status !== "ready") return;
    const unknown = state.data.sectorCoverage?.unknown ?? 0;
    if (unknown <= 0) return;
    if (ranFor.current === state.data) return;
    ranFor.current = state.data;
    let cancelled = false;
    (async () => {
      let classifiedAny = false;
      while (attemptsRef.current < MAX_INFER_ATTEMPTS && !cancelled) {
        attemptsRef.current += 1;
        const response = await fetch("/api/investing/sectors/infer", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ exclude: [...excludeRef.current] }),
        }).catch(() => null);
        if (!response || !response.ok) break;
        const body: { classified?: unknown; remaining?: unknown; failedSymbols?: unknown } =
          await response.json().catch(() => ({}));
        if (Array.isArray(body.failedSymbols))
          for (const symbol of body.failedSymbols)
            if (typeof symbol === "string") excludeRef.current.add(symbol);
        if (typeof body.classified === "number" && body.classified > 0) classifiedAny = true;
        else break;
        if (typeof body.remaining === "number" && body.remaining <= 0) break;
      }
      if (classifiedAny && !cancelled) refreshRef.current();
    })();
    return () => {
      cancelled = true;
    };
  }, [enabled, state]);
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
