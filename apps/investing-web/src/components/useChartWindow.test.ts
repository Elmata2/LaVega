import type { PortfolioRange } from "@lavega/core";
import { expect, test } from "vitest";
import {
  chartWindowReducer,
  initialChartWindowState,
  pointsInWindow,
  type ChartWindowState,
} from "./useChartWindow";

const all = Array.from({ length: 60 }, (_, index) => ({
  date: new Date(Date.UTC(2026, 0, 1 + index)).toISOString().slice(0, 10),
}));
const lastMonth = all.slice(-22);
const preset = (range: PortfolioRange) => (range === "1M" ? lastMonth : all);
const visible = (state: ChartWindowState) => pointsInWindow(all, state.window, preset);

function wheelOut(state: ChartWindowState) {
  return chartWindowReducer(state, {
    type: "wheel",
    direction: "out",
    ratio: 0.5,
    all,
    preset,
    minimumPoints: 2,
  });
}

test("outward wheel zoom from 1M grows monotonically and stays at full history", () => {
  let state = initialChartWindowState;
  const counts = [visible(state).length];
  for (let tick = 0; tick < 40; tick += 1) {
    state = wheelOut(state);
    counts.push(visible(state).length);
  }
  for (let index = 1; index < counts.length; index += 1) {
    expect(counts[index]).toBeGreaterThanOrEqual(counts[index - 1]!);
  }
  expect(counts.at(-1)).toBe(all.length);
  expect(state.window).toMatchObject({ kind: "custom", baseRange: "1M" });
  expect(wheelOut(state)).toBe(state);
});

test("clear restores the original preset after a custom window", () => {
  const zoomed = wheelOut(wheelOut(initialChartWindowState));
  expect(zoomed.window.kind).toBe("custom");
  expect(chartWindowReducer(zoomed, { type: "clear" }).window).toEqual({
    kind: "preset",
    range: "1M",
  });
});

test("outward zoom on a preset that already shows full history changes nothing", () => {
  const state = chartWindowReducer(initialChartWindowState, { type: "preset", range: "All" });
  expect(wheelOut(state)).toBe(state);
});

test("a second pointer cannot take over the active drag", () => {
  const started = chartWindowReducer(initialChartWindowState, {
    type: "dragStart",
    pointerId: 1,
    date: all[40]!.date,
    x: 80,
    all,
  });
  const intruded = chartWindowReducer(started, {
    type: "dragStart",
    pointerId: 2,
    date: all[59]!.date,
    x: 300,
    all,
  });
  expect(intruded).toBe(started);
  expect(chartWindowReducer(started, { type: "dragMove", pointerId: 2, date: all[59]!.date })).toBe(
    started,
  );
  expect(chartWindowReducer(started, { type: "dragEnd", pointerId: 2, x: 300, all })).toBe(started);
});

test("cancel from the owning pointer clears the drag without changing the window", () => {
  const started = chartWindowReducer(initialChartWindowState, {
    type: "dragStart",
    pointerId: 1,
    date: all[40]!.date,
    x: 80,
    all,
  });
  const moved = chartWindowReducer(started, {
    type: "dragMove",
    pointerId: 1,
    date: all[55]!.date,
  });
  expect(chartWindowReducer(moved, { type: "dragCancel", pointerId: 2 })).toBe(moved);
  const cancelled = chartWindowReducer(moved, { type: "dragCancel", pointerId: 1 });
  expect(cancelled.drag).toBeNull();
  expect(cancelled.window).toEqual(initialChartWindowState.window);
});

