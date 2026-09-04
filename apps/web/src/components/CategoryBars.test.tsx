// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { act, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, expect, test } from "vitest";
import CategoryBars from "./CategoryBars";

/* This file runs in the jsdom environment (it mounts the component for real),
 * where import.meta.url resolves against the jsdom document rather than the
 * disk — so the stylesheet is read from the package root, which is vitest's
 * working directory. */
const css = readFileSync(resolve(process.cwd(), "src/styles/charts.css"), "utf8");

const series = [
  { label: "Vorige periode", color: "var(--muted)" },
  { label: "Deze periode", color: "var(--accent)" },
];

const groups = [
  { label: "Boodschappen", values: [400, 500] },
  { label: "Transport", values: [200, 100] },
];

const format = (v: number) => `€${v}`;

/* The reading is an interaction, so half of this file drives a real mount with
 * React's own root API (no testing library is installed in this repo, and none
 * is being added for one file — the same approach StatistiekBlock.aangepast
 * already uses). */
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

test("CategoryBars draws one bar per series per group, legend and labels included", () => {
  const html = renderToStaticMarkup(
    <CategoryBars
      groups={groups}
      series={series}
      format={format}
      ariaLabel="Uitgaven per categorie"
    />,
  );
  expect(html.match(/class="lv-bar"/g)?.length).toBe(4);
  expect(html).toContain('aria-label="Uitgaven per categorie"');
  expect(html).toContain("Vorige periode");
  expect(html).toContain("Deze periode");
  expect(html).toContain(">Boodschappen<");
  expect(html).toContain(">Transport<");
});

test("CategoryBars scales both series against one shared maximum", () => {
  const html = renderToStaticMarkup(
    <CategoryBars groups={groups} series={series} format={format} ariaLabel="A" />,
  );
  // The axis is rounded outwards to readable gridlines (0/200/400/600), so the
  // scale's top is 600 and every bar is its true fraction of that — both series
  // measured against one maximum, which is the only reason the comparison means
  // anything.
  expect(html).toContain("height:83.33%"); // 500 / 600
  expect(html).toContain("height:66.67%"); // 400 / 600
  expect(html).toContain("height:33.33%"); // 200 / 600
  expect(html).toContain("height:16.67%"); // 100 / 600
});

/* --- Item 12: the exact number, on hover AND on tap AND from the keyboard --- */

test("every bar is a real control, so its number is reachable without a mouse", () => {
  const html = renderToStaticMarkup(
    <CategoryBars groups={groups} series={series} format={format} ariaLabel="A" />,
  );
  // A `title` attribute would have been a feature only a desktop mouse has: a
  // phone never hovers and a keyboard never triggers one. Four bars, four
  // buttons — focusable, tappable, and each one still exactly `class="lv-bar"`.
  expect(html.match(/<button /g)?.length).toBe(4);
  expect(html.match(/type="button"/g)?.length).toBe(4);
  expect(html.match(/class="lv-bar"/g)?.length).toBe(4);
});

test("each bar's reading names its own slice of time and prints the amount for it", () => {
  const html = renderToStaticMarkup(
    <CategoryBars
      groups={[{ label: "Kleding…", title: "Kleding & winkelen", values: [10, 20] }]}
      series={series}
      format={format}
      ariaLabel="A"
    />,
  );
  // "€20" on its own invites the reader to guess whether it is the month, the
  // window or the average, so the slice is printed above the number — and it is
  // real text in the DOM, not a native tooltip.
  expect(html).toContain('<span class="lv-tip-when">Kleding &amp; winkelen · Deze periode</span>');
  expect(html).toContain('<span class="lv-tip-value">€20</span>');
  // The same reading is the button's accessible name, so a screen reader gets
  // the number and the slice in one go.
  expect(html).toContain('aria-label="Kleding &amp; winkelen · Deze periode: €20"');
  // The x-axis label keeps its title: that one is truncated text, not a value.
  expect(html).toContain('title="Kleding &amp; winkelen"');
});

