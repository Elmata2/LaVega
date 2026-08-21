import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Brush, CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { pct, points, trades, type Point } from "./data";

type IndexedPoint = Point & { index: number };

const RANGES = [
  { key: "1M", label: "1M", days: 30 },
  { key: "6M", label: "6M", days: 182 },
  { key: "1Y", label: "1Y", days: 365 },
  { key: "All", label: "All", days: points.length },
] as const;
type RangeKey = (typeof RANGES)[number]["key"];

const SERIES = [
  { key: "portfolio", label: "Portfolio", color: "var(--prototype-portfolio)", dash: undefined },
  { key: "spx", label: "S&P 500", color: "var(--prototype-benchmark)", dash: "5 4" },
  { key: "world", label: "MSCI World", color: "#7fb5d6", dash: "5 4" },
  { key: "aex", label: "AEX", color: "#c98fd6", dash: "5 4" },
] as const;

// Rebase every series to 0% at the first point of whatever window is
// currently visible — the anchor follows the window, not the data
// (Decisions so far, issue 75).
function rebase(slice: Point[]): Point[] {
  if (slice.length === 0) return slice;
  const anchor = slice[0];
  return slice.map((point) => ({
    ...point,
    portfolio: point.portfolio - anchor.portfolio,
    spx: point.spx - anchor.spx,
    world: point.world - anchor.world,
    aex: point.aex - anchor.aex,
  }));
}

const DAY_MS = 86_400_000;

type Zoom = { from: number; to: number } | null;

function TooltipContent({ active, payload, label, chartWidth, cursorX, benchmarks }: any) {
  if (!active || !payload?.length) return null;
  const flip = chartWidth && cursorX != null && cursorX > chartWidth * 0.62;
  const date = new Date(`${label}T00:00:00Z`).toLocaleDateString("nl-NL", { day: "numeric", month: "short", year: "numeric" });
  return <div className="tooltip" style={flip ? { transform: "translateX(-100%)" } : undefined}>
    <p className="tooltip-date">{date}</p>
    {SERIES.filter((series) => series.key === "portfolio" || benchmarks.includes(series.key)).map((series) => {
      const item = payload.find((entry: any) => entry.dataKey === series.key);
      if (!item) return null;
      return <p key={series.key}><i className="tooltip-dot" style={{ background: series.color }} />{series.label} {pct.format(Number(item.value) / 100)}</p>;
    })}
  </div>;
}

