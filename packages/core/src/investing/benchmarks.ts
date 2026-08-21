import type { PortfolioValuePoint } from "./portfolio.js";

export const MAX_BENCHMARKS = 3;

export type BenchmarkSelection = { tenantId: string; symbols: string[] };
export interface BenchmarkSelectionStore {
  get(tenantId: string): Promise<BenchmarkSelection>;
  set(selection: BenchmarkSelection): Promise<void>;
}

export type BenchmarkInstrument = {
  symbol: string;
  name: string;
  exchange: string;
  currency: string;
};

export type BenchmarkSeries = BenchmarkInstrument & {
  points: Array<{ date: string; value: number | null }>;
};

export type ChartMode = "euros" | "indexed";
export type ReturnPoint = { date: string; cumulativeReturn: number | null };
export type IndexedSeriesPoint = {
  date: string;
  portfolioReturn: number | null;
  benchmarkReturns: Record<string, number | null>;
  portfolioValue: number | null;
  unpriced: string[];
  cashUnknown: string[];
};

export function validateBenchmarkSymbols(symbols: readonly string[]): string[] {
  const normalized = symbols.map((symbol) => symbol.trim().toUpperCase());
  if (normalized.some((symbol) => !symbol)) throw new Error("Benchmark symbol is required");
  if (normalized.length > MAX_BENCHMARKS) throw new Error(`Select at most ${MAX_BENCHMARKS} benchmarks`);
  if (new Set(normalized).size !== normalized.length) throw new Error("Benchmark symbols must be unique");
  return normalized;
}

export function deriveChartMode(benchmarkIds: readonly string[]): ChartMode {
  return benchmarkIds.length === 0 ? "euros" : "indexed";
}

/** Rebase on original visible-window start. Unknown start never moves the anchor. */
export function computeReturnSeries(points: readonly { date: string; value: number | null }[]): ReturnPoint[] {
  const anchor = points[0]?.value;
  if (anchor === null || anchor === undefined || anchor === 0) {
    return points.map(({ date }) => ({ date, cumulativeReturn: null }));
  }
  return points.map(({ date, value }) => ({
    date,
    cumulativeReturn: value === null ? null : value / anchor - 1,
  }));
}

export function computeTimeWeightedReturnSeries(
  points: readonly { date: string; value: number | null }[],
  externalFlows: readonly { date: string; amount: number | null }[],
): ReturnPoint[] {
  const flows = new Map(externalFlows.map((flow) => [flow.date, flow.amount]));
  let previous: number | null = null;
  let cumulative: number | null = null;
  return points.map((point) => {
    const value = point.value;
    if (value === null) {
      previous = null;
      cumulative = null;
      return { date: point.date, cumulativeReturn: null };
    }
    if (previous === null || previous <= 0) {
      previous = value;
      cumulative = value > 0 ? 0 : null;
      return { date: point.date, cumulativeReturn: cumulative };
    }
    const flow = flows.get(point.date) ?? 0;
    if (flow === null) {
      previous = null;
      cumulative = null;
      return { date: point.date, cumulativeReturn: null };
    }
    const daily = (value - previous - flow) / previous;
    cumulative = cumulative === null ? null : (1 + cumulative) * (1 + daily) - 1;
    previous = value;
    return { date: point.date, cumulativeReturn: cumulative };
  });
}

export function buildIndexedSeries(
  portfolio: readonly PortfolioValuePoint[],
  benchmarks: readonly BenchmarkSeries[],
  externalFlows: readonly { date: string; amount: number | null }[] = [],
): IndexedSeriesPoint[] {
  const portfolioReturns = computeTimeWeightedReturnSeries(portfolio.map((point) => ({ date: point.date, value: point.cashUnknown.length ? null : point.value })), externalFlows);
  const benchmarkReturns = new Map(benchmarks.map((benchmark) => {
    const values = new Map(benchmark.points.map((point) => [point.date, point.value]));
    const aligned = portfolio.map((point) => ({ date: point.date, value: values.get(point.date) ?? null }));
    return [benchmark.symbol, new Map(computeReturnSeries(aligned).map((point) => [point.date, point.cumulativeReturn]))];
  }));
  return portfolio.map((point, index) => ({
    date: point.date,
    portfolioReturn: portfolioReturns[index]?.cumulativeReturn ?? null,
    benchmarkReturns: Object.fromEntries(benchmarks.map((benchmark) => [benchmark.symbol, benchmarkReturns.get(benchmark.symbol)?.get(point.date) ?? null])),
    portfolioValue: point.value,
    unpriced: point.unpriced,
    cashUnknown: point.cashUnknown,
  }));
}
