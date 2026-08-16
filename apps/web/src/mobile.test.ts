import { readFileSync } from "node:fs";
import { expect, test } from "vitest";

/* The phone layout is pure CSS reflow of the same DOM the desktop uses, so its
 * only failure mode is a silent one: a class or an attribute renamed on one
 * side of the contract and not the other. These read the real files.
 *
 * They are not a substitute for looking at a phone — the bugs fixed in this
 * pass (a 414px document inside a 390px viewport, twelve month labels
 * ellipsised to "s…") were all found in a browser at 390px and 320px. */

const base = readFileSync(new URL("./styles/base.css", import.meta.url), "utf8");
const charts = readFileSync(new URL("./styles/charts.css", import.meta.url), "utf8");
const flat = (s: string) => s.replace(/\s+/g, " ");

/* Belasting is deliberately NOT in this list any more: since the UI review it
 * renders one module per tax with a stacked per-entity block instead of a
 * table, so there is no card-table contract left to check there. Any view that
 * DOES opt a table into the card layout still has to label its cells. */
const CARD_TABLE_VIEWS = [
  "./views/Transacties.tsx",
  "./views/Rekeningen.tsx",
  "./views/Optimalisatie.tsx",
];

test("every table that becomes cards on a phone labels its cells", () => {
  // .table-cards td::before prints attr(data-label); a table that opts in
  // without the attributes renders a column of unlabelled values.
  expect(flat(base)).toContain("content: attr(data-label)");

  for (const path of CARD_TABLE_VIEWS) {
    const src = readFileSync(new URL(path, import.meta.url), "utf8");
    const tables = src.match(/table-cards/g)?.length ?? 0;
    expect(tables, `${path} should opt its tables into the card layout`).toBeGreaterThan(0);
    // One data-label per body cell, so at least as many labels as tables.
    const labels = src.match(/data-label=/g)?.length ?? 0;
    expect(labels, `${path} has ${tables} card tables but ${labels} labelled cells`).toBeGreaterThanOrEqual(tables);
  }
});

test("the card-table treatment is scoped to phone width, not applied everywhere", () => {
  // Desktop keeps its columns; only below 620px does a row become a card.
  const block = base.slice(base.indexOf("@media (max-width: 620px)"));
  expect(block).toContain(".table-cards td");
  expect(base.indexOf(".table-cards td")).toBeGreaterThan(base.indexOf("@media (max-width: 620px)"));
});

test("grid tracks that hold money use minmax(0,...) so a long amount cannot widen the page", () => {
  // The bug: a .kpi tile's min-content (a euro amount at 2.3rem) was wider than
  // its 1fr track, giving a 414px document in a 390px viewport.
  expect(flat(base)).toContain("grid-template-columns: repeat(2, minmax(0, 1fr))");
  expect(flat(base)).toContain(".kpi { min-width: 0;");
});

test("the pinned phone app bar leaves room for anything scrolled under it", () => {
  const phone = base.slice(base.indexOf("@media (max-width: 900px)"));
  expect(flat(phone)).toContain("position: sticky");
  expect(flat(phone)).toContain("scroll-margin-top");
});

test("a crowded bar axis thins its labels instead of ellipsising every one", () => {
  const rule = flat(charts);
  expect(rule).toContain(".lv-bars-many span:nth-child(even) { visibility: hidden; }");
  // visibility:hidden alone keeps the cell's width, so the surviving labels
  // gain nothing — they must also be allowed to overflow into the blank.
  expect(rule).toContain(".lv-bars-many span { overflow: visible; text-overflow: clip; }");
});

test("no chart puts text inside an SVG, at any viewport", () => {
  // SVG text scales with the drawing; at one column that took an 11px label to
  // about 6px. Every label in every chart component is HTML.
  for (const path of ["./components/TrendChart.tsx", "./components/CategoryBars.tsx"]) {
    const src = readFileSync(new URL(path, import.meta.url), "utf8");
    expect(src, `${path} must not render <text> inside its SVG`).not.toContain("<text");
  }
});
