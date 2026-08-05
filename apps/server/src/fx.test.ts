import { afterEach, expect, test, vi } from "vitest";

afterEach(() => vi.restoreAllMocks());

test("getFxRate returns the parsed live payload on a good response", async () => {
  vi.stubGlobal("fetch", vi.fn(async () =>
    new Response(JSON.stringify({ amount: 1, base: "EUR", date: "2026-08-04", rates: { USD: 1.15, GBP: 0.85 } }), {
      status: 200,
      headers: { "content-type": "application/json" },
    }),
  ));
  const { getFxRate } = await import("./fx.js");
  const r = await getFxRate();
  expect(r.base).toBe("EUR");
  expect(r.rates.USD).toBeCloseTo(1.15, 6);
});
