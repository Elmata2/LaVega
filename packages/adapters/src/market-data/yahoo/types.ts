export type YahooChartResult = {
  meta?: {
    currency?: string;
    regularMarketPrice?: number;
    chartPreviousClose?: number;
    exchangeName?: string;
  };
  timestamp?: number[];
  indicators?: {
    quote?: Array<{
      open?: (number | null)[];
      high?: (number | null)[];
      low?: (number | null)[];
      close?: (number | null)[];
      volume?: (number | null)[];
    }>;
  };
  events?: {
    dividends?: Record<string, { amount?: number; date?: number }>;
    splits?: Record<
      string,
      { date?: number; numerator?: number; denominator?: number; splitRatio?: string }
    >;
  };
};

export type YahooChartResponse = {
  chart?: { result?: YahooChartResult[]; error?: { description?: string } | null };
};

export type YahooPricePoint = {
  date: string;
  open: number | null;
  high: number | null;
  low: number | null;
  close: number | null;
  volume: number | null;
};

export type YahooQuote = { symbol: string; price: number; currency?: string; exchange?: string };

export type YahooSearchResult = {
  symbol: string;
  name: string;
  exchange?: string;
  quoteType?: string;
};
