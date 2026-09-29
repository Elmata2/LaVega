import type { SummaryState } from "../lib/summaryResource.js";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card.js";

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
    : value.toLocaleString("en-GB", { style: "percent", maximumFractionDigits: 1 });

/** Presentational: `/api/investing/summary` is the slowest call on the page,
 *  so Overview reads it once and shares the result with PortfolioSummaryCard
 *  (risk) rather than mounting a second copy of this fetch here. Sectors
 *  describe current holdings rather than a period, so this card is happy
 *  with whichever range that shared read happens to use. */
export function SectorAllocationCard({
  currency,
  state,
}: {
  currency?: string;
  state: SummaryState;
}) {
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
  const { sectors } = state.data;
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
        {currency && <p className="mt-3 text-xs text-muted-foreground">Amounts in {currency}.</p>}
      </CardContent>
    </Card>
  );
}
