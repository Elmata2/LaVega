import { expect, test } from "vitest";
import { YahooHttpClient } from "./http.js";
import { loadYahooPriceHistory } from "./history.js";
import { createYahooPriceProvider } from "./priceProvider.js";

type Chart = {
  currency?: string;
  closes?: number[];
  splits?: Array<{ day: number; numerator: number; denominator: number }>;
};

function stubClient(
  charts: Record<string, Chart>,
  search: Record<string, string> = {},
): { client: YahooHttpClient; charts: string[] } {
  const requested: string[] = [];
  const fetchFn = (async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url === "https://fc.yahoo.com/")
      return new Response("", { headers: { "set-cookie": "A=B; Path=/" } });
    if (url.includes("getcrumb")) return new Response("crumb-value");
    const json = (body: unknown) =>
      new Response(JSON.stringify(body), { headers: { "content-type": "application/json" } });
    if (url.includes("/v1/finance/search")) {
      const query = new URL(url).searchParams.get("q")!;
      return json({ quotes: search[query] ? [{ symbol: search[query] }] : [] });
    }
    const symbol = decodeURIComponent(url.slice(url.indexOf("/chart/") + 7, url.indexOf("?")));
    requested.push(symbol);
    const chart = charts[symbol];
    if (!chart)
      return new Response(
        JSON.stringify({ chart: { result: null, error: { description: "No data found" } } }),
        { status: 404 },
      );
    return json({
      chart: {
        result: [
          {
            meta: { currency: chart.currency },
            timestamp: (chart.closes ?? []).map((_, index) => index * 86400),
            indicators: { quote: [{ close: chart.closes ?? [] }] },
            events: {
              splits: Object.fromEntries(
                (chart.splits ?? []).map((split) => [
                  String(split.day),
                  {
                    date: split.day * 86400,
                    numerator: split.numerator,
                    denominator: split.denominator,
                  },
                ]),
              ),
            },
          },
        ],
      },
    });
  }) as typeof fetch;
  return { client: new YahooHttpClient(fetchFn, 20_000, 1), charts: requested };
}

test("passes over a listing that carries no closes and keeps looking", async () => {
  const { client, charts } = stubClient({
    "BY6.DE": { currency: "EUR", closes: [] },
    "BY6.VI": { currency: "EUR", closes: [10, 11] },
  });

  const history = await loadYahooPriceHistory({ ticker: "BY6d_EQ", exchange: "UNKNOWN", client });

  expect(history.symbol).toBe("BY6.VI");
  expect(history.points.map((point) => point.close)).toEqual([10, 11]);
  expect(charts).toContain("BY6.DE");
});

test("resolves the exact listing from the ISIN before guessing suffixes", async () => {
  const { client, charts } = stubClient(
    { "NOVN.SW": { currency: "CHF", closes: [90] } },
    { CH0012005267: "NOVN.SW" },
  );

  const history = await loadYahooPriceHistory({
    ticker: "NOVCd_EQ",
    exchange: "UNKNOWN",
    isin: "CH0012005267",
    client,
  });

  expect(history).toMatchObject({ symbol: "NOVN.SW", currency: "CHF" });
  expect(charts).toEqual(["NOVN.SW"]);
});

test("reports the quote currency so pence listings are not read as pounds", async () => {
  const { client } = stubClient({ "HLMA.L": { currency: "GBp", closes: [3555] } });

  const history = await loadYahooPriceHistory({ ticker: "HLMAl_EQ", exchange: "UNKNOWN", client });

  expect(history.currency).toBe("GBp");
});

test("returns an empty series rather than failing when no listing has closes", async () => {
  const { client } = stubClient({ "SOF.BR": { currency: "EUR", closes: [] } });

  const history = await loadYahooPriceHistory({ ticker: "SOF_BE_EQ", exchange: "UNKNOWN", client });

  expect(history).toMatchObject({ symbol: "SOF.BR", points: [] });
});

test("records each split on the bar of the session it takes effect", async () => {
  const { client } = stubClient({
    IBKR: {
      currency: "USD",
      closes: [50, 51, 52],
      splits: [{ day: 1, numerator: 4, denominator: 1 }],
    },
  });
  const provider = createYahooPriceProvider({ client, today: () => "1970-01-03" });

  const result = await provider.get({
    ticker: "IBKR_US_EQ",
    exchange: "UNKNOWN",
    symbol: "IBKR_US_EQ",
    currency: "USD",
    from: "1970-01-01",
  });

  expect(result?.bars.map(({ date, split }) => ({ date, split }))).toEqual([
    { date: "1970-01-01", split: 1 },
    { date: "1970-01-02", split: 4 },
    { date: "1970-01-03", split: 1 },
  ]);
});
