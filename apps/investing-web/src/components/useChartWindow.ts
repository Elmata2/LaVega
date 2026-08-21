import type { PortfolioRange } from "@lavega/core";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

export const chartRanges: Array<{ value: PortfolioRange; label: string }> = [
  { value: "1M", label: "1 maand" },
  { value: "6M", label: "6 maanden" },
  { value: "1Y", label: "1 jaar" },
  { value: "YTD", label: "Dit jaar" },
  { value: "All", label: "Alles" },
];

export type ChartWindow =
  | { kind: "preset"; range: PortfolioRange }
  | { kind: "custom"; from: string; to: string; baseRange: PortfolioRange };

type Dated = { date: string };

export function pointsInWindow<T extends Dated>(all: readonly T[], window: ChartWindow, preset: (range: PortfolioRange) => readonly T[]): T[] {
  if (window.kind === "preset") return [...preset(window.range)];
  return all.filter((point) => point.date >= window.from && point.date <= window.to);
}

export function positionPointsForRange<T extends Dated>(all: readonly T[], range: PortfolioRange): T[] {
  if (range === "All") return [...all];
  const last = all.at(-1)?.date;
  if (!last) return [];
  const end = new Date(`${last}T00:00:00Z`);
  let from: string;
  if (range === "YTD") from = `${end.getUTCFullYear()}-01-01`;
  else {
    const start = new Date(end);
    if (range === "1M") start.setUTCMonth(start.getUTCMonth() - 1);
    else if (range === "6M") start.setUTCMonth(start.getUTCMonth() - 6);
    else start.setUTCFullYear(start.getUTCFullYear() - 1);
    from = start.toISOString().slice(0, 10);
  }
  return all.filter((point) => point.date >= from && point.date <= last);
}

