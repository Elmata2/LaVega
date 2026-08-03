import { expect, test } from "vitest";
import { createRatesProvider, parseRatesPayload, type RatesCache } from "./ratesProvider.js";

const payload = { asOf: "2026-08-03", rates: [{ bank: "Test Bank", product: "Spaar", ratePct: 3.14, freeWithdrawal: true }] };
const okFetch = (async () => ({ ok: true, json: async () => payload })) as unknown as typeof fetch;
const failFetch = (async () => { throw new Error("offline"); }) as unknown as typeof fetch;
const memCache = (): RatesCache => {
  let v: any = null;
  return { get: () => v, set: (x) => { v = x; } };
};

test("parseRatesPayload accepts valid, rejects malformed", () => {
  expect(parseRatesPayload(payload).rates[0].ratePct).toBe(3.14);
  expect(() => parseRatesPayload({ asOf: "x" })).toThrow();
  expect(() => parseRatesPayload({ asOf: "x", rates: [{ bank: "B" }] })).toThrow();
  expect(() => parseRatesPayload({ asOf: "x", rates: [] })).toThrow();
});

test("live fetch success -> source live + cached", async () => {
  const cache = memCache();
  const p = createRatesProvider({ url: "http://x/api/rates", fetchFn: okFetch, cache, now: () => 123 });
  const r = await p.getRates();
  expect(r.source).toBe("live");
  expect(r.rates[0].bank).toBe("Test Bank");
  expect(cache.get()).toMatchObject({ asOf: "2026-08-03", ts: 123 });
});

test("fetch fails but cache present -> source cache", async () => {
  const cache = memCache();
  cache.set({ ...payload, ts: 1 });
  const p = createRatesProvider({ url: "http://x/api/rates", fetchFn: failFetch, cache });
  const r = await p.getRates();
  expect(r.source).toBe("cache");
  expect(r.rates[0].bank).toBe("Test Bank");
});

test("fetch fails and no cache -> bundled offline fallback", async () => {
  const p = createRatesProvider({ url: "http://x/api/rates", fetchFn: failFetch, cache: memCache() });
  const r = await p.getRates();
  expect(r.source).toBe("bundled");
  expect(r.rates.length).toBeGreaterThan(0);
});

test("no url -> bundled (never fetches)", async () => {
  const p = createRatesProvider({ cache: memCache() });
  expect((await p.getRates()).source).toBe("bundled");
});

test("bad HTTP status -> fallback, not throw", async () => {
  const badStatus = (async () => ({ ok: false, json: async () => ({}) })) as unknown as typeof fetch;
  const p = createRatesProvider({ url: "http://x", fetchFn: badStatus, cache: memCache() });
  expect((await p.getRates()).source).toBe("bundled");
});
