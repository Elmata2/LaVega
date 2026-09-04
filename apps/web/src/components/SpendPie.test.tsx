// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { act, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, expect, test } from "vitest";
import SpendPie, { sliceAtPoint } from "./SpendPie";

/* Item 12 for the pie: every slice's exact euro has to be readable by hover, by
 * tap and by keyboard, and the ring itself has to answer when you point at it —
 * a legend row and an arc of the same colour should not be two different
 * conversations.
 *
 * jsdom, because half of this is interaction; the stylesheet is read from the
 * package root because import.meta.url resolves against the jsdom document. */

const css = readFileSync(resolve(process.cwd(), "src/styles/charts.css"), "utf8");

const slices = [
  { category: "Boodschappen", cents: 45_000, share: 0.5 },
  { category: "Transport", cents: 27_000, share: 0.3 },
  { category: "Kleding", cents: 18_000, share: 0.2 },
];
const TOTAL = 90_000;
const euro = (c: number) => `€${Math.round(c / 100)}`;

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

/** The ring is sized in CSS pixels, which jsdom does not lay out, so the box is
 *  stated here — the geometry under test is the angle, not the layout. */
function box(el: HTMLElement, size = 168) {
  el.getBoundingClientRect = () =>
    ({
      left: 0,
      top: 0,
      right: size,
      bottom: size,
      width: size,
      height: size,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    }) as DOMRect;
}

function point(el: HTMLElement, type: string, clientX: number, clientY: number) {
  act(() => {
    el.dispatchEvent(new MouseEvent(type, { bubbles: true, clientX, clientY }));
  });
}

test("the hole holds the period's total until a slice is asked about", () => {
  const html = renderToStaticMarkup(<SpendPie slices={slices} totalCents={TOTAL} euro={euro} />);
  expect(html).toContain("€900");
  expect(html).toContain("uitgaven");
});

test("every slice is a control, so its exact amount is reachable without a mouse", () => {
  const html = renderToStaticMarkup(<SpendPie slices={slices} totalCents={TOTAL} euro={euro} />);
  // Three slices, three buttons: a row that was a <span> could not be tabbed
  // to, so the ring's colours were mouse-only knowledge.
  expect(html.match(/<button /g)?.length).toBe(3);
  expect(html).toContain("Boodschappen");
  expect(html).toContain("€450");
  expect(html).toContain("50%");
});

test("only a real category can be filtered to, and 'Overig' still cannot", () => {
  const many = Array.from({ length: 10 }, (_, i) => ({
    category: `C${i}`,
    cents: 1000 * (10 - i),
    share: (10 - i) / 55,
  }));
  const html = renderToStaticMarkup(
    <SpendPie slices={many} totalCents={55_000} euro={euro} maxSlices={8} onSelect={() => {}} />,
  );
  // Eight named slices filter; the ninth is several categories folded together,
  // so there is nothing to filter to — it highlights and nothing more.
  expect(html.match(/data-filter="yes"/g)?.length).toBe(8);
  expect(html).toContain("Overig");
  expect(html.match(/<button /g)?.length).toBe(9);
});

test("asking about a slice puts THAT slice's number in the hole, with its share", () => {
  const el = mount(<SpendPie slices={slices} totalCents={TOTAL} euro={euro} />);
  const rows = [...el.querySelectorAll<HTMLButtonElement>("button.spend-pie-item")];
  const hole = el.querySelector<HTMLElement>(".spend-pie-hole");
  expect(hole?.textContent).toContain("€900");

  // Keyboard: tabbing onto a row is enough — no click required.
  act(() => rows[1].focus());
  expect(hole?.textContent).toContain("Transport");
  expect(hole?.textContent).toContain("€270");
  expect(hole?.textContent).toContain("30%");
  // And the number is labelled as a share of the period's total, not left as a
  // bare euro amount sitting where the total normally is.
  expect(hole?.textContent).toContain("van totaal");

  act(() => rows[1].blur());
  expect(hole?.textContent).toContain("€900");
});

test("the arc answers where it is pointed, and the rest of the ring steps back", () => {
  const el = mount(<SpendPie slices={slices} totalCents={TOTAL} euro={euro} />);
  const ring = el.querySelector<HTMLElement>(".spend-pie-ring");
  const hole = el.querySelector<HTMLElement>(".spend-pie-hole");
  box(ring!);

  // Three o'clock is 90°, inside the first (0–180°) slice.
  point(ring!, "pointermove", 150, 84);
  expect(hole?.textContent).toContain("Boodschappen");
  expect(hole?.textContent).toContain("€450");
  // The slice being read is the only one at full strength; dimming the others is
  // what connects the number in the hole to one arc rather than to the ring.
  // (jsdom normalises the hex stops to rgb()/rgba(); the alpha is the dimming.)
  expect(ring?.style.background).toContain("rgb(76, 110, 245) 0% 50%");
  expect(ring?.style.background).toContain("rgba(121, 80, 242, 0.2)");
  expect(ring?.getAttribute("data-active")).toBe("0");

  // Six o'clock is 180°, the second slice (180–288°).
  point(ring!, "pointermove", 84, 150);
  expect(hole?.textContent).toContain("Transport");

  // The middle of the ring is the hole, where the total lives — pointing at the
  // total must not be read as pointing at whichever arc is behind it.
  point(ring!, "pointermove", 84, 84);
  expect(hole?.textContent).toContain("€900");

  point(ring!, "pointerleave", 0, 0);
  expect(hole?.textContent).toContain("€900");
});

