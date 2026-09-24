import { expect, test } from "vitest";
import { convertCurrency, MissingFxRateError } from "./portfolio.js";
import type { FxRate } from "../fx.js";

const rate: FxRate = { date: "2026-08-21", base: "EUR", rates: { USD: 1.17 } };

test("converts with a rate dated on or before the target date", () => {
  expect(convertCurrency(117, "USD", "EUR", "2026-08-21", rate)).toBeCloseTo(100);
});

test("does not use a future rate for an older economic date", () => {
  expect(() => convertCurrency(117, "USD", "EUR", "2026-08-19", rate)).toThrow(
    "No FX rate available for 2026-08-19",
  );
});

test("uses the latest dated observation on or before the economic date", () => {
  expect(
    convertCurrency(100, "USD", "EUR", "2026-08-21", [
      { date: "2026-08-20", base: "EUR", rates: { USD: 1.1 } },
      { date: "2026-08-21", base: "EUR", rates: { USD: 1.2 } },
    ]),
  ).toBeCloseTo(100 / 1.2);
});

test("bounds weekend and holiday carry to ten calendar days", () => {
  const friday = { date: "2026-08-07", base: "EUR", rates: { USD: 1.1 } };
  expect(convertCurrency(110, "USD", "EUR", "2026-08-10", friday)).toBeCloseTo(100);
  expect(() => convertCurrency(110, "USD", "EUR", "2026-08-18", friday)).toThrow(
    "No FX rate available for 2026-08-18",
  );
});

test("throws when the FX provider failed and passed undefined", () => {
  expect(() => convertCurrency(117, "USD", "EUR", "2026-08-21", undefined)).toThrow(
    "No FX rate available",
  );
});

test("skips conversion when currencies already match, even with no FX rate at all", () => {
  expect(convertCurrency(117, "EUR", "EUR", "2026-08-21", undefined)).toBe(117);
});

test("a missing FX rate throws a typed error carrying the date and the currency pair", () => {
  try {
    convertCurrency(117, "USD", "EUR", "2026-08-19", rate);
    throw new Error("expected convertCurrency to throw");
  } catch (error) {
    expect(error).toBeInstanceOf(MissingFxRateError);
    expect((error as MissingFxRateError).from).toBe("USD");
    expect((error as MissingFxRateError).to).toBe("EUR");
    expect((error as MissingFxRateError).date).toBe("2026-08-19");
  }
});
