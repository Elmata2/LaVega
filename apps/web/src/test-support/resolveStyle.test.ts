import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";
import { resolved } from "./resolveStyle.js";
import { MODULE_GRID_CLASS } from "../module-grid.js";

const built = existsSync(fileURLToPath(new URL("../../dist/assets/", import.meta.url)));

test("resolves a hand-written rule", () => {
  expect(resolved([MODULE_GRID_CLASS], "display")).toBe("grid");
});

/* The breakpoints the homescreen actually collapses at. Asserted through the
 * element's classes rather than through a named selector, so these survive the
 * grid being converted to utilities. */
test("resolves inside each max-width block", () => {
  expect(resolved([MODULE_GRID_CLASS], "grid-template-columns")).toBe("repeat(3,minmax(0,1fr))");
  expect(resolved([MODULE_GRID_CLASS], "grid-template-columns", 1200)).toBe(
    "repeat(2,minmax(0,1fr))",
  );
  expect(resolved([MODULE_GRID_CLASS], "grid-template-columns", 900)).toBe("minmax(0,1fr)");
});

/* The whole point: a generated utility resolves the same way a hand-written
 * rule does, so an assertion does not care which side of the migration a
 * component is on. Only present once the sheet has been built. */
test.skipIf(!built)("resolves a generated Tailwind utility", () => {
  expect(resolved(["bg-pos-tint"], "background-color")).toBe("var(--pos-tint)");
});

/* THE PROPERTY THAT MAKES THIS SAFE. Converting a component removes the rules
 * its old assertion described. Returning undefined there would turn a real
 * check into a vacuous one that still passes; throwing means the suite tells
 * you the assertion has come loose from the markup. */
test("throws rather than passing vacuously when nothing matches", () => {
  expect(() => resolved(["class-that-does-not-exist"], "color")).toThrow(/no rule matches/);
});
