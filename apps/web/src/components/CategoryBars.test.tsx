import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";
import CategoryBars from "./CategoryBars";

const css = readFileSync(new URL("../styles/charts.css", import.meta.url), "utf8");

const series = [
  { label: "Vorige periode", color: "var(--muted)" },
  { label: "Deze periode", color: "var(--accent)" },
];

const groups = [
  { label: "Boodschappen", values: [400, 500] },
  { label: "Transport", values: [200, 100] },
];

const format = (v: number) => `€${v}`;

test("CategoryBars draws one bar per series per group, legend and labels included", () => {
  const html = renderToStaticMarkup(
    <CategoryBars groups={groups} series={series} format={format} ariaLabel="Uitgaven per categorie" />,
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

test("CategoryBars puts the exact amount in each bar's tooltip and the full name in the label's", () => {
  const html = renderToStaticMarkup(
    <CategoryBars
      groups={[{ label: "Kleding…", title: "Kleding & winkelen", values: [10, 20] }]}
      series={series}
      format={format}
      ariaLabel="A"
    />,
  );
  expect(html).toContain('title="Kleding &amp; winkelen · Deze periode: €20"');
  expect(html).toContain('title="Kleding &amp; winkelen"');
});

test("CategoryBars shows the value axis only when asked", () => {
  const off = renderToStaticMarkup(<CategoryBars groups={groups} series={series} format={format} ariaLabel="A" />);
  expect(off).not.toContain("lv-chart-tick");
  expect(off).not.toContain("lv-chart-withaxis");

  const on = renderToStaticMarkup(
    <CategoryBars groups={groups} series={series} format={format} ariaLabel="A" showAxis />,
  );
  expect(on).toContain("lv-chart-withaxis");
  expect(on).toContain('class="lv-chart-tick"');
});

test("CategoryBars renders nothing rather than an empty plot with no groups", () => {
  expect(renderToStaticMarkup(<CategoryBars groups={[]} series={series} format={format} ariaLabel="A" />)).toBe("");
});

test("every class CategoryBars emits has a rule in charts.css", () => {
  for (const cls of ["lv-bars", "lv-bars-plot", "lv-bars-groups", "lv-bars-group", "lv-bar", "lv-bars-xaxis"]) {
    expect(css, `.${cls} missing from charts.css`).toContain(`.${cls}`);
  }
  // A zero-height bar would disappear entirely; the hairline says "measured".
  expect(css.replace(/\s+/g, " ")).toContain("min-height: 2px");
});
