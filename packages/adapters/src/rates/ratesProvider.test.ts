import { expect, test } from "vitest";
import { createRatesProvider, parseRatesPayload, type RatesCache } from "./ratesProvider.js";

const payload = {
  asOf: "2026-08-03",
  rates: [{ bank: "Test Bank", product: "Spaar", ratePct: 3.14, freeWithdrawal: true }],
};
const okFetch = (async () => ({ ok: true, json: async () => payload })) as unknown as typeof fetch;
const failFetch = (async () => {
  throw new Error("offline");
}) as unknown as typeof fetch;
const memCache = (): RatesCache => {
  let v: any = null;
  return {
    get: () => v,
    set: (x) => {
      v = x;
    },
  };
};

test("parseRatesPayload accepts valid, rejects malformed", () => {
  expect(parseRatesPayload(payload).rates[0].ratePct).toBe(3.14);
  expect(() => parseRatesPayload({ asOf: "x" })).toThrow();
  expect(() => parseRatesPayload({ asOf: "x", rates: [{ bank: "B" }] })).toThrow();
  expect(() => parseRatesPayload({ asOf: "x", rates: [] })).toThrow();
});

test("live fetch success -> source live + cached", async () => {
  const cache = memCache();
  const p = createRatesProvider({
    url: "http://x/api/rates",
    fetchFn: okFetch,
    cache,
    now: () => 123,
  });
  const r = await p.getRates();
  expect(r.source).toBe("live");
  expect(r.rates[0].bank).toBe("Test Bank");
  expect(cache.get()).toMatchObject({ asOf: "2026-08-03", ts: 123 });
});

test("fetch fails but fresh cache present -> source cache", async () => {
  const cache = memCache();
  cache.set({ ...payload, ts: 1000 });
  const p = createRatesProvider({
    url: "http://x/api/rates",
    fetchFn: failFetch,
    cache,
    now: () => 2000,
  });
  const r = await p.getRates();
  expect(r.source).toBe("cache");
  expect(r.rates[0].bank).toBe("Test Bank");
});

test("fetch fails and cache is STALE (beyond TTL) -> bundled, not stale cache", async () => {
  const cache = memCache();
  cache.set({ ...payload, ts: 0 });
  const p = createRatesProvider({
    url: "http://x/api/rates",
    fetchFn: failFetch,
    cache,
    cacheTtlMs: 1000,
    now: () => 999999,
  });
  expect((await p.getRates()).source).toBe("bundled");
});

test("fetch fails and no cache -> bundled offline fallback", async () => {
  const p = createRatesProvider({
    url: "http://x/api/rates",
    fetchFn: failFetch,
    cache: memCache(),
  });
  const r = await p.getRates();
  expect(r.source).toBe("bundled");
  expect(r.rates.length).toBeGreaterThan(0);
});

test("no url -> bundled (never fetches)", async () => {
  const p = createRatesProvider({ cache: memCache() });
  expect((await p.getRates()).source).toBe("bundled");
});

test("bad HTTP status -> fallback, not throw", async () => {
  const badStatus = (async () => ({
    ok: false,
    json: async () => ({}),
  })) as unknown as typeof fetch;
  const p = createRatesProvider({ url: "http://x", fetchFn: badStatus, cache: memCache() });
  expect((await p.getRates()).source).toBe("bundled");
});

/* CATALOGUE RATES OUTRANK THE SCRAPE, and merge with it rather than replacing it. */
test("a bank's own document beats the live comparison figure for the same product", async () => {
  const live = {
    asOf: "2026-08-19",
    rates: [{ bank: "ABN AMRO", product: "Direct Sparen", ratePct: 1.3, freeWithdrawal: true }],
  };
  const p = createRatesProvider({
    url: "https://x/api/rates",
    fetchFn: (async () => ({ ok: true, json: async () => live })) as unknown as typeof fetch,
    cache: { get: () => null, set: () => {} },
    catalogueRates: [
      {
        bank: "ABN AMRO",
        product: "Direct Sparen",
        ratePct: 1.25,
        freeWithdrawal: true,
        sourceUrl: "https://abn/fid.pdf",
        asOf: "2025-05-01",
      },
    ],
  });
  const got = await p.getRates();
  expect(got.rates).toHaveLength(1);
  expect(got.rates[0].ratePct).toBe(1.25);
  // The row carries ITS OWN date, which is what one shared asOf could never do —
  // this figure is fifteen months old and must be able to say so.
  expect(got.rates[0].asOf).toBe("2025-05-01");
  expect(got.rates[0].sourceUrl).toBe("https://abn/fid.pdf");
});

test("a product only the scrape knows is kept, not dropped by the catalogue", async () => {
  const live = {
    asOf: "2026-08-19",
    rates: [{ bank: "Klarna", product: "Flex rekening", ratePct: 1.95, freeWithdrawal: true }],
  };
  const p = createRatesProvider({
    url: "https://x/api/rates",
    fetchFn: (async () => ({ ok: true, json: async () => live })) as unknown as typeof fetch,
    cache: { get: () => null, set: () => {} },
    catalogueRates: [
      {
        bank: "Triodos",
        product: "Internet Sparen",
        ratePct: 1.15,
        freeWithdrawal: true,
        sourceUrl: "https://t/x",
        asOf: "2026-02-01",
      },
    ],
  });
  const got = await p.getRates();
  expect(got.rates.map((r) => r.bank).sort()).toEqual(["Klarna", "Triodos"]);
});

test("supplying no catalogue rates changes nothing", async () => {
  const live = {
    asOf: "2026-08-19",
    rates: [{ bank: "Klarna", product: "Flex rekening", ratePct: 1.95, freeWithdrawal: true }],
  };
  const p = createRatesProvider({
    url: "https://x/api/rates",
    fetchFn: (async () => ({ ok: true, json: async () => live })) as unknown as typeof fetch,
    cache: { get: () => null, set: () => {} },
  });
  expect((await p.getRates()).rates).toEqual(live.rates);
});
