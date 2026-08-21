import type { PortfolioRange, PortfolioValuePoint } from "@lavega/core";
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { Area, AreaChart, Line, ReferenceArea, ReferenceLine, XAxis, YAxis } from "recharts";
import { EmptyState } from "./EmptyState";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import { ChartContainer, ChartTooltip } from "./ui/chart";

const ranges: Array<{ value: PortfolioRange; label: string }> = [
  { value: "1M", label: "1 maand" },
  { value: "6M", label: "6 maanden" },
  { value: "1Y", label: "1 jaar" },
  { value: "YTD", label: "Dit jaar" },
  { value: "All", label: "Alles" },
];

type NetWorthWindow =
  | { kind: "preset"; range: PortfolioRange }
  | { kind: "custom"; from: string; to: string; baseRange: PortfolioRange };

type Props = {
  data: Partial<Record<PortfolioRange, PortfolioValuePoint[]>>;
  currency?: string;
};

type NetWorthChartPoint = PortfolioValuePoint & {
  stalePositions: number | null;
};

const dateLabel = (date: string) => new Date(`${date}T00:00:00Z`).toLocaleDateString("nl-NL", { day: "numeric", month: "short", year: "numeric" });
const money = (value: number, currency: string) => value.toLocaleString("nl-NL", { style: "currency", currency, maximumFractionDigits: 2 });
const displayValue = (value: number | null, currency: string) => value === null ? "Waarde onbekend" : money(value, currency);

function allPoints(data: Props["data"]): PortfolioValuePoint[] {
  if (data.All) return data.All;
  return [...new Map(Object.values(data).flatMap((points) => points ?? []).map((point) => [point.date, point])).values()]
    .sort((left, right) => left.date.localeCompare(right.date));
}

export function netWorthPointsForWindow(data: Props["data"], window: NetWorthWindow): PortfolioValuePoint[] {
  if (window.kind === "preset") return data[window.range] ?? (window.range === "All" ? allPoints(data) : []);
  return allPoints(data).filter((point) => point.date >= window.from && point.date <= window.to);
}

export function toNetWorthChartPoint(point: PortfolioValuePoint): NetWorthChartPoint {
  return {
    ...point,
    value: point.positionsValue === null || point.cashValue === null ? null : point.value,
    stalePositions: point.forwardFilled.length > 0 ? point.positionsValue : null,
  };
}

