import { expect, test, vi } from "vitest";
import { blockedYahooFixture } from "./yahoo/__fixtures__/blocked.js";
import { rateLimitedYahooFixture } from "./yahoo/__fixtures__/rate-limited.js";
import { createYahooPriceProvider } from "./yahoo/priceProvider.js";
import { createInMemoryPriceStore } from "../prices/inMemoryPriceStore.js";
import { syncPrices } from "./priceSync.js";
import { YahooHttpClient } from "./yahoo/http.js";

const request = {
  ticker: "ASML",
  exchange: "AMS",
  symbol: "ASML",
  currency: "EUR",
  today: "2026-01-03",
};

function lane(provider: ReturnType<typeof createYahooPriceProvider>) {
  return [provider];
}

test("calls Yahoo directly without a consent gate", async () => {
  const fetchJsonWithCrumb = vi.fn(async () => ({ chart: { result: [] } }));
  const provider = createYahooPriceProvider({ client: { fetchJsonWithCrumb } as never });
  await provider.get(request);
  expect(fetchJsonWithCrumb).toHaveBeenCalledTimes(1);
});

test.each(["Yahoo Finance rate-limited price request", "Yahoo Finance blocked price request"])(
  "preserves provider problem %s through sync",
  async (problem) => {
    const store = createInMemoryPriceStore();
    const priceProviders = [
      { sourceKey: "yahoo", priority: 10, get: async () => ({ bars: [], problems: [problem] }) },
    ];
    await expect(
      syncPrices({
        store,
        tenantId: "local",
        priceProviders,
        request: {
          symbol: "ASML",
          ticker: "ASML",
          exchange: "AMS",
          currency: "EUR",
          today: "2026-01-01",
        },
      }),
    ).resolves.toMatchObject({ problems: [problem] });
  },
);

test.each([
  [rateLimitedYahooFixture, "rate-limited"],
  [blockedYahooFixture, "blocked"],
])("reports Yahoo HTTP fixture response %o as %s", async (fixture, expected) => {
  const fetchFn = vi.fn(async (url: RequestInfo | URL) => {
    const target = String(url);
    if (target === "https://fc.yahoo.com/")
      return new Response("", { headers: { "set-cookie": "A=B; Path=/" } });
    if (target.includes("getcrumb")) return new Response("crumb");
    return new Response(fixture.body, { status: fixture.status });
  }) as unknown as typeof fetch;
  const provider = createYahooPriceProvider({ client: new YahooHttpClient(fetchFn, 20_000, 0) });
  await expect(provider.get(request)).resolves.toMatchObject({
    problems: [expect.stringContaining(expected)],
  });
});

test("backfills once and top-ups from PriceStore lastDate without wiping cache", async () => {
  const urls: string[] = [];
  const client = {
    fetchJsonWithCrumb: vi.fn(async (url: string) => {
      urls.push(url);
      const start = Number(url.match(/period1=(\d+)/)?.[1] ?? 1767225600);
      return {
        chart: { result: [{ timestamp: [start], indicators: { quote: [{ close: [100] }] } }] },
      };
    }),
  } as never;
  const store = createInMemoryPriceStore();
  const provider = createYahooPriceProvider({ client });
  const r = lane(provider);
  await expect(
    syncPrices({
      store,
      tenantId: "local",
      priceProviders: r,
      request: { ...request, today: "2026-01-01" },
    }),
  ).resolves.toMatchObject({ problems: [], fetched: true });
  await expect(
    syncPrices({
      store,
      tenantId: "local",
      priceProviders: r,
      request: { ...request, today: "2026-01-02" },
    }),
  ).resolves.toMatchObject({ problems: [], fetched: true });
  expect(urls[0]).toContain("range=5y");
  expect(urls[1]).toContain("period1=1767312000");
});

test("writes bars under the tenant the sync was asked for, not one a provider names", async () => {
  const client = {
    fetchJsonWithCrumb: vi.fn(async () => ({
      chart: { result: [{ timestamp: [1767225600], indicators: { quote: [{ close: [100] }] } }] },
    })),
  } as never;
  const store = createInMemoryPriceStore();
  await syncPrices({
    store,
    tenantId: "user-b",
    priceProviders: lane(createYahooPriceProvider({ client })),
    request: { ...request, today: "2026-01-02" },
  });

  await expect(store.getRange("user-b", "ASML")).resolves.toHaveLength(1);
  await expect(store.getRange("local", "ASML")).resolves.toEqual([]);
});

test("labels a London pence quote GBX so it cannot be read as pounds", async () => {
  const fetchJsonWithCrumb = vi.fn(async () => ({
    chart: {
      result: [
        {
          meta: { currency: "GBp" },
          timestamp: [Math.floor(Date.parse("2026-01-02T00:00:00Z") / 1000)],
          indicators: { quote: [{ close: [3592] }] },
        },
      ],
    },
  }));
  const provider = createYahooPriceProvider({ client: { fetchJsonWithCrumb } as never });
  const result = await provider.get({ ...request, symbol: "HLMAl_EQ", currency: "GBX" });
  expect(result?.bars.map((bar) => bar.currency)).toEqual(["GBX"]);
});
