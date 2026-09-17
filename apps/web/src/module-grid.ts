/* The homescreen layout language, as pure string helpers.
 *
 * A module declares what it needs — a column span and a height — and the grid
 * places it. That is the whole contract: adding a block later is one
 * `<Module span={2}>` line, not a layout rewrite (the reason Alexander asked
 * for modular blocks: they are the basis for the customised CFO agents).
 *
 * The class names produced here are the *only* coupling between the React
 * primitives and styles/modules.css, so both sides are pinned by tests: this
 * file for the span → class mapping, module-grid.test.ts for the CSS rules the
 * classes resolve to at each breakpoint.
 *
 * SPAN_CLASS / HEIGHT_CLASS are Tailwind utilities, not hand-written hooks —
 * the placement and sizing rules that used to live in styles/modules.css as
 * `.module-span-N` / `.module-SHORT|TALL` now live here as class strings.
 * `.module-grid` itself (display, the 3→2→1 column template, gap) is left
 * hand-written on purpose: MODULE_GRID_CLASS is asserted as a single class by
 * resolveStyle.test.ts (shared test infrastructure this share does not own),
 * so its identity — one class name backing display/grid-template-columns — is
 * pinned regardless of which side of the migration it sits on.
 *
 * The breakpoints below are desktop-first `max-width`, same as the rest of
 * this app. Tailwind's own `max-*:` variant is NOT the same condition — it
 * compiles to `not (min-width: …)`, which excludes the boundary pixel where a
 * hand-written `max-width` query includes it. The arbitrary at-rule form
 * `[@media(max-width:…)]:` is used instead because it compiles byte-identical
 * to the original condition, verified against the built stylesheet. */

/** Columns the grid shows on a wide desktop. Narrower widths collapse to 2 then 1. */
export const MODULE_COLUMNS = 3;

/** How many of the grid's columns a module occupies. */
export type ModuleSpan = 1 | 2 | 3;

/** Short = a figure or a short list. Tall = a chart or a long list. */
export type ModuleHeight = "short" | "tall";

export const MODULE_GRID_CLASS = "module-grid";

/** `grid-column`, by span. 2 clamps to the full row once the grid is down to
 *  two columns (≤1200px) — restated at ≤900px too, redundant in a real
 *  browser (≤900 already implies ≤1200) but needed so resolved()'s per-width
 *  lookup, which does not accumulate wider max-width blocks, finds it there.
 *  1 only clamps once the grid is down to one column (≤900px). 3 is always
 *  the full row, so it carries no breakpoint variant. */
const SPAN_CLASS: Record<ModuleSpan, string> = {
  1: "[grid-column:span_1] [@media(max-width:900px)]:col-span-full",
  2: "[grid-column:span_2] [@media(max-width:1200px)]:col-span-full [@media(max-width:900px)]:col-span-full",
  3: "col-span-full",
};

/** `min-height`. A tall module only reserves the extra height on a screen wide
 *  enough to show it beside another column; stacked single-column (≤900px) it
 *  collapses to the short height, same as the hand-written rule did. */
const HEIGHT_CLASS: Record<ModuleHeight, string> = {
  short: "min-h-[var(--module-h-short)]",
  tall: "min-h-[var(--module-h-tall)] [@media(max-width:900px)]:min-h-[var(--module-h-short)]",
};

export type ModuleLayout = {
  span?: ModuleSpan;
  height?: ModuleHeight;
  className?: string;
};

/** `{ span: 2, height: "tall" }` → "module <span utilities> <height utilities>". */
export function moduleClass({ span = 1, height = "short", className }: ModuleLayout = {}): string {
  const parts = ["module", SPAN_CLASS[span], HEIGHT_CLASS[height]];
  if (className) parts.push(className);
  return parts.join(" ");
}