test("a single-series chart names the group alone, not 'group · series'", () => {
  const html = renderToStaticMarkup(
    <CategoryBars
      groups={[{ label: "aug", title: "augustus 2026", values: [120] }]}
      series={[{ label: "Verschil", color: "var(--neg)" }]}
      format={format}
      ariaLabel="A"
    />,
  );
  expect(html).toContain('<span class="lv-tip-when">augustus 2026</span>');
  expect(html).toContain('aria-label="augustus 2026: €120"');
});

test("a bar that nearly fills the plot reads inside itself instead of over the legend", () => {
  const html = renderToStaticMarkup(
    <CategoryBars groups={groups} series={series} format={format} ariaLabel="A" />,
  );
  // 500/600 = 83% leaves no room above the bar; 400/600 = 67% does.
  expect(html.match(/class="lv-tip lv-tip-inside"/g)?.length).toBe(1);
  expect(html.match(/class="lv-tip"/g)?.length).toBe(3);
});

test("a tap opens the reading and a second tap closes it — a phone has no hover", () => {
  const el = mount(<CategoryBars groups={groups} series={series} format={format} ariaLabel="A" />);
  const bars = [...el.querySelectorAll<HTMLButtonElement>("button.lv-bar")];
  expect(bars).toHaveLength(4);
  expect(bars[0].dataset.tip).toBe("off");

  act(() => bars[0].click());
  expect(bars[0].dataset.tip).toBe("on");

  // Tapping the same bar again puts it away. Without this, a tapped chip would
  // stay on screen on the phones that do not focus a button on tap.
  act(() => bars[0].click());
  expect(bars[0].dataset.tip).toBe("off");

  // And one bar at a time: two open chips would overlap into nonsense.
  act(() => bars[0].click());
  act(() => bars[3].click());
  expect(bars[0].dataset.tip).toBe("off");
  expect(bars[3].dataset.tip).toBe("on");
});

test("CategoryBars shows the value axis only when asked", () => {
  const off = renderToStaticMarkup(
    <CategoryBars groups={groups} series={series} format={format} ariaLabel="A" />,
  );
  expect(off).not.toContain("lv-chart-tick");
  expect(off).not.toContain("lv-chart-withaxis");

  const on = renderToStaticMarkup(
    <CategoryBars groups={groups} series={series} format={format} ariaLabel="A" showAxis />,
  );
  expect(on).toContain("lv-chart-withaxis");
  expect(on).toContain('class="lv-chart-tick"');
});

test("CategoryBars renders nothing rather than an empty plot with no groups", () => {
  expect(
    renderToStaticMarkup(
      <CategoryBars groups={[]} series={series} format={format} ariaLabel="A" />,
    ),
  ).toBe("");
});

test("every class CategoryBars emits has a rule in charts.css", () => {
  for (const cls of [
    "lv-bars",
    "lv-bars-plot",
    "lv-bars-groups",
    "lv-bars-group",
    "lv-bar",
    "lv-bars-xaxis",
  ]) {
    expect(css, `.${cls} missing from charts.css`).toContain(`.${cls}`);
  }
  // A zero-height bar would disappear entirely; the hairline says "measured".
  expect(css.replace(/\s+/g, " ")).toContain("min-height: 2px");
});

test("the reading is revealed by hover, by focus and by tap — all three", () => {
  const flat = css.replace(/\s+/g, " ");
  expect(flat).toContain(".lv-bar:hover > .lv-tip");
  expect(flat).toContain(".lv-bar:focus > .lv-tip"); // a tap that does focus
  expect(flat).toContain(".lv-bar:focus-visible > .lv-tip"); // keyboard
  expect(flat).toContain('.lv-bar[data-tip="on"] > .lv-tip'); // a tap that does not
  // Idle chips must not swallow the pointer or be read out twice.
  expect(flat).toContain("visibility: hidden");
  expect(flat).toContain("pointer-events: none");
  // A button carries UA chrome; the bar has to stay a bar.
  expect(flat).toContain("appearance: none");
});
