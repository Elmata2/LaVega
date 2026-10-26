import { expect, test } from "vitest";
import { parseEuros } from "./parseEuros.js";

test("parseEuros accepts Dutch formats", () => {
  expect(parseEuros("3.250")).toBe(325000);
  expect(parseEuros("3250")).toBe(325000);
  expect(parseEuros("€ 3 250")).toBe(325000);
  expect(parseEuros("3250,50")).toBe(325100);
  expect(parseEuros("1.234.567")).toBe(123456700);
  expect(parseEuros("3.250,20")).toBe(325000);
  expect(parseEuros("0")).toBe(0);
});

test("parseEuros treats comma or dot plus three digits as thousands (R4)", () => {
  expect(parseEuros("2,500")).toBe(250000);
  expect(parseEuros("2.500")).toBe(250000);
  expect(parseEuros("12.50")).toBe(1300);
  expect(parseEuros("12,50")).toBe(1300);
  expect(parseEuros("1250.50")).toBe(125100);
  expect(parseEuros("3.250,50")).toBe(325100);
  expect(parseEuros("3,250.50")).toBe(325100);
  expect(parseEuros("2,500.00")).toBe(250000);
  expect(parseEuros("1,234,567")).toBe(123456700);
});

test("parseEuros rejects what is not an amount", () => {
  expect(parseEuros("")).toBeNull();
  expect(parseEuros("   ")).toBeNull();
  expect(parseEuros("abc")).toBeNull();
  expect(parseEuros("-5")).toBeNull();
  expect(parseEuros("12abc")).toBeNull();
  expect(parseEuros("1,2,3")).toBeNull();
  expect(parseEuros("3.250.50")).toBeNull();
});