export function useChartWindow<T extends Dated>(options: {
  allPoints: readonly T[];
  presetPoints: (range: PortfolioRange) => readonly T[];
  minimumWheelPoints?: number;
  leftInset?: number;
  rightInset?: number;
}) {
  const { allPoints, presetPoints, minimumWheelPoints = 2, leftInset = 72, rightInset = 16 } = options;
  const [window, setWindow] = useState<ChartWindow>({ kind: "preset", range: "1M" });
  const [focusIndex, setFocusIndex] = useState<number | null>(null);
  const [pointerRatio, setPointerRatio] = useState(0);
  const [drag, setDrag] = useState<{ pointerId: number; from: number; to: number; startX: number } | null>(null);
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [dateError, setDateError] = useState<string | null>(null);
  const chartRef = useRef<HTMLDivElement>(null);
  const points = useMemo(() => pointsInWindow(allPoints, window, presetPoints), [allPoints, presetPoints, window]);
  const baseRange = window.kind === "preset" ? window.range : window.baseRange;
  const minDate = allPoints[0]?.date;
  const maxDate = allPoints.at(-1)?.date;

  const resetFocus = useCallback(() => { setFocusIndex(null); setDateError(null); }, []);
  const applyPreset = useCallback((range: PortfolioRange) => {
    setWindow({ kind: "preset", range });
    resetFocus();
  }, [resetFocus]);
  const clearZoom = useCallback(() => {
    setWindow((current) => current.kind === "custom" ? { kind: "preset", range: current.baseRange } : current);
    resetFocus();
  }, [resetFocus]);
  const indexForClientX = useCallback((clientX: number, count = points.length) => {
    const rect = chartRef.current?.getBoundingClientRect();
    if (!rect || count === 0 || rect.width <= 0) return null;
    const ratio = Math.max(0, Math.min(1, (clientX - rect.left - leftInset) / Math.max(1, rect.width - leftInset - rightInset)));
    return Math.round(ratio * (count - 1));
  }, [leftInset, points.length, rightInset]);

  useEffect(() => {
    const element = chartRef.current;
    if (!element || allPoints.length < 2) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      if (points.length < 2) return;
      const ratio = Math.max(0, Math.min(1, (event.clientX - element.getBoundingClientRect().left) / Math.max(1, element.clientWidth)));
      const step = Math.max(1, Math.round(points.length * 0.05));
      const nextCount = Math.max(minimumWheelPoints, Math.min(allPoints.length, points.length + (event.deltaY < 0 ? -step : step)));
      if (nextCount >= allPoints.length) { clearZoom(); return; }
      const centerDate = points[Math.round(ratio * (points.length - 1))]?.date ?? points.at(-1)!.date;
      const foundCenter = allPoints.findIndex((point) => point.date >= centerDate);
      const center = foundCenter < 0 ? allPoints.length - 1 : foundCenter;
      let start = Math.round(center - ratio * (nextCount - 1));
      start = Math.max(0, Math.min(allPoints.length - nextCount, start));
      setWindow({ kind: "custom", from: allPoints[start]!.date, to: allPoints[start + nextCount - 1]!.date, baseRange });
      setFocusIndex(null);
    };
    element.addEventListener("wheel", onWheel, { passive: false });
    return () => element.removeEventListener("wheel", onWheel);
  }, [allPoints, baseRange, clearZoom, minimumWheelPoints, points]);

  const applyTypedDates = useCallback(() => {
    if (!dateFrom || !dateTo || !minDate || !maxDate) { setDateError("Kies twee geldige datums."); return; }
    const from = dateFrom <= dateTo ? dateFrom : dateTo;
    const to = dateFrom <= dateTo ? dateTo : dateFrom;
    const clampedFrom = from < minDate ? minDate : from;
    const clampedTo = to > maxDate ? maxDate : to;
    if (allPoints.filter((point) => point.date >= clampedFrom && point.date <= clampedTo).length < 2) { setDateError("Dit bereik bevat te weinig waarden."); return; }
    setWindow({ kind: "custom", from: clampedFrom, to: clampedTo, baseRange });
    resetFocus();
  }, [allPoints, baseRange, dateFrom, dateTo, maxDate, minDate, resetFocus]);

  const onKeyDown = useCallback((event: React.KeyboardEvent) => {
    const last = points.length - 1;
    if (last < 0) return;
    if (event.key === "ArrowRight") { event.preventDefault(); setFocusIndex((current) => Math.min(last, (current ?? last - 1) + 1)); }
    if (event.key === "ArrowLeft") { event.preventDefault(); setFocusIndex((current) => Math.max(0, (current ?? last + 1) - 1)); }
    if (event.key === "Home") { event.preventDefault(); setFocusIndex(0); }
    if (event.key === "End") { event.preventDefault(); setFocusIndex(last); }
    if (event.key === "Escape") { event.preventDefault(); clearZoom(); }
  }, [clearZoom, points.length]);
  const onPointerDown = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || points.length < 2) return;
    const index = indexForClientX(event.clientX);
    if (index === null) return;
    event.currentTarget.setPointerCapture?.(event.pointerId);
    setDrag({ pointerId: event.pointerId, from: index, to: index, startX: event.clientX });
  }, [indexForClientX, points.length]);
  const onPointerMove = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (!drag || drag.pointerId !== event.pointerId) return;
    const index = indexForClientX(event.clientX);
    if (index !== null) setDrag({ ...drag, to: index });
  }, [drag, indexForClientX]);
  const onPointerUp = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (!drag || drag.pointerId !== event.pointerId) return;
    event.currentTarget.releasePointerCapture?.(event.pointerId);
    const moved = Math.abs(event.clientX - drag.startX);
    if (moved >= 8 && drag.from !== drag.to) {
      const from = Math.min(drag.from, drag.to);
      const to = Math.max(drag.from, drag.to);
      setWindow({ kind: "custom", from: points[from]!.date, to: points[to]!.date, baseRange });
      setFocusIndex(null);
    }
    setDrag(null);
  }, [baseRange, drag, points]);

  return { window, setWindow, points, focusIndex, setFocusIndex, pointerRatio, setPointerRatio, drag, chartRef, dateFrom, setDateFrom, dateTo, setDateTo, dateError, minDate, maxDate, baseRange, applyPreset, clearZoom, applyTypedDates, indexForClientX, onKeyDown, onPointerDown, onPointerMove, onPointerUp };
}
