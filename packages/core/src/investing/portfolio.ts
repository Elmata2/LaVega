import { crossRate, type FxRate } from "../fx.js";
import type { Position, PriceBar, Trade } from "./model.js";

export type PortfolioValuePoint = { date: string; value: number; unpriced: string[] };
export type BenchmarkPoint = { date: string; value: number };
export type PortfolioBenchmarkPoint = {
  date: string;
  portfolioValue: number | null;
  benchmarkValue: number | null;
  unpriced: string[];
};
export type PortfolioRange = "1M" | "6M" | "1Y" | "YTD" | "All";
export type FxRates = FxRate | FxRate[];

function rateFor(rates: FxRates, date: string): FxRate {
  const candidates = Array.isArray(rates) ? rates : [rates];
  const rate = candidates.filter((candidate) => candidate.date <= date).sort((a, b) => b.date.localeCompare(a.date))[0];
  if (!rate) throw new Error(`No FX rate available for ${date}`);
  return rate;
}

/** Convert one monetary value using the latest supplied rate on or before date.
 *  Same-currency values skip the rate lookup entirely, so they never go
 *  `unpriced` just because no FX rate covers that date. */
export function convertCurrency(value: number, from: string, to: string, date: string, fxRates: FxRates): number {
  if (from === to) return value;
  return value * crossRate(from, to, rateFor(fxRates, date));
}

function quantityOnDate(position: Position, trades: Trade[], date: string): number {
  const signed = (trade: Trade) => trade.side === "sell" ? -trade.quantity : trade.side === "buy" ? trade.quantity : 0;
  const relevant = trades.filter((trade) => trade.symbol === position.symbol);
  if (date < position.asOf) {
    return position.quantity - relevant
      .filter((trade) => trade.date > date && trade.date <= position.asOf)
      .reduce((quantity, trade) => quantity + signed(trade), 0);
  }
  return position.quantity + relevant
    .filter((trade) => trade.date > position.asOf && trade.date <= date)
    .reduce((quantity, trade) => quantity + signed(trade), 0);
}

/** Build daily portfolio values. Missing prices remain visible in `unpriced`. */
export function computePortfolioValueSeries(
  positions: Position[],
  trades: Trade[],
  priceBars: PriceBar[],
  presentationCurrency: string,
  fxRates: FxRates,
): PortfolioValuePoint[] {
  const dates = [...new Set(priceBars.map((bar) => bar.date))].sort();
  return dates.map((date) => {
    let value = 0;
    const unpriced = new Set<string>();
    for (const position of positions) {
      const bar = priceBars.find((candidate) => candidate.symbol === position.symbol && candidate.date === date);
      if (!bar) {
        if (quantityOnDate(position, trades, date) !== 0) unpriced.add(position.symbol);
        continue;
      }
      const quantity = quantityOnDate(position, trades, date);
      try {
        value += convertCurrency(quantity * bar.close, bar.currency, presentationCurrency, date, fxRates);
      } catch {
        unpriced.add(position.symbol);
      }
    }
    return { date, value, unpriced: [...unpriced].sort() };
  });
}

/** Normalize benchmark closes to the portfolio's first priced value. Skips
 *  leading zero-value points (e.g. dates before any position was opened), so
 *  the benchmark line isn't scaled to zero for the whole range. */
export function normalizeBenchmarkSeries(bars: PriceBar[], portfolio: PortfolioValuePoint[]): BenchmarkPoint[] {
  const sortedBars = [...bars].sort((a, b) => a.date.localeCompare(b.date));
  const firstPortfolio = portfolio.find((point) => point.unpriced.length === 0 && point.value !== 0 && sortedBars.some((bar) => bar.date === point.date));
  const firstBar = sortedBars.find((bar) => bar.date === firstPortfolio?.date);
  if (!firstPortfolio || !firstBar || firstBar.close === 0) return [];
  return sortedBars.filter((bar) => bar.date >= firstBar.date).map((bar) => ({ date: bar.date, value: firstPortfolio.value * bar.close / firstBar.close }));
}

function subtractMonths(date: string, months: number): string {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCMonth(value.getUTCMonth() - months);
  return value.toISOString().slice(0, 10);
}

/** Keep points on or after range start. Start anchors to latest point in input. */
export function filterPortfolioValueRange<T extends { date: string }>(points: T[], range: PortfolioRange): T[] {
  if (points.length === 0 || range === "All") return [...points];
  const latest = [...points].sort((a, b) => a.date.localeCompare(b.date)).at(-1)!.date;
  const start = range === "YTD" ? `${latest.slice(0, 4)}-01-01` : subtractMonths(latest, range === "1M" ? 1 : range === "6M" ? 6 : 12);
  return points.filter((point) => point.date >= start);
}

/** Join portfolio and benchmark values on date for a chart boundary. */
export function buildPortfolioBenchmarkSeries(
  portfolio: PortfolioValuePoint[],
  benchmark: BenchmarkPoint[],
  range: PortfolioRange,
): PortfolioBenchmarkPoint[] {
  const filteredPortfolio = filterPortfolioValueRange(portfolio, range);
  if (filteredPortfolio.length === 0) return [];

  const startDate = filteredPortfolio[0].date;
  const endDate = filteredPortfolio.at(-1)!.date;
  const dates = new Set([
    ...filteredPortfolio.map((point) => point.date),
    ...benchmark.filter((point) => point.date >= startDate && point.date <= endDate).map((point) => point.date),
  ]);
  const portfolioByDate = new Map(portfolio.map((point) => [point.date, point]));
  const benchmarkByDate = new Map(benchmark.map((point) => [point.date, point]));

  return [...dates].sort().map((date) => {
    const portfolioPoint = portfolioByDate.get(date);
    const benchmarkPoint = benchmarkByDate.get(date);
    return {
      date,
      portfolioValue: portfolioPoint?.value ?? null,
      benchmarkValue: benchmarkPoint?.value ?? null,
      unpriced: portfolioPoint?.unpriced ?? [],
    };
  });
}