export function InteractionChart({ zoomMode }: { zoomMode: "combined" | "separate" }) {
  const [range, setRange] = useState<RangeKey>("1Y");
  const [zoom, setZoom] = useState<Zoom>(null);
  const [dragFrom, setDragFrom] = useState<number | null>(null);
  const [dragTo, setDragTo] = useState<number | null>(null);
  const [benchmarks, setBenchmarks] = useState<string[]>(["spx"]);
  const [focusIndex, setFocusIndex] = useState<number | null>(null);
  const [drilled, setDrilled] = useState<(typeof trades)[number] | null>(null);
  const [cursorX, setCursorX] = useState<number | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  const preset = RANGES.find((item) => item.key === range)!;

  const visible = useMemo((): IndexedPoint[] => {
    const withIndex = points.map((point, index) => ({ ...point, index }));
    const source = withIndex.slice(-preset.days);
    if (!zoom) return source;
    return withIndex.filter((point) => {
      const t = point.date.getTime();
      return t >= Math.min(zoom.from, zoom.to) && t <= Math.max(zoom.from, zoom.to);
    });
  }, [preset, zoom]);

  const chartData = useMemo(() => rebase(visible).map((point, i) => ({ ...point, index: visible[i].index })), [visible]);

  const applyRange = useCallback((key: RangeKey) => {
    setRange(key);
    setZoom(null); // one preset wins; picking a range always clears a custom zoom (Decision: they share one anchor, not two independent states).
    setFocusIndex(null);
  }, []);

  const clearZoom = useCallback(() => { setZoom(null); setFocusIndex(null); }, []);

  // Manual date entry: the same `zoom` state the drag sets, just typed in
  // instead of dragged — one anchor either way (Decision, this ticket).
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const minDate = points[0]?.date.toISOString().slice(0, 10);
  const maxDate = points[points.length - 1]?.date.toISOString().slice(0, 10);
  const applyDateRange = (event: React.FormEvent) => {
    event.preventDefault();
    if (!dateFrom || !dateTo) return;
    const from = new Date(`${dateFrom}T00:00:00Z`).getTime();
    const to = new Date(`${dateTo}T00:00:00Z`).getTime();
    if (Number.isNaN(from) || Number.isNaN(to) || from === to) return;
    setZoom({ from, to });
    setFocusIndex(null);
  };

  // Scroll-wheel zoom: hovering the chart and scrolling zooms the visible
  // window smoothly in/out; scrolling anywhere else leaves the page alone.
  // Native listener (not React's onWheel) because React's is passive by
  // default and can't preventDefault to stop page scroll while zooming.
  useEffect(() => {
    if (zoomMode !== "combined") return;
    const el = wrapRef.current;
    if (!el) return;
    const dataMin = points[0].date.getTime();
    const dataMax = points[points.length - 1].date.getTime();
    const fullSpan = dataMax - dataMin;
    const minSpan = DAY_MS * 5;

    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      setZoom((current) => {
        const bounds = current ?? { from: dataMax - DAY_MS * (preset.days - 1), to: dataMax };
        const span = bounds.to - bounds.from;
        const center = (bounds.to + bounds.from) / 2;
        const factor = event.deltaY < 0 ? 0.95 : 1 / 0.95; // scroll up = zoom in
        const newSpan = Math.min(fullSpan, Math.max(minSpan, span * factor));
        if (newSpan >= fullSpan - DAY_MS) return null; // zoomed all the way back out
        let from = center - newSpan / 2;
        let to = center + newSpan / 2;
        if (from < dataMin) { to += dataMin - from; from = dataMin; }
        if (to > dataMax) { from -= to - dataMax; to = dataMax; }
        return { from: Math.max(dataMin, from), to: Math.min(dataMax, to) };
      });
      setFocusIndex(null);
    };

    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [zoomMode, preset.days]);

  // Combined mode: drag directly on the plot to zoom. Separate mode ignores
  // these and uses the <Brush> strip below the chart instead.
  const onMouseDown = (state: any) => {
    if (zoomMode !== "combined" || !state?.activeLabel) return;
    setDragFrom(new Date(`${state.activeLabel}T00:00:00Z`).getTime());
    setDragTo(null);
  };
  const onMouseMove = (state: any) => {
    setCursorX(state?.chartX ?? null);
    if (zoomMode === "combined" && dragFrom !== null && state?.activeLabel) {
      setDragTo(new Date(`${state.activeLabel}T00:00:00Z`).getTime());
    }
    if (state?.activeTooltipIndex != null) setFocusIndex(state.activeTooltipIndex);
  };
  const onMouseUp = () => {
    if (dragFrom !== null && dragTo !== null && Math.abs(dragTo - dragFrom) > DAY_MS * 2) {
      setZoom({ from: dragFrom, to: dragTo });
      setFocusIndex(null);
    }
    setDragFrom(null); setDragTo(null);
  };

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === "Escape") { clearZoom(); return; }
    const max = chartData.length - 1;
    const current = focusIndex ?? 0;
    if (event.key === "ArrowRight") { setFocusIndex(Math.min(max, current + 1)); event.preventDefault(); }
    if (event.key === "ArrowLeft") { setFocusIndex(Math.max(0, current - 1)); event.preventDefault(); }
    if (event.key === "Home") { setFocusIndex(0); event.preventDefault(); }
    if (event.key === "End") { setFocusIndex(max); event.preventDefault(); }
  };

  const toggleBenchmark = (key: string) => setBenchmarks((current) =>
    current.includes(key) ? current.filter((item) => item !== key) : current.length >= 3 ? current : [...current, key]);

  const focused = focusIndex != null ? chartData[focusIndex] : null;
  const description = `Portefeuillerendement geïndexeerd op 0% bij start van het weergegeven venster, vergeleken met ${benchmarks.map((key) => SERIES.find((series) => series.key === key)?.label).join(", ") || "geen benchmark"}.`;

  return <div className="chart-shell">
    <div className="chart-controls">
      <div role="group" aria-label="Periode kiezen" className="pill-group">
        {RANGES.map((item) => <button key={item.key} type="button" aria-pressed={range === item.key && !zoom} onClick={() => applyRange(item.key)} className={range === item.key && !zoom ? "pill active" : "pill"}>{item.label}</button>)}
      </div>
      <div role="group" aria-label="Benchmarks" className="pill-group">
        {SERIES.filter((series) => series.key !== "portfolio").map((series) => <button key={series.key} type="button" aria-pressed={benchmarks.includes(series.key)} onClick={() => toggleBenchmark(series.key)} className={benchmarks.includes(series.key) ? "pill active" : "pill"}>{series.label}</button>)}
      </div>
      {zoomMode === "combined" && (
        <form className="date-range-form" onSubmit={applyDateRange} aria-label="Periode intypen">
          <input type="date" aria-label="Van" min={minDate} max={maxDate} value={dateFrom} onChange={(event) => setDateFrom(event.target.value)} />
          <span aria-hidden="true">–</span>
          <input type="date" aria-label="Tot" min={minDate} max={maxDate} value={dateTo} onChange={(event) => setDateTo(event.target.value)} />
          <button type="submit" className="pill">Ga</button>
        </form>
      )}
      {zoom && <button type="button" className="zoom-pill" onClick={clearZoom}>
        Zoom: {new Date(zoom.from).toLocaleDateString("nl-NL")} – {new Date(zoom.to).toLocaleDateString("nl-NL")} ✕
      </button>}
    </div>

    <div
      ref={wrapRef}
      className="chart"
      role="img"
      aria-label={description}
      tabIndex={0}
      onKeyDown={onKeyDown}
      onMouseLeave={() => setFocusIndex(null)}
    >
      <ResponsiveContainer>
        <LineChart data={chartData} margin={{ top: 8, right: 8, bottom: zoomMode === "separate" ? 0 : 8, left: 4 }}
          onMouseDown={onMouseDown} onMouseMove={onMouseMove} onMouseUp={onMouseUp}
          onClick={(state: any) => {
            const trade = trades.find((item) => item.index === visible[state?.activeTooltipIndex ?? -1]?.index);
            if (trade) setDrilled(trade);
          }}
        >
          <CartesianGrid vertical={false} stroke="var(--prototype-grid)" />
          <XAxis dataKey="label" stroke="var(--prototype-muted)" tickLine={false} axisLine={false} minTickGap={48} fontSize={10} tickFormatter={(v) => v.slice(5)} />
          <YAxis width={48} tickFormatter={(v: number) => `${v > 0 ? "+" : ""}${v.toFixed(0)}%`} stroke="var(--prototype-muted)" tickLine={false} axisLine={false} fontSize={10} />
          <ReferenceLine y={0} stroke="var(--prototype-line)" />
          {focusIndex != null && <ReferenceLine x={chartData[focusIndex]?.label} stroke="var(--prototype-focus)" strokeDasharray="3 3" />}
          <Tooltip content={<TooltipContent chartWidth={wrapRef.current?.clientWidth} cursorX={cursorX} benchmarks={benchmarks} />} isAnimationActive={false} />
          <Line dataKey="portfolio" name="Portfolio" stroke="var(--prototype-portfolio)" strokeWidth={2.5} dot={false} activeDot={{ r: 4 }} isAnimationActive animationDuration={350} />
          {SERIES.filter((series) => benchmarks.includes(series.key)).map((series) => (
            <Line key={series.key} dataKey={series.key} name={series.label} stroke={series.color} strokeWidth={1.5} strokeDasharray={series.dash} dot={false} activeDot={{ r: 3 }} isAnimationActive animationDuration={350} />
          ))}
          {trades.filter((trade) => visible.some((p) => p.index === trade.index)).map((trade) => {
            const rebased = chartData.find((p) => p.index === trade.index);
            return rebased ? <ReferenceLine key={trade.symbol + trade.index} x={rebased.label} stroke="transparent" /> : null;
          })}
          {zoomMode === "separate" && (
            <Brush
              dataKey="label"
              height={28}
              stroke="var(--prototype-focus)"
              fill="var(--prototype-surface-raised)"
              travellerWidth={8}
              startIndex={0}
              endIndex={chartData.length - 1}
              onChange={(range: { startIndex?: number; endIndex?: number }) => {
                if (range.startIndex == null || range.endIndex == null) return;
                if (range.startIndex === 0 && range.endIndex === chartData.length - 1) { clearZoom(); return; }
                const from = visible[range.startIndex]?.date.getTime();
                const to = visible[range.endIndex]?.date.getTime();
                if (from != null && to != null) setZoom({ from, to });
              }}
            />
          )}
        </LineChart>
      </ResponsiveContainer>
    </div>

    <p aria-live="polite" className="sr-only">
      {focused ? `${new Date(`${focused.label}T00:00:00Z`).toLocaleDateString("nl-NL")}: portefeuille ${pct.format(focused.portfolio / 100)}` : ""}
    </p>
    <ul className="sr-only" aria-label="Exacte grafiekwaarden">
      {chartData.map((point) => <li key={point.label}>{point.label}: portefeuille {pct.format(point.portfolio / 100)}{benchmarks.map((key) => `, ${SERIES.find((s) => s.key === key)?.label} ${pct.format((point as any)[key] / 100)}`).join("")}</li>)}
    </ul>

    <div className="legend">
      <span><i style={{ background: "var(--prototype-portfolio)" }} />Portfolio</span>
      {benchmarks.map((key) => <span key={key}><i style={{ background: SERIES.find((s) => s.key === key)?.color }} />{SERIES.find((s) => s.key === key)?.label}</span>)}
      <span className="muted">· {trades.length} trade markers, click one to drill</span>
    </div>

    {drilled && <div className="drill-panel">
      <p>Drilling into <strong>{drilled.symbol}</strong> — {new Date(`${drilled.date}T00:00:00Z`).toLocaleDateString("nl-NL")}. (Stub: real build navigates to the position detail page, issue #81.)</p>
      <button type="button" onClick={() => setDrilled(null)}>Close</button>
    </div>}
  </div>;
}
