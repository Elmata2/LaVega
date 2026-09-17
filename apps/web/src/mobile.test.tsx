// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { act, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, test } from "vitest";
import { resolved } from "./test-support/resolveStyle.js";
import Table, { Td } from "./components/ui/Table.js";

/* The phone layout is pure CSS reflow of the same DOM the desktop uses, so its
 * only failure mode is a silent one: a class or an attribute renamed on one
 * side of the contract and not the other. These read the real files.
 *
 * They are not a substitute for looking at a phone — the bugs fixed in this
 * pass (a 414px document inside a 390px viewport, twelve month labels
 * ellipsised to "s…") were all found in a browser at 390px and 320px.
 *
 * jsdom (for the two component-mount tests below), so every path here is
 * resolved from the package root instead of `import.meta.url` — the same
 * workaround SpendPie.test.tsx uses, and resolveStyle.ts explains why:
 * Vite's static asset-URL analysis rewrites `new URL(..., import.meta.url)`
 * under jsdom into a path `fileURLToPath` then rejects. */

const srcFile = (path: string) => resolve(process.cwd(), "src", path);
const base = readFileSync(srcFile("styles/base.css"), "utf8");
const charts = readFileSync(srcFile("styles/charts.css"), "utf8");
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
  // `<Table cards>` collapses to label/value rows below 620px (Table.tsx);
  // a table that opts in without data-label on its cells renders a column of
  // unlabelled values. The CSS moved off base.css (docs/adr/0005), so this is
  // now a check on the call sites — the same thing the original checked,
  // read from the caller's own contract with Td rather than from CSS text
  // that no longer exists once a table converts.
  for (const path of CARD_TABLE_VIEWS) {
    const src = readFileSync(srcFile(path), "utf8");
    const tables = src.match(/<Table\b[^>]*\bcards\b/g)?.length ?? 0;
    expect(tables, `${path} should opt its tables into the card layout`).toBeGreaterThan(0);
    // One data-label per body cell, so at least as many labels as tables.
    const labels = src.match(/data-label=/g)?.length ?? 0;
    expect(
      labels,
      `${path} has ${tables} card tables but ${labels} labelled cells`,
    ).toBeGreaterThanOrEqual(tables);
  }
});

/* Mount infrastructure for the two tests below, matching the pattern this repo
 * already uses (SpendPie.test.tsx, TrendChart.test.tsx): render the REAL
 * component and read the REAL className off the DOM, rather than typing out
 * what we believe it renders (docs/adr/0005 — a hand-typed list defeats
 * resolveStyle's whole point, and can pass for the wrong reason). */
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

function classesOf(el: Element): string[] {
  return el.className.split(/\s+/).filter(Boolean);
}

test("a card cell's border only disappears below 620px, not everywhere", () => {
  // The property `.table-cards td { border-bottom: none }` used to override,
  // read straight off a REAL <Td> in <Table cards> — resolveStyle refuses
  // descendant selectors (`.table-cards td`), which is most of this cluster
  // (docs/adr/0005), but this ONE declaration is a flat class directly on the
  // cell (TD_CARDS in Table.tsx), so it is exactly the part this tool can see.
  const el = mount(
    <Table cards>
      <tbody>
        <tr>
          <Td data-label="Bank">ING</Td>
        </tr>
      </tbody>
    </Table>,
  );
  const td = el.querySelector("td")!;
  const classes = classesOf(td);
  expect(resolved(classes, "border-bottom-width")).toBe("1px"); // desktop: bordered
  expect(resolved(classes, "border-bottom-width", 620)).toBe("0"); // phone: not
});

test("a non-card table's <td> never carries the card-mode classes", () => {
  // <Table> (no `cards`) is Regels.tsx's shape — TableCardsContext defaults to
  // false, so its <Td> must not emit the flex/label layout at any width. A
  // component that leaked the card classes unconditionally would still pass
  // every other test in this file, since none of them render a plain table.
  const el = mount(
    <Table>
      <tbody>
        <tr>
          <Td>plain</Td>
        </tr>
      </tbody>
    </Table>,
  );
  const td = el.querySelector("td")!;
  expect(classesOf(td).some((c) => c.includes("before:content-"))).toBe(false);
});

test("Table.tsx scopes its card layout to the 620px boundary form that includes it", () => {
  // `max-[620px]:` compiles to `not (min-width:620px)`, which EXCLUDES exactly
  // 620px where the original `@media (max-width:620px)` included it (trap 5,
  // docs/adr/0005) — resolveStyle cannot see any of the descendant rules this
  // guards (`.table-cards table/thead/tbody/tr`), so this is a static check on
  // the one string that must never regress to the wrong form. The boundary
  // itself is verified in a browser (report).
  // Comments legitimately name the wrong form to explain why it is wrong
  // (see Table.tsx itself); strip them so only real class strings count.
  const src = readFileSync(srcFile("components/ui/Table.tsx"), "utf8").replace(
    /\/\*[\s\S]*?\*\//g,
    "",
  );
  expect(src).toContain("[@media(max-width:620px)]:");
  expect(src).not.toMatch(/max-\[620px\]:/);
});

test("the card-table treatment is scoped to phone width, not applied everywhere", () => {
  // Desktop keeps its columns; only below 620px does a row become a card. The
  // card-collapse rules themselves moved to Table.tsx (docs/adr/0005), so
  // base.css should carry none of that selector any more — comments that
  // document the move are not a regression, so they are stripped first.
  const block = base.slice(base.indexOf("@media (max-width: 620px)"));
  expect(block).toContain(".kpi-row");
  expect(base.replace(/\/\*[\s\S]*?\*\//g, "")).not.toContain(".table-cards");
});

test("grid tracks that hold money use minmax(0,...) so a long amount cannot widen the page", () => {
  // The bug: a .kpi tile's min-content (a euro amount at 2.3rem) was wider than
  // its 1fr track, giving a 414px document in a 390px viewport.
  expect(resolved(["kpi-row"], "grid-template-columns", 900)).toBe("repeat(2,minmax(0,1fr))");
  expect(resolved(["kpi"], "min-width", 900)).toBe("0");
});

test("the pinned phone app bar leaves room for anything scrolled under it", () => {
  expect(resolved(["appbar"], "position", 900)).toBe("sticky");
  expect(resolved(["module"], "scroll-margin-top", 900)).toBe("7rem");
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
    const src = readFileSync(srcFile(path), "utf8");
    expect(src, `${path} must not render <text> inside its SVG`).not.toContain("<text");
  }
});
