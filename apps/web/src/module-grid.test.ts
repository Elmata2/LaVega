import { expect, test } from "vitest";
import { moduleClass, MODULE_COLUMNS, MODULE_GRID_CLASS } from "./module-grid.js";
import { resolved } from "./test-support/resolveStyle.js";

/* Span behaviour lives in two halves that must agree: moduleClass() picks the
 * class, styles/modules.css says what the class does. Both halves are pinned
 * here — the mapping directly, the CSS through resolved() — because a silent
 * rename on either side would break every homescreen module's layout without
 * failing anything else (this repo has no render/DOM test lib). */

test("moduleClass maps span + height onto the grid's classes", () => {
  expect(moduleClass()).toBe("module module-span-1 module-short");
  expect(moduleClass({ span: 2 })).toBe("module module-span-2 module-short");
  expect(moduleClass({ span: 3, height: "tall" })).toBe("module module-span-3 module-tall");
});

test("moduleClass keeps a caller's own class last", () => {
  expect(moduleClass({ span: 2, className: "overzicht-positie" })).toBe(
    "module module-span-2 module-short overzicht-positie",
  );
});

test("the grid shows MODULE_COLUMNS columns on desktop", () => {
  expect(resolved([MODULE_GRID_CLASS], "grid-template-columns")).toBe(
    `repeat(${MODULE_COLUMNS},minmax(0,1fr))`,
  );
});

test("every class moduleClass can emit is styled", () => {
  const emitted = new Set<string>();
  for (const span of [1, 2, 3] as const) {
    for (const height of ["short", "tall"] as const) {
      for (const cls of moduleClass({ span, height }).split(" ")) emitted.add(cls);
    }
  }
  for (const cls of emitted) {
    // "display" is a probe, not the property under test: resolved() throws
    // only when no rule matches the class at all, whatever property is asked for.
    expect(() => resolved([cls], "display"), `.${cls} has no rule in modules.css`).not.toThrow();
  }
});

test("on desktop a span occupies exactly that many columns", () => {
  expect(resolved(["module-span-1"], "grid-column")).toBe("span 1");
  expect(resolved(["module-span-2"], "grid-column")).toBe("span 2");
  // 3 = the full row, written as 1 / -1 so it survives a narrower grid.
  expect(resolved(["module-span-3"], "grid-column")).toBe("1 / -1");
});

test("at 1200px the grid is 2 columns and wide spans clamp to the full row", () => {
  expect(resolved([MODULE_GRID_CLASS], "grid-template-columns", 1200)).toBe(
    "repeat(2,minmax(0,1fr))",
  );
  expect(resolved(["module-span-2"], "grid-column", 1200)).toBe("1 / -1");
  expect(resolved(["module-span-3"], "grid-column", 1200)).toBe("1 / -1");
});

test("at 900px the shell is one column: every span is the full row", () => {
  expect(resolved([MODULE_GRID_CLASS], "grid-template-columns", 900)).toBe("minmax(0,1fr)");
  expect(resolved(["module-span-1"], "grid-column", 900)).toBe("1 / -1");
  expect(resolved(["module-span-2"], "grid-column", 900)).toBe("1 / -1");
  expect(resolved(["module-span-3"], "grid-column", 900)).toBe("1 / -1");
});

test("a tall module reserves more height than a short one, but not on a phone", () => {
  expect(resolved(["module-short"], "min-height")).toBe("var(--module-h-short)");
  expect(resolved(["module-tall"], "min-height")).toBe("var(--module-h-tall)");
  expect(resolved(["module-tall"], "min-height", 900)).toBe("var(--module-h-short)");
});

test("module titles keep the reference's uppercase letter-spaced register", () => {
  expect(resolved(["module-title"], "text-transform")).toBe("uppercase");
  // Built sheet drops the leading zero the source writes; same value, ".12em".
  expect(resolved(["module-title"], "letter-spacing")).toBe(".12em");
});
