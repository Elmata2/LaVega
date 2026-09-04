// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, test } from "vitest";
import { formatEuro } from "../../format.js";
import StatistiekBlock from "./StatistiekBlock";
import { own, rules, txs } from "./fixtures";

/* "Aangepast" has to be a REAL range — two dates the owner picks — not a sixth
 * preset wearing a different name. That is only observable by driving the
 * control, so this mounts the block with React's own root API and works the
 * select and the two date fields. (No testing library is installed in this
 * repo, and none is being added for one file.) */

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLDivElement | null = null;

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
});

function mount(): HTMLDivElement {
  host = document.createElement("div");
  document.body.appendChild(host);
  const el = host;
  act(() => {
    root = createRoot(el);
    root.render(<StatistiekBlock txs={txs} rules={rules} own={own} onSelectCategory={() => {}} />);
  });
  return el;
}

/** React listens for the native input/change event and reads the value off the
 *  element, so the value has to be set through the prototype's own setter. */
function setValue(
  el: HTMLInputElement | HTMLSelectElement,
  value: string,
  event: "input" | "change",
) {
  const proto =
    el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(el, value);
  act(() => {
    el.dispatchEvent(new Event(event, { bubbles: true }));
  });
}

const periodSelect = (el: HTMLElement) =>
  el.querySelector("select.module-period") as HTMLSelectElement;
const dateFields = (el: HTMLElement) =>
  [...el.querySelectorAll('input[type="date"]')] as HTMLInputElement[];

test("choosing Aangepast opens two date fields, seeded with the window that was showing", () => {
  const el = mount();
  expect(dateFields(el)).toHaveLength(0);

  setValue(periodSelect(el), "aangepast", "change");
  const [start, end] = dateFields(el);
  // The twelve-month preset that was showing, so a range gets adjusted rather
  // than typed from scratch.
  expect(start.value).toBe("2025-09-01");
  expect(end.value).toBe("2026-08-11");
  expect(el.innerHTML).toContain("1 sep 2025 – 11 aug 2026");
});

test("a hand-picked range is honoured exactly, down to the bucket it is drawn in", () => {
  const el = mount();
  setValue(periodSelect(el), "aangepast", "change");
  const [start, end] = dateFields(el);

  setValue(start, "2026-08-01", "input");
  setValue(end, "2026-08-11", "input");

  // innerHTML serialises the non-breaking space in "€ 1.350,00" as an entity;
  // put it back so the euro strings compare as the formatter writes them.
  const html = el.innerHTML.replace(/&nbsp;/g, "\u00a0");
  // The range as asked for — not the nearest preset.
  expect(html).toContain("1 aug – 11 aug 2026");
  expect(html).not.toContain("sep 2025");
  // Eleven days is charted per day, so the two August transactions sit on
  // their own dates instead of inside one month-high bar.
  expect(html).toContain(">3 aug<");
  expect(html).toContain(">11 aug<");
  // And the totals are the window's own: no income landed in August.
  expect(html).toContain("Uitgaven in deze periode");
  expect(html).toContain(formatEuro(250 + 1_100));
  expect(html).toContain(formatEuro(0)); // no income landed in that window
});

test("half a range is not a window: the block asks rather than guessing", () => {
  const el = mount();
  setValue(periodSelect(el), "aangepast", "change");
  const [start, end] = dateFields(el);

  setValue(start, "", "input");
  expect(el.innerHTML).toContain("Kies een begindatum en een einddatum.");
  expect(el.innerHTML).not.toContain("lv-bar");

  // An end before its start is refused in the same way — never silently
  // swapped, never silently ignored.
  setValue(start, "2026-08-10", "input");
  setValue(end, "2026-06-01", "input");
  expect(el.innerHTML).toContain("De einddatum ligt vóór de begindatum");
});
