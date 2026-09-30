import { normalizeCurrencyCode, type PriceBar } from "@lavega/core";
import type { Provider } from "../providerRouter.js";
import { loadYahooPriceHistory, YahooNoListingError } from "./history.js";
import { YahooHttpClient } from "./http.js";

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
/** `listing` names the provider's own symbol for the listing it quoted.
 *  `notFound` marks every candidate as a confirmed Yahoo 404, not a transient
 *  or ambiguous failure: the caller can treat this as a real end state. */
export type PriceProviderResult = {
  bars: PriceBar[];
  problems: string[];
  listing?: string;
  notFound?: boolean;
};

export function createYahooPriceProvider(
  input: {
    client?: YahooHttpClient;
    today?: () => string;
    resolveMissingListing?: (request: YahooPriceRequest) => Promise<string | null>;
  } = {},
): Provider<YahooPriceRequest, PriceProviderResult> {
  const client = input.client ?? new YahooHttpClient();
  return {
    sourceKey: "yahoo",
    priority: 10,
    async get(request) {
      try {
        const historyInput = {
          ticker: request.ticker,
          exchange: request.exchange,
          isin: request.isin,
          currency: request.currency,
          from: request.from,
          to: request.to ?? request.today ?? (input.today ?? currentDate)(),
          interval: "1d" as const,
          client,
        };
        let history;
        try {
          history = await loadYahooPriceHistory(historyInput);
        } catch (error) {
          if (!(error instanceof YahooNoListingError) || !input.resolveMissingListing) throw error;
          const listing = (await input.resolveMissingListing(request))?.trim().toUpperCase();
          if (
            !listing ||
            !/^[A-Z0-9]+(?:-[A-Z0-9]+)*(?:\.[A-Z]+)?$/.test(listing) ||
            error.candidates.some((candidate) => candidate.toUpperCase() === listing)
          )
            throw error;
          try {
            history = await loadYahooPriceHistory({ ...historyInput, listing });
          } catch (fallbackError) {
            if (fallbackError instanceof YahooNoListingError)
              throw new YahooNoListingError(error.ticker, [
                ...error.candidates,
                ...fallbackError.candidates,
              ]);
            throw fallbackError;
          }
        }
        // Label a bar with the currency the quote is actually in. The broker's
        // instrument currency can name a different listing of the same stock.
        const currency = normalizeCurrencyCode(history.currency ?? request.currency);
        const bars: PriceBar[] = history.points.flatMap((point) =>
          point.close == null
            ? []
            : [
                {
                  symbol: request.symbol,
                  date: point.date,
                  close: point.close,
                  currency,
                  split: 1,
                },
              ],
        );
        for (const split of history.splits) {
          const session = bars.find((bar) => bar.date >= split.date);
          if (session && split.ratio !== undefined && split.ratio > 0)
            session.split = (session.split ?? 1) * split.ratio;
        }
        return { bars, problems: [], listing: history.symbol };
      } catch (error) {
        return {
          bars: [],
          problems: [readableYahooProblem(error)],
          notFound: error instanceof YahooNoListingError,
        };
      }
    },
  };
}

function currentDate(): string {
  return new Date().toISOString().slice(0, 10);
}
function readableYahooProblem(error: unknown): string {
  if (error instanceof YahooNoListingError) {
    const count = error.candidates.length;
    return `No listing found on Yahoo Finance for ${error.candidates[0]} (tried ${count} ${count === 1 ? "symbol" : "symbols"})`;
  }
  const message = error instanceof Error ? error.message : String(error);
  if (/\[429\]|rate.?limit/i.test(message)) return "Yahoo Finance rate-limited price request";
  if (/\[403\]|blocked|forbidden/i.test(message)) return "Yahoo Finance blocked price request";
  return `Yahoo Finance price request failed: ${message}`;
}
