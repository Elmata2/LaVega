import type { PositionMarker, PositionPricePoint } from "@lavega/core";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Line, LineChart, ReferenceArea, ReferenceDot, ReferenceLine, XAxis, YAxis } from "recharts";
import { EmptyState } from "./EmptyState";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import { ChartContainer } from "./ui/chart";
import { chartRanges, positionPointsForRange, useChartWindow } from "./useChartWindow";

type PositionPriceChartProps = { symbol: string; currency: string; points: PositionPricePoint[]; onMarkerActivate?: (date: string) => void };
const markerColors = { buy: "hsl(var(--pos))", sell: "hsl(var(--neg))", dividend: "hsl(var(--chart-amber))" } as const;
const dateLabel = (value: string) => new Date(`${value}T00:00:00Z`).toLocaleDateString("nl-NL", { day: "numeric", month: "short", year: "numeric" });
const priceLabel = (value: number, currency: string) => value.toLocaleString("nl-NL", { style: "currency", currency, maximumFractionDigits: 2 });

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
  const [activeEventDate, setActiveEventDate] = useState<string | null>(null);
  const presetPoints = useCallback((range: Parameters<typeof positionPointsForRange>[1]) => positionPointsForRange(all, range), [all]);
  const chart = useChartWindow({ allPoints: all, presetPoints, leftInset: 64, rightInset: 16 });
  const { points: visible, focusIndex, setFocusIndex, drag, chartRef, dateFrom, setDateFrom, dateTo, setDateTo, dateError, minDate, maxDate } = chart;
  const active = visible[focusIndex ?? visible.length - 1] ?? null;
  const plotPoints = useMemo(() => chartPointsWithGaps(visible), [visible]);
  const missingDates = plotPoints.flatMap((point) => point.close === null ? [point.date] : []);
  const markers = visible.flatMap((point, pointIndex) => point.markers.map((marker, markerIndex) => ({ marker, point, pointIndex, markerIndex })));
  useEffect(() => setActiveEventDate(null), [chart.window]);
  function applyDates(event: React.FormEvent) {
    event.preventDefault();
    chart.applyTypedDates(); setActiveEventDate(null);
  }

  function activateMarker(pointIndex: number, eventDate: string) { setFocusIndex(pointIndex); setActiveEventDate(eventDate); onMarkerActivate?.(eventDate); }

  return <Card>
    <CardHeader className="gap-4 sm:flex-row sm:items-start sm:justify-between"><div><p className="text-sm font-medium text-muted-foreground">Koershistorie</p><CardTitle>{symbol}</CardTitle></div>
      <div role="group" aria-label="Periode kiezen" className="flex flex-wrap gap-1 rounded-pill bg-secondary p-1">{chartRanges.map((range) => <button key={range.value} type="button" aria-pressed={chart.window.kind === "preset" && chart.window.range === range.value} onClick={() => { chart.applyPreset(range.value); setActiveEventDate(null); }} className="pressable rounded-pill px-2.5 py-1.5 text-xs font-semibold text-muted-foreground hover:text-foreground">{range.label}</button>)}</div>
    </CardHeader>
    <CardContent>
      {all.length === 0 ? <EmptyState title="Geen koershistorie" description="Prijsdata verschijnt zodra de eerste synchronisatie klaar is." /> : <>
        <form onSubmit={applyDates} aria-label="Datumbereik kiezen" className="mb-3 flex flex-wrap items-end gap-2 text-xs">
          <label className="font-semibold text-muted-foreground">Van<input type="date" aria-label="Van datum" min={minDate} max={maxDate} value={dateFrom} onChange={(event) => setDateFrom(event.target.value)} className="mt-1 block rounded-[10px] border border-input bg-background px-2 py-1.5 font-normal text-foreground" /></label>
          <label className="font-semibold text-muted-foreground">Tot<input type="date" aria-label="Tot datum" min={minDate} max={maxDate} value={dateTo} onChange={(event) => setDateTo(event.target.value)} className="mt-1 block rounded-[10px] border border-input bg-background px-2 py-1.5 font-normal text-foreground" /></label>
          <button type="submit" className="pressable rounded-pill border border-border px-3 py-1.5 font-semibold">Toepassen</button>
          {chart.window.kind === "custom" && <button type="button" onClick={() => { chart.clearZoom(); setActiveEventDate(null); }} aria-label="Zoom wissen" className="pressable rounded-pill bg-secondary px-3 py-1.5 font-semibold">Zoom: {dateLabel(chart.window.from)} – {dateLabel(chart.window.to)} ×</button>}
        </form>
        {dateError && <p role="alert" className="mb-3 text-xs text-negative">{dateError}</p>}
        <div ref={chartRef} role="img" tabIndex={0} aria-label={`Koershistorie van ${symbol}. Gebruik pijltoetsen voor exacte waarden, Home en End voor begin en einde, Escape om zoom te wissen.`} className="touch-pan-y select-none rounded-[12px] outline-none focus-visible:ring-2 focus-visible:ring-ring"
          onKeyDown={(event) => { chart.onKeyDown(event); setActiveEventDate(null); }}
          onPointerDown={chart.onPointerDown}
          onPointerMove={(event) => { const index = chart.indexForClientX(event.clientX); if (index !== null) { setFocusIndex(index); setActiveEventDate(null); } chart.onPointerMove(event); }}
          onPointerUp={chart.onPointerUp}>
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
