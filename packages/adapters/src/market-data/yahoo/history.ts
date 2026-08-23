import { YahooHttpClient } from "./http.js";
import { getYahooSymbolsToTry } from "./symbols.js";
import { mapYahooChart } from "./mappers.js";
import type { YahooChartResponse, YahooPricePoint } from "./types.js";

export type YahooRange = "1d" | "5d" | "1mo" | "3mo" | "6mo" | "1y" | "5y" | "max";
export type YahooInterval = "5m" | "15m" | "1h" | "1d" | "1wk" | "1mo";
const CHART_URL = "https://query1.finance.yahoo.com/v8/finance/chart/";

export async function loadYahooPriceHistory(input: { ticker: string; exchange: string; range?: YahooRange; interval?: YahooInterval; from?: string; to?: string; client?: YahooHttpClient }): Promise<YahooPricePoint[]> {
  const client = input.client ?? new YahooHttpClient();
  let lastError: unknown;
  for (const symbol of getYahooSymbolsToTry(input.ticker, input.exchange)) {
    try {
      const period = input.from && input.to ? `period1=${Math.floor(Date.parse(`${input.from}T00:00:00Z`) / 1000)}&period2=${Math.floor(Date.parse(`${input.to}T00:00:00Z`) / 1000) + 86400}` : `range=${input.range ?? "5y"}`;
      const url = `${CHART_URL}${encodeURIComponent(symbol)}?${period}&interval=${input.interval ?? "1d"}&events=div%2Csplits`;
      const data = await client.fetchJsonWithCrumb<YahooChartResponse>(url);
      const result = data.chart?.result?.[0];
      if (!result) throw new Error(data.chart?.error?.description ?? `No Yahoo history for ${symbol}`);
      return mapYahooChart(result);
    } catch (error) { lastError = error; }
  }
  throw lastError ?? new Error(`No Yahoo history for ${input.ticker}`);
}
