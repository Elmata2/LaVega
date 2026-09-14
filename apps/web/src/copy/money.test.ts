import { expect, test } from "vitest";
import { CATEGORY_OPTIONS } from "@lavega/core";
import { CATEGORY_LABELS, categoryLabel } from "./money.js";

/* CATEGORY_LABELS is a hand-typed table next to a hand-typed taxonomy — a typo
 * here silently breaks the picker for that one category, and a manual read of
 * both lists is not a proof. This is the mechanical one: same 25 keys as
 * CATEGORY_OPTIONS, nothing missing, nothing extra, and every `nl` value is
 * byte-identical to its own key. */

test("CATEGORY_LABELS covers exactly the CATEGORY_OPTIONS taxonomy", () => {
  expect(new Set(Object.keys(CATEGORY_LABELS))).toEqual(new Set(CATEGORY_OPTIONS));
});

test("every nl label is byte-identical to its own key", () => {
  for (const [key, { nl }] of Object.entries(CATEGORY_LABELS)) {
    expect(nl).toBe(key);
  }
});

test("categoryLabel renders the reader's language and falls back for the unknown", () => {
  expect(categoryLabel("nl", "Boodschappen")).toBe("Boodschappen");
  expect(categoryLabel("en", "Boodschappen")).toBe("Groceries");
  expect(categoryLabel("en", "onbekend")).toBe("Uncategorised");
  expect(categoryLabel("nl", "onbekend")).toBe("onbekend");
  // A category outside the table (a hand-edited import) is shown as typed.
  expect(categoryLabel("en", "Zelfverzonnen")).toBe("Zelfverzonnen");
});
