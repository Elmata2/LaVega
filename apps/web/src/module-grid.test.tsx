// @vitest-environment jsdom
import { act, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, test } from "vitest";
import Module from "./components/Module.js";
import ModuleGrid from "./components/ModuleGrid.js";
import {
  moduleClass,
  MODULE_COLUMNS,
  MODULE_GRID_CLASS,
  type ModuleHeight,
  type ModuleSpan,
} from "./module-grid.js";
import { resolved } from "./test-support/resolveStyle.js";

/* Span behaviour lives in two halves that must agree: Module/ModuleGrid pick
 * the class, styles/modules.css (grid template) or module-grid.ts itself
 * (span, height — now Tailwind utility strings) says what the class does.
 * Both halves are pinned here — the mapping directly, the CSS/utilities
 * through resolved() — because a silent rename on either side would break
 * every homescreen module's layout without failing anything else.
 *
 * resolved() is given the REAL className read off a mounted element, never a
 * hand-typed list. A hand-typed list only proves the string I typed resolves
 * to something — it stops proving anything about Module/ModuleGrid the moment
 * either one stops emitting that string, which is exactly the vacuous-
 * assertion failure mode resolved() exists to prevent, rebuilt one layer up. */

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mounted: { root: Root; container: HTMLElement }[] = [];

afterEach(() => {
  for (const { root, container } of mounted.splice(0)) {
    act(() => root.unmount());
    container.remove();
  }
});

/** Mounts `node` and returns its root element — the thing whose real
 *  className every assertion below reads. */
function mount(node: ReactElement): HTMLElement {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => root.render(node));
  mounted.push({ root, container });
  const el = container.firstElementChild;
  if (!el) throw new Error("mounted node produced no element");
  return el as HTMLElement;
}

function moduleEl(span?: ModuleSpan, height?: ModuleHeight): HTMLElement {
  return mount(
    <Module title="x" span={span} height={height}>
      y
    </Module>,
  );
}

function moduleClasses(span?: ModuleSpan, height?: ModuleHeight): string[] {
  return moduleEl(span, height).className.split(" ");
}

function gridClasses(): string[] {
  return mount(<ModuleGrid>{null}</ModuleGrid>).className.split(" ");
}

test("moduleClass maps span + height onto the grid's classes", () => {
  expect(moduleClass()).toBe(
    "module [grid-column:span_1] [@media(max-width:900px)]:col-span-full min-h-[var(--module-h-short)]",
  );
  expect(moduleClass({ span: 2 })).toBe(
    "module [grid-column:span_2] [@media(max-width:1200px)]:col-span-full [@media(max-width:900px)]:col-span-full min-h-[var(--module-h-short)]",
  );
  expect(moduleClass({ span: 3, height: "tall" })).toBe(
    "module col-span-full min-h-[var(--module-h-tall)] [@media(max-width:900px)]:min-h-[var(--module-h-short)]",
  );
});

test("moduleClass keeps a caller's own class last", () => {
  expect(moduleClass({ span: 2, className: "overzicht-positie" })).toBe(
    "module [grid-column:span_2] [@media(max-width:1200px)]:col-span-full [@media(max-width:900px)]:col-span-full min-h-[var(--module-h-short)] overzicht-positie",
  );
});

test("a mounted <Module> actually carries moduleClass()'s output, not just the function", () => {
  expect(moduleClasses(2, "tall").join(" ")).toBe(moduleClass({ span: 2, height: "tall" }));
});

test("a mounted <ModuleGrid> carries MODULE_GRID_CLASS", () => {
  expect(gridClasses()).toEqual([MODULE_GRID_CLASS]);
});

test("the grid shows MODULE_COLUMNS columns on desktop", () => {
  expect(resolved(gridClasses(), "grid-template-columns")).toBe(
    `repeat(${MODULE_COLUMNS},minmax(0,1fr))`,
  );
});

test("every class a mounted module can carry is styled, at the width it applies", () => {
  const emitted = new Set<string>();
  for (const span of [1, 2, 3] as const) {
    for (const height of ["short", "tall"] as const) {
      for (const cls of moduleClasses(span, height)) emitted.add(cls);
    }
  }
  for (const cls of emitted) {
    // A breakpoint variant's own rule only exists inside its max-width block,
    // so it must be probed there — resolving without atWidth would find
    // nothing and throw for a reason that has nothing to do with a rename.
    const width = Number(/^\[@media\(max-width:(\d+)px\)\]:/.exec(cls)?.[1] ?? NaN);
    const atWidth = Number.isFinite(width) ? width : undefined;
    // "display" is a probe, not the property under test: resolved() throws
    // only when no rule matches the class at all, whatever property is asked for.
    expect(() => resolved([cls], "display", atWidth), `.${cls} has no rule in modules.css`).not.toThrow();
  }
});

test("on desktop a span occupies exactly that many columns", () => {
  expect(resolved(moduleClasses(1), "grid-column")).toBe("span 1");
  expect(resolved(moduleClasses(2), "grid-column")).toBe("span 2");
  // 3 = the full row. Tailwind's own col-span-full serialises it as "1/-1",
  // not the hand-written "1 / -1" — same value, no space around the slash.
  expect(resolved(moduleClasses(3), "grid-column")).toBe("1/-1");
});

test("at 1200px the grid is 2 columns and wide spans clamp to the full row", () => {
  expect(resolved(gridClasses(), "grid-template-columns", 1200)).toBe("repeat(2,minmax(0,1fr))");
  expect(resolved(moduleClasses(2), "grid-column", 1200)).toBe("1/-1");
  expect(resolved(moduleClasses(3), "grid-column", 1200)).toBe("1/-1");
});

test("at 900px the shell is one column: every span is the full row", () => {
  expect(resolved(gridClasses(), "grid-template-columns", 900)).toBe("minmax(0,1fr)");
  expect(resolved(moduleClasses(1), "grid-column", 900)).toBe("1/-1");
  expect(resolved(moduleClasses(2), "grid-column", 900)).toBe("1/-1");
  expect(resolved(moduleClasses(3), "grid-column", 900)).toBe("1/-1");
});

test("a tall module reserves more height than a short one, but not on a phone", () => {
  expect(resolved(moduleClasses(1, "short"), "min-height")).toBe("var(--module-h-short)");
  expect(resolved(moduleClasses(1, "tall"), "min-height")).toBe("var(--module-h-tall)");
  expect(resolved(moduleClasses(1, "tall"), "min-height", 900)).toBe("var(--module-h-short)");
});

test("module titles keep the reference's uppercase letter-spaced register", () => {
  const title = moduleEl(1, "short").querySelector("h2")!.className.split(" ");
  expect(resolved(title, "text-transform")).toBe("uppercase");
  // Built sheet drops the leading zero the source writes; same value, ".12em".
  expect(resolved(title, "letter-spacing")).toBe(".12em");
});
