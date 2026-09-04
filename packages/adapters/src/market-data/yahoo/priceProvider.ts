import { normalizeCurrencyCode, type PriceBar } from "@lavega/core";
import type { Provider } from "../providerRouter.js";
import { loadYahooPriceHistory } from "./history.js";
import type { YahooHttpClient } from "./http.js";

export type YahooPriceRequest = {
  ticker: string;
  exchange: string;
  symbol: string;
  currency: string;
  isin?: string;
  from?: string;
  to?: string;
  today?: string;
};
export type PriceProviderResult = { bars: PriceBar[]; problems: string[] };

export function createYahooPriceProvider(
  input: { client?: YahooHttpClient; today?: () => string } = {},
): Provider<YahooPriceRequest, PriceProviderResult> {
  return {
    sourceKey: "yahoo",
    priority: 10,
    async get(request) {
      try {
        const history = await loadYahooPriceHistory({
          ticker: request.ticker,
          exchange: request.exchange,
          isin: request.isin,
          from: request.from,
          to: request.to ?? request.today ?? (input.today ?? currentDate)(),
          interval: "1d",
          client: input.client,
        });
        // Label a bar with the currency the quote is actually in. The broker's
        // instrument currency can name a different listing of the same stock.
        const currency = normalizeCurrencyCode(history.currency ?? request.currency);
        return {
          bars: history.points.flatMap((point) =>
            point.close == null
              ? []
              : [{ symbol: request.symbol, date: point.date, close: point.close, currency }],
          ),
          problems: [],
        };
      } catch (error) {
        return { bars: [], problems: [readableYahooProblem(error)] };
      }
    },
  };
}

function currentDate(): string {
  return new Date().toISOString().slice(0, 10);
}
function readableYahooProblem(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (/\[429\]|rate.?limit/i.test(message)) return "Yahoo Finance rate-limited price request";
  if (/\[403\]|blocked|forbidden/i.test(message)) return "Yahoo Finance blocked price request";
  return `Yahoo Finance price request failed: ${message}`;
}
