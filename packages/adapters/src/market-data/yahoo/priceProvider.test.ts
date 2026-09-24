import { expect, test } from "vitest";
import { YahooHttpClient } from "./http.js";
import { createYahooPriceProvider } from "./priceProvider.js";
import { notFoundYahooFixture } from "./__fixtures__/not-found.js";

const request = {
  ticker: "SKX_US_EQ",
  exchange: "",
  symbol: "SKX_US_EQ",
  currency: "USD",
  today: "2026-01-01",
};

test("reports a no-listing problem naming the primary symbol, not the last fallback, when every candidate 404s as not-found", async () => {
  const fetchFn = (async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url === "https://fc.yahoo.com/")
      return new Response("", { headers: { "set-cookie": "A=B; Path=/" } });
    if (url.includes("getcrumb")) return new Response("crumb-value");
    return new Response(notFoundYahooFixture.body, { status: notFoundYahooFixture.status });
  }) as typeof fetch;
  const provider = createYahooPriceProvider({ client: new YahooHttpClient(fetchFn, 20_000, 1) });

  const result = await provider.get(request);

  expect(result?.problems).toEqual([
    "No listing found on Yahoo Finance for SKX (tried 16 symbols) - the instrument is probably delisted",
  ]);
});
