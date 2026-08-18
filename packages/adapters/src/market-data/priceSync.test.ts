import { expect, test, vi } from "vitest";
import { MarketDataRouter } from "./providerRouter.js";
import { createMemoryYahooConsentStore } from "./yahoo/disclosure.js";
import { blockedYahooFixture } from "./yahoo/__fixtures__/blocked.js";
import { rateLimitedYahooFixture } from "./yahoo/__fixtures__/rate-limited.js";
import { createYahooPriceProvider, type PriceProviderResult, type YahooPriceRequest } from "./yahoo/priceProvider.js";
import { createInMemoryPriceStore } from "../prices/inMemoryPriceStore.js";
import { syncPrices } from "./priceSync.js";

const request = { ticker: "ASML", exchange: "AMS", symbol: "ASML", currency: "EUR", today: "2026-01-03" };

function router(provider: ReturnType<typeof createYahooPriceProvider>) {
  return new MarketDataRouter<YahooPriceRequest, PriceProviderResult, never, never, never, never>({ price: [provider], fx: [], identifier: [] });
}

test("does not call Yahoo before consent, then keeps consent for later calls", async () => {
  const fetchJsonWithCrumb = vi.fn(async () => ({ chart: { result: [] } }));
  const consent = createMemoryYahooConsentStore();
  const provider = createYahooPriceProvider({ consent, client: { fetchJsonWithCrumb } as never });
  await expect(provider.get(request)).resolves.toMatchObject({ problems: [expect.stringContaining("disclosure")] });
  expect(fetchJsonWithCrumb).not.toHaveBeenCalled();
  consent.recordConsent();
  await provider.get(request);
  expect(fetchJsonWithCrumb).toHaveBeenCalledTimes(1);
});

test.each(["Yahoo Finance rate-limited price request", "Yahoo Finance blocked price request"])("preserves provider problem %s through router sync", async (problem) => {
  const store = createInMemoryPriceStore();
  const router = new MarketDataRouter<YahooPriceRequest, PriceProviderResult, never, never, never, never>({
    price: [{ sourceKey: "yahoo", priority: 10, get: async () => ({ bars: [], problems: [problem] }) }],
    fx: [], identifier: [],
  });
  await expect(syncPrices({ store, router, request: { symbol: "ASML", ticker: "ASML", exchange: "AMS", currency: "EUR", today: "2026-01-01" } })).resolves.toMatchObject({ problems: [problem] });
});

test.each([
  [`[${rateLimitedYahooFixture.status}] ${rateLimitedYahooFixture.body}`, "rate-limited"],
  [`[${blockedYahooFixture.status}] ${blockedYahooFixture.body}`, "blocked"],
])("reports Yahoo fixture response %s as %s", async (error, expected) => {
  const provider = createYahooPriceProvider({ consent: createMemoryYahooConsentStore(true), client: { fetchJsonWithCrumb: async () => { throw new Error(error); } } as never });
  await expect(provider.get(request)).resolves.toMatchObject({ problems: [expect.stringContaining(expected)] });
});

test("backfills once and top-ups from PriceStore lastDate without wiping cache", async () => {
  const urls: string[] = [];
  const client = { fetchJsonWithCrumb: vi.fn(async (url: string) => {
    urls.push(url);
    const start = Number(url.match(/period1=(\d+)/)?.[1] ?? 1767225600);
    return { chart: { result: [{ timestamp: [start], indicators: { quote: [{ close: [100] }] } }] } };
  }) } as never;
  const store = createInMemoryPriceStore();
  const provider = createYahooPriceProvider({ consent: createMemoryYahooConsentStore(true), client });
  const r = router(provider);
  await expect(syncPrices({ store, router: r, request: { ...request, today: "2026-01-01" } })).resolves.toMatchObject({ problems: [], fetched: true });
  await expect(syncPrices({ store, router: r, request: { ...request, today: "2026-01-02" } })).resolves.toMatchObject({ problems: [], fetched: true });
  expect(urls[0]).toContain("range=5y");
  expect(urls[1]).toContain("period1=1767312000");
});
