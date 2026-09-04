import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";
import { moduleClass, MODULE_COLUMNS, MODULE_GRID_CLASS } from "./module-grid.js";

/* Span behaviour lives in two halves that must agree: moduleClass() picks the
 * class, styles/modules.css says what the class does. Both halves are pinned
 * here — the mapping directly, the CSS by reading the stylesheet — because a
 * silent rename on either side would break every homescreen module's layout
 * without failing anything else (this repo has no render/DOM test lib). */

// Comments stripped up front so a rule's selector never carries the comment above it.
const css = readFileSync(
  fileURLToPath(new URL("./styles/modules.css", import.meta.url)),
  "utf8",
).replace(/\/\*[\s\S]*?\*\//g, "");

/** The stylesheet split into the default scope and each max-width media block. */
function scopes(source: string): { base: string; media: Map<number, string> } {
  const media = new Map<number, string>();
  let base = "";
  let i = 0;
  while (i < source.length) {
    const at = source.indexOf("@media", i);
    if (at === -1) {
      base += source.slice(i);
      break;
    }
    base += source.slice(i, at);
    const open = source.indexOf("{", at);
    let depth = 0;
    let end = open;
    for (; end < source.length; end++) {
      if (source[end] === "{") depth++;
      else if (source[end] === "}" && --depth === 0) break;
    }
    const width = Number(/max-width:\s*(\d+)px/.exec(source.slice(at, open))?.[1]);
    media.set(width, source.slice(open + 1, end));
    i = end + 1;
  }
  return { base, media };
}

/** The declaration a selector sets inside one scope, e.g. "grid-column". */
function declaration(scope: string, selector: string, property: string): string | undefined {
  // Matches the rule whose selector list contains `selector` as a whole entry.
  const rules = scope.matchAll(/([^{}]+)\{([^{}]*)\}/g);
  for (const [, selectors, body] of rules) {
    const list = selectors.split(",").map((s) => s.trim());
    if (!list.includes(selector)) continue;
    const found = new RegExp(`(?:^|;)\\s*${property}\\s*:\\s*([^;]+)`).exec(body);
    if (found) return found[1].trim();
  }
  return undefined;
}

const { base, media } = scopes(css);

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
  expect(declaration(base, `.${MODULE_GRID_CLASS}`, "grid-template-columns")).toBe(
    `repeat(${MODULE_COLUMNS}, minmax(0, 1fr))`,
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
    expect(css, `.${cls} has no rule in modules.css`).toMatch(new RegExp(`\\.${cls}[\\s,{]`));
  }
});

test("on desktop a span occupies exactly that many columns", () => {
  expect(declaration(base, ".module-span-1", "grid-column")).toBe("span 1");
  expect(declaration(base, ".module-span-2", "grid-column")).toBe("span 2");
  // 3 = the full row, written as 1 / -1 so it survives a narrower grid.
  expect(declaration(base, ".module-span-3", "grid-column")).toBe("1 / -1");
});

test("at 1200px the grid is 2 columns and wide spans clamp to the full row", () => {
  const scope = media.get(1200)!;
  expect(declaration(scope, `.${MODULE_GRID_CLASS}`, "grid-template-columns")).toBe(
    "repeat(2, minmax(0, 1fr))",
  );
  expect(declaration(scope, ".module-span-2", "grid-column")).toBe("1 / -1");
  expect(declaration(scope, ".module-span-3", "grid-column")).toBe("1 / -1");
});

test("at 900px the shell is one column: every span is the full row", () => {
  const scope = media.get(900)!;
  expect(declaration(scope, `.${MODULE_GRID_CLASS}`, "grid-template-columns")).toBe(
    "minmax(0, 1fr)",
  );
  expect(declaration(scope, ".module-span-1", "grid-column")).toBe("1 / -1");
  expect(declaration(scope, ".module-span-2", "grid-column")).toBe("1 / -1");
  expect(declaration(scope, ".module-span-3", "grid-column")).toBe("1 / -1");
});

test("a tall module reserves more height than a short one, but not on a phone", () => {
  expect(declaration(base, ".module-short", "min-height")).toBe("var(--module-h-short)");
  expect(declaration(base, ".module-tall", "min-height")).toBe("var(--module-h-tall)");
  expect(declaration(media.get(900)!, ".module-tall", "min-height")).toBe("var(--module-h-short)");
});

test("module titles keep the reference's uppercase letter-spaced register", () => {
  expect(declaration(base, ".module-title", "text-transform")).toBe("uppercase");
  expect(declaration(base, ".module-title", "letter-spacing")).toBe("0.12em");
});
