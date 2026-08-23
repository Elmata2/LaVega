// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, test } from "vitest";
import type { Tx } from "@lavega/core";
import { formatEuro } from "../../format.js";
import StatistiekBlock from "./StatistiekBlock";
import { own } from "./fixtures";

/* Item 1, and it is one number wrong twice over.
 *
 *   "The donut is now visible nicely and I can click on it, but the numbers are
 *    wrong because it says I had 2 million in investing and saving, which I
 *    would love to have."
 *
 * Measured on these rows before anything changed: € 20.000 of deposits into his
 * own broker and savings accounts (a) counted as spending, and (b) were printed
 * by a formatter that takes EUROS while the ring hands it CENTS — so € 20.000
 * appeared as € 2.000.000. The literal two million. Both are asserted here,
 * because fixing either one alone still leaves the figure wrong.
 *
 * Also: items 5–8 live in this view, so the click-through out of a slice is
 * tested here too.
 *
 * jsdom and React's own root API — the view switch has to be worked to see the
 * ring at all, and no testing library is installed in this repo. */

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const tx = (id: string, date: string, amount: number, counterparty: string, description = ""): Tx => ({
  id, accountKey: "A1", date, amount, currency: "EUR", counterparty, description, category: "", manual: false,
});

/** A realistic August: income, two real expenses, one transfer to an account the
 *  app knows (A2's IBAN → "Eigen overboeking") and two deposits into accounts it
 *  does not know, because they were never imported. */
const txs: Tx[] = [
  tx("v1", "2026-08-01", 6_000, "Klant BV", "Managementfee"),
  tx("v2", "2026-08-03", -85.4, "Albert Heijn", "Boodschappen"),
  tx("v3", "2026-08-05", -250, "Vattenfall", "Energie augustus"),
  tx("v4", "2026-08-06", -15_000, "Trading 212", "Storting"),
  tx("v5", "2026-08-07", -5_000, "Spaarrekening", "Naar spaarrekening"),
  tx("v6", "2026-08-08", -1_000, "NL02RABO0001", "Naar Café BV"),
];

let root: Root | null = null;
let host: HTMLDivElement | null = null;
const picked: string[] = [];

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
  picked.length = 0;
});

function mount(rows: Tx[] = txs): HTMLDivElement {
  host = document.createElement("div");
  document.body.appendChild(host);
  const el = host;
  act(() => {
    root = createRoot(el);
    root.render(
      <StatistiekBlock txs={rows} rules={[]} own={own} onSelectCategory={(c) => picked.push(c)} />,
    );
  });
  return el;
}

function tab(el: HTMLElement, label: string) {
  const button = [...el.querySelectorAll<HTMLButtonElement>("button.module-tab")].find(
    (b) => b.textContent === label,
  );
  if (!button) throw new Error(`no ${label} tab`);
  act(() => button.click());
}

/** The ring is sized in CSS pixels, which jsdom does not lay out, so the box is
 *  stated — what is under test is the angle, not the layout. */
function box(el: HTMLElement, size = 168) {
  el.getBoundingClientRect = () =>
    ({ left: 0, top: 0, right: size, bottom: size, width: size, height: size, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;
}

test("the ring prints euros, not cents read as euros", () => {
  const el = mount();
  tab(el, "Verdeling");

  // € 85,40 + € 250 of real spending. NOT € 33.540 (cents read as euros) and
  // certainly not the € 2.033.540 he saw.
  const hole = el.querySelector(".spend-pie-hole")!;
  expect(hole.textContent).toContain(formatEuro(335.4));
  expect(hole.textContent).not.toContain(formatEuro(33_540));

  const values = [...el.querySelectorAll(".spend-pie-value")].map((n) => n.textContent);
  expect(values).toEqual([formatEuro(250), formatEuro(85.4)]);
});

test("a deposit into his own savings is outside the ring, and the ring says so", () => {
  const el = mount();
  tab(el, "Verdeling");

  const names = [...el.querySelectorAll(".spend-pie-name")].map((n) => n.textContent);
  expect(names).toEqual(["Wonen & energie", "Boodschappen"]);
  expect(names).not.toContain("Sparen & beleggen");

  // Visibly excluded, not quietly dropped: the amount, the category and the
  // reason are all on screen.
  const note = el.querySelector(".stat-moved")!;
  expect(note.textContent).toContain("Sparen & beleggen");
  expect(note.textContent).toContain(formatEuro(20_000));
  expect(note.textContent).toContain("spaar");
  expect(note.textContent).toContain("Eigen overboeking");
  expect(note.textContent).toContain(formatEuro(1_000));
});

test("the period's own totals leave the same money out, and say so once", () => {
  const el = mount();
  const figures = el.querySelector(".stat-figures")!;
  // € 85,40 + € 250, not € 20.335.
  expect(figures.textContent).toContain(formatEuro(335.4));
  expect(figures.textContent).toContain(formatEuro(6_000));
  // The note is one line for the whole block, in every view.
  expect(el.querySelectorAll(".stat-moved")).toHaveLength(1);
});

test("clicking a slice opens that category — from the legend and from the arc", () => {
  const el = mount();
  tab(el, "Verdeling");

  const rows = [...el.querySelectorAll<HTMLButtonElement>("button.spend-pie-item")];
  act(() => rows[1].click());
  expect(picked).toEqual(["Boodschappen"]);

  // And the ring itself: the first arc starts at twelve o'clock, so a point just
  // right of the top edge is inside it.
  const ring = el.querySelector<HTMLElement>(".spend-pie-ring")!;
  box(ring);
  act(() => {
    ring.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, clientX: 100, clientY: 20 }));
    ring.dispatchEvent(new MouseEvent("click", { bubbles: true, clientX: 100, clientY: 20 }));
  });
  expect(picked).toEqual(["Boodschappen", "Wonen & energie"]);
});

test("the hole is a picture, not a link: clicking the middle jumps nowhere", () => {
  const el = mount();
  tab(el, "Verdeling");
  const ring = el.querySelector<HTMLElement>(".spend-pie-ring")!;
  box(ring);
  act(() => {
    ring.dispatchEvent(new MouseEvent("click", { bubbles: true, clientX: 84, clientY: 84 }));
  });
  expect(picked).toEqual([]);
});

test("the grown-most sentence is in euros too", () => {
  const el = mount();
  tab(el, "Gegroeid");
  const insight = el.querySelector(".stat-insight")!;
  // Energy is the biggest riser at € 250 — against a preceding window with
  // nothing in it, so "nieuw" rather than a percentage.
  expect(insight.textContent).toContain("Wonen & energie");
  expect(insight.textContent).toContain(formatEuro(250));
  expect(insight.textContent).toContain("nieuw");
  expect(insight.textContent).not.toContain(formatEuro(25_000));
});
