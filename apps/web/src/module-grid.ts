/* The homescreen layout language, as pure string helpers.
 *
 * A module declares what it needs — a column span and a height — and the grid
 * places it. That is the whole contract: adding a block later is one
 * `<Module span={2}>` line, not a layout rewrite (the reason Alexander asked
 * for modular blocks: they are the basis for the customised CFO agents).
 *
 * The class names produced here are the *only* coupling between the React
 * primitives and styles/modules.css, so both sides are pinned by tests: this
 * file for the span → class mapping, module-grid.test.tsx for the CSS rules the
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
 * The breakpoints below are desktop-first `max-width` container queries. The
 * arbitrary at-rule form `[@container(max-width:…)]:` is used (not Tailwind's
 * `@max-*:` container variants, which compile to a strict `<`) so the boundary
 * pixel is included, like the hand-written `max-width` rules in modules.css. */

/* THE BREAKPOINTS ARE CONTAINER WIDTHS, measured on the wrapper inside main
 * (CONTENT_CONTAINER_CLASS), not on the viewport. Today's shell leaves the
 * wrapper narrower than the viewport, so the old 1200 / 900 viewport thresholds
 * are offset to switch at the same viewport widths as before. Measured in a
 * browser: .shell is full viewport width (its margin is `frame-gap auto`, so
 * the 20px gap is top and bottom only) and .content pads 32px each side.
 *   - viewport > 900: wrapper = viewport - 2 x 32 = viewport - 64, so the old
 *     1200 becomes 1136.
 *   - viewport <= 900: the content padding is 2 x 16, so wrapper = viewport - 32
 *     and the old 900 becomes 868.
 * Exact at 1200 and for every viewport <= 900. Mismatch band: viewports 901-932
 * (wrapper 837-868) get one column where the old rule gave two; one container
 * threshold cannot be exact on both sides of the 900px padding change. Above
 * the shell's 1680px max-width the wrapper stops growing, which is still three
 * columns. A classic always-visible scrollbar takes about its width from the
 * wrapper and shifts the switch by that much (viewport queries include it).
 * A later shell (rail, sidebar) re-measures main by itself, which is the point
 * of this change; revisit these two numbers then. They are repeated as literals
 * in the class strings below because Tailwind needs to see the whole string. */
export const CONTAINER_TWO_COL_MAX = 1136;
export const CONTAINER_ONE_COL_MAX = 868;

/** The wrapper inside the scrolling main that the container queries measure
 *  (`container-type: inline-size`, styles/modules.css). Not on `.content`
 *  itself (the scroll element) nor on any ancestor of sticky/fixed chrome. */
export const CONTENT_CONTAINER_CLASS = "content-container";

/** Columns the grid shows on a wide desktop. Narrower widths collapse to 2 then 1. */
export const MODULE_COLUMNS = 3;

/** How many of the grid's columns a module occupies. */
export type ModuleSpan = 1 | 2 | 3;

/** Short = a figure or a short list. Tall = a chart or a long list. */
export type ModuleHeight = "short" | "tall";

export const MODULE_GRID_CLASS = "module-grid";

/** `grid-column`, by span. 2 clamps to the full row once the grid is down to
 *  two columns (container ≤1136px) — restated at ≤900px too, redundant in a real
 *  browser (≤868 already implies ≤1136) but needed so resolved()'s per-width
 *  lookup, which does not accumulate wider max-width blocks, finds it there.
 *  1 only clamps once the grid is down to one column (container ≤868px). 3 is always
 *  the full row, so it carries no breakpoint variant. */
const SPAN_CLASS: Record<ModuleSpan, string> = {
  1: "[grid-column:span_1] [@container(max-width:868px)]:col-span-full",
  2: "[grid-column:span_2] [@container(max-width:1136px)]:col-span-full [@container(max-width:868px)]:col-span-full",
  3: "col-span-full",
};

/** `min-height`. A tall module only reserves the extra height on a screen wide
 *  enough to show it beside another column; stacked single-column (container ≤868px) it
 *  collapses to the short height, same as the hand-written rule did. */
const HEIGHT_CLASS: Record<ModuleHeight, string> = {
  short: "min-h-[var(--module-h-short)]",
  tall: "min-h-[var(--module-h-tall)] [@container(max-width:868px)]:min-h-[var(--module-h-short)]",
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
