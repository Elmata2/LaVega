import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";
import TrendChart, { axisIndices } from "./TrendChart";

/* Real renders via renderToStaticMarkup (no render library in this repo), plus
 * a read of styles/charts.css so a class rename on either side fails here. */

const css = readFileSync(new URL("../styles/charts.css", import.meta.url), "utf8");

const points = [
  { label: "nu", value: 1000 },
  { label: "week 1", value: 1200 },
  { label: "week 2", value: 800 },
  { label: "week 3", value: 950 },
];

const format = (v: number) => `€${v}`;

test("TrendChart draws one smooth path and opens its readout on the last point", () => {
  const html = renderToStaticMarkup(
    <TrendChart points={points} format={format} ariaLabel="Testtrend" readoutLabel="Saldo" />,
  );
  expect(html).toContain('aria-label="Testtrend"');
  expect(html).toContain("Saldo · week 3");
  expect(html).toContain("€950");
  // A cubic path, not a polyline: the line is smoothed.
  expect(html).toContain("<path");
  expect(html).not.toContain("<polyline");
  // Strokes must not thicken when the 0–100 box is stretched to the card width.
  expect(html).toContain('vector-effect="non-scaling-stroke"');
  expect(html).toContain('preserveAspectRatio="none"');
});

test("TrendChart puts every label in HTML, never in the SVG", () => {
  const html = renderToStaticMarkup(<TrendChart points={points} format={format} ariaLabel="Testtrend" showAxis />);
  // The bug this design exists to prevent: SVG <text> shrank to ~6px when the
  // grid collapsed to one column on a phone.
  expect(html).not.toContain("<text");
  expect(html).toContain('class="lv-chart-tick"');
  expect(html).toContain('class="lv-chart-xlabel"');
});

test("TrendChart draws the band and the reference line only when given them", () => {
  const bare = renderToStaticMarkup(<TrendChart points={points} format={format} ariaLabel="A" />);
  expect(bare).not.toContain("<line ");
  expect(bare).not.toContain("lv-chart-reflabel");
  expect(bare).not.toContain('fill-opacity="0.14"'); // no band

  const full = renderToStaticMarkup(
    <TrendChart
      points={points}
      band={{ lower: [900, 1100, 700, 850], upper: [1100, 1300, 900, 1050] }}
      reference={{ value: 900, label: "buffer" }}
      format={format}
      ariaLabel="A"
    />,
  );
  expect(full).toContain("<line ");
  expect(full).toContain("buffer");
  expect(full).toContain('stroke-dasharray="5 4"');
  expect(full).toContain('fill-opacity="0.14"'); // the uncertainty band
});

test("TrendChart marks a named point and skips an out-of-range one", () => {
  const inside = renderToStaticMarkup(
    <TrendChart points={points} format={format} ariaLabel="A" mark={{ index: 2, color: "var(--neg)" }} />,
  );
  expect(inside).toContain('class="lv-chart-mark" style="left:66.67%');

  const outside = renderToStaticMarkup(
    <TrendChart points={points} format={format} ariaLabel="A" mark={{ index: 9, color: "var(--neg)" }} />,
  );
  expect(outside).not.toContain("lv-chart-mark");
});

test("TrendChart renders nothing rather than an empty axis with no points", () => {
  expect(renderToStaticMarkup(<TrendChart points={[]} format={format} ariaLabel="A" />)).toBe("");
});

test("axisIndices keeps every label while they fit and thins them out when they don't", () => {
  expect(axisIndices(0)).toEqual([]);
  expect(axisIndices(4)).toEqual([0, 1, 2, 3]);
  // 14 weekly points on a phone: ends plus two inside, never fourteen.
  expect(axisIndices(14)).toEqual([0, 4, 9, 13]);
});

test("every class TrendChart emits has a rule in charts.css", () => {
  for (const cls of [
    "lv-chart",
    "lv-chart-withaxis",
    "lv-chart-readout",
    "lv-chart-readout-value",
    "lv-chart-plot",
    "lv-chart-area",
    "lv-chart-svg",
    "lv-chart-grid",
    "lv-chart-tick",
    "lv-chart-cursor",
    "lv-chart-dot",
    "lv-chart-mark",
    "lv-chart-reflabel",
    "lv-chart-hit",
    "lv-chart-xaxis",
    "lv-chart-xlabel",
  ]) {
    expect(css, `.${cls} missing from charts.css`).toContain(`.${cls}`);
  }
});

test("the axis gutter is a variable the drawing area subtracts, so a tick never shifts the data", () => {
  expect(css).toContain("--lv-axis-w: 0px");
  expect(css.replace(/\s+/g, " ")).toContain(".lv-chart-area { position: absolute; inset: 0 0 0 var(--lv-axis-w); }");
});
