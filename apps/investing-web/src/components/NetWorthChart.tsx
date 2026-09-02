import type { PortfolioRange, PortfolioValuePoint } from "@lavega/core";
import { useCallback, useId, useMemo } from "react";
import { Area, AreaChart, Line, ReferenceArea, ReferenceLine, XAxis, YAxis } from "recharts";
import { EmptyState } from "./EmptyState";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import { ChartContainer, ChartTooltip } from "./ui/chart";
import { chartRanges, pointsInWindow, useChartWindow, type ChartWindow } from "./useChartWindow";
import { shortDate } from "../lib/dates.js";

type Props = {
  data: Partial<Record<PortfolioRange, PortfolioValuePoint[]>>;
  currency?: string;
};

type NetWorthChartPoint = PortfolioValuePoint & {
  stalePositions: number | null;
};

const dateLabel = shortDate;
const money = (value: number, currency: string) => value.toLocaleString("nl-NL", { style: "currency", currency, maximumFractionDigits: 2 });
const displayValue = (value: number | null, currency: string) => value === null ? "Waarde onbekend" : money(value, currency);

function allPoints(data: Props["data"]): PortfolioValuePoint[] {
  if (data.All) return data.All;
  return [...new Map(Object.values(data).flatMap((points) => points ?? []).map((point) => [point.date, point])).values()]
    .sort((left, right) => left.date.localeCompare(right.date));
}

export function netWorthPointsForWindow(data: Props["data"], window: ChartWindow): PortfolioValuePoint[] {
  return pointsInWindow(allPoints(data), window, (range) => data[range] ?? (range === "All" ? allPoints(data) : []));
}

export function toNetWorthChartPoint(point: PortfolioValuePoint): NetWorthChartPoint {
  return {
    ...point,
    stalePositions: point.forwardFilled.length > 0 ? point.positionsValue : null,
  };
}

