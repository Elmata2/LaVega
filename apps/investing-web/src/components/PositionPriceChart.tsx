import type { PositionMarker, PositionPricePoint } from "@lavega/core";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Line, LineChart, ReferenceArea, ReferenceDot, ReferenceLine, XAxis, YAxis } from "recharts";
import { EmptyState } from "./EmptyState";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import { ChartContainer } from "./ui/chart";

type PositionPriceChartProps = { symbol: string; currency: string; points: PositionPricePoint[]; onMarkerActivate?: (date: string) => void };
const ranges = [{ days: 30, label: "1 maand" }, { days: 183, label: "6 maanden" }, { days: 365, label: "1 jaar" }, { days: 0, label: "Alles" }] as const;
const markerColors = { buy: "hsl(var(--pos))", sell: "hsl(var(--neg))", dividend: "hsl(var(--chart-amber))" } as const;
const dateLabel = (value: string) => new Date(`${value}T00:00:00Z`).toLocaleDateString("nl-NL", { day: "numeric", month: "short", year: "numeric" });
const priceLabel = (value: number, currency: string) => value.toLocaleString("nl-NL", { style: "currency", currency, maximumFractionDigits: 2 });

function fromDays(end: string, days: number): string {
  const date = new Date(`${end}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() - days);
  return date.toISOString().slice(0, 10);
}

function chartPointsWithGaps(points: PositionPricePoint[]): Array<PositionPricePoint | { date: string; close: null }> {
  const result: Array<PositionPricePoint | { date: string; close: null }> = [];
  for (const [index, point] of points.entries()) {
    const previous = points[index - 1];
    if (previous) {
      const cursor = new Date(`${previous.date}T00:00:00Z`);
      const end = new Date(`${point.date}T00:00:00Z`);
      cursor.setUTCDate(cursor.getUTCDate() + 1);
      while (cursor < end) {
        const day = cursor.getUTCDay();
        if (day !== 0 && day !== 6) result.push({ date: cursor.toISOString().slice(0, 10), close: null });
        cursor.setUTCDate(cursor.getUTCDate() + 1);
      }
    }
    result.push(point);
  }
  return result;
}

function MarkerDetails({ close, date, markers, currency }: { close: number; date: string; markers: PositionMarker[]; currency: string }) {
  return <section role="status" aria-live="polite" className="rounded-[12px] border border-border bg-secondary/30 p-3 text-xs">
    <p className="font-semibold">{dateLabel(date)} · Slotkoers {priceLabel(close, currency)}</p>
    {markers.length === 0 ? <p className="mt-1 text-muted-foreground">Geen activiteit op deze datum.</p> : <ul className="mt-2 space-y-2">{markers.map((marker, index) => <li key={`${marker.eventDate}-${marker.kind}-${index}`}>
      <span className="font-semibold">{marker.kind === "buy" ? "Koop" : marker.kind === "sell" ? "Verkoop" : "Dividend"}</span>
      <span className="text-muted-foreground"> · gebeurtenis {dateLabel(marker.eventDate)}{marker.quantity === undefined ? "" : ` · ${marker.quantity.toLocaleString("nl-NL")} stuks`}{marker.executionPrice == null ? "" : ` · koers ${priceLabel(marker.executionPrice, marker.currency ?? currency)}`}{marker.amount === undefined ? "" : ` · bedrag ${priceLabel(marker.amount, marker.currency ?? currency)}`}{marker.commission == null ? "" : ` · commissie ${priceLabel(marker.commission, marker.currency ?? currency)}`}</span>
    </li>)}</ul>}
  </section>;
}

export function PositionPriceChart({ symbol, currency, points, onMarkerActivate }: PositionPriceChartProps) {
  const all = useMemo(() => [...points].sort((left, right) => left.date.localeCompare(right.date)), [points]);
  const [window, setWindow] = useState<{ from: string; to: string } | null>(null);
  const [focusIndex, setFocusIndex] = useState<number | null>(null);
  const [activeEventDate, setActiveEventDate] = useState<string | null>(null);
  const [drag, setDrag] = useState<{ pointerId: number; from: number; to: number } | null>(null);
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [dateError, setDateError] = useState<string | null>(null);
  const chartRef = useRef<HTMLDivElement>(null);
  const visible = useMemo(() => window ? all.filter((point) => point.date >= window.from && point.date <= window.to) : all, [all, window]);
  const active = visible[focusIndex ?? visible.length - 1] ?? null;
  const plotPoints = useMemo(() => chartPointsWithGaps(visible), [visible]);
  const missingDates = plotPoints.flatMap((point) => point.close === null ? [point.date] : []);
  const markers = visible.flatMap((point, pointIndex) => point.markers.map((marker, markerIndex) => ({ marker, point, pointIndex, markerIndex })));
  const minDate = all[0]?.date;
  const maxDate = all.at(-1)?.date;
  const clearZoom = useCallback(() => { setWindow(null); setFocusIndex(null); setActiveEventDate(null); setDateError(null); }, []);
  const indexForClientX = useCallback((clientX: number, count = visible.length) => {
    const rect = chartRef.current?.getBoundingClientRect();
    if (!rect || rect.width <= 0 || count === 0) return null;
    const ratio = Math.max(0, Math.min(1, (clientX - rect.left - 64) / Math.max(1, rect.width - 80)));
    return Math.round(ratio * (count - 1));
  }, [visible.length]);

  useEffect(() => {
    const element = chartRef.current;
    if (!element || all.length < 2) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      if (visible.length < 2) return;
      const ratio = Math.max(0, Math.min(1, (event.clientX - element.getBoundingClientRect().left) / Math.max(1, element.clientWidth)));
      const step = Math.max(1, Math.round(visible.length * 0.05));
      const nextCount = Math.max(2, Math.min(all.length, visible.length + (event.deltaY < 0 ? -step : step)));
      if (nextCount >= all.length) { clearZoom(); return; }
      const centerDate = visible[Math.round(ratio * (visible.length - 1))]?.date ?? visible.at(-1)!.date;
      const foundCenter = all.findIndex((point) => point.date >= centerDate);
      const center = foundCenter < 0 ? all.length - 1 : foundCenter;
      let start = Math.round(center - ratio * (nextCount - 1));
      start = Math.max(0, Math.min(all.length - nextCount, start));
      setWindow({ from: all[start]!.date, to: all[start + nextCount - 1]!.date });
      setFocusIndex(null); setActiveEventDate(null);
    };
    element.addEventListener("wheel", onWheel, { passive: false });
    return () => element.removeEventListener("wheel", onWheel);
  }, [all, clearZoom, visible]);

  function applyDates(event: React.FormEvent) {
    event.preventDefault();
    if (!dateFrom || !dateTo || !minDate || !maxDate) { setDateError("Vul twee geldige datums in."); return; }
    const [rawFrom, rawTo] = dateFrom <= dateTo ? [dateFrom, dateTo] : [dateTo, dateFrom];
    const from = rawFrom < minDate ? minDate : rawFrom;
    const to = rawTo > maxDate ? maxDate : rawTo;
    if (all.filter((point) => point.date >= from && point.date <= to).length < 2) { setDateError("Kies minimaal twee datapunten."); return; }
    setWindow({ from, to }); setFocusIndex(null); setActiveEventDate(null); setDateError(null);
  }

  function activateMarker(pointIndex: number, eventDate: string) { setFocusIndex(pointIndex); setActiveEventDate(eventDate); onMarkerActivate?.(eventDate); }

  return <Card>
    <CardHeader className="gap-4 sm:flex-row sm:items-start sm:justify-between"><div><p className="text-sm font-medium text-muted-foreground">Koershistorie</p><CardTitle>{symbol}</CardTitle></div>
      <div role="group" aria-label="Periode kiezen" className="flex flex-wrap gap-1 rounded-pill bg-secondary p-1">{ranges.map((range) => <button key={range.label} type="button" onClick={() => { if (!maxDate || range.days === 0) clearZoom(); else setWindow({ from: fromDays(maxDate, range.days), to: maxDate }); setFocusIndex(null); setActiveEventDate(null); }} className="pressable rounded-pill px-2.5 py-1.5 text-xs font-semibold text-muted-foreground hover:text-foreground">{range.label}</button>)}</div>
    </CardHeader>
    <CardContent>
      {all.length === 0 ? <EmptyState title="Geen koershistorie" description="Prijsdata verschijnt zodra de eerste synchronisatie klaar is." /> : <>
        <form onSubmit={applyDates} aria-label="Datumbereik kiezen" className="mb-3 flex flex-wrap items-end gap-2 text-xs">
          <label className="font-semibold text-muted-foreground">Van<input type="date" aria-label="Van datum" min={minDate} max={maxDate} value={dateFrom} onChange={(event) => setDateFrom(event.target.value)} className="mt-1 block rounded-[10px] border border-input bg-background px-2 py-1.5 font-normal text-foreground" /></label>
          <label className="font-semibold text-muted-foreground">Tot<input type="date" aria-label="Tot datum" min={minDate} max={maxDate} value={dateTo} onChange={(event) => setDateTo(event.target.value)} className="mt-1 block rounded-[10px] border border-input bg-background px-2 py-1.5 font-normal text-foreground" /></label>
          <button type="submit" className="pressable rounded-pill border border-border px-3 py-1.5 font-semibold">Toepassen</button>
          {window && <button type="button" onClick={clearZoom} aria-label="Zoom wissen" className="pressable rounded-pill bg-secondary px-3 py-1.5 font-semibold">Zoom: {dateLabel(window.from)} – {dateLabel(window.to)} ×</button>}
        </form>
        {dateError && <p role="alert" className="mb-3 text-xs text-negative">{dateError}</p>}
        <div ref={chartRef} role="img" tabIndex={0} aria-label={`Koershistorie van ${symbol}. Gebruik pijltoetsen voor exacte waarden, Home en End voor begin en einde, Escape om zoom te wissen.`} className="touch-pan-y select-none rounded-[12px] outline-none focus-visible:ring-2 focus-visible:ring-ring"
          onKeyDown={(event) => { const last = visible.length - 1; const current = focusIndex ?? last; if (event.key === "Escape") clearZoom(); else if (event.key === "ArrowRight") setFocusIndex(Math.min(last, current + 1)); else if (event.key === "ArrowLeft") setFocusIndex(Math.max(0, current - 1)); else if (event.key === "Home") setFocusIndex(0); else if (event.key === "End") setFocusIndex(last); else return; setActiveEventDate(null); event.preventDefault(); }}
          onPointerDown={(event) => { if (event.button !== 0 || visible.length < 2) return; const index = indexForClientX(event.clientX); if (index === null) return; event.currentTarget.setPointerCapture?.(event.pointerId); setDrag({ pointerId: event.pointerId, from: index, to: index }); }}
          onPointerMove={(event) => { const index = indexForClientX(event.clientX); if (index !== null) { setFocusIndex(index); setActiveEventDate(null); } if (drag?.pointerId === event.pointerId && index !== null) setDrag({ ...drag, to: index }); }}
          onPointerUp={(event) => { if (!drag || drag.pointerId !== event.pointerId) return; event.currentTarget.releasePointerCapture?.(event.pointerId); const from = Math.min(drag.from, drag.to); const to = Math.max(drag.from, drag.to); if (to > from) setWindow({ from: visible[from]!.date, to: visible[to]!.date }); setDrag(null); setFocusIndex(null); }}>
          <ChartContainer className="h-[300px]" aria-hidden="true"><LineChart data={plotPoints} margin={{ top: 12, right: 12, left: 0, bottom: 0 }}>
            <XAxis dataKey="date" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} /><YAxis tick={{ fontSize: 11 }} tickLine={false} axisLine={false} width={60} tickFormatter={(value: number) => value.toLocaleString("nl-NL")} />
            <Line type="monotone" dataKey="close" name="Koers" stroke="hsl(var(--chart-blue))" strokeWidth={2} dot={false} connectNulls={false} isAnimationActive={false} />
            {active && <ReferenceLine x={active.date} stroke="hsl(var(--muted-foreground))" strokeDasharray="3 3" />}
            {drag && <ReferenceArea x1={visible[Math.min(drag.from, drag.to)]?.date} x2={visible[Math.max(drag.from, drag.to)]?.date} fill="hsl(var(--chart-blue))" fillOpacity={0.12} />}
            {markers.map(({ marker, point, markerIndex }) => <ReferenceDot key={`${marker.eventDate}-${marker.kind}-${markerIndex}`} x={point.date} y={point.close} r={markerIndex === 0 ? 6 : 4} fill={markerColors[marker.kind]} stroke="hsl(var(--background))" strokeWidth={2} ifOverflow="extendDomain" />)}
          </LineChart></ChartContainer>
        </div>
        {active && <div className="mt-3"><MarkerDetails close={active.close} date={activeEventDate ?? active.date} markers={activeEventDate ? active.markers.filter((marker) => marker.eventDate === activeEventDate) : active.markers.filter((marker) => marker.eventDate === active.date)} currency={currency} /></div>}
        <div aria-label="Koersmarkeringen" className="mt-4 flex flex-wrap gap-2 text-xs">{markers.map(({ marker, pointIndex, markerIndex }) => <button type="button" key={`${marker.eventDate}-${marker.kind}-${markerIndex}`} onClick={() => activateMarker(pointIndex, marker.eventDate)} className="pressable inline-flex items-center gap-1.5 rounded-pill border border-border px-2.5 py-1.5 font-semibold"><span aria-hidden="true" className="size-2 rounded-full" style={{ backgroundColor: markerColors[marker.kind] }} />{dateLabel(marker.eventDate)} · {marker.label}</button>)}</div>
        <ul className="sr-only" aria-label="Exacte koerswaarden">{visible.map((point) => <li key={point.date}>{dateLabel(point.date)}: {priceLabel(point.close, currency)}{point.markers.length ? `, ${point.markers.map((marker) => marker.label).join(", ")}` : ""}</li>)}{missingDates.map((date) => <li key={`missing-${date}`}>{dateLabel(date)}: koers onbekend</li>)}</ul>
      </>}
    </CardContent>
  </Card>;
}
