import type { BenchmarkInstrument } from "@lavega/core";
import { YahooHttpClient } from "./http.js";
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
  { symbol: "^STOXX50E", name: "EURO STOXX 50", exchange: "STOXX", currency: "EUR" },
  { symbol: "^AEX", name: "AEX", exchange: "Amsterdam", currency: "EUR" },
  { symbol: "^GDAXI", name: "DAX", exchange: "Frankfurt", currency: "EUR" },
  { symbol: "^FCHI", name: "CAC 40", exchange: "Paris", currency: "EUR" },
];

async function confirmedCurrency(client: YahooHttpClient, quote: SearchQuote): Promise<string | null> {
  if (quote.currency) return quote.currency.toUpperCase();
  if (!quote.symbol) return null;
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(quote.symbol)}?range=1d&interval=1d`;
  const response = await client.fetchJsonWithCrumb<YahooChartResponse>(url);
  return response.chart?.result?.[0]?.meta?.currency?.toUpperCase() ?? null;
}

const ISIN = /^[A-Z]{2}[A-Z0-9]{9}[0-9]$/;

/** Resolve a broker ISIN to the Yahoo symbol for that instrument. Yahoo matches
 *  an ISIN exactly, which beats guessing an exchange suffix from a broker ticker. */
export async function resolveYahooSymbolByIsin(isin: string, client: YahooHttpClient): Promise<string | null> {
  const normalized = isin.trim().toUpperCase();
  if (!ISIN.test(normalized)) return null;
  try {
    const response = await client.fetchJsonWithCrumb<SearchResponse>(`https://query1.finance.yahoo.com/v1/finance/search?q=${normalized}&quotesCount=4&newsCount=0`);
    return (response.quotes ?? []).find((quote) => quote.symbol)?.symbol?.toUpperCase() ?? null;
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
  const fallback = () => CURATED_EUROPEAN_BENCHMARKS
    .filter((item) => !normalized || `${item.symbol} ${item.name}`.toLowerCase().includes(normalized.toLowerCase()))
    .slice(0, input.limit ?? 8);
  if (!normalized) return { results: fallback(), fallback: true, problems: [] };
  try {
    const response = await client.fetchJsonWithCrumb<SearchResponse>(`https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(normalized)}&quotesCount=${input.limit ?? 8}&newsCount=0`);
    const candidates = (response.quotes ?? []).filter((quote) => quote.symbol && ["INDEX", "ETF", "MUTUALFUND"].includes(quote.quoteType ?? ""));
    const confirmed = await Promise.all(candidates.map(async (quote) => ({ quote, currency: await confirmedCurrency(client, quote) })));
    const results = confirmed.flatMap(({ quote, currency }) => !currency ? [] : [{
      symbol: quote.symbol!.toUpperCase(),
      name: quote.longname ?? quote.shortname ?? quote.symbol!,
      exchange: quote.exchDisp ?? quote.exchange ?? "Yahoo Finance",
      currency,
    }]);
    return results.length ? { results, fallback: false, problems: [] } : { results: fallback(), fallback: true, problems: [] };
  } catch (error) {
    return { results: fallback(), fallback: true, problems: [`Yahoo Finance search failed: ${error instanceof Error ? error.message : String(error)}`] };
  }
}
