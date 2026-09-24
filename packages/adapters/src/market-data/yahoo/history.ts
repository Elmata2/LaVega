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
  range?: YahooRange;
  interval?: YahooInterval;
  from?: string;
  to?: string;
  client?: YahooHttpClient;
};
const CHART_URL = "https://query1.finance.yahoo.com/v8/finance/chart/";

/** Every candidate symbol got a genuine Yahoo not-found, so retrying is pointless;
 *  this is almost always a delisting, never a fetch failure. */
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
  const failures: Array<{ symbol: string; error: unknown; notFound: boolean }> = [];
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
      failures.push({ symbol, error, notFound: isYahooNotFound(error) });
    }
  }
  if (empty) return empty;
  if (failures.length > 0 && failures.every((failure) => failure.notFound))
    throw new YahooNoListingError(
      input.ticker,
      failures.map((failure) => failure.symbol),
    );
  throw failures[0]?.error ?? new Error(`No Yahoo history for ${input.ticker}`);
}

/** The ISIN is the instrument's own identifier, so Yahoo can answer with the
 *  exact listing. Ticker suffix guessing only runs when that fails. */
async function yahooSymbolCandidates(
  input: YahooPriceHistoryInput,
  client: YahooHttpClient,
): Promise<string[]> {
  const guesses = getYahooSymbolsToTry(input.ticker, input.exchange);
  const exact = input.isin ? await resolveYahooSymbolByIsin(input.isin, client) : null;
  return exact ? [exact, ...guesses.filter((guess) => guess !== exact)] : guesses;
}
