import { expect, test } from "vitest";
import { convertCurrency } from "./portfolio.js";
import type { FxRate } from "../fx.js";

const rate: FxRate = { date: "2026-08-21", base: "EUR", rates: { USD: 1.17 } };

test("converts with a rate dated on or before the target date", () => {
  expect(convertCurrency(117, "USD", "EUR", "2026-08-21", rate)).toBeCloseTo(100);
});

test("falls forward to the nearest known rate for older dates instead of throwing", () => {
  // Runtime holds only the latest FX rate; a price bar from before that date
  // must still convert (position detail currentPrice/currentValue).
  expect(convertCurrency(117, "USD", "EUR", "2026-08-19", rate)).toBeCloseTo(100);
});

test("throws when the FX provider failed and passed undefined", () => {
  expect(() => convertCurrency(117, "USD", "EUR", "2026-08-21", undefined)).toThrow(
    "No FX rate available",
  );
});

test("skips conversion when currencies already match, even with no FX rate at all", () => {
  expect(convertCurrency(117, "EUR", "EUR", "2026-08-21", undefined)).toBe(117);
});
