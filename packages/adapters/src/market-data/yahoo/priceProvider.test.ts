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

test.each([
  ["SKX_US_EQ", "SKX", "SKX.F"],
  ["MASI_US_EQ", "MASI", "MASI.MI"],
])(
  "reports unresolved %s instead of accepting another company's chart",
  async (ticker, primary, unrelated) => {
    const requested: string[] = [];
    const fetchFn = (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "https://fc.yahoo.com/")
        return new Response("", { headers: { "set-cookie": "A=B; Path=/" } });
      if (url.includes("getcrumb")) return new Response("crumb-value");
      const symbol = decodeURIComponent(url.slice(url.indexOf("/chart/") + 7, url.indexOf("?")));
      requested.push(symbol);
      if (symbol === unrelated) {
        return new Response(
          JSON.stringify({
            chart: {
              result: [
                {
                  meta: { currency: "EUR" },
                  timestamp: [0],
                  indicators: { quote: [{ close: [10] }] },
                },
              ],
            },
          }),
        );
      }
      return new Response(notFoundYahooFixture.body, { status: notFoundYahooFixture.status });
    }) as typeof fetch;
    const provider = createYahooPriceProvider({ client: new YahooHttpClient(fetchFn, 20_000, 1) });

    const result = await provider.get({ ...request, ticker, symbol: ticker });

    expect(result?.bars).toEqual([]);
    expect(requested).toEqual([primary]);
    expect(result?.problems).toEqual([
      `No listing found on Yahoo Finance for ${primary} (tried 1 symbol)`,
    ]);
  },
);
