import { YahooHttpClient } from "./http.js";
import { getYahooSymbolsToTry } from "./symbols.js";
import { resolveYahooSymbolByIsin } from "./search.js";
import { mapYahooChart, mapYahooSplits } from "./mappers.js";
import type { YahooChartResponse, YahooPricePoint } from "./types.js";

export type YahooRange = "1d" | "5d" | "1mo" | "3mo" | "6mo" | "1y" | "5y" | "max";
export type YahooInterval = "5m" | "15m" | "1h" | "1d" | "1wk" | "1mo";
export type YahooPriceHistory = {
  symbol: string;
  currency: string | null;
  points: YahooPricePoint[];
  splits: Array<{ date: string; ratio?: number }>;
};
export type YahooPriceHistoryInput = {
  ticker: string;
  exchange: string;
  isin?: string;
  /** Explicit provider listing; bypasses ISIN lookup and ticker guesses. */
  listing?: string;
  range?: YahooRange;
  interval?: YahooInterval;
  from?: string;
  to?: string;
  client?: YahooHttpClient;
};
const CHART_URL = "https://query1.finance.yahoo.com/v8/finance/chart/";

/** Every candidate symbol got a genuine Yahoo not-found. This does not
 *  distinguish a delisting from an unresolved provider symbol. */
export class YahooNoListingError extends Error {
  constructor(
    public readonly ticker: string,
    public readonly candidates: string[],
  ) {
    super(`No Yahoo listing found for ${ticker} among ${candidates.length} candidates`);
    this.name = "YahooNoListingError";
  }
}

function isYahooNotFound(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const match = /^\[404\] (.*)$/s.exec(error.message);
  if (!match) return false;
  try {
    return (JSON.parse(match[1]!) as YahooChartResponse).chart?.error?.code === "Not Found";
  } catch {
    return false;
  }
}

export async function loadYahooPriceHistory(
  input: YahooPriceHistoryInput,
): Promise<YahooPriceHistory> {
  const client = input.client ?? new YahooHttpClient();
  const missing: string[] = [];
  let empty: YahooPriceHistory | null = null;
  for (const symbol of await yahooSymbolCandidates(input, client)) {
    try {
      const period =
        input.from && input.to
          ? `period1=${Math.floor(Date.parse(`${input.from}T00:00:00Z`) / 1000)}&period2=${Math.floor(Date.parse(`${input.to}T00:00:00Z`) / 1000) + 86400}`
          : `range=${input.range ?? "5y"}`;
      const url = `${CHART_URL}${encodeURIComponent(symbol)}?${period}&interval=${input.interval ?? "1d"}&events=div%2Csplits`;
      const data = await client.fetchJsonWithCrumb<YahooChartResponse>(url);
      const result = data.chart?.result?.[0];
      if (!result)
        throw new Error(data.chart?.error?.description ?? `No Yahoo history for ${symbol}`);
      const history = {
        symbol,
        currency: result.meta?.currency ?? null,
        points: mapYahooChart(result),
        splits: mapYahooSplits(result.events),
      };
      // A listing can exist and carry no closes at all, the way BY6.DE shadows
      // the BYD line that trades. Keep looking before settling for nothing.
      if (history.points.length === 0) {
        empty ??= history;
        continue;
      }
      return history;
    } catch (error) {
      if (!isYahooNotFound(error)) throw error;
      missing.push(symbol);
    }
  }
  if (empty) return empty;
  if (missing.length > 0) throw new YahooNoListingError(input.ticker, missing);
  throw new Error(`No Yahoo history for ${input.ticker}`);
}

/** Keep Yahoo's ISIN lookup result ahead of the broker listing candidates. */
async function yahooSymbolCandidates(
  input: YahooPriceHistoryInput,
  client: YahooHttpClient,
): Promise<string[]> {
  if (input.listing) return [input.listing];
  const guesses = getYahooSymbolsToTry(input.ticker, input.exchange);
  const resolved = input.isin ? await resolveYahooSymbolByIsin(input.isin, client) : null;
  return resolved ? [resolved, ...guesses.filter((guess) => guess !== resolved)] : guesses;
}
