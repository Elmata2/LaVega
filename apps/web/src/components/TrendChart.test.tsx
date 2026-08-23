// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { act, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, expect, test } from "vitest";
import TrendChart, { axisIndices, keyToIndex } from "./TrendChart";

/* Real renders via renderToStaticMarkup (no render library in this repo), plus
 * a read of styles/charts.css so a class rename on either side fails here. The
 * keyboard tests mount the chart for real with React's own root API — arrow-key
 * scrubbing cannot be checked from static markup.
 *
 * This file runs in jsdom, where import.meta.url resolves against the jsdom
 * document rather than the disk, so the stylesheet is read from the package
 * root (vitest's working directory). */

const css = readFileSync(resolve(process.cwd(), "src/styles/charts.css"), "utf8");

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLDivElement | null = null;

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
});

function mount(ui: ReactElement): HTMLDivElement {
  host = document.createElement("div");
  document.body.appendChild(host);
  const el = host;
  act(() => {
    root = createRoot(el);
    root.render(ui);
  });
  return el;
}

function press(el: HTMLElement, key: string) {
  act(() => {
    el.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
  });
}

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

/* --- Item 12: the reading has to be reachable without a mouse --- */

test("the trend can be scrubbed from the keyboard, and says where it is", () => {
  const html = renderToStaticMarkup(
    <TrendChart points={points} format={format} ariaLabel="Verwacht saldo" readoutLabel="Saldo" />,
  );
  // A pointer-only chart is a chart only he can read on a laptop. The hit
  // surface is focusable and reports the point it sits on, so a screen reader
  // announces "week 3: €950" as the arrows move.
  expect(html).toContain('tabindex="0"');
  expect(html).toContain('role="slider"');
  expect(html).toContain('aria-valuetext="week 3: €950"');
  expect(html).toContain('aria-valuenow="3"');
  expect(html).toContain('aria-valuemin="0"');
  expect(html).toContain('aria-valuemax="3"');
  // Nothing is being set: moving the cursor changes the reading, not the data.
  expect(html).toContain('aria-readonly="true"');
});

test("the plot is a group, not an image — an image would hide the scrubber", () => {
  const html = renderToStaticMarkup(<TrendChart points={points} format={format} ariaLabel="Testtrend" />);
  expect(html).toContain('role="group"');
  expect(html).not.toContain('role="img"');
});

test("arrow keys walk the readout point by point, Home and End jump to the ends", () => {
  const el = mount(<TrendChart points={points} format={format} ariaLabel="A" readoutLabel="Saldo" />);
  const hit = el.querySelector<HTMLElement>(".lv-chart-hit");
  const readout = el.querySelector<HTMLElement>(".lv-chart-readout");
  expect(hit).not.toBeNull();
  // It opens on the last point — the number the card is actually about.
  expect(readout?.textContent).toContain("week 3");
  expect(readout?.textContent).toContain("€950");

  press(hit!, "ArrowLeft");
  expect(readout?.textContent).toContain("week 2");
  expect(readout?.textContent).toContain("€800");
  expect(hit?.getAttribute("aria-valuetext")).toBe("week 2: €800");

  press(hit!, "Home");
  expect(readout?.textContent).toContain("nu");
  expect(readout?.textContent).toContain("€1000");

  press(hit!, "End");
  expect(readout?.textContent).toContain("week 3");

  // Off the end is not an error and not a wrap-around: it stays put.
  press(hit!, "ArrowRight");
  expect(readout?.textContent).toContain("week 3");
});

test("keyToIndex moves one step at a time and never walks off the series", () => {
  expect(keyToIndex(4, 2, "ArrowRight")).toBe(3);
  expect(keyToIndex(4, 2, "ArrowLeft")).toBe(1);
  expect(keyToIndex(4, 3, "ArrowRight")).toBe(3); // clamped, not wrapped
  expect(keyToIndex(4, 0, "ArrowLeft")).toBe(0);
  expect(keyToIndex(4, 2, "Home")).toBe(0);
  expect(keyToIndex(4, 2, "End")).toBe(3);
  // Anything else is not ours: the page must keep scrolling and tabbing.
  expect(keyToIndex(4, 2, "Tab")).toBeNull();
  expect(keyToIndex(4, 2, "a")).toBeNull();
  expect(keyToIndex(0, 0, "ArrowLeft")).toBeNull();
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

test("the scrubber shows where the keyboard is", () => {
  // A focusable surface with no visible focus state is a trap for anyone who
  // cannot see the cursor line move.
  expect(css.replace(/\s+/g, " ")).toContain(".lv-chart-hit:focus-visible");
});

test("the axis gutter is a variable the drawing area subtracts, so a tick never shifts the data", () => {
  expect(css).toContain("--lv-axis-w: 0px");
  expect(css.replace(/\s+/g, " ")).toContain(".lv-chart-area { position: absolute; inset: 0 0 0 var(--lv-axis-w); }");
});
