import type { PortfolioRange, PortfolioValuePoint } from "@lavega/core";
import { useCallback, useId, useMemo } from "react";
import { Area, AreaChart, Line, ReferenceArea, ReferenceLine, XAxis, YAxis } from "recharts";
import { EmptyState } from "./EmptyState";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import { ChartContainer, ChartTooltip } from "./ui/chart";
import { chartRanges, pointsInWindow, useChartWindow, type ChartWindow } from "./useChartWindow";
import { shortDate } from "../lib/dates.js";

/** A portfolio point, optionally carrying the owner's opted-in Personal total
 *  (`@lavega/core`'s `mergeInPersonalNetWorth`). Both extra fields are
 *  optional so a caller with nothing to merge — every existing caller, and
 *  every point in this file's own tests — can keep passing a plain
 *  `PortfolioValuePoint[]` unchanged. */
type ChartInputPoint = PortfolioValuePoint & {
  personalValue?: number | null;
  netWorth?: number | null;
};

type Props = {
  data: Partial<Record<PortfolioRange, ChartInputPoint[]>>;
  currency?: string;
  /** The most recent date the owner shared a Personal total, or null/absent
   *  when nothing has ever been shared. Drives the "Bank accounts (Personal,
   *  as of …)" band's label; when it is null the band, its legend swatch and
   *  its tooltip line are all omitted, and the chart renders exactly as it
   *  did before this existed. */
  personalAsOfDate?: string | null;
};

type NetWorthChartPoint = Omit<ChartInputPoint, "personalValue"> & {
  stalePositions: number | null;
  /** Normalized by `toNetWorthChartPoint`: always present, never `undefined`. */
  personalValue: number | null;
  /** `netWorth` when the caller merged one in, otherwise the portfolio-only
   *  `value` — the single figure this chart's own "Total" line and headline
   *  number show. Return/risk/allocation elsewhere never read this; they keep
   *  reading `positionsValue`/`cashValue`/`value` on the untouched source. */
  netTotal: number | null;
};

const dateLabel = shortDate;
const money = (value: number, currency: string) =>
  value.toLocaleString("en-GB", { style: "currency", currency, maximumFractionDigits: 2 });
const displayValue = (value: number | null, currency: string) =>
  value === null ? "Value unknown" : money(value, currency);

function allPoints(data: Props["data"]): PortfolioValuePoint[] {
  if (data.All) return data.All;
  return [
    ...new Map(
      Object.values(data)
        .flatMap((points) => points ?? [])
        .map((point) => [point.date, point]),
    ).values(),
  ].sort((left, right) => left.date.localeCompare(right.date));
}

export function netWorthPointsForWindow(
  data: Props["data"],
  window: ChartWindow,
): PortfolioValuePoint[] {
  return pointsInWindow(
    allPoints(data),
    window,
    (range) => data[range] ?? (range === "All" ? allPoints(data) : []),
  );
}

export function toNetWorthChartPoint(point: ChartInputPoint): NetWorthChartPoint {
  return {
    ...point,
    personalValue: point.personalValue ?? null,
    netTotal: point.netWorth ?? point.value,
    stalePositions: point.forwardFilled.length > 0 ? point.positionsValue : null,
  };
}

