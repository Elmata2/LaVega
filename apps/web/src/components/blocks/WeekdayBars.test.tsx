import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";
import WeekdayBars from "./WeekdayBars";

const euro = (v: number) => `€${Math.round(v)}`;

const week = [
  { label: "ma", value: 20 },
  { label: "di", value: 35 },
  { label: "wo", value: 15 },
  { label: "do", value: 40 },
  { label: "vr", value: 120 },
  { label: "za", value: 60 },
  { label: "zo", value: 10 },
];

test("WeekdayBars draws a bar per day plus the trend line from the reference", () => {
  const html = renderToStaticMarkup(
    <WeekdayBars days={week} format={euro} ariaLabel="Gemiddelde uitgaven per weekdag" peakIndex={4} />,
  );
  expect(html.match(/weekday-bar/g)?.length).toBeGreaterThanOrEqual(7);
  expect(html).toContain(">vr<");
  // The trend line across the week is one dashed path over the same box.
  expect(html).toContain("stroke-dasharray");
  expect(html).toContain("lv-chart-svg");
  // The peak carries the reference's value chip and is marked on the axis.
  expect(html).toContain("weekday-peak-chip");
  expect(html).toContain("weekday-bar-peak");
  expect(html).toContain("weekday-label-peak");
  expect(html).toContain("€120");
});

test("WeekdayBars draws no bar for a day it has no measurement for", () => {
  const partial = [
    { label: "ma", value: null },
    { label: "di", value: null },
    { label: "wo", value: null },
    { label: "do", value: null },
    { label: "vr", value: 20 },
    { label: "za", value: 30 },
    { label: "zo", value: null },
  ];
  const html = renderToStaticMarkup(
    <WeekdayBars days={partial} format={euro} ariaLabel="Gemiddelde uitgaven per weekdag" peakIndex={5} />,
  );
  // Two measured days -> two bars. A zero-height bar for the other five would
  // say "that day is free"; they are simply not drawn.
  expect(html.match(/class="lv-bar weekday-bar/g)?.length).toBe(2);
  // Every label still has its slot, so the axis stays aligned with the bars.
  for (const d of partial) expect(html).toContain(`>${d.label}<`);
  expect(html.match(/class="lv-bars-group"/g)?.length).toBe(7);
});

test("WeekdayBars omits the trend line when a single day is all there is", () => {
  const one = [
    { label: "ma", value: null },
    { label: "di", value: 12 },
    { label: "wo", value: null },
  ];
  const html = renderToStaticMarkup(<WeekdayBars days={one} format={euro} ariaLabel="Uitgaven" />);
  expect(html).not.toContain("lv-chart-svg");
  expect(html).not.toContain("weekday-peak-chip");
});

/* --- The "normal day" baseline (B6). Not a trend: a slope across Mon…Sun only
 * says where the week was cut. A horizontal line at a MEASURED average is the
 * comparison the block's own sentence already makes out loud. --- */

test("the average reference line is drawn at the measured value, once", () => {
  const html = renderToStaticMarkup(
    <WeekdayBars days={week} format={euro} ariaLabel="Uitgaven" peakIndex={4} averageValue={42.857} />,
  );
  expect(html.match(/weekday-average"/g)?.length).toBe(1);
  expect(html).toContain("gemiddelde dag €43");
  // Positioned against the same nice domain the bars use (max 120 -> 150).
  expect(html).toContain("top:71.43%");
});

test("no average was measured means no line — never a baseline at zero", () => {
  const none = renderToStaticMarkup(<WeekdayBars days={week} format={euro} ariaLabel="Uitgaven" />);
  expect(none).not.toContain("weekday-average");

  const nulled = renderToStaticMarkup(
    <WeekdayBars days={week} format={euro} ariaLabel="Uitgaven" averageValue={null} />,
  );
  expect(nulled).not.toContain("weekday-average");

  const zero = renderToStaticMarkup(
    <WeekdayBars days={week} format={euro} ariaLabel="Uitgaven" averageValue={0} />,
  );
  expect(zero).not.toContain("weekday-average");
});

test("too few measured days to compare against, so no baseline is drawn", () => {
  const two = [
    { label: "ma", value: 20 },
    { label: "di", value: null },
    { label: "wo", value: 40 },
  ];
  const html = renderToStaticMarkup(
    <WeekdayBars days={two} format={euro} ariaLabel="Uitgaven" averageValue={30} />,
  );
  // The bars are still drawn; only the comparison that two points cannot carry
  // is withheld.
  expect(html.match(/class="lv-bar weekday-bar/g)?.length).toBe(2);
  expect(html).not.toContain("weekday-average");
});