export function NetWorthChart({ data, currency = "EUR" }: Props) {
  const [visibleWindow, setVisibleWindow] = useState<NetWorthWindow>({ kind: "preset", range: "1M" });
  const [focusIndex, setFocusIndex] = useState<number | null>(null);
  const [pointerRatio, setPointerRatio] = useState(0);
  const [drag, setDrag] = useState<{ pointerId: number; from: number; to: number; startX: number } | null>(null);
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [dateError, setDateError] = useState<string | null>(null);
  const chartRef = useRef<HTMLDivElement>(null);
  const hatchId = `net-worth-hatch-${useId().replace(/:/g, "")}`;

  const fullPoints = useMemo(() => allPoints(data), [data]);
  const points = useMemo(() => netWorthPointsForWindow(data, visibleWindow), [data, visibleWindow]);
  const chartPoints = useMemo(() => points.map(toNetWorthChartPoint), [points]);
  const activePoint = chartPoints[focusIndex ?? chartPoints.length - 1] ?? null;
  const minDate = fullPoints[0]?.date;
  const maxDate = fullPoints.at(-1)?.date;
  const baseRange = visibleWindow.kind === "preset" ? visibleWindow.range : visibleWindow.baseRange;
  const warnings = useMemo(() => ({
    unpriced: [...new Set(points.flatMap((point) => point.unpriced))],
    cashUnknown: [...new Set(points.flatMap((point) => point.cashUnknown))],
    forwardFilled: [...new Set(points.flatMap((point) => point.forwardFilled))],
  }), [points]);

  const applyPreset = useCallback((range: PortfolioRange) => {
    setVisibleWindow({ kind: "preset", range });
    setFocusIndex(null);
    setDateError(null);
  }, []);
  const clearZoom = useCallback(() => {
    setVisibleWindow((current) => current.kind === "custom" ? { kind: "preset", range: current.baseRange } : current);
    setFocusIndex(null);
    setDateError(null);
  }, []);
  const indexForClientX = useCallback((clientX: number, count = points.length) => {
    const rect = chartRef.current?.getBoundingClientRect();
    if (!rect || count === 0 || rect.width <= 0) return null;
    const ratio = Math.max(0, Math.min(1, (clientX - rect.left - 72) / Math.max(1, rect.width - 88)));
    return Math.round(ratio * (count - 1));
  }, [points.length]);

  useEffect(() => {
    const element = chartRef.current;
    if (!element || fullPoints.length < 2) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      if (points.length < 2) return;
      const ratio = Math.max(0, Math.min(1, (event.clientX - element.getBoundingClientRect().left) / Math.max(1, element.clientWidth)));
      const step = Math.max(1, Math.round(points.length * 0.05));
      const nextCount = Math.max(2, Math.min(fullPoints.length, points.length + (event.deltaY < 0 ? -step : step)));
      if (nextCount >= fullPoints.length) { clearZoom(); return; }
      const centerDate = points[Math.round(ratio * (points.length - 1))]?.date ?? points.at(-1)!.date;
      const foundCenter = fullPoints.findIndex((point) => point.date >= centerDate);
      const center = foundCenter < 0 ? fullPoints.length - 1 : foundCenter;
      let start = Math.round(center - ratio * (nextCount - 1));
      start = Math.max(0, Math.min(fullPoints.length - nextCount, start));
      setVisibleWindow({ kind: "custom", from: fullPoints[start]!.date, to: fullPoints[start + nextCount - 1]!.date, baseRange });
      setFocusIndex(null);
    };
    element.addEventListener("wheel", onWheel, { passive: false });
    return () => element.removeEventListener("wheel", onWheel);
  }, [baseRange, clearZoom, fullPoints, points]);

  function applyTypedDates(event: React.FormEvent) {
    event.preventDefault();
    if (!dateFrom || !dateTo || !minDate || !maxDate) { setDateError("Vul twee geldige datums in."); return; }
    const [from, to] = dateFrom <= dateTo ? [dateFrom, dateTo] : [dateTo, dateFrom];
    const clampedFrom = from < minDate ? minDate : from;
    const clampedTo = to > maxDate ? maxDate : to;
    if (fullPoints.filter((point) => point.date >= clampedFrom && point.date <= clampedTo).length < 2) { setDateError("Kies minimaal twee datapunten."); return; }
    setVisibleWindow({ kind: "custom", from: clampedFrom, to: clampedTo, baseRange });
    setFocusIndex(null);
    setDateError(null);
  }

  function onKeyDown(event: React.KeyboardEvent) {
    if (event.key === "Escape") { clearZoom(); return; }
    const last = chartPoints.length - 1;
    if (last < 0) return;
    const current = focusIndex ?? last;
    if (event.key === "ArrowRight") { setFocusIndex(Math.min(last, current + 1)); event.preventDefault(); }
    if (event.key === "ArrowLeft") { setFocusIndex(Math.max(0, current - 1)); event.preventDefault(); }
    if (event.key === "Home") { setFocusIndex(0); event.preventDefault(); }
    if (event.key === "End") { setFocusIndex(last); event.preventDefault(); }
  }

  return <Card data-dashboard-section="net-worth">
    <CardHeader className="gap-4 sm:flex-row sm:items-start sm:justify-between">
      <div><p className="text-sm font-medium text-muted-foreground">Nettovermogen</p><CardTitle>Beleggingen en cash</CardTitle></div>
      <div role="group" aria-label="Periode nettovermogen kiezen" className="flex flex-wrap gap-1 rounded-pill bg-secondary p-1">
        {ranges.map((item) => <button key={item.value} type="button" aria-pressed={visibleWindow.kind === "preset" && visibleWindow.range === item.value} onClick={() => applyPreset(item.value)} className={`pressable rounded-pill px-2.5 py-1.5 text-xs font-semibold ${visibleWindow.kind === "preset" && visibleWindow.range === item.value ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground"}`}>{item.label}</button>)}
      </div>
    </CardHeader>
    <CardContent>
      {points.length === 0 ? <EmptyState title="Geen vermogenshistorie" description="Nettovermogen verschijnt zodra broker- en prijsgegevens beschikbaar zijn." /> : <>
        <div className="mb-4 flex flex-wrap items-baseline gap-x-3 gap-y-1"><strong className="font-display text-2xl tabular-nums">{displayValue(activePoint?.value ?? null, currency)}</strong><span className="text-xs text-muted-foreground">op {activePoint ? dateLabel(activePoint.date) : "onbekende datum"}</span></div>
        <form onSubmit={applyTypedDates} aria-label="Datumbereik nettovermogen kiezen" className="mb-3 flex flex-wrap items-end gap-2 text-xs">
          <label className="font-semibold text-muted-foreground">Van<input type="date" aria-label="Nettovermogen van datum" min={minDate} max={maxDate} value={dateFrom} onChange={(event) => setDateFrom(event.target.value)} className="mt-1 block rounded-[10px] border border-input bg-background px-2 py-1.5 font-normal text-foreground" /></label>
          <label className="font-semibold text-muted-foreground">Tot<input type="date" aria-label="Nettovermogen tot datum" min={minDate} max={maxDate} value={dateTo} onChange={(event) => setDateTo(event.target.value)} className="mt-1 block rounded-[10px] border border-input bg-background px-2 py-1.5 font-normal text-foreground" /></label>
          <button type="submit" className="pressable rounded-pill border border-border px-3 py-1.5 font-semibold">Toepassen</button>
          {visibleWindow.kind === "custom" && <button type="button" onClick={clearZoom} aria-label="Zoom nettovermogen wissen" className="pressable rounded-pill bg-secondary px-3 py-1.5 font-semibold">Zoom: {dateLabel(visibleWindow.from)} – {dateLabel(visibleWindow.to)} ×</button>}
        </form>
        {dateError && <p role="alert" className="mb-3 text-xs text-negative">{dateError}</p>}
        <div
          ref={chartRef}
          role="img"
          tabIndex={0}
          aria-label="Nettovermogen: Beleggingen, cash en totaal. Gebruik pijltoetsen voor exacte waarden, Home en End voor begin en einde, Escape om zoom te wissen."
          className="touch-pan-y select-none rounded-[12px]"
          onKeyDown={onKeyDown}
          onPointerDown={(event) => {
            if (event.button !== 0 || points.length < 2) return;
            const index = indexForClientX(event.clientX);
            if (index === null) return;
            event.currentTarget.setPointerCapture?.(event.pointerId);
            setDrag({ pointerId: event.pointerId, from: index, to: index, startX: event.clientX });
          }}
          onPointerMove={(event) => {
            const index = indexForClientX(event.clientX);
            if (index !== null) setFocusIndex(index);
            const rect = event.currentTarget.getBoundingClientRect();
            setPointerRatio(Math.max(0, Math.min(1, (event.clientX - rect.left) / Math.max(1, rect.width))));
            if (drag?.pointerId === event.pointerId && index !== null) setDrag({ ...drag, to: index });
          }}
          onPointerUp={(event) => {
            if (!drag || drag.pointerId !== event.pointerId) return;
            event.currentTarget.releasePointerCapture?.(event.pointerId);
            if (Math.abs(event.clientX - drag.startX) >= 10 && Math.abs(drag.to - drag.from) >= 1) {
              const fromIndex = Math.min(drag.from, drag.to);
              const toIndex = Math.max(drag.from, drag.to);
              setVisibleWindow({ kind: "custom", from: points[fromIndex]!.date, to: points[toIndex]!.date, baseRange });
              setFocusIndex(null);
            }
            setDrag(null);
          }}
          onPointerCancel={() => setDrag(null)}
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
