import { afterEach, expect, test, vi } from "vitest";
import { YahooHttpClient } from "./http.js";
import { createYahooPriceProvider } from "./priceProvider.js";
import { getYahooSymbolForKnownExchange } from "./symbols.js";
import { notFoundYahooFixture } from "./__fixtures__/not-found.js";

afterEach(() => vi.unstubAllGlobals());

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

const adrRequest = {
  ticker: "TSFAd_EQ",
  exchange: "UNKNOWN",
  symbol: "TSFAd_EQ",
  currency: "EUR",
  isin: "US8740391003",
  today: "2026-01-01",
};

function chartResponse(closes: number[] = [100], currency = "USD") {
  return {
    chart: {
      result: [
        {
          meta: { currency },
          timestamp: closes.map((_, index) => index * 86400),
          indicators: { quote: [{ close: closes }] },
        },
      ],
    },
  };
}

function missingChart(): Error {
  return new Error(`[404] ${notFoundYahooFixture.body}`);
}

test("resolves a missing encoded venue lazily and records actual listing and currency", async () => {
  const fetchJsonWithCrumb = vi
    .fn()
    .mockResolvedValueOnce({ quotes: [] })
    .mockRejectedValueOnce(missingChart())
    .mockResolvedValueOnce(chartResponse());
  const resolveMissingListing = vi.fn().mockResolvedValue("TSM");
  const provider = createYahooPriceProvider({
    client: { fetchJsonWithCrumb } as never,
    resolveMissingListing,
  });
  const result = await provider.get(adrRequest);
  expect(resolveMissingListing).toHaveBeenCalledWith(adrRequest);
  expect(fetchJsonWithCrumb).toHaveBeenCalledTimes(3);
  expect(fetchJsonWithCrumb.mock.calls[1]?.[0]).toContain("/chart/TSFA.DE?");
  expect(fetchJsonWithCrumb.mock.calls[2]?.[0]).toContain("/chart/TSM?");
  expect(result).toMatchObject({
    listing: "TSM",
    problems: [],
    bars: [{ symbol: "TSFAd_EQ", currency: "USD", close: 100 }],
  });
});

test.each(["success", "empty", "rate-limited"])(
  "does not resolve another listing after %s",
  async (kind) => {
    const fetchJsonWithCrumb = vi.fn().mockResolvedValueOnce({ quotes: [] });
    if (kind === "rate-limited")
      fetchJsonWithCrumb.mockRejectedValueOnce(new Error("[429] blocked"));
    else fetchJsonWithCrumb.mockResolvedValueOnce(chartResponse(kind === "empty" ? [] : [100]));
    const resolveMissingListing = vi.fn().mockResolvedValue("TSM");
    const provider = createYahooPriceProvider({
      client: { fetchJsonWithCrumb } as never,
      resolveMissingListing,
    });
    await provider.get(adrRequest);
    expect(resolveMissingListing).not.toHaveBeenCalled();
    expect(fetchJsonWithCrumb).toHaveBeenCalledTimes(2);
  },
);

test.each([
  ["duplicate", "TSFA.DE"],
  ["invalid", "MASI*"],
  ["unknown venue", getYahooSymbolForKnownExchange("TSM", "UNKNOWN")],
  ["conflicting venue", getYahooSymbolForKnownExchange("TSM.DE", "US")],
])("does not retry a %s fallback", async (_, listing) => {
  const fetchJsonWithCrumb = vi
    .fn()
    .mockResolvedValueOnce({ quotes: [] })
    .mockRejectedValueOnce(missingChart());
  const provider = createYahooPriceProvider({
    client: { fetchJsonWithCrumb } as never,
    resolveMissingListing: async () => listing,
  });
  const result = await provider.get(adrRequest);
  expect(result?.bars).toEqual([]);
  expect(fetchJsonWithCrumb).toHaveBeenCalledTimes(2);
});

test("includes both missing listings in the final problem", async () => {
  const fetchJsonWithCrumb = vi
    .fn()
    .mockResolvedValueOnce({ quotes: [] })
    .mockRejectedValueOnce(missingChart())
    .mockRejectedValueOnce(missingChart());
  const provider = createYahooPriceProvider({
    client: { fetchJsonWithCrumb } as never,
    resolveMissingListing: async () => "TSM",
  });
  expect(await provider.get(adrRequest)).toMatchObject({
    bars: [],
    problems: ["No listing found on Yahoo Finance for TSFA.DE (tried 2 symbols)"],
  });
});

test("reports a fallback transport error instead of unresolved identity", async () => {
  const fetchJsonWithCrumb = vi
    .fn()
    .mockResolvedValueOnce({ quotes: [] })
    .mockRejectedValueOnce(missingChart())
    .mockRejectedValueOnce(new Error("[429] blocked"));
  const provider = createYahooPriceProvider({
    client: { fetchJsonWithCrumb } as never,
    resolveMissingListing: async () => "TSM",
  });
  expect(await provider.get(adrRequest)).toMatchObject({
    bars: [],
    problems: ["Yahoo Finance rate-limited price request"],
  });
});

test("reuses one default Yahoo session across broker symbols", async () => {
  const requested: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      requested.push(url);
      if (url === "https://fc.yahoo.com/")
        return new Response("", { headers: { "set-cookie": "A=B; Path=/" } });
      if (url.includes("getcrumb")) return new Response("crumb-value");
      return new Response(JSON.stringify(chartResponse()), {
        headers: { "content-type": "application/json" },
      });
    }),
  );
  const provider = createYahooPriceProvider();
  for (const ticker of ["CPRX_US_EQ", "AAPL_US_EQ"]) {
    const result = await provider.get({ ...request, ticker, symbol: ticker });
    expect(result?.problems).toEqual([]);
    expect(result?.bars[0]?.symbol).toBe(ticker);
  }
  expect(requested.filter((url) => url === "https://fc.yahoo.com/")).toHaveLength(1);
  expect(requested.filter((url) => url.includes("getcrumb"))).toHaveLength(1);
  expect(requested.filter((url) => url.includes("/chart/"))).toHaveLength(2);
});
