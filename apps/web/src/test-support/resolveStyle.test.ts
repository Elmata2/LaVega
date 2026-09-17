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

/* Interactive states, both halves of the migration. The hand-written sheets use
 * :hover heavily, and a converted component emits the same shape, since
 * `hover:bg-surface` compiles to `.hover\:bg-surface:hover`. Without this the
 * migration could verify a component at rest and nothing else. */
test("resolves a rule that only applies in a state", () => {
  expect(resolved(["cat-compare"], "text-decoration", undefined, ":hover")).toBe("underline");
});

/* The state must not leak into the resting style, or a test would assert a
 * hover colour on an element nobody is pointing at. cat-compare has both, and
 * they must come back different (was card-link, extracted to
 * components/ui/CardLink.tsx — docs/adr/0005 — which deleted the hand-written
 * rule this test used as its example). */
test("a state rule does not leak into the resting style", () => {
  const rest = resolved(["cat-compare"], "text-decoration");
  const hover = resolved(["cat-compare"], "text-decoration", undefined, ":hover");
  expect(hover).toBe("underline");
  expect(rest).not.toBe(hover);
});

/* A selector list must not be torn apart by a comma inside brackets. Most
 * Tailwind arbitrary values carry one, and a naive split made the rule match
 * nothing — so a converted component resolved to whatever it had before and the
 * assertion checking it was quietly wrong. */
test("a selector carrying a bracketed comma still matches", () => {
  expect(() => resolved(["bg-[rgb(0_0_0/4%)]"], "background-color")).not.toThrow();
});