export function NetWorthChart({ data, currency = "EUR", personalAsOfDate = null }: Props) {
  const hatchId = `net-worth-hatch-${useId().replace(/:/g, "")}`;

  const fullPoints = useMemo(() => allPoints(data), [data]);
  const presetPoints = useCallback(
    (range: PortfolioRange) => data[range] ?? (range === "All" ? fullPoints : []),
    [data, fullPoints],
  );
  const chart = useChartWindow({ allPoints: fullPoints, presetPoints });
  const {
    points,
    focusIndex,
    pointerRatio,
    selection,
    chartRef,
    dateFrom,
    setDateFrom,
    dateTo,
    setDateTo,
    dateError,
    minDate,
    maxDate,
  } = chart;
  const chartPoints = useMemo(() => points.map(toNetWorthChartPoint), [points]);
  const activePoint = chartPoints[focusIndex ?? chartPoints.length - 1] ?? null;
  const warnings = useMemo(
    () => ({
      unpriced: [...new Set(points.flatMap((point) => point.unpriced))],
      cashUnknown: [...new Set(points.flatMap((point) => point.cashUnknown))],
      cashEstimated: [...new Set(points.flatMap((point) => point.cashEstimated ?? []))],
      forwardFilled: [...new Set(points.flatMap((point) => point.forwardFilled))],
    }),
    [points],
  );

  function applyTypedDates(event: React.FormEvent) {
    event.preventDefault();
    chart.applyTypedDates();
  }

  return (
    <Card data-dashboard-section="net-worth">
      <CardHeader gap="wide" className="sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-sm font-medium text-muted-foreground">Net worth</p>
          <CardTitle>Investments and cash</CardTitle>
        </div>
        <div
          role="group"
          aria-label="Choose net worth period"
          className="flex flex-wrap gap-1 rounded-pill bg-secondary p-1"
        >
          {chartRanges.map((item) => (
            <button
              key={item.value}
              type="button"
              aria-pressed={chart.window.kind === "preset" && chart.window.range === item.value}
              onClick={() => chart.applyPreset(item.value)}
              className={`pressable rounded-pill px-2.5 py-1.5 text-xs font-semibold ${chart.window.kind === "preset" && chart.window.range === item.value ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground"}`}
            >
              {item.label}
            </button>
          ))}
        </div>
      </CardHeader>
      <CardContent>
        {points.length === 0 ? (
          <EmptyState
            title="No net worth history"
            description="Net worth appears once broker and price data are available."
          />
        ) : (
          <>
            <div className="mb-4 flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <strong className="font-display text-2xl tabular-nums">
                {displayValue(activePoint?.netTotal ?? null, currency)}
              </strong>
              <span className="text-xs text-muted-foreground">
                on {activePoint ? dateLabel(activePoint.date) : "unknown date"}
              </span>
            </div>
            {activePoint &&
              chartPoints.length > 1 &&
              (() => {
                const first = chartPoints[0]!;
                const change =
                  activePoint.netTotal !== null && first.netTotal !== null
                    ? activePoint.netTotal - first.netTotal
                    : null;
                const investmentChange =
                  activePoint.positionsValue !== null && first.positionsValue !== null
                    ? activePoint.positionsValue - first.positionsValue
                    : null;
                const cashChange =
                  activePoint.cashValue !== null && first.cashValue !== null
                    ? activePoint.cashValue - first.cashValue
                    : null;
                const formatChange = (value: number | null) =>
                  value === null ? "Unknown" : `${value >= 0 ? "+" : ""}${money(value, currency)}`;
                return (
                  <div
                    className="mb-5 grid gap-3 sm:grid-cols-3"
                    aria-label="Net worth change summary"
                  >
                    <div className="rounded-tile border border-border bg-secondary/30 p-3">
                      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        Trend
                      </p>
                      <p
                        className={`mt-1 text-xl font-semibold tabular-nums ${change !== null && change < 0 ? "text-negative" : "text-positive"}`}
                      >
                        {formatChange(change)}
                      </p>
                    </div>
                    <div className="rounded-tile border border-border p-3">
                      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        Investments
                      </p>
                      <p className="mt-1 text-lg font-semibold tabular-nums">
                        {formatChange(investmentChange)}
                      </p>
                    </div>
                    <div className="rounded-tile border border-border p-3">
                      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        Cash
                      </p>
                      <p className="mt-1 text-lg font-semibold tabular-nums">
                        {formatChange(cashChange)}
                      </p>
                    </div>
                  </div>
                );
              })()}
            <form
              onSubmit={applyTypedDates}
              aria-label="Choose net worth date range"
              className="mb-3 flex flex-wrap items-end gap-2 text-xs"
            >
              <label className="font-semibold text-muted-foreground">
                From
                <input
                  type="date"
                  aria-label="Net worth from date"
                  min={minDate}
                  max={maxDate}
                  value={dateFrom}
                  onChange={(event) => setDateFrom(event.target.value)}
                  className="mt-1 block rounded-chip border border-input bg-background px-2 py-1.5 font-normal text-foreground"
                />
              </label>
              <label className="font-semibold text-muted-foreground">
                To
                <input
                  type="date"
                  aria-label="Net worth to date"
                  min={minDate}
                  max={maxDate}
                  value={dateTo}
                  onChange={(event) => setDateTo(event.target.value)}
                  className="mt-1 block rounded-chip border border-input bg-background px-2 py-1.5 font-normal text-foreground"
                />
              </label>
              <button
                type="submit"
                className="pressable rounded-pill border border-border px-3 py-1.5 font-semibold"
              >
                Apply
              </button>
              {chart.window.kind === "custom" && (
                <button
                  type="button"
                  onClick={chart.clearZoom}
                  aria-label="Clear net worth zoom"
                  className="pressable rounded-pill bg-secondary px-3 py-1.5 font-semibold"
                >
                  Zoom: {dateLabel(chart.window.from)} – {dateLabel(chart.window.to)} ×
                </button>
              )}
            </form>
            {dateError && (
              <p role="alert" className="mb-3 text-xs text-negative">
                {dateError}
              </p>
            )}
            <div
              ref={chartRef}
              role="img"
              tabIndex={0}
              aria-label="Net worth: investments, cash and total. Use arrow keys for exact values, Home and End for start and end, Escape to clear zoom."
              className="touch-pan-y select-none rounded-xl"
              {...chart.handlers}
            >
              <ChartContainer className="h-[320px]" aria-hidden="true">
                <AreaChart
                  data={chartPoints}
                  margin={{ top: 12, right: 12, left: 8, bottom: 0 }}
                  onMouseMove={(state) => {
                    if (typeof state?.activeTooltipIndex === "number")
                      chart.focus(state.activeTooltipIndex);
                  }}
                >
                  <defs>
                    <pattern
                      id={hatchId}
                      width="6"
                      height="6"
                      patternTransform="rotate(45)"
                      patternUnits="userSpaceOnUse"
                    >
                      <rect
                        width="6"
                        height="6"
                        fill="var(--color-chart-teal)"
                        fillOpacity={0.14}
                      />
                      <line
                        x1="0"
                        y1="0"
                        x2="0"
                        y2="6"
                        stroke="var(--color-chart-teal)"
                        strokeOpacity={0.6}
                        strokeWidth="2"
                      />
                    </pattern>
                  </defs>
                  <XAxis
                    dataKey="date"
                    tick={{ fontSize: 11 }}
                    tickLine={false}
                    axisLine={false}
                    tickFormatter={(value: string) => value.slice(5)}
                  />
                  <YAxis
                    tick={{ fontSize: 11 }}
                    tickLine={false}
                    axisLine={false}
                    width={72}
                    domain={["auto", "auto"]}
                    tickFormatter={(value: number) => money(value, currency)}
                  />
                  {focusIndex !== null && chartPoints[focusIndex] && (
                    <ReferenceLine
                      x={chartPoints[focusIndex]!.date}
                      stroke="hsl(var(--foreground))"
                      strokeOpacity={0.4}
                      strokeDasharray="3 3"
                    />
                  )}
                  {selection && (
                    <ReferenceArea
                      x1={selection.from}
                      x2={selection.to}
                      fill="hsl(var(--chart-blue))"
                      fillOpacity={0.12}
                      strokeOpacity={0}
                    />
                  )}
                  <ChartTooltip
                    isAnimationActive={false}
                    reverseDirection={{ x: pointerRatio > 0.62, y: false }}
                    content={<NetWorthTooltip currency={currency} />}
                  />
                  <Area
                    dataKey="positionsValue"
                    stackId="net"
                    name="Investments"
                    connectNulls={false}
                    stroke="hsl(var(--chart-teal))"
                    fill="hsl(var(--chart-teal) / 0.24)"
                    strokeWidth={1.5}
                    isAnimationActive={false}
                  />
                  <Area
                    dataKey="cashValue"
                    stackId="net"
                    name="Cash"
                    connectNulls={false}
                    stroke="hsl(var(--chart-amber))"
                    fill="hsl(var(--chart-amber) / 0.24)"
                    strokeWidth={1.5}
                    isAnimationActive={false}
                  />
                  {personalAsOfDate && (
                    <Area
                      dataKey="personalValue"
                      stackId="net"
                      name={`Bank accounts (Personal, as of ${dateLabel(personalAsOfDate)})`}
                      connectNulls={false}
                      stroke="hsl(var(--chart-blue))"
                      fill="hsl(var(--chart-blue) / 0.24)"
                      strokeWidth={1.5}
                      isAnimationActive={false}
                    />
                  )}
                  <Area
                    dataKey="stalePositions"
                    name="Estimated price"
                    connectNulls={false}
                    stroke="none"
                    fill={`url(#${hatchId})`}
                    isAnimationActive={false}
                    legendType="none"
                  />
                  <Line
                    dataKey="netTotal"
                    name="Total"
                    connectNulls={false}
                    stroke="hsl(var(--foreground))"
                    strokeWidth={2.25}
                    dot={false}
                    activeDot={{ r: 4 }}
                    isAnimationActive={false}
                  />
                </AreaChart>
              </ChartContainer>
            </div>
            <p aria-live="polite" className="sr-only">
              {activePoint ? accessiblePoint(activePoint, currency) : "No values available"}
            </p>
            <ul className="sr-only" aria-label="Exact net worth values">
              {chartPoints.map((point) => (
                <li key={point.date}>{accessiblePoint(point, currency)}</li>
              ))}
            </ul>
            <div
              className="mt-4 flex flex-wrap gap-4 text-xs text-muted-foreground"
              aria-label="Net worth chart series"
            >
              <span className="inline-flex items-center gap-1.5">
                <span aria-hidden="true" className="size-2 rounded-full bg-chart-teal" />
                Investments
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span aria-hidden="true" className="size-2 rounded-full bg-chart-amber" />
                Cash
              </span>
              {personalAsOfDate && (
                <span className="inline-flex items-center gap-1.5">
                  <span aria-hidden="true" className="size-2 rounded-full bg-chart-blue" />
                  Bank accounts (Personal, as of {dateLabel(personalAsOfDate)})
                </span>
              )}
              <span className="inline-flex items-center gap-1.5">
                <span aria-hidden="true" className="h-0.5 w-3 bg-foreground" />
                Total
              </span>
              {warnings.forwardFilled.length > 0 && (
                <span className="inline-flex items-center gap-1.5">
                  <span aria-hidden="true" className="h-2.5 w-3 net-worth-hatch" />
                  Estimated prices ({warnings.forwardFilled.length})
                  <span className="sr-only">
                    {" "}
                    Estimated price: {warnings.forwardFilled.join(", ")}
                  </span>
                </span>
              )}
            </div>
            {(warnings.unpriced.length > 0 ||
              warnings.cashUnknown.length > 0 ||
              warnings.cashEstimated.length > 0) && (
              <div
                role="status"
                className="mt-4 rounded-tile border border-warning/30 bg-warning/10 px-4 py-3 text-xs leading-5"
              >
                <p className="font-semibold">Net worth partly unknown</p>
                {warnings.unpriced.length > 0 && (
                  <p>
                    <span className="sr-only">
                      Excluded due to stale price: {warnings.unpriced.join(", ")}{" "}
                    </span>
                    Excluded due to stale price: {warnings.unpriced.length} instruments
                  </p>
                )}
                {warnings.cashUnknown.length > 0 && (
                  <p>
                    <span className="sr-only">
                      Cash value unknown: {warnings.cashUnknown.join(", ")}{" "}
                    </span>
                    Cash value unknown: {warnings.cashUnknown.length} accounts
                  </p>
                )}
                {warnings.cashEstimated.length > 0 && (
                  <p>
                    Cash estimated from unproven history: {warnings.cashEstimated.length} accounts
                  </p>
                )}
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

function NetWorthTooltip({
  active,
  payload,
  currency,
}: {
  active?: boolean;
  payload?: Array<{ payload?: NetWorthChartPoint }>;
  currency: string;
}) {
  const point = active ? payload?.[0]?.payload : null;
  if (!point) return null;
  return (
    <div className="max-w-[min(320px,80vw)] rounded-xl border border-border bg-card px-3 py-2 text-xs shadow-md">
      <p className="mb-1 text-muted-foreground">{dateLabel(point.date)}</p>
      <p className="mb-2 text-base font-semibold tabular-nums">
        {displayValue(point.netTotal, currency)}
      </p>
      <p className="flex justify-between gap-5">
        <span>Investments{point.forwardFilled.length > 0 ? " (estimated price)" : ""}</span>
        <strong>{displayValue(point.positionsValue, currency)}</strong>
      </p>
      <p className="mt-1 flex justify-between gap-5">
        <span>Cash</span>
        <strong>{displayValue(point.cashValue, currency)}</strong>
      </p>
      {point.personalValue !== null && (
        <p className="mt-1 flex justify-between gap-5">
          <span>Bank accounts (Personal)</span>
          <strong>{displayValue(point.personalValue, currency)}</strong>
        </p>
      )}
      {point.unpriced.length > 0 && (
        <p className="mt-2 border-t border-border pt-2 text-warning">
          Excluded due to stale price: {point.unpriced.join(", ")}
        </p>
      )}
      {point.cashUnknown.length > 0 && (
        <p className="mt-1 text-warning">Cash value unknown: {point.cashUnknown.join(", ")}</p>
      )}
      {(point.cashEstimated?.length ?? 0) > 0 && (
        <p className="mt-1 text-muted-foreground">
          Cash estimated: {point.cashEstimated?.join(", ")}
        </p>
      )}
    </div>
  );
}

function accessiblePoint(point: NetWorthChartPoint, currency: string): string {
  return `${dateLabel(point.date)}: total ${displayValue(point.netTotal, currency)}, investments ${displayValue(point.positionsValue, currency)}, cash ${displayValue(point.cashValue, currency)}${point.personalValue !== null ? `, bank accounts (Personal): ${displayValue(point.personalValue, currency)}` : ""}${point.forwardFilled.length ? `, estimated price: ${point.forwardFilled.join(", ")}` : ""}${point.unpriced.length ? `, excluded due to stale price: ${point.unpriced.join(", ")}` : ""}${point.cashUnknown.length ? `, cash value unknown: ${point.cashUnknown.join(", ")}` : ""}${point.cashEstimated?.length ? `, cash estimated: ${point.cashEstimated.join(", ")}` : ""}`;
}