test("a tap on a filterable row still filters; a tap on 'Overig' does nothing", () => {
  const picked: string[] = [];
  const many = Array.from({ length: 10 }, (_, i) => ({
    category: `C${i}`,
    cents: 1000 * (10 - i),
    share: (10 - i) / 55,
  }));
  const el = mount(
    <SpendPie
      slices={many}
      totalCents={55_000}
      euro={euro}
      maxSlices={8}
      onSelect={(c) => picked.push(c)}
    />,
  );
  const rows = [...el.querySelectorAll<HTMLButtonElement>("button.spend-pie-item")];
  act(() => rows[0].click());
  act(() => rows[8].click()); // Overig
  expect(picked).toEqual(["C0"]);
});

test("sliceAtPoint reads the angle the way the ring is drawn: clockwise from twelve", () => {
  const shares = [0.5, 0.25, 0.25];
  expect(sliceAtPoint(shares, 0.9, 0.5)).toBe(0); // 3 o'clock = 90°
  expect(sliceAtPoint(shares, 0.5, 0.95)).toBe(1); // 6 o'clock = 180°
  expect(sliceAtPoint(shares, 0.1, 0.5)).toBe(2); // 9 o'clock = 270°
  expect(sliceAtPoint(shares, 0.5, 0.05)).toBe(0); // 12 o'clock = 0°
  // The hole and the corners outside the circle belong to no slice. Naming one
  // there would be a number the pointer never asked for.
  expect(sliceAtPoint(shares, 0.5, 0.5)).toBeNull();
  expect(sliceAtPoint(shares, 0.02, 0.02)).toBeNull();
  expect(sliceAtPoint([], 0.9, 0.5)).toBeNull();
  // Shares that do not quite sum to 1 (rounded upstream) still map the tail to
  // the last slice, because that is what the gradient draws there.
  expect(sliceAtPoint([0.5, 0.49], 0.1, 0.5)).toBe(1);
});

test("charts.css dresses the state the reading depends on", () => {
  const flat = css.replace(/\s+/g, " ");
  expect(flat).toContain(".spend-pie-item:focus-visible");
  expect(flat).toContain('.spend-pie-item[data-active="on"]');
  // A row that filters points; a row that only highlights must not pretend to.
  expect(flat).toContain('.spend-pie-item[data-filter="yes"] { cursor: pointer; }');
  expect(flat).toContain(".spend-pie-hole");
});

/* Item 5: the number in the middle was centred while a slice was being read and
 * sitting high in the total view. The cause was the grid, not the state — with
 * `align-content` left at its default the auto rows stretch, so two rows put the
 * amount in the top half and three rows put it in the middle by accident. Packing
 * the rows centres the group at any number of lines. */
test("the hole centres its contents whether it holds two lines or three", () => {
  const flat = css.replace(/\s+/g, " ");
  const hole = flat.match(/\.spend-pie-hole \{[^}]*\}/)?.[0] ?? "";
  expect(hole).toContain("align-content: center");
});

/* Item 6: an arc opens its category, so it has to point — and only where a click
 * actually goes somewhere. */
test("the ring points only where an arc can be opened", () => {
  const flat = css.replace(/\s+/g, " ");
  expect(flat).toContain('.spend-pie-ring[data-open="yes"] { cursor: pointer; }');
});

/* Item 8: "V…" names nothing. The row being read un-clips its name, and it is
 * reachable by hover, by tap (data-active) and by keyboard (focus-visible) — a
 * `title` alone would have answered only the mouse. */
test("a clipped legend name un-clips while it is being read, by any of the three ways", () => {
  const flat = css.replace(/\s+/g, " ");
  for (const selector of [
    ".spend-pie-item:hover .spend-pie-name",
    ".spend-pie-item:focus-visible .spend-pie-name",
    '.spend-pie-item[data-active="on"] .spend-pie-name',
  ]) {
    expect(flat).toContain(selector);
  }
  const revealed = flat.match(/\.spend-pie-item:hover \.spend-pie-name,[^{]*\{[^}]*\}/)?.[0] ?? "";
  expect(revealed).toContain("white-space: normal");
  // And the name in the hole wraps rather than ellipsising into nothing.
  const slice = flat.match(/\.spend-pie-slice \{[^}]*\}/)?.[0] ?? "";
  expect(slice).not.toContain("text-overflow: ellipsis");
});

/* Item 8 for the bar charts: the axis cell keeps its slot (the row stays aligned
 * with the bars), and the full name — which the cell already carries in `title` —
 * grows out of it to the right on hover, the way he suggested. */
test("a clipped axis label reveals its full name to the right", () => {
  const flat = css.replace(/\s+/g, " ");
  const chip = flat.match(/\.lv-bars-xaxis span\[title\]::after \{[^}]*\}/)?.[0] ?? "";
  expect(chip).toContain("content: attr(title)");
  expect(chip).toContain("left: 0");
  expect(flat).toContain(".lv-bars-xaxis span:hover[title]::after");
  // The rightmost label grows the other way, so it does not hang off the card.
  expect(flat).toContain(".lv-bars-xaxis span:last-child[title]::after");
  // And nothing pops up over the weekday axis, whose labels are never clipped:
  // a chip repeating "vr" would be noise on a chart he called fine.
  expect(flat).toContain(".weekday-bars .lv-bars-xaxis span[title]::after { content: none; }");
});
