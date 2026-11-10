import { expect, test } from "vitest";
import {
  MAX_CENTS,
  centsText,
  parseDate,
  parseEuros,
  parseNumber,
  parseWholeNumber,
} from "./parse";

test("euros become integer cents from the digits, with either decimal mark", () => {
  expect(parseEuros("12")).toEqual({ ok: true, value: 1200 });
  expect(parseEuros("12,5")).toEqual({ ok: true, value: 1250 });
  expect(parseEuros("0.07")).toEqual({ ok: true, value: 7 });
  expect(parseEuros(" €1234 ")).toEqual({ ok: true, value: 123400 });
  // a float would give 1.15 * 100 = 114.99999999999999
  expect(parseEuros("1.15")).toEqual({ ok: true, value: 115 });
  expect(parseEuros("10000000")).toEqual({ ok: true, value: MAX_CENTS });
});

test("euros refuse empty, words, signs, extra decimals, zero and huge amounts", () => {
  const err = (t: string, o?: { allowZero?: boolean }) => {
    const r = parseEuros(t, o);
    return r.ok ? "ok" : r.error;
  };
  expect(err("")).toBe("required");
  expect(err("abc")).toBe("number");
  expect(err("1e3")).toBe("number");
  expect(err("-5")).toBe("negative");
  expect(err("1.234")).toBe("decimals");
  expect(err("10000000.01")).toBe("tooLarge");
  expect(err("99999999999999")).toBe("number");
  expect(err("0")).toBe("zero");
  expect(err("0", { allowZero: true })).toBe("ok");
  expect(err("NaN")).toBe("number");
  expect(err("Infinity")).toBe("number");
});

test("numbers and whole numbers stay inside their range", () => {
  expect(parseNumber("3,5", { min: 0, max: 60, maxDecimals: 1 })).toEqual({ ok: true, value: 3.5 });
  expect(parseNumber("-2.5", { min: -5, max: 50, maxDecimals: 2 })).toEqual({
    ok: true,
    value: -2.5,
  });
  expect(parseNumber("61", { min: 0, max: 60, maxDecimals: 1 })).toEqual({
    ok: false,
    error: "range",
  });
  expect(parseNumber("-1", { min: 0, max: 60, maxDecimals: 1 })).toEqual({
    ok: false,
    error: "negative",
  });
  expect(parseNumber("1.25", { min: 0, max: 60, maxDecimals: 1 })).toEqual({
    ok: false,
    error: "decimals",
  });
  expect(parseWholeNumber("2.5", { min: 1, max: 120 })).toEqual({ ok: false, error: "integer" });
  expect(parseWholeNumber("0", { min: 1, max: 120 })).toEqual({ ok: false, error: "range" });
  expect(parseWholeNumber("120", { min: 1, max: 120 })).toEqual({ ok: true, value: 120 });
});

test("dates must be real calendar days", () => {
  expect(parseDate("2027-03-01")).toEqual({ ok: true, value: "2027-03-01" });
  expect(parseDate("2027-02-30")).toEqual({ ok: false, error: "date" });
  expect(parseDate("01-03-2027")).toEqual({ ok: false, error: "date" });
  expect(parseDate("")).toEqual({ ok: false, error: "required" });
});

test("centsText round-trips what parseEuros accepts", () => {
  for (const cents of [1, 7, 100, 1250, 123456, MAX_CENTS]) {
    expect(parseEuros(centsText(cents))).toEqual({ ok: true, value: cents });
  }
});

test("minus zero is stored as zero, centsText keeps the sign, old years are refused", () => {
  const r = parseNumber("-0", { min: -5, max: 50, maxDecimals: 2 });
  expect(r.ok && Object.is(r.value, 0)).toBe(true);
  expect(centsText(-5)).toBe("-0.05");
  expect(parseDate("1899-12-31")).toEqual({ ok: false, error: "date" });
  expect(parseDate("0000-01-01")).toEqual({ ok: false, error: "date" });
});
