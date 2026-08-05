import { expect, test } from "vitest";
import { crossRate, routeNet, rankRoutes, parseFxRatePayload, FX_ROUTES, FX_RATE_FALLBACK } from "./fx.js";

const RATE = { base: "EUR", date: "2026-08-04", rates: { USD: 1.15, GBP: 0.85 } };

test("crossRate: base identity, to-base, and cross", () => {
  expect(crossRate("EUR", "USD", RATE)).toBeCloseTo(1.15, 6);
  expect(crossRate("USD", "EUR", RATE)).toBeCloseTo(1 / 1.15, 6);
  expect(crossRate("USD", "GBP", RATE)).toBeCloseTo(0.85 / 1.15, 6);
  expect(crossRate("USD", "USD", RATE)).toBe(1);
});

test("crossRate throws on an unknown currency", () => {
  expect(() => crossRate("EUR", "XXX", RATE)).toThrow();
});

test("routeNet: spread + fixed fee reduce what you receive; cost vs mid is positive", () => {
  const mid = 1.15; // EUR->USD
  const r = routeNet(1000, mid, { provider: "Test", spreadPct: 1, fixedFeeFrom: 10 });
  // (1000 - 10) * 1.15 * 0.99 = 1127.115
  expect(r.netReceived).toBeCloseTo(1127.115, 3);
  expect(r.totalCostPct).toBeGreaterThan(0);
  expect(r.effectiveRate).toBeCloseTo(1127.115 / 1000, 6);
});

test("routeNet clamps a fixed fee larger than the amount to zero received", () => {
  const r = routeNet(5, 1.15, { provider: "Test", spreadPct: 0, fixedFeeFrom: 10 });
  expect(r.netReceived).toBe(0);
});

test("rankRoutes sorts by net received, best first", () => {
  const ranked = rankRoutes(1000, "EUR", "USD", RATE, [
    { provider: "Cheap", spreadPct: 0.5 },
    { provider: "Pricey", spreadPct: 2 },
  ]);
  expect(ranked[0].provider).toBe("Cheap");
  expect(ranked[0].netReceived).toBeGreaterThan(ranked[1].netReceived);
});

test("parseFxRatePayload accepts a Frankfurter-shaped payload and rejects junk", () => {
  const ok = parseFxRatePayload({ amount: 1, base: "EUR", date: "2026-08-04", rates: { USD: 1.15 } });
  expect(ok).toEqual({ base: "EUR", date: "2026-08-04", rates: { USD: 1.15 } });
  expect(parseFxRatePayload({ base: "EUR" })).toBeNull();
  expect(parseFxRatePayload(null)).toBeNull();
  expect(parseFxRatePayload({ base: "EUR", date: "x", rates: { USD: "nope" } })).toBeNull();
});

test("bundled route table and fallback rate are non-empty and well-formed", () => {
  expect(FX_ROUTES.length).toBeGreaterThan(2);
  expect(FX_ROUTES.every((r) => typeof r.spreadPct === "number")).toBe(true);
  expect(FX_RATE_FALLBACK.base).toBe("EUR");
  expect(FX_RATE_FALLBACK.rates.USD).toBeGreaterThan(0);
});
