import { expect, test } from "vitest";
import { directionOfTx, fromCents, magnitudeCents, toCents } from "./money.js";

/* ADR 0011's one boundary: a stored sign becomes a direction here, and every
 * ported matching/total formula compares these integer cents instead of floats.
 * The half-cent rows are the ones that matter — `Math.round` alone turns -0.005
 * into 0, a silently vanished cent. */

test("directionOfTx reads LaVega's negative-outflow convention", () => {
  expect(directionOfTx({ amount: -0.01 })).toBe("out");
  expect(directionOfTx({ amount: -5000 })).toBe("out");
  expect(directionOfTx({ amount: 0.01 })).toBe("in");
  expect(directionOfTx({ amount: 0 })).toBe("in");
});

test("toCents rounds half away from zero on BOTH signs", () => {
  expect(toCents(0)).toBe(0);
  expect(toCents(10.5)).toBe(1050);
  expect(toCents(-10.5)).toBe(-1050);
  expect(toCents(0.005)).toBe(1);
  expect(toCents(-0.005)).toBe(-1); // Math.round alone would give 0 here
  expect(toCents(0.004)).toBe(0);
  expect(toCents(-0.006)).toBe(-1);
  expect(toCents(1234.56)).toBe(123456);
});

test("fromCents is the inverse of the integer representation", () => {
  expect(fromCents(1050)).toBe(10.5);
  expect(fromCents(-1)).toBe(-0.01);
  expect(toCents(fromCents(-1234))).toBe(-1234);
  expect(toCents(fromCents(0))).toBe(0);
});

test("magnitudeCents is the positive shape a matching rule compares", () => {
  expect(magnitudeCents(-100.01)).toBe(10001);
  expect(magnitudeCents(100.01)).toBe(10001);
  expect(magnitudeCents(-0.005)).toBe(1);
  expect(magnitudeCents(0)).toBe(0);
  expect(magnitudeCents(-5000)).toBe(magnitudeCents(5000));
});
