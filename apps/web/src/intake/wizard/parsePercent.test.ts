import { expect, test } from "vitest";
import { parsePercent } from "./parsePercent.js";

test("accepts Dutch and English decimals, with or without a percent sign", () => {
  expect(parsePercent("14,9")).toBe(14.9);
  expect(parsePercent("14.9 %")).toBe(14.9);
  expect(parsePercent("15")).toBe(15);
  expect(parsePercent("0")).toBe(0);
  expect(parsePercent("100")).toBe(100);
});

test("rejects text, negatives, over 100 and a thousands-style number", () => {
  for (const bad of ["", "abc", "-3", "101", "1,234,5", "14,9,1", "1e3"])
    expect(parsePercent(bad)).toBeNull();
});
