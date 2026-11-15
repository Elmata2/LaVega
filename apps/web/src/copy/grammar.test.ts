import { expect, test } from "vitest";
import { adminCopy } from "./admin.js";
import { optimiseCopy } from "./optimise.js";

/* Sentences built from a count have to agree with that count in BOTH halves.
 * The type system cannot see this and the parity gate cannot either: both
 * branches are present, both are English, and the sentence only reads wrong
 * when the number is plural.
 *
 * This file exists because the outsidePeriod fix below was made once, mistaken
 * for an unrelated drift, and reverted. A pinned assertion is a cheaper way to
 * hold a decision than remembering it. */

test("outsidePeriod's tail agrees with its head", () => {
  const en = adminCopy.en.belasting.vat.outsidePeriod;
  const one = en({ outside: 1, nearestOutside: null, total: 2 });
  const many = en({ outside: 3, nearestOutside: null, total: 2 });

  expect(one).toContain("There is 1 invoice");
  expect(one).toContain("That one does not count");

  expect(many).toContain("There are 3 invoices");
  expect(many).not.toContain("That one does not count");
});

test("a one-year card fee does not read as plural years", () => {
  const en = optimiseCopy.en.travel.cardCost;
  expect(en.spanOneOffYearOne).not.toMatch(/\byears\b/);
  expect(en.spanOneOffMonthOne).not.toMatch(/\bmonths\b/);
  expect(optimiseCopy.nl.travel.cardCost.spanOneOffYearOne).not.toMatch(/\{n\}/);
});
