import { expect, test } from "vitest";
import {
  areaPath,
  bandPath,
  barPercent,
  makeYScale,
  nearestIndex,
  niceDomain,
  smoothPath,
  xPositions,
  type Pt,
} from "./chart";

/* The chart maths every graph in the app now shares. Headless — these pin the
 * numbers, the component tests pin the markup. */

test("makeYScale inverts the axis and keeps the inset", () => {
  const y = makeYScale(0, 100, 10);
  expect(y(100)).toBe(10); // the top, one inset down
  expect(y(0)).toBe(90); // the bottom, one inset up
  expect(y(50)).toBe(50);
});

test("makeYScale never divides by zero on a flat series", () => {
  const y = makeYScale(5, 5, 6);
  expect(Number.isFinite(y(5))).toBe(true);
});

test("xPositions spreads points across the box and centres a single one", () => {
  expect(xPositions(0)).toEqual([]);
  expect(xPositions(1)).toEqual([50]);
  expect(xPositions(3)).toEqual([0, 50, 100]);
});

test("niceDomain rounds the axis outwards to readable ticks", () => {
  const d = niceDomain(120, 1847, 4);
  expect(d.min).toBeLessThanOrEqual(120);
  expect(d.max).toBeGreaterThanOrEqual(1847);
  // Every tick is a multiple of the step, and the ends are ticks.
  expect(d.ticks[0]).toBe(d.min);
  expect(d.ticks[d.ticks.length - 1]).toBe(d.max);
  expect(d.ticks.every((t) => Number.isFinite(t))).toBe(true);
});

test("niceDomain gives a flat series a band to sit in instead of a zero range", () => {
  const d = niceDomain(500, 500, 4);
  expect(d.max).toBeGreaterThan(d.min);
});

test("smoothPath degrades honestly with too few points", () => {
  expect(smoothPath([])).toBe("");
  expect(smoothPath([{ x: 10, y: 20 }])).toBe("M 10 20");
  expect(
    smoothPath([
      { x: 0, y: 0 },
      { x: 100, y: 50 },
    ]),
  ).toContain("C");
});

test("smoothPath never overshoots a dip — a smoothed cash line may not invent a shortfall", () => {
  // A V: the curve through it must stay at or above the trough (y grows
  // downwards, so "below the trough" means a LARGER y than 90).
  const pts: Pt[] = [
    { x: 0, y: 10 },
    { x: 50, y: 90 },
    { x: 100, y: 10 },
  ];
  const d = smoothPath(pts);
  const ys = [...d.matchAll(/-?\d+(?:\.\d+)?\s(-?\d+(?:\.\d+)?)/g)].map((m) => Number(m[1]));
  expect(ys.length).toBeGreaterThan(0);
  expect(Math.max(...ys)).toBeLessThanOrEqual(90);
  expect(Math.min(...ys)).toBeGreaterThanOrEqual(10);
});

test("areaPath closes the line down to the baseline", () => {
  const d = areaPath(
    [
      { x: 0, y: 20 },
      { x: 100, y: 40 },
    ],
    100,
  );
  expect(d.startsWith("M 0 20")).toBe(true);
  expect(d.endsWith("L 0 100 Z")).toBe(true);
});

test("bandPath joins the two edges into one closed shape", () => {
  const d = bandPath(
    [
      { x: 0, y: 10 },
      { x: 100, y: 20 },
    ],
    [
      { x: 0, y: 40 },
      { x: 100, y: 50 },
    ],
  );
  // One move, one join to the return leg, one close — never two subpaths.
  expect(d.match(/M /g)?.length).toBe(1);
  expect(d).toContain(" L ");
  expect(d.endsWith("Z")).toBe(true);
});

test("nearestIndex maps a pointer fraction to a point and clamps outside the plot", () => {
  expect(nearestIndex(1, 0.7)).toBe(0);
  expect(nearestIndex(5, 0)).toBe(0);
  expect(nearestIndex(5, 1)).toBe(4);
  expect(nearestIndex(5, 0.5)).toBe(2);
  expect(nearestIndex(5, -3)).toBe(0);
  expect(nearestIndex(5, 9)).toBe(4);
});

test("barPercent scales against the shared maximum and draws nothing for non-positive values", () => {
  expect(barPercent(50, 200)).toBe(25);
  expect(barPercent(200, 200)).toBe(100);
  expect(barPercent(0, 200)).toBe(0);
  expect(barPercent(-40, 200)).toBe(0);
  expect(barPercent(40, 0)).toBe(0);
});