export function NetWorthChart({ data, currency = "EUR" }: Props) {
  const hatchId = `net-worth-hatch-${useId().replace(/:/g, "")}`;

  const fullPoints = useMemo(() => allPoints(data), [data]);
  const presetPoints = useCallback((range: PortfolioRange) => data[range] ?? (range === "All" ? fullPoints : []), [data, fullPoints]);
  const chart = useChartWindow({ allPoints: fullPoints, presetPoints });
  const { points, focusIndex, setFocusIndex, pointerRatio, setPointerRatio, drag, chartRef, dateFrom, setDateFrom, dateTo, setDateTo, dateError, minDate, maxDate } = chart;
  const chartPoints = useMemo(() => points.map(toNetWorthChartPoint), [points]);
  const activePoint = chartPoints[focusIndex ?? chartPoints.length - 1] ?? null;
  const warnings = useMemo(() => ({
    unpriced: [...new Set(points.flatMap((point) => point.unpriced))],
    cashUnknown: [...new Set(points.flatMap((point) => point.cashUnknown))],
    forwardFilled: [...new Set(points.flatMap((point) => point.forwardFilled))],
  }), [points]);

  function applyTypedDates(event: React.FormEvent) {
    event.preventDefault();
    chart.applyTypedDates();
  }

  return <Card data-dashboard-section="net-worth">
    <CardHeader className="gap-4 sm:flex-row sm:items-start sm:justify-between">
      <div><p className="text-sm font-medium text-muted-foreground">Nettovermogen</p><CardTitle>Beleggingen en cash</CardTitle></div>
      <div role="group" aria-label="Periode nettovermogen kiezen" className="flex flex-wrap gap-1 rounded-pill bg-secondary p-1">
        {chartRanges.map((item) => <button key={item.value} type="button" aria-pressed={chart.window.kind === "preset" && chart.window.range === item.value} onClick={() => chart.applyPreset(item.value)} className={`pressable rounded-pill px-2.5 py-1.5 text-xs font-semibold ${chart.window.kind === "preset" && chart.window.range === item.value ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground"}`}>{item.label}</button>)}
      </div>
    </CardHeader>
    <CardContent>
      {points.length === 0 ? <EmptyState title="Geen vermogenshistorie" description="Nettovermogen verschijnt zodra broker- en prijsgegevens beschikbaar zijn." /> : <>
        <div className="mb-4 flex flex-wrap items-baseline gap-x-3 gap-y-1"><strong className="font-display text-2xl tabular-nums">{displayValue(activePoint?.value ?? null, currency)}</strong><span className="text-xs text-muted-foreground">op {activePoint ? dateLabel(activePoint.date) : "onbekende datum"}</span></div>
        <form onSubmit={applyTypedDates} aria-label="Datumbereik nettovermogen kiezen" className="mb-3 flex flex-wrap items-end gap-2 text-xs">
          <label className="font-semibold text-muted-foreground">Van<input type="date" aria-label="Nettovermogen van datum" min={minDate} max={maxDate} value={dateFrom} onChange={(event) => setDateFrom(event.target.value)} className="mt-1 block rounded-[10px] border border-input bg-background px-2 py-1.5 font-normal text-foreground" /></label>
          <label className="font-semibold text-muted-foreground">Tot<input type="date" aria-label="Nettovermogen tot datum" min={minDate} max={maxDate} value={dateTo} onChange={(event) => setDateTo(event.target.value)} className="mt-1 block rounded-[10px] border border-input bg-background px-2 py-1.5 font-normal text-foreground" /></label>
          <button type="submit" className="pressable rounded-pill border border-border px-3 py-1.5 font-semibold">Toepassen</button>
          {chart.window.kind === "custom" && <button type="button" onClick={chart.clearZoom} aria-label="Zoom nettovermogen wissen" className="pressable rounded-pill bg-secondary px-3 py-1.5 font-semibold">Zoom: {dateLabel(chart.window.from)} – {dateLabel(chart.window.to)} ×</button>}
        </form>
        {dateError && <p role="alert" className="mb-3 text-xs text-negative">{dateError}</p>}
        <div
          ref={chartRef}
          role="img"
          tabIndex={0}
          aria-label="Nettovermogen: Beleggingen, cash en totaal. Gebruik pijltoetsen voor exacte waarden, Home en End voor begin en einde, Escape om zoom te wissen."
          className="touch-pan-y select-none rounded-[12px]"
          onKeyDown={chart.onKeyDown}
          onPointerDown={chart.onPointerDown}
          onPointerMove={(event) => {
            const index = chart.indexForClientX(event.clientX);
            if (index !== null) setFocusIndex(index);
            const rect = event.currentTarget.getBoundingClientRect();
            setPointerRatio(Math.max(0, Math.min(1, (event.clientX - rect.left) / Math.max(1, rect.width))));
            chart.onPointerMove(event);
          }}
          onPointerUp={chart.onPointerUp}
          onPointerLeave={() => { if (!drag) setFocusIndex(null); }}
        >
          <ChartContainer className="h-[320px]" aria-hidden="true">
            <AreaChart data={chartPoints} margin={{ top: 12, right: 12, left: 8, bottom: 0 }} onMouseMove={(state) => { if (typeof state?.activeTooltipIndex === "number") setFocusIndex(state.activeTooltipIndex); }}>
              <defs><pattern id={hatchId} width="6" height="6" patternTransform="rotate(45)" patternUnits="userSpaceOnUse"><rect width="6" height="6" fill="hsl(var(--chart-teal) / 0.14)" /><line x1="0" y1="0" x2="0" y2="6" stroke="hsl(var(--chart-teal) / 0.6)" strokeWidth="2" /></pattern></defs>
              <XAxis dataKey="date" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} tickFormatter={(value: string) => value.slice(5)} />
              <YAxis tick={{ fontSize: 11 }} tickLine={false} axisLine={false} width={72} domain={["auto", "auto"]} tickFormatter={(value: number) => money(value, currency)} />
              {focusIndex !== null && chartPoints[focusIndex] && <ReferenceLine x={chartPoints[focusIndex]!.date} stroke="hsl(var(--foreground))" strokeOpacity={0.4} strokeDasharray="3 3" />}
              {drag && <ReferenceArea x1={points[Math.min(drag.from, drag.to)]?.date} x2={points[Math.max(drag.from, drag.to)]?.date} fill="hsl(var(--chart-blue))" fillOpacity={0.12} strokeOpacity={0} />}
              <ChartTooltip isAnimationActive={false} reverseDirection={{ x: pointerRatio > 0.62, y: false }} content={<NetWorthTooltip currency={currency} />} />
              <Area dataKey="positionsValue" stackId="net" name="Beleggingen" connectNulls={false} stroke="hsl(var(--chart-teal))" fill="hsl(var(--chart-teal) / 0.24)" strokeWidth={1.5} isAnimationActive={false} />
              <Area dataKey="cashValue" stackId="net" name="Cash" connectNulls={false} stroke="hsl(var(--chart-amber))" fill="hsl(var(--chart-amber) / 0.24)" strokeWidth={1.5} isAnimationActive={false} />
              <Area dataKey="stalePositions" name="Geschatte koers" connectNulls={false} stroke="none" fill={`url(#${hatchId})`} isAnimationActive={false} legendType="none" />
              <Line dataKey="value" name="Totaal" connectNulls={false} stroke="hsl(var(--foreground))" strokeWidth={2.25} dot={false} activeDot={{ r: 4 }} isAnimationActive={false} />
            </AreaChart>
          </ChartContainer>
        </div>
        <p aria-live="polite" className="sr-only">{activePoint ? accessiblePoint(activePoint, currency) : "Geen waarden beschikbaar"}</p>
        <ul className="sr-only" aria-label="Exacte nettovermogenswaarden">{chartPoints.map((point) => <li key={point.date}>{accessiblePoint(point, currency)}</li>)}</ul>
        <div className="mt-4 flex flex-wrap gap-4 text-xs text-muted-foreground" aria-label="Nettovermogen grafiekseries">
          <span className="inline-flex items-center gap-1.5"><span aria-hidden="true" className="size-2 rounded-full bg-[hsl(var(--chart-teal))]" />Beleggingen</span>
          <span className="inline-flex items-center gap-1.5"><span aria-hidden="true" className="size-2 rounded-full bg-[hsl(var(--chart-amber))]" />Cash</span>
          <span className="inline-flex items-center gap-1.5"><span aria-hidden="true" className="h-0.5 w-3 bg-foreground" />Totaal</span>
          {warnings.forwardFilled.length > 0 && <span className="inline-flex items-center gap-1.5"><span aria-hidden="true" className="h-2.5 w-3 net-worth-hatch" />Geschatte koers: {warnings.forwardFilled.join(", ")}</span>}
        </div>
        {(warnings.unpriced.length > 0 || warnings.cashUnknown.length > 0) && <div role="status" className="mt-4 rounded-[14px] border border-warning/30 bg-warning/10 px-4 py-3 text-xs leading-5">
          <p className="font-semibold">Nettovermogen deels onbekend</p>
          {warnings.unpriced.length > 0 && <p>Uitgesloten wegens verouderde koers: {warnings.unpriced.join(", ")}</p>}
          {warnings.cashUnknown.length > 0 && <p>Cashwaarde onbekend: {warnings.cashUnknown.join(", ")}</p>}
        </div>}
      </>}
    </CardContent>
  </Card>;
}

