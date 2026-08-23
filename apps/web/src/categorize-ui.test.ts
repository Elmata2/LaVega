import { expect, test } from "vitest";
import { toDecisions } from "./categorize-ui.js";

/* The redaction tests that used to live here have moved with the code they test.
 * They pinned `buildCategorizeItems`, whose IBAN pattern hopped across whitespace
 * and deleted the merchant name along with the IBAN — so the tests passed while
 * blanking 747 of 1.394 of his onbekend rows. Passing tests around a broken
 * function are worse than no tests: they invite the next person to trust it.
 *
 * The working implementation is packages/core/src/categorize.ts →
 * aiCategorizeItems, and its guarantees ("geen IBANs, bedragen of datums") are
 * asserted there, in the package that owns the transform. */

test("toDecisions drops rows left on 'Sla over' (empty category)", () => {
  const decisions = toDecisions([
    { id: "t1", category: "Boodschappen" },
    { id: "t2", category: "" },
    { id: "t3", category: "Inkomen" },
  ]);
  expect(decisions).toEqual([
    { id: "t1", category: "Boodschappen" },
    { id: "t3", category: "Inkomen" },
  ]);
});
