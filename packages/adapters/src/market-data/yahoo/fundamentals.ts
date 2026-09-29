import type {
  CompanyFundamentals,
  FundamentalsEstimate,
  FundamentalsPeriod,
  FundamentalsProvider,
} from "@lavega/core";
import { YahooHttpClient } from "./http.js";
import { getYahooSymbolsToTry } from "./symbols.js";

const QUOTE_SUMMARY_URL = "https://query2.finance.yahoo.com/v10/finance/quoteSummary/";
const TIMESERIES_URL =
  "https://query2.finance.yahoo.com/ws/fundamentals-timeseries/v1/finance/timeseries/";
/* incomeStatementHistory, balanceSheetHistory and cashflowStatementHistory
 * are left out on purpose: Yahoo now returns them with only endDate and
 * zeroed line items. Statement depth comes from fundamentals-timeseries. */
const MODULES = "price,assetProfile,financialData,defaultKeyStatistics,summaryDetail,earningsTrend";
const HISTORY_YEARS = 6;
const QUARTERS = 5;

const LINE_ITEMS = {
  revenue: "TotalRevenue",
  grossProfit: "GrossProfit",
  operatingIncome: "OperatingIncome",
  netIncome: "NetIncome",
  dilutedEps: "DilutedEPS",
  operatingCashFlow: "OperatingCashFlow",
  capitalExpenditure: "CapitalExpenditure",
  freeCashFlow: "FreeCashFlow",
  stockholdersEquity: "StockholdersEquity",
  totalDebt: "TotalDebt",
  currentAssets: "CurrentAssets",
  currentLiabilities: "CurrentLiabilities",
  dilutedShares: "DilutedAverageShares",
} as const satisfies Record<Exclude<keyof FundamentalsPeriod, "endDate">, string>;
type LineItem = keyof typeof LINE_ITEMS;
const QUARTERLY_ITEMS: readonly LineItem[] = [
  "revenue",
  "operatingIncome",
  "netIncome",
  "dilutedEps",
];

type Raw = { raw?: number } | undefined;
type QuoteSummaryResult = {
  price?: {
    longName?: string;
    shortName?: string;
    currency?: string;
    regularMarketPrice?: Raw;
    marketCap?: Raw;
  };
  assetProfile?: { sector?: string; industry?: string };
  financialData?: Record<string, Raw | string | undefined> & { financialCurrency?: string };
  defaultKeyStatistics?: Record<string, Raw>;
  summaryDetail?: Record<string, Raw>;
  earningsTrend?: {
    trend?: Array<{
      period?: string;
      endDate?: string | null;
      earningsEstimate?: { avg?: Raw; growth?: Raw };
      revenueEstimate?: { avg?: Raw; growth?: Raw };
    }>;
  };
};
type TimeseriesPoint = { asOfDate?: string; reportedValue?: Raw } | null;
type TimeseriesResponse = {
  timeseries?: { result?: Array<{ meta?: { type?: string[] } } & Record<string, unknown>> };
};

export function createYahooFundamentalsProvider(client?: YahooHttpClient): FundamentalsProvider {
  return { fetch: (symbol) => fetchYahooFundamentals(symbol, client) };
}

/** Resolves null when Yahoo knows no company under any candidate symbol.
 *  Transport failures reject: an outage must never read as "no data". */
export async function fetchYahooFundamentals(
  symbol: string,
  client: YahooHttpClient = new YahooHttpClient(),
  now: Date = new Date(),
): Promise<CompanyFundamentals | null> {
  for (const candidate of new Set(
    getYahooSymbolsToTry(symbol, "").map((item) => item.toUpperCase()),
  )) {
    const summary = await client
      .fetchJsonWithCrumb<{
        quoteSummary?: { result?: QuoteSummaryResult[] | null };
      }>(`${QUOTE_SUMMARY_URL}${encodeURIComponent(candidate)}?modules=${MODULES}`)
      .catch((error: unknown) => {
        if (error instanceof Error && error.message.startsWith("[404]")) return null;
        throw error;
      });
    const result = summary?.quoteSummary?.result?.[0];
    if (!result?.financialData && !result?.defaultKeyStatistics) continue;
    const series = await fetchTimeseries(client, candidate, now);
    return toCompanyFundamentals(symbol, candidate, result, series, now);
  }
  return null;
}

async function fetchTimeseries(client: YahooHttpClient, symbol: string, now: Date) {
  const types = [
    ...Object.values(LINE_ITEMS).map((item) => `annual${item}`),
    ...QUARTERLY_ITEMS.map((item) => `quarterly${LINE_ITEMS[item]}`),
  ];
  const period2 = Math.floor(now.getTime() / 1000);
  const period1 = period2 - HISTORY_YEARS * 366 * 86_400;
  const response = await client.fetchJsonWithCrumb<TimeseriesResponse>(
    `${TIMESERIES_URL}${encodeURIComponent(symbol)}?type=${types.join(",")}&period1=${period1}&period2=${period2}`,
  );
  const byType = new Map<string, Map<string, number>>();
  for (const entry of response.timeseries?.result ?? []) {
    const type = entry.meta?.type?.[0];
    const points = type ? entry[type] : undefined;
    if (!type || !Array.isArray(points)) continue;
    const values = new Map<string, number>();
    for (const point of points as TimeseriesPoint[]) {
      const value = point?.reportedValue?.raw;
      if (point?.asOfDate && typeof value === "number") values.set(point.asOfDate, value);
    }
    byType.set(type, values);
  }
  return byType;
}

