import { expect, test } from "vitest";
import { crossRate, normalizeCurrencyCode, parseFxRatePayload, FX_RATE_FALLBACK } from "./fx.js";

const RATE = { base: "EUR", date: "2026-08-04", rates: { USD: 1.15, GBP: 0.85 } };

test("crossRate: base identity, to-base, and cross", () => {
  expect(crossRate("EUR", "USD", RATE)).toBeCloseTo(1.15, 6);
  expect(crossRate("USD", "EUR", RATE)).toBeCloseTo(1 / 1.15, 6);
  expect(crossRate("USD", "GBP", RATE)).toBeCloseTo(0.85 / 1.15, 6);
  expect(crossRate("USD", "USD", RATE)).toBe(1);
});

test("crossRate reads London pence as a hundredth of a pound", () => {
  expect(crossRate("GBp", "GBP", RATE)).toBeCloseTo(0.01, 9);
  expect(crossRate("GBX", "GBP", RATE)).toBeCloseTo(0.01, 9);
  expect(crossRate("GBP", "GBp", RATE)).toBeCloseTo(100, 6);
  expect(crossRate("GBp", "EUR", RATE)).toBeCloseTo(1 / 85, 9);
  expect(crossRate("GBp", "GBp", RATE)).toBe(1);
});

test("normalizeCurrencyCode keeps pence apart from pounds", () => {
  expect(normalizeCurrencyCode("GBp")).toBe("GBX");
  expect(normalizeCurrencyCode("gbx")).toBe("GBX");
  expect(normalizeCurrencyCode("GBX")).toBe("GBX");
  expect(normalizeCurrencyCode("GBP")).toBe("GBP");
  expect(normalizeCurrencyCode(" usd ")).toBe("USD");
});

test("normalized pence still cross at a hundredth of a pound", () => {
  expect(crossRate(normalizeCurrencyCode("GBp"), "GBP", RATE)).toBeCloseTo(0.01, 9);
});

test("crossRate throws on an unknown currency", () => {
  expect(() => crossRate("EUR", "XXX", RATE)).toThrow();
});

test("parseFxRatePayload accepts a Frankfurter-shaped payload and rejects junk", () => {
  const ok = parseFxRatePayload({
    amount: 1,
    base: "EUR",
    date: "2026-08-04",
    rates: { USD: 1.15 },
  });
  expect(ok).toEqual({ base: "EUR", date: "2026-08-04", rates: { USD: 1.15 } });
  expect(parseFxRatePayload({ base: "EUR" })).toBeNull();
  expect(parseFxRatePayload(null)).toBeNull();
  expect(parseFxRatePayload({ base: "EUR", date: "x", rates: { USD: "nope" } })).toBeNull();
});

test("fallback rate is well-formed", () => {
  expect(FX_RATE_FALLBACK.base).toBe("EUR");
  expect(FX_RATE_FALLBACK.rates.USD).toBeGreaterThan(0);
});
