// @vitest-environment jsdom
import { act, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, expect, test } from "vitest";
import WeekdayBars from "./WeekdayBars";

/* Item 12, for the weekday chart. He asked for the chart itself to be left
 * alone ("weekdays and the growth chart are fine as they are") and only for the
 * reading to be added, so this file tests exactly that: every measured bar can
 * be read by hover, by tap and by keyboard, and a day with no measurement still
 * shows no number at all.
 *
 * A separate file from WeekdayBars.test.tsx because the reading is an
 * interaction: this one mounts the component for real (React's own root API —
 * no testing library is installed in this repo). */

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

test("each weekday bar carries its own number, named with the day it belongs to", () => {
  const html = renderToStaticMarkup(
    <WeekdayBars days={week} format={euro} ariaLabel="Gemiddelde uitgaven per weekdag" peakIndex={4} />,
  );
  // Seven measured days, seven buttons — not seven divs with a title only a
  // desktop mouse can reach.
  expect(html.match(/<button /g)?.length).toBe(7);
  expect(html.match(/class="lv-tip-value"/g)?.length).toBe(7);
  expect(html).toContain('<span class="lv-tip-when">vr</span>');
  expect(html).toContain('<span class="lv-tip-value">€120</span>');
  expect(html).toContain('aria-label="vr: €120"');
  // The peak bar fills the plot, so its chip has to read inside the bar rather
  // than on top of the peak chip that already sits above it.
  expect(html).toContain('class="lv-tip lv-tip-inside"');
});

test("a day that was never measured gets no bar and therefore no number", () => {
  const partial = [
    { label: "ma", value: null },
    { label: "di", value: 20 },
    { label: "wo", value: null },
  ];
  const html = renderToStaticMarkup(<WeekdayBars days={partial} format={euro} ariaLabel="Uitgaven" />);
  // Unknown is not zero: the untouched days have no chip to hover, because
  // there is no number to show. Inventing "€0" would say "that day is free".
  expect(html.match(/<button /g)?.length).toBe(1);
  expect(html.match(/class="lv-tip-value"/g)?.length).toBe(1);
  expect(html).toContain('aria-label="di: €20"');
});

test("a tap opens a weekday's number and a second tap closes it", () => {
  const el = mount(<WeekdayBars days={week} format={euro} ariaLabel="Uitgaven" peakIndex={4} />);
  const bars = [...el.querySelectorAll<HTMLButtonElement>("button.lv-bar")];
  expect(bars).toHaveLength(7);

  act(() => bars[2].click());
  expect(bars[2].dataset.tip).toBe("on");
  act(() => bars[2].click());
  expect(bars[2].dataset.tip).toBe("off");

  act(() => bars[2].click());
  act(() => bars[5].click());
  expect(bars[2].dataset.tip).toBe("off");
  expect(bars[5].dataset.tip).toBe("on");
});

test("the plot is a group, not an image — an image would hide every bar again", () => {
  const html = renderToStaticMarkup(<WeekdayBars days={week} format={euro} ariaLabel="Uitgaven" />);
  // role="img" makes descendants presentational, which would have taken the
  // seven buttons straight back out of the screen reader's reach.
  expect(html).toContain('role="group"');
  expect(html).not.toContain('role="img"');
  expect(html).toContain('aria-label="Uitgaven"');
});