export function toCompanyFundamentals(
  symbol: string,
  providerSymbol: string,
  result: QuoteSummaryResult,
  series: Map<string, Map<string, number>>,
  now: Date,
): CompanyFundamentals {
  const financial = result.financialData ?? {};
  const statistics = result.defaultKeyStatistics ?? {};
  const detail = result.summaryDetail ?? {};
  const value = (field: Raw | string | undefined) =>
    typeof field === "object" && typeof field.raw === "number" && Number.isFinite(field.raw)
      ? field.raw
      : null;
  const price = value(financial.currentPrice) ?? value(result.price?.regularMarketPrice);
  const currency = financial.financialCurrency ?? result.price?.currency ?? null;
  const priceCurrency = result.price?.currency ?? currency;
  /* Yahoo divides a price in one currency by statement figures in another
   * for a cross-listing, which yields values like a 1571 P/B. Only ratios
   * it derives that way are dropped; its per-share P/E stays consistent. */
  const crossCurrency = currency !== null && priceCurrency !== currency;
  const sameCurrency = (field: Raw) => (crossCurrency ? null : value(field));
  return {
    symbol,
    providerSymbol,
    name: result.price?.longName ?? result.price?.shortName ?? null,
    currency,
    priceCurrency,
    sector: result.assetProfile?.sector ?? null,
    industry: result.assetProfile?.industry ?? null,
    fetchedAt: now.toISOString(),
    snapshot: {
      price,
      marketCap: value(result.price?.marketCap) ?? value(detail.marketCap),
      enterpriseValue: sameCurrency(statistics.enterpriseValue),
      trailingPe: value(detail.trailingPE),
      forwardPe: value(detail.forwardPE) ?? value(statistics.forwardPE),
      priceToBook: sameCurrency(statistics.priceToBook),
      pegRatio: value(statistics.pegRatio) ?? value(statistics.trailingPegRatio),
      enterpriseToEbitda: sameCurrency(statistics.enterpriseToEbitda),
      dividendYield: value(detail.dividendYield),
      payoutRatio: value(detail.payoutRatio),
      beta: value(detail.beta) ?? value(statistics.beta),
      grossMargin: value(financial.grossMargins),
      operatingMargin: value(financial.operatingMargins),
      profitMargin: value(financial.profitMargins) ?? value(statistics.profitMargins),
      returnOnEquity: value(financial.returnOnEquity),
      returnOnAssets: value(financial.returnOnAssets),
      revenueGrowth: value(financial.revenueGrowth),
      earningsGrowth: value(financial.earningsGrowth),
      debtToEquityPercent: value(financial.debtToEquity),
      currentRatio: value(financial.currentRatio),
      totalCash: value(financial.totalCash),
      totalDebt: value(financial.totalDebt),
      freeCashFlow: value(financial.freeCashflow),
      operatingCashFlow: value(financial.operatingCashflow),
      targetMeanPrice: value(financial.targetMeanPrice),
      analystCount: value(financial.numberOfAnalystOpinions),
    },
    annual: periods(series, "annual", Object.keys(LINE_ITEMS) as LineItem[]),
    quarterly: periods(series, "quarterly", QUARTERLY_ITEMS).slice(0, QUARTERS),
    estimates: (result.earningsTrend?.trend ?? []).flatMap((trend): FundamentalsEstimate[] =>
      trend.period
        ? [
            {
              period: trend.period,
              endDate: trend.endDate ?? null,
              epsAverage: value(trend.earningsEstimate?.avg),
              epsGrowth: value(trend.earningsEstimate?.growth),
              revenueAverage: value(trend.revenueEstimate?.avg),
              revenueGrowth: value(trend.revenueEstimate?.growth),
            },
          ]
        : [],
    ),
  };
}

function periods(
  series: Map<string, Map<string, number>>,
  prefix: "annual" | "quarterly",
  items: readonly LineItem[],
): FundamentalsPeriod[] {
  const dates = new Set<string>();
  for (const item of items)
    for (const date of series.get(`${prefix}${LINE_ITEMS[item]}`)?.keys() ?? []) dates.add(date);
  return [...dates]
    .sort()
    .reverse()
    .map((endDate) => {
      const period: FundamentalsPeriod = {
        endDate,
        revenue: null,
        grossProfit: null,
        operatingIncome: null,
        netIncome: null,
        dilutedEps: null,
        operatingCashFlow: null,
        capitalExpenditure: null,
        freeCashFlow: null,
        stockholdersEquity: null,
        totalDebt: null,
        currentAssets: null,
        currentLiabilities: null,
        dilutedShares: null,
      };
      for (const item of items)
        period[item] = series.get(`${prefix}${LINE_ITEMS[item]}`)?.get(endDate) ?? null;
      return period;
    });
}
