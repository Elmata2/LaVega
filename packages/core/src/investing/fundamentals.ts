/** One reported period from the company's filed statements. Figures are in
 *  the reporting currency; a missing line item is null, never zero. */
export type FundamentalsPeriod = {
  /** Period end date, YYYY-MM-DD. */
  endDate: string;
  revenue: number | null;
  grossProfit: number | null;
  operatingIncome: number | null;
  netIncome: number | null;
  dilutedEps: number | null;
  operatingCashFlow: number | null;
  capitalExpenditure: number | null;
  freeCashFlow: number | null;
  stockholdersEquity: number | null;
  totalDebt: number | null;
  currentAssets: number | null;
  currentLiabilities: number | null;
  dilutedShares: number | null;
};

/** Ratios as fractions (0.3 is 30%), amounts in `currency`. */
export type FundamentalsSnapshot = {
  price: number | null;
  marketCap: number | null;
  enterpriseValue: number | null;
  trailingPe: number | null;
  forwardPe: number | null;
  priceToBook: number | null;
  pegRatio: number | null;
  enterpriseToEbitda: number | null;
  dividendYield: number | null;
  payoutRatio: number | null;
  beta: number | null;
  grossMargin: number | null;
  operatingMargin: number | null;
  profitMargin: number | null;
  returnOnEquity: number | null;
  returnOnAssets: number | null;
  revenueGrowth: number | null;
  earningsGrowth: number | null;
  /** Yahoo reports debt to equity as a percentage (45 is 0.45x). */
  debtToEquityPercent: number | null;
  currentRatio: number | null;
  totalCash: number | null;
  totalDebt: number | null;
  freeCashFlow: number | null;
  operatingCashFlow: number | null;
  targetMeanPrice: number | null;
  analystCount: number | null;
};

export type FundamentalsEstimate = {
  /** Yahoo period code: 0q, +1q, 0y, +1y. */
  period: string;
  endDate: string | null;
  epsAverage: number | null;
  epsGrowth: number | null;
  revenueAverage: number | null;
  revenueGrowth: number | null;
};

export type CompanyFundamentals = {
  /** The symbol the caller asked for. */
  symbol: string;
  /** The provider's own symbol that answered, for example ASML.AS. */
  providerSymbol: string;
  name: string | null;
  /** Currency of the filed statements. */
  currency: string | null;
  /** Currency of the quoted price. It differs from `currency` for a
   *  cross-listing such as ASML on Nasdaq. */
  priceCurrency: string | null;
  sector: string | null;
  industry: string | null;
  fetchedAt: string;
  snapshot: FundamentalsSnapshot;
  /** Newest first. */
  annual: FundamentalsPeriod[];
  /** Newest first. */
  quarterly: FundamentalsPeriod[];
  estimates: FundamentalsEstimate[];
};

/** Company financials by portfolio symbol. Resolves null when the provider
 *  knows no company for the symbol, and rejects when the provider fails, so
 *  a caller never mistakes an outage for "no data". */
export type FundamentalsProvider = {
  fetch(symbol: string): Promise<CompanyFundamentals | null>;
};

/** Aggregates computed here so the model reasons over facts instead of
 *  re-deriving arithmetic from a table. */
export type FundamentalsAggregates = {
  years: number;
  revenueCagr: number | null;
  epsCagr: number | null;
  averageOperatingMargin: number | null;
  operatingMarginTrend: number | null;
  averageReturnOnEquity: number | null;
  /** Free cash flow over net income, summed across the annual periods. */
  cashConversion: number | null;
  shareCountChange: number | null;
};

export function fundamentalsAggregates(fundamentals: CompanyFundamentals): FundamentalsAggregates {
  const annual = fundamentals.annual;
  const newest = annual[0];
  const oldest = annual.at(-1);
  const years = annual.length > 1 ? annual.length - 1 : 0;
  const operatingMargins = annual.map((period) => ratio(period.operatingIncome, period.revenue));
  const returns = annual.map((period) => ratio(period.netIncome, period.stockholdersEquity));
  const freeCashFlow = sum(annual.map((period) => period.freeCashFlow));
  const netIncome = sum(annual.map((period) => period.netIncome));
  return {
    years,
    revenueCagr: cagr(oldest?.revenue, newest?.revenue, years),
    epsCagr: cagr(oldest?.dilutedEps, newest?.dilutedEps, years),
    averageOperatingMargin: average(operatingMargins),
    operatingMarginTrend:
      operatingMargins[0] != null && operatingMargins.at(-1) != null && years > 0
        ? operatingMargins[0] - operatingMargins.at(-1)!
        : null,
    averageReturnOnEquity: average(returns),
    cashConversion: freeCashFlow !== null && netIncome ? freeCashFlow / netIncome : null,
    shareCountChange: ratio(
      newest?.dilutedShares != null && oldest?.dilutedShares != null && years > 0
        ? newest.dilutedShares - oldest.dilutedShares
        : null,
      oldest?.dilutedShares ?? null,
    ),
  };
}

/** A compact text block for the prompt: one summary, the derived aggregates
 *  and a short statement table. Never raw provider JSON. */
