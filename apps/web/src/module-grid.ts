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
 * classes resolve to at each breakpoint. */

/** Columns the grid shows on a wide desktop. Narrower widths collapse to 2 then 1. */
export const MODULE_COLUMNS = 3;

/** How many of the grid's columns a module occupies. */
export type ModuleSpan = 1 | 2 | 3;

/** Short = a figure or a short list. Tall = a chart or a long list. */
export type ModuleHeight = "short" | "tall";

export const MODULE_GRID_CLASS = "module-grid";

export type ModuleLayout = {
  span?: ModuleSpan;
  height?: ModuleHeight;
  className?: string;
};

/** `{ span: 2, height: "tall" }` → "module module-span-2 module-tall". */
export function moduleClass({ span = 1, height = "short", className }: ModuleLayout = {}): string {
  const parts = ["module", `module-span-${span}`, `module-${height}`];
  if (className) parts.push(className);
  return parts.join(" ");
}