function NetWorthTooltip({ active, payload, currency }: { active?: boolean; payload?: Array<{ payload?: NetWorthChartPoint }>; currency: string }) {
  const point = active ? payload?.[0]?.payload : null;
  if (!point) return null;
  return <div className="max-w-[min(320px,80vw)] rounded-[12px] border border-border bg-card px-3 py-2 text-xs shadow-soft">
    <p className="mb-1 text-muted-foreground">{dateLabel(point.date)}</p>
    <p className="mb-2 text-base font-semibold tabular-nums">{displayValue(point.value, currency)}</p>
    <p className="flex justify-between gap-5"><span>Beleggingen{point.forwardFilled.length > 0 ? " (geschatte koers)" : ""}</span><strong>{displayValue(point.positionsValue, currency)}</strong></p>
    <p className="mt-1 flex justify-between gap-5"><span>Cash</span><strong>{displayValue(point.cashValue, currency)}</strong></p>
    {point.unpriced.length > 0 && <p className="mt-2 border-t border-border pt-2 text-warning">Uitgesloten wegens verouderde koers: {point.unpriced.join(", ")}</p>}
    {point.cashUnknown.length > 0 && <p className="mt-1 text-warning">Cashwaarde onbekend: {point.cashUnknown.join(", ")}</p>}
  </div>;
}

function accessiblePoint(point: PortfolioValuePoint, currency: string): string {
  return `${dateLabel(point.date)}: totaal ${displayValue(point.value, currency)}, beleggingen ${displayValue(point.positionsValue, currency)}, cash ${displayValue(point.cashValue, currency)}${point.forwardFilled.length ? `, geschatte koers: ${point.forwardFilled.join(", ")}` : ""}${point.unpriced.length ? `, uitgesloten wegens verouderde koers: ${point.unpriced.join(", ")}` : ""}${point.cashUnknown.length ? `, cashwaarde onbekend: ${point.cashUnknown.join(", ")}` : ""}`;
}
