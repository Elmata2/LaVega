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
  CONTENT_CONTAINER_CLASS,
  CONTAINER_ONE_COL_MAX,
  CONTAINER_TWO_COL_MAX,
  type ModuleHeight,
  type ModuleSpan,
} from "./module-grid.js";
import { resolved, resolvedInContainer } from "./test-support/resolveStyle.js";

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
    "module [grid-column:span_1] [@container(max-width:868px)]:col-span-full min-h-[var(--module-h-short)]",
  );
  expect(moduleClass({ span: 2 })).toBe(
    "module [grid-column:span_2] [@container(max-width:1096px)]:col-span-full [@container(max-width:868px)]:col-span-full min-h-[var(--module-h-short)]",
  );
  expect(moduleClass({ span: 3, height: "tall" })).toBe(
    "module col-span-full min-h-[var(--module-h-tall)] [@container(max-width:868px)]:min-h-[var(--module-h-short)]",
  );
});

test("moduleClass keeps a caller's own class last", () => {
  expect(moduleClass({ span: 2, className: "overzicht-positie" })).toBe(
    "module [grid-column:span_2] [@container(max-width:1096px)]:col-span-full [@container(max-width:868px)]:col-span-full min-h-[var(--module-h-short)] overzicht-positie",
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

test("the breakpoints are container widths, offset from the old viewport 1200 / 900", () => {
  // Wrapper width = viewport minus frame gutter (2 x 20) minus content padding
  // (2 x 32): 1200 - 104 = 1096. At <= 900 the frame is full-bleed and the
  // padding is 2 x 16: 900 - 32 = 868.
  expect(CONTAINER_TWO_COL_MAX).toBe(1096);
  expect(CONTAINER_ONE_COL_MAX).toBe(868);
});

test("the content wrapper is a size container on the inline axis", () => {
  expect(resolved([CONTENT_CONTAINER_CLASS], "container-type")).toBe("inline-size");
});

test("every class a mounted module can carry is styled, at the width it applies", () => {
  const emitted = new Set<string>();
  for (const span of [1, 2, 3] as const) {
    for (const height of ["short", "tall"] as const) {
      for (const cls of moduleClasses(span, height)) emitted.add(cls);
    }
  }
  for (const cls of emitted) {
    // A breakpoint variant's own rule only exists inside its @container block,
    // so it must be probed there — resolving without a width would find
    // nothing and throw for a reason that has nothing to do with a rename.
    const width = Number(/^\[@container\(max-width:(\d+)px\)\]:/.exec(cls)?.[1] ?? NaN);
    // "display" is a probe, not the property under test: resolved() throws
    // only when no rule matches the class at all, whatever property is asked for.
    expect(
      () =>
        Number.isFinite(width)
          ? resolvedInContainer([cls], "display", width)
          : resolved([cls], "display"),
      `.${cls} has no rule in modules.css`,
    ).not.toThrow();
  }
});

test("no module class falls back to a viewport media query", () => {
  const all = [1, 2, 3].flatMap((span) =>
    ["short", "tall"].flatMap((height) =>
      moduleClasses(span as ModuleSpan, height as ModuleHeight),
    ),
  );
  expect(all.filter((cls) => cls.includes("@media"))).toEqual([]);
});

test("on desktop a span occupies exactly that many columns", () => {
  expect(resolved(moduleClasses(1), "grid-column")).toBe("span 1");
  expect(resolved(moduleClasses(2), "grid-column")).toBe("span 2");
  // 3 = the full row. Tailwind's own col-span-full serialises it as "1/-1",
  // not the hand-written "1 / -1" — same value, no space around the slash.
  expect(resolved(moduleClasses(3), "grid-column")).toBe("1/-1");
});

test("in a container <= 1096px the grid is 2 columns and wide spans clamp to the full row", () => {
  expect(resolvedInContainer(gridClasses(), "grid-template-columns", CONTAINER_TWO_COL_MAX)).toBe(
    "repeat(2,minmax(0,1fr))",
  );
  expect(resolvedInContainer(moduleClasses(2), "grid-column", CONTAINER_TWO_COL_MAX)).toBe("1/-1");
  expect(resolvedInContainer(moduleClasses(3), "grid-column", CONTAINER_TWO_COL_MAX)).toBe("1/-1");
});

test("in a container <= 868px the grid is one column: every span is the full row", () => {
  expect(resolvedInContainer(gridClasses(), "grid-template-columns", CONTAINER_ONE_COL_MAX)).toBe(
    "minmax(0,1fr)",
  );
  expect(resolvedInContainer(moduleClasses(1), "grid-column", CONTAINER_ONE_COL_MAX)).toBe("1/-1");
  expect(resolvedInContainer(moduleClasses(2), "grid-column", CONTAINER_ONE_COL_MAX)).toBe("1/-1");
  expect(resolvedInContainer(moduleClasses(3), "grid-column", CONTAINER_ONE_COL_MAX)).toBe("1/-1");
});

test("a tall module reserves more height than a short one, but not in a one-column container", () => {
  expect(resolved(moduleClasses(1, "short"), "min-height")).toBe("var(--module-h-short)");
  expect(resolved(moduleClasses(1, "tall"), "min-height")).toBe("var(--module-h-tall)");
  expect(resolvedInContainer(moduleClasses(1, "tall"), "min-height", CONTAINER_ONE_COL_MAX)).toBe(
    "var(--module-h-short)",
  );
});

test("module titles keep the reference's uppercase letter-spaced register", () => {
  const title = moduleEl(1, "short").querySelector("h2")!.className.split(" ");
  expect(resolved(title, "text-transform")).toBe("uppercase");
  // Built sheet drops the leading zero the source writes; same value, ".12em".
  expect(resolved(title, "letter-spacing")).toBe(".12em");
});
