export type MetricPoint = { date: string; value: number | null };

export type PortfolioMetrics = {
  dailyVolatility: number | null;
  annualizedVolatility: number | null;
  beta: number | null;
  alpha: number | null;
  maxDrawdown: number | null;
  observationDays: number;
};

export type SectorExposure = { sector: string; weight: number };

/** Fewer usable return observations than this and every statistic is noise. */
const MIN_OBSERVATIONS = 20;
const TRADING_DAYS = 252;

function alignedReturns(points: readonly MetricPoint[]): Array<{ date: string; ret: number }> {
  const sorted = [...points].sort((left, right) => left.date.localeCompare(right.date));
  const returns: Array<{ date: string; ret: number }> = [];
  let previous: { date: string; value: number } | null = null;
  for (const point of sorted) {
    if (point.value === null) continue;
    if (previous && previous.value !== 0 && point.value > 0) returns.push({ date: point.date, ret: point.value / previous.value - 1 });
    previous = { date: point.date, value: point.value };
  }
  return returns;
}

function mean(values: readonly number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function sampleVariance(values: readonly number[], meanValue: number): number {
  if (values.length < 2) return NaN;
  return values.reduce((sum, value) => sum + (value - meanValue) ** 2, 0) / (values.length - 1);
}

export function computePortfolioMetrics(input: { valuePoints: readonly MetricPoint[]; benchmarkPoints?: readonly MetricPoint[] }): PortfolioMetrics {
  const empty: PortfolioMetrics = { dailyVolatility: null, annualizedVolatility: null, beta: null, alpha: null, maxDrawdown: null, observationDays: 0 };
  const returns = alignedReturns(input.valuePoints);
  const values = input.valuePoints.filter((point): point is { date: string; value: number } => point.value !== null);
  const drawdown = values.length >= 2 ? maxDrawdown(values.map((point) => point.value)) : null;
  if (returns.length < MIN_OBSERVATIONS) return { ...empty, observationDays: returns.length, maxDrawdown: drawdown };
  const meanReturn = mean(returns.map((entry) => entry.ret));
  const variance = sampleVariance(returns.map((entry) => entry.ret), meanReturn);
  if (!Number.isFinite(variance)) return { ...empty, maxDrawdown: drawdown };
  const dailyVolatility = Math.sqrt(variance);

  let beta: number | null = null;
  let alpha: number | null = null;
  if (input.benchmarkPoints) {
    const benchmarkByDate = new Map(alignedReturns(input.benchmarkPoints).map((entry) => [entry.date, entry.ret]));
    const pairs = returns.flatMap((entry) => {
      const benchmarkReturn = benchmarkByDate.get(entry.date);
      return benchmarkReturn === undefined ? [] : [{ portfolio: entry.ret, benchmark: benchmarkReturn }];
    });
    if (pairs.length >= MIN_OBSERVATIONS) {
      const meanPortfolio = mean(pairs.map((pair) => pair.portfolio));
      const meanBenchmark = mean(pairs.map((pair) => pair.benchmark));
      const benchmarkVariance = sampleVariance(pairs.map((pair) => pair.benchmark), meanBenchmark);
      if (Number.isFinite(benchmarkVariance) && benchmarkVariance > 0) {
        const covariance = pairs.reduce((sum, pair) => sum + (pair.portfolio - meanPortfolio) * (pair.benchmark - meanBenchmark), 0) / (pairs.length - 1);
        beta = covariance / benchmarkVariance;
        alpha = meanPortfolio * TRADING_DAYS - beta * meanBenchmark * TRADING_DAYS;
      }
    }
  }

  return {
    dailyVolatility: dailyVolatility,
    annualizedVolatility: dailyVolatility * Math.sqrt(TRADING_DAYS),
    beta: beta,
    alpha: alpha,
    maxDrawdown: drawdown,
    observationDays: returns.length,
  };
}

function maxDrawdown(values: readonly number[]): number {
  let peak = values[0]!;
  let worst = 0;
  for (const value of values) {
    peak = Math.max(peak, value);
    worst = Math.min(worst, peak === 0 ? 0 : value / peak - 1);
  }
  return worst;
}

export function buildSectorExposure(
  positions: readonly { symbol: string; marketValue: number | null }[],
  sectorBySymbol: ReadonlyMap<string, string>,
): SectorExposure[] {
  const totalsBySector = new Map<string, number>();
  let total = 0;
  for (const position of positions) {
    if (position.marketValue === null || position.marketValue <= 0) continue;
    const sector = sectorBySymbol.get(position.symbol.toUpperCase()) ?? "Unknown";
    totalsBySector.set(sector, (totalsBySector.get(sector) ?? 0) + position.marketValue);
    total += position.marketValue;
  }
  if (total <= 0) return [];
  return [...totalsBySector.entries()]
    .map(([sector, value]) => ({ sector: sector, weight: value / total }))
    .sort((left, right) => right.weight - left.weight || left.sector.localeCompare(right.sector));
}