test("a drag whose dataset was replaced ends as a cancel", () => {
  const started = chartWindowReducer(initialChartWindowState, {
    type: "dragStart",
    pointerId: 1,
    date: all[45]!.date,
    x: 80,
    all,
  });
  const moved = chartWindowReducer(started, {
    type: "dragMove",
    pointerId: 1,
    date: all[59]!.date,
  });
  const replaced = all.slice(0, 50);
  const ended = chartWindowReducer(moved, { type: "dragEnd", pointerId: 1, x: 300, all: replaced });
  expect(ended.drag).toBeNull();
  expect(ended.window).toEqual(initialChartWindowState.window);
  const restarted = chartWindowReducer(moved, {
    type: "dragStart",
    pointerId: 2,
    date: replaced[10]!.date,
    x: 80,
    all: replaced,
  });
  expect(restarted.drag).toMatchObject({ pointerId: 2, source: replaced });
});

test("a short drag does not zoom", () => {
  const started = chartWindowReducer(initialChartWindowState, {
    type: "dragStart",
    pointerId: 1,
    date: all[40]!.date,
    x: 80,
    all,
  });
  const moved = chartWindowReducer(started, {
    type: "dragMove",
    pointerId: 1,
    date: all[41]!.date,
  });
  const ended = chartWindowReducer(moved, { type: "dragEnd", pointerId: 1, x: 84, all });
  expect(ended.window).toEqual(initialChartWindowState.window);
  expect(ended.drag).toBeNull();
});

test("hover end keeps focus while a drag is active", () => {
  const focused = chartWindowReducer(initialChartWindowState, { type: "focus", index: 3 });
  expect(chartWindowReducer(focused, { type: "hoverEnd" }).focusIndex).toBeNull();
  const dragging = chartWindowReducer(focused, {
    type: "dragStart",
    pointerId: 1,
    date: all[40]!.date,
    x: 80,
    all,
  });
  expect(chartWindowReducer(dragging, { type: "hoverEnd" }).focusIndex).toBe(3);
});

test("keyboard steps stay inside the visible points", () => {
  let state = chartWindowReducer(initialChartWindowState, {
    type: "focusStep",
    delta: 1,
    count: 3,
  });
  expect(state.focusIndex).toBe(2);
  state = chartWindowReducer(state, { type: "focusStep", delta: 1, count: 3 });
  expect(state.focusIndex).toBe(2);
  state = chartWindowReducer(state, { type: "focusStep", delta: -1, count: 3 });
  expect(state.focusIndex).toBe(1);
});

test("typed dates reject a range with too few values", () => {
  const typed = [
    { type: "dateInput", field: "from", value: all[5]!.date },
    { type: "dateInput", field: "to", value: all[5]!.date },
    { type: "typedDates", all },
  ] as const;
  const state = typed.reduce(chartWindowReducer, initialChartWindowState);
  expect(state.dateError).toBe("This range contains too few values.");
  expect(state.window).toEqual(initialChartWindowState.window);
});

test("typed dates in either order open a custom window on the base range", () => {
  const typed = [
    { type: "dateInput", field: "from", value: all[20]!.date },
    { type: "dateInput", field: "to", value: all[10]!.date },
    { type: "typedDates", all },
  ] as const;
  expect(typed.reduce(chartWindowReducer, initialChartWindowState).window).toEqual({
    kind: "custom",
    from: all[10]!.date,
    to: all[20]!.date,
    baseRange: "1M",
  });
});

test("wheel zoom on fewer points than the minimum changes nothing", () => {
  const few = all.slice(0, 3);
  const state = chartWindowReducer(initialChartWindowState, { type: "preset", range: "All" });
  for (const direction of ["in", "out"] as const) {
    expect(
      chartWindowReducer(state, {
        type: "wheel",
        direction,
        ratio: 0.5,
        all: few,
        preset: () => few,
        minimumPoints: 5,
      }),
    ).toBe(state);
  }
});

test("keyboard steps ignore a focus index past the visible points", () => {
  const stale = chartWindowReducer(initialChartWindowState, { type: "focus", index: 10 });
  expect(chartWindowReducer(stale, { type: "focusStep", delta: -1, count: 3 }).focusIndex).toBe(2);
});
