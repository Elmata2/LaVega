import {
  benchmarkDisplayName,
  normalizeCurrencyCode,
  type BenchmarkInstrument,
} from "@lavega/core";
import { YahooHttpClient } from "./http.js";
import { isKnownYahooExchange } from "./symbols.js";
import type { YahooChartResponse } from "./types.js";

type SearchQuote = {
  symbol?: string;
  shortname?: string;
  longname?: string;
  exchange?: string;
  exchDisp?: string;
  quoteType?: string;
  currency?: string;
};
type SearchResponse = { quotes?: SearchQuote[] };

export const CURATED_EUROPEAN_BENCHMARKS: BenchmarkInstrument[] = [
  {
    symbol: "^STOXX50E",
    name: benchmarkDisplayName("^STOXX50E"),
    exchange: "STOXX",
    currency: "EUR",
  },
  { symbol: "^AEX", name: benchmarkDisplayName("^AEX"), exchange: "Amsterdam", currency: "EUR" },
  {
    symbol: "^GDAXI",
    name: benchmarkDisplayName("^GDAXI"),
    exchange: "Frankfurt",
    currency: "EUR",
  },
  { symbol: "^FCHI", name: benchmarkDisplayName("^FCHI"), exchange: "Paris", currency: "EUR" },
];

async function confirmedCurrency(
  client: YahooHttpClient,
  quote: SearchQuote,
): Promise<string | null> {
  if (quote.currency) return normalizeCurrencyCode(quote.currency);
  if (!quote.symbol) return null;
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(quote.symbol)}?range=1d&interval=1d`;
  const response = await client.fetchJsonWithCrumb<YahooChartResponse>(url);
  const meta = response.chart?.result?.[0]?.meta?.currency;
  return meta ? normalizeCurrencyCode(meta) : null;
}

const ISIN = /^[A-Z]{2}[A-Z0-9]{9}[0-9]$/;

/** Ask Yahoo for a broker ISIN's symbol. This is a provider lookup, not
 *  independent identity verification: the search response has no matching ISIN.
 *
 *  Yahoo's own ranking is not currency-aware: for one ISIN it can list a
 *  thin cross-listing ahead of the listing the broker actually quotes in.
 *  `preferredCurrency` (the broker instrument's currency) is checked against
 *  each candidate in order, confirming via a chart request where the search
 *  result omits `currency`; a known exchange breaks a further tie; the first
 *  quote is the last resort. */
export async function resolveYahooSymbolByIsin(
  isin: string,
  client: YahooHttpClient,
  preferredCurrency?: string,
): Promise<string | null> {
  const normalized = isin.trim().toUpperCase();
  if (!ISIN.test(normalized)) return null;
  try {
    const response = await client.fetchJsonWithCrumb<SearchResponse>(
      `https://query1.finance.yahoo.com/v1/finance/search?q=${normalized}&quotesCount=4&newsCount=0`,
    );
    const quotes = (response.quotes ?? []).filter(
      (quote): quote is SearchQuote & { symbol: string } => Boolean(quote.symbol),
    );
    const first = quotes[0];
    if (!first) return null;
    if (!preferredCurrency) return first.symbol.toUpperCase();
    const wanted = normalizeCurrencyCode(preferredCurrency);
    for (const quote of quotes) {
      if ((await confirmedCurrency(client, quote)) === wanted) return quote.symbol.toUpperCase();
    }
    const knownExchange = quotes.find((quote) => isKnownYahooExchange(quote.exchange ?? ""));
    return (knownExchange ?? first).symbol.toUpperCase();
  } catch {
    return null;
  }
}

export async function searchYahooBenchmarks(
  query: string,
  input: { client?: YahooHttpClient; limit?: number } = {},
): Promise<{ results: BenchmarkInstrument[]; fallback: boolean; problems: string[] }> {
  const normalized = query.trim();
  const client = input.client ?? new YahooHttpClient();
  const fallback = () =>
    CURATED_EUROPEAN_BENCHMARKS.filter(
      (item) =>
        !normalized ||
        `${item.symbol} ${item.name}`.toLowerCase().includes(normalized.toLowerCase()),
    ).slice(0, input.limit ?? 8);
  if (!normalized) return { results: fallback(), fallback: true, problems: [] };
  try {
    const response = await client.fetchJsonWithCrumb<SearchResponse>(
      `https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(normalized)}&quotesCount=${input.limit ?? 8}&newsCount=0`,
    );
    const candidates = (response.quotes ?? []).filter(
      (quote) => quote.symbol && ["INDEX", "ETF", "MUTUALFUND"].includes(quote.quoteType ?? ""),
    );
    const confirmed = await Promise.all(
      candidates.map(async (quote) => ({
        quote,
        currency: await confirmedCurrency(client, quote),
      })),
    );
    const results = confirmed.flatMap(({ quote, currency }) =>
      !currency
        ? []
        : [
            {
              symbol: quote.symbol!.toUpperCase(),
              name: benchmarkDisplayName(
                quote.symbol!,
                quote.longname ?? quote.shortname ?? quote.symbol!,
              ),
              exchange: quote.exchDisp ?? quote.exchange ?? "Yahoo Finance",
              currency,
            },
          ],
    );
    return results.length
      ? { results, fallback: false, problems: [] }
      : { results: fallback(), fallback: true, problems: [] };
  } catch (error) {
    return {
      results: fallback(),
      fallback: true,
      problems: [
        `Yahoo Finance search failed: ${error instanceof Error ? error.message : String(error)}`,
      ],
    };
  }
}