export function renderFundamentalsBrief(fundamentals: CompanyFundamentals): string {
  const s = fundamentals.snapshot;
  const a = fundamentalsAggregates(fundamentals);
  const header = [
    fundamentals.providerSymbol,
    fundamentals.name,
    [fundamentals.sector, fundamentals.industry].filter(Boolean).join(" / ") || null,
    fundamentals.currency ? `statements in ${fundamentals.currency}` : null,
    fundamentals.priceCurrency && fundamentals.priceCurrency !== fundamentals.currency
      ? `price and market cap in ${fundamentals.priceCurrency}`
      : null,
  ]
    .filter(Boolean)
    .join(" | ");
  const lines = [
    header,
    `Price ${num(s.price)} | market cap ${amount(s.marketCap)} | EV ${amount(s.enterpriseValue)} | P/E ${num(s.trailingPe)} trailing, ${num(s.forwardPe)} forward | P/B ${num(s.priceToBook)} | PEG ${num(s.pegRatio)} | EV/EBITDA ${num(s.enterpriseToEbitda)}`,
    `Margins gross ${pct(s.grossMargin)}, operating ${pct(s.operatingMargin)}, net ${pct(s.profitMargin)} | ROE ${pct(s.returnOnEquity)} | ROA ${pct(s.returnOnAssets)}`,
    `Growth (latest quarter, year on year) revenue ${pct(s.revenueGrowth)}, earnings ${pct(s.earningsGrowth)}`,
    `Balance sheet cash ${amount(s.totalCash)}, debt ${amount(s.totalDebt)}, debt/equity ${s.debtToEquityPercent == null ? "n/a" : `${num(s.debtToEquityPercent / 100)}x`}, current ratio ${num(s.currentRatio)} | FCF ${amount(s.freeCashFlow)}`,
    `Dividend yield ${pct(s.dividendYield)}, payout ${pct(s.payoutRatio)} | beta ${num(s.beta)} | analyst target ${num(s.targetMeanPrice)} (${s.analystCount ?? "n/a"} analysts)`,
  ];
  if (a.years > 0)
    lines.push(
      `Over ${a.years} years: revenue CAGR ${pct(a.revenueCagr)}, EPS CAGR ${pct(a.epsCagr)}, average operating margin ${pct(a.averageOperatingMargin)} (trend ${points(a.operatingMarginTrend)}), average ROE ${pct(a.averageReturnOnEquity)}, FCF/net income ${num(a.cashConversion)}, share count ${pct(a.shareCountChange)}`,
    );
  if (fundamentals.annual.length > 0) {
    lines.push(
      "Annual, newest first: year | revenue | op margin | net income | EPS | FCF | equity | debt",
    );
    for (const period of fundamentals.annual)
      lines.push(
        [
          period.endDate.slice(0, 4),
          amount(period.revenue),
          pct(ratio(period.operatingIncome, period.revenue)),
          amount(period.netIncome),
          num(period.dilutedEps),
          amount(period.freeCashFlow),
          amount(period.stockholdersEquity),
          amount(period.totalDebt),
        ].join(" | "),
      );
  }
  if (fundamentals.quarterly.length > 0) {
    lines.push("Quarters, newest first: end | revenue | op margin | EPS");
    for (const period of fundamentals.quarterly)
      lines.push(
        [
          period.endDate,
          amount(period.revenue),
          pct(ratio(period.operatingIncome, period.revenue)),
          num(period.dilutedEps),
        ].join(" | "),
      );
  }
  const estimates = fundamentals.estimates.filter(
    (estimate) => estimate.epsAverage !== null || estimate.revenueAverage !== null,
  );
  if (estimates.length > 0)
    lines.push(
      `Analyst estimates: ${estimates
        .map(
          (estimate) =>
            `${estimate.period} EPS ${num(estimate.epsAverage)} (${pct(estimate.epsGrowth)}), revenue ${amount(estimate.revenueAverage)} (${pct(estimate.revenueGrowth)})`,
        )
        .join("; ")}`,
    );
  return lines.join("\n");
}

function ratio(numerator: number | null | undefined, denominator: number | null | undefined) {
  return numerator != null && denominator ? numerator / denominator : null;
}

function cagr(from: number | null | undefined, to: number | null | undefined, years: number) {
  return from != null && to != null && from > 0 && to > 0 && years > 0
    ? (to / from) ** (1 / years) - 1
    : null;
}

function average(values: (number | null)[]): number | null {
  const known = values.filter((value): value is number => value !== null);
  return known.length > 0 ? known.reduce((total, value) => total + value, 0) / known.length : null;
}

function sum(values: (number | null)[]): number | null {
  return values.every((value) => value !== null)
    ? (values as number[]).reduce((total, value) => total + value, 0)
    : null;
}

function num(value: number | null): string {
  return value == null ? "n/a" : Number(value.toFixed(2)).toString();
}

function pct(value: number | null): string {
  return value == null ? "n/a" : `${(value * 100).toFixed(1)}%`;
}

function points(value: number | null): string {
  return value == null ? "n/a" : `${value >= 0 ? "+" : ""}${(value * 100).toFixed(1)} pts`;
}

function amount(value: number | null): string {
  if (value == null) return "n/a";
  const size = Math.abs(value);
  if (size >= 1e12) return `${(value / 1e12).toFixed(2)}T`;
  if (size >= 1e9) return `${(value / 1e9).toFixed(2)}B`;
  if (size >= 1e6) return `${(value / 1e6).toFixed(1)}M`;
  if (size >= 1e3) return `${(value / 1e3).toFixed(1)}K`;
  return value.toFixed(0);
}
