import type { PriceBar } from "@lavega/core";
import type { Provider } from "../providerRouter.js";
import { loadYahooPriceHistory } from "./history.js";
import type { YahooHttpClient } from "./http.js";

export type YahooPriceRequest = { ticker: string; exchange: string; symbol: string; currency: string; from?: string; to?: string; today?: string };
export type PriceProviderResult = { bars: PriceBar[]; problems: string[] };

export function createYahooPriceProvider(input: { client?: YahooHttpClient; today?: () => string } = {}): Provider<YahooPriceRequest, PriceProviderResult> {
  return { sourceKey: "yahoo", priority: 10, async get(request) {
    try {
      const points = await loadYahooPriceHistory({ ticker: request.ticker, exchange: request.exchange, from: request.from, to: request.to ?? request.today ?? (input.today ?? currentDate)(), interval: "1d", client: input.client });
      return { bars: points.flatMap((point) => point.close == null ? [] : [{ symbol: request.symbol, date: point.date, close: point.close, currency: request.currency }]), problems: [] };
    } catch (error) { return { bars: [], problems: [readableYahooProblem(error)] }; }
  } };
}

function currentDate(): string { return new Date().toISOString().slice(0, 10); }
function readableYahooProblem(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (/\[429\]|rate.?limit/i.test(message)) return "Yahoo Finance rate-limited price request";
  if (/\[403\]|blocked|forbidden/i.test(message)) return "Yahoo Finance blocked price request";
  return `Yahoo Finance price request failed: ${message}`;
}
