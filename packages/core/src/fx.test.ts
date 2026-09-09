import { expect, test } from "vitest";
import {
  crossRate,
  normalizeCurrencyCode,
  parseFxRatePayload,
  FX_RATE_FALLBACK,
  rateOn,
  toEur,
} from "./fx.js";

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

const HISTORY = {
  HUF: {
    "2026-09-04": 398, // Friday
    "2026-09-07": 400, // Monday
  },
  USD: {
    "2026-09-07": 1.08,
  },
};

test.each([
  ["exact-day hit", HISTORY, "HUF", "2026-09-07", 400],
  ["Saturday falls back to preceding Friday", HISTORY, "HUF", "2026-09-05", 398],
  ["Sunday falls back to preceding Friday", HISTORY, "HUF", "2026-09-06", 398],
  ["no entry within 10 days returns null", HISTORY, "HUF", "2026-01-01", null],
  ["unknown currency returns null", HISTORY, "XXX", "2026-09-07", null],
  ["empty history returns null", {}, "HUF", "2026-09-07", null],
  ["date exists but only for a different currency", HISTORY, "USD", "2026-09-04", null],
] as const)("rateOn: %s", (_label, history, currency, date, expected) => {
  expect(rateOn(history, currency, date)).toBe(expected);
});

test("rateOn walks backward across a month boundary", () => {
  const history = { HUF: { "2026-08-31": 397 } };
  expect(rateOn(history, "HUF", "2026-09-03")).toBe(397);
});

test("rateOn never walks forward past the requested date", () => {
  const history = { HUF: { "2026-09-08": 401 } };
  expect(rateOn(history, "HUF", "2026-09-07")).toBeNull();
});

test("rateOn returns null for a zero rate on an exact-date hit, not 0", () => {
  expect(rateOn({ HUF: { "2026-08-03": 0 } }, "HUF", "2026-08-03")).toBeNull();
});

test("rateOn returns null for a negative rate on an exact-date hit", () => {
  expect(rateOn({ HUF: { "2026-08-03": -5 } }, "HUF", "2026-08-03")).toBeNull();
});

test("rateOn returns null for a zero rate found by the backward walk, not 0", () => {
  expect(rateOn({ HUF: { "2026-08-31": 0 } }, "HUF", "2026-09-03")).toBeNull();
});

test("rateOn returns null for a negative rate found by the backward walk", () => {
  expect(rateOn({ HUF: { "2026-08-31": -5 } }, "HUF", "2026-09-03")).toBeNull();
});

test("toEur: worked example, 300000 HUF at 400 HUF/EUR is exactly 750 EUR", () => {
  expect(toEur(300000, "HUF", "2026-09-07", HISTORY)).toBe(750);
});

test("toEur: EUR passes through unchanged, no history lookup needed", () => {
  expect(toEur(123.45, "EUR", "2026-09-07", {})).toBe(123.45);
  expect(toEur(-50, "eur", "2026-09-07", {})).toBe(-50);
});

test("toEur: a negative amount preserves sign", () => {
  expect(toEur(-300000, "HUF", "2026-09-07", HISTORY)).toBe(-750);
});

test("toEur: a missing rate returns null", () => {
  expect(toEur(1000, "HUF", "2026-01-01", HISTORY)).toBeNull();
});

test("toEur: a zero rate returns null, not Infinity", () => {
  const result = toEur(1000, "HUF", "2026-08-03", { HUF: { "2026-08-03": 0 } });
  expect(result).toBeNull();
  expect(result === Infinity).toBe(false);
});

test("toEur: a zero rate with a zero amount returns null, not NaN", () => {
  expect(toEur(0, "HUF", "2026-08-03", { HUF: { "2026-08-03": 0 } })).toBeNull();
});

test("toEur: a negative rate returns null, not a division result", () => {
  expect(toEur(1000, "HUF", "2026-08-03", { HUF: { "2026-08-03": -5 } })).toBeNull();
});

test.each([
  ["lowercase", "huf"],
  ["mixed case", "Huf"],
  ["padded with whitespace", " huf "],
] as const)("rateOn: %s currency resolves the same as the uppercase key", (_label, currency) => {
  expect(rateOn(HISTORY, currency, "2026-09-07")).toBe(rateOn(HISTORY, "HUF", "2026-09-07"));
});

test("toEur: a lowercase currency code resolves the same rate as its uppercase form", () => {
  expect(toEur(300000, "huf", "2026-09-07", HISTORY)).toBe(
    toEur(300000, "HUF", "2026-09-07", HISTORY),
  );
});
