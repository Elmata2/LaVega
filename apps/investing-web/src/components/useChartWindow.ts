import type { PortfolioRange } from "@lavega/core";
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";

export const chartRanges: Array<{ value: PortfolioRange; label: string }> = [
  { value: "1M", label: "1 month" },
  { value: "6M", label: "6 months" },
  { value: "1Y", label: "1 year" },
  { value: "YTD", label: "YTD" },
  { value: "All", label: "All" },
];

export type ChartWindow =
  | { kind: "preset"; range: PortfolioRange }
  | { kind: "custom"; from: string; to: string; baseRange: PortfolioRange };

type Dated = { date: string };

export function pointsInWindow<T extends Dated>(
  all: readonly T[],
  window: ChartWindow,
  preset: (range: PortfolioRange) => readonly T[],
): T[] {
  if (window.kind === "preset") return [...preset(window.range)];
  return all.filter((point) => point.date >= window.from && point.date <= window.to);
}

export function positionPointsForRange<T extends Dated>(
  all: readonly T[],
  range: PortfolioRange,
): T[] {
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

// A drag holds dates, not indices, and the dataset it started on. Dates stay
// meaningful when the visible window moves; a replaced dataset cancels it.
type Drag = {
  pointerId: number;
  anchor: string;
  head: string;
  startX: number;
  source: readonly Dated[];
};

export type ChartWindowState = {
  window: ChartWindow;
  focusIndex: number | null;
  drag: Drag | null;
  dateFrom: string;
  dateTo: string;
  dateError: string | null;
};

export type ChartWindowAction =
  | { type: "preset"; range: PortfolioRange }
  | { type: "clear" }
  | {
      type: "wheel";
      direction: "in" | "out";
      ratio: number;
      all: readonly Dated[];
      preset: (range: PortfolioRange) => readonly Dated[];
      minimumPoints: number;
    }
  | { type: "dateInput"; field: "from" | "to"; value: string }
  | { type: "typedDates"; all: readonly Dated[] }
  | { type: "focus"; index: number | null }
  | { type: "focusStep"; delta: 1 | -1; count: number }
  | { type: "hoverEnd" }
  | { type: "dragStart"; pointerId: number; date: string; x: number; all: readonly Dated[] }
  | { type: "dragMove"; pointerId: number; date: string }
  | { type: "dragEnd"; pointerId: number; x: number; all: readonly Dated[] }
  | { type: "dragCancel"; pointerId: number };

export const initialChartWindowState: ChartWindowState = {
  window: { kind: "preset", range: "1M" },
  focusIndex: null,
  drag: null,
  dateFrom: "",
  dateTo: "",
  dateError: null,
};

const minimumDragPixels = 8;

function baseRangeOf(window: ChartWindow): PortfolioRange {
  return window.kind === "preset" ? window.range : window.baseRange;
}

function showWindow(state: ChartWindowState, window: ChartWindow): ChartWindowState {
  return { ...state, window, focusIndex: null, dateError: null };
}

function showDates(
  state: ChartWindowState,
  from: string,
  to: string,
  all: readonly Dated[],
): ChartWindowState | null {
  const count = all.filter((point) => point.date >= from && point.date <= to).length;
  if (count < 2) return null;
  return showWindow(state, { kind: "custom", from, to, baseRange: baseRangeOf(state.window) });
}

function wheel(
  state: ChartWindowState,
  action: Extract<ChartWindowAction, { type: "wheel" }>,
): ChartWindowState {
  const { all, ratio } = action;
  const visible = pointsInWindow(all, state.window, action.preset);
  const count = visible.length;
  if (count < 2) return state;
  const step = Math.max(1, Math.round(count * 0.05));
  const nextCount = Math.min(
    all.length,
    Math.max(action.minimumPoints, count + (action.direction === "in" ? -step : step)),
  );
  if (action.direction === "in" ? nextCount >= count : nextCount <= count) return state;
  const centerDate = visible[Math.round(ratio * (count - 1))]?.date ?? visible.at(-1)!.date;
  const foundCenter = all.findIndex((point) => point.date >= centerDate);
  const center = foundCenter < 0 ? all.length - 1 : foundCenter;
  const start = Math.max(
    0,
    Math.min(all.length - nextCount, Math.round(center - ratio * (nextCount - 1))),
  );
  return showWindow(state, {
    kind: "custom",
    from: all[start]!.date,
    to: all[start + nextCount - 1]!.date,
    baseRange: baseRangeOf(state.window),
  });
}

export function chartWindowReducer(
  state: ChartWindowState,
  action: ChartWindowAction,
): ChartWindowState {
  switch (action.type) {
    case "preset":
      return showWindow(state, { kind: "preset", range: action.range });
    case "clear":
      return showWindow(state, { kind: "preset", range: baseRangeOf(state.window) });
    case "wheel":
      return wheel(state, action);
    case "dateInput":
      return action.field === "from"
        ? { ...state, dateFrom: action.value }
        : { ...state, dateTo: action.value };
    case "typedDates": {
      const minDate = action.all[0]?.date;
      const maxDate = action.all.at(-1)?.date;
      if (!state.dateFrom || !state.dateTo || !minDate || !maxDate)
        return { ...state, dateError: "Choose two valid dates." };
      const [from, to] = [state.dateFrom, state.dateTo].sort();
      return (
        showDates(
          state,
          from! < minDate ? minDate : from!,
          to! > maxDate ? maxDate : to!,
          action.all,
        ) ?? {
          ...state,
          dateError: "This range contains too few values.",
        }
      );
    }
    case "focus":
      return { ...state, focusIndex: action.index };
    case "focusStep": {
      const last = action.count - 1;
      if (last < 0) return state;
      const current =
        state.focusIndex !== null && state.focusIndex <= last
          ? state.focusIndex
          : last - action.delta;
      return { ...state, focusIndex: Math.max(0, Math.min(last, current + action.delta)) };
    }
    case "hoverEnd":
      return state.drag ? state : { ...state, focusIndex: null };
    case "dragStart":
      if (state.drag?.source === action.all) return state;
      return {
        ...state,
        drag: {
          pointerId: action.pointerId,
          anchor: action.date,
          head: action.date,
          startX: action.x,
          source: action.all,
        },
      };
    case "dragMove":
      if (state.drag?.pointerId !== action.pointerId || state.drag.head === action.date)
        return state;
      return { ...state, drag: { ...state.drag, head: action.date } };
    case "dragEnd": {
      const drag = state.drag;
      if (drag?.pointerId !== action.pointerId) return state;
      const ended = { ...state, drag: null };
      if (drag.source !== action.all) return ended;
      if (Math.abs(action.x - drag.startX) < minimumDragPixels) return ended;
      if (drag.anchor === drag.head) return ended;
      const [from, to] = [drag.anchor, drag.head].sort();
      return showDates(ended, from!, to!, action.all) ?? ended;
    }
    case "dragCancel":
      if (state.drag?.pointerId !== action.pointerId) return state;
      return { ...state, drag: null };
  }
}

function clampRatio(value: number) {
  return Math.max(0, Math.min(1, value));
}

/**
 * Owns one chart's visible window, crosshair focus, and drag gesture. Every
 * transition runs through `chartWindowReducer`, so each chart instance keeps
 * its own state and callers only issue semantic commands.
 */
export function useChartWindow<T extends Dated>(options: {
  allPoints: readonly T[];
  presetPoints: (range: PortfolioRange) => readonly T[];
  minimumWheelPoints?: number;
  leftInset?: number;
  rightInset?: number;
}) {
  const {
    allPoints,
    presetPoints,
    minimumWheelPoints = 2,
    leftInset = 72,
    rightInset = 16,
  } = options;
  const [state, dispatch] = useReducer(chartWindowReducer, initialChartWindowState);
  const [pointerRatio, setPointerRatio] = useState(0);
  const chartRef = useRef<HTMLDivElement>(null);
  const points = useMemo(
    () => pointsInWindow(allPoints, state.window, presetPoints),
    [allPoints, presetPoints, state.window],
  );
  const drag = state.drag?.source === allPoints ? state.drag : null;
  const selection = useMemo(() => {
    if (!drag) return null;
    const [from, to] = [drag.anchor, drag.head].sort();
    return { from: from!, to: to! };
  }, [drag]);

  const indexAt = useCallback(
    (clientX: number) => {
      const rect = chartRef.current?.getBoundingClientRect();
      if (!rect || points.length === 0 || rect.width <= 0) return null;
      const ratio = clampRatio(
        (clientX - rect.left - leftInset) / Math.max(1, rect.width - leftInset - rightInset),
      );
      return Math.round(ratio * (points.length - 1));
    },
    [leftInset, points.length, rightInset],
  );

  useEffect(() => {
    const element = chartRef.current;
    if (!element || allPoints.length < 2) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      dispatch({
        type: "wheel",
        direction: event.deltaY < 0 ? "in" : "out",
        ratio: clampRatio(
          (event.clientX - element.getBoundingClientRect().left) / Math.max(1, element.clientWidth),
        ),
        all: allPoints,
        preset: presetPoints,
        minimumPoints: minimumWheelPoints,
      });
    };
    element.addEventListener("wheel", onWheel, { passive: false });
    return () => element.removeEventListener("wheel", onWheel);
  }, [allPoints, minimumWheelPoints, presetPoints]);

  const handlers = useMemo(
    () => ({
      onKeyDown(event: React.KeyboardEvent) {
        const count = points.length;
        const command: ChartWindowAction | null =
          event.key === "ArrowRight"
            ? { type: "focusStep", delta: 1, count }
            : event.key === "ArrowLeft"
              ? { type: "focusStep", delta: -1, count }
              : event.key === "Home" && count > 0
                ? { type: "focus", index: 0 }
                : event.key === "End" && count > 0
                  ? { type: "focus", index: count - 1 }
                  : event.key === "Escape"
                    ? { type: "clear" }
                    : null;
        if (!command) return;
        event.preventDefault();
        dispatch(command);
      },
      onPointerDown(event: React.PointerEvent<HTMLDivElement>) {
        if (event.button !== 0 || points.length < 2 || drag) return;
        const index = indexAt(event.clientX);
        if (index === null) return;
        event.currentTarget.setPointerCapture?.(event.pointerId);
        dispatch({
          type: "dragStart",
          pointerId: event.pointerId,
          date: points[index]!.date,
          x: event.clientX,
          all: allPoints,
        });
      },
      onPointerMove(event: React.PointerEvent<HTMLDivElement>) {
        const rect = event.currentTarget.getBoundingClientRect();
        setPointerRatio(clampRatio((event.clientX - rect.left) / Math.max(1, rect.width)));
        const index = indexAt(event.clientX);
        if (index === null) return;
        dispatch({ type: "focus", index });
        dispatch({ type: "dragMove", pointerId: event.pointerId, date: points[index]!.date });
      },
      onPointerUp(event: React.PointerEvent<HTMLDivElement>) {
        dispatch({ type: "dragEnd", pointerId: event.pointerId, x: event.clientX, all: allPoints });
      },
      onPointerCancel(event: React.PointerEvent<HTMLDivElement>) {
        dispatch({ type: "dragCancel", pointerId: event.pointerId });
      },
      onLostPointerCapture(event: React.PointerEvent<HTMLDivElement>) {
        dispatch({ type: "dragCancel", pointerId: event.pointerId });
      },
      onPointerLeave() {
        dispatch({ type: "hoverEnd" });
      },
    }),
    [allPoints, drag, indexAt, points],
  );

  return {
    window: state.window,
    points,
    focusIndex:
      state.focusIndex !== null && state.focusIndex < points.length ? state.focusIndex : null,
    pointerRatio,
    selection,
    chartRef,
    handlers,
    dateFrom: state.dateFrom,
    dateTo: state.dateTo,
    dateError: state.dateError,
    minDate: allPoints[0]?.date,
    maxDate: allPoints.at(-1)?.date,
    setDateFrom: useCallback(
      (value: string) => dispatch({ type: "dateInput", field: "from", value }),
      [],
    ),
    setDateTo: useCallback(
      (value: string) => dispatch({ type: "dateInput", field: "to", value }),
      [],
    ),
    applyPreset: useCallback((range: PortfolioRange) => dispatch({ type: "preset", range }), []),
    clearZoom: useCallback(() => dispatch({ type: "clear" }), []),
    applyTypedDates: useCallback(
      () => dispatch({ type: "typedDates", all: allPoints }),
      [allPoints],
    ),
    focus: useCallback((index: number | null) => dispatch({ type: "focus", index }), []),
  };
}
