import type { ExternalCashFlow } from "./benchmarks.js";

export type MetricPoint = { date: string; value: number | null; usable?: boolean };

export type PortfolioMetrics = {
  dailyVolatility: number | null;
  annualizedVolatility: number | null;
  beta: number | null;
  alpha: number | null;
  maxDrawdown: number | null;
  observationDays: number;
  excludedIntervals: number;
  pairedObservationDays: number;
  startDate: string | null;
  endDate: string | null;
};

export type SectorExposure = { sector: string; weight: number };

/** Fewer usable return observations than this and every statistic is noise. */
const MIN_OBSERVATIONS = 20;
const TRADING_DAYS = 252;

type ValidPoint = { date: string; value: number };
type DatedReturn = { start: string; date: string; ret: number };

function isValidPoint(point: MetricPoint): point is ValidPoint {
  return (
    /^\d{4}-\d{2}-\d{2}$/.test(point.date) &&
    Number.isFinite(Date.parse(`${point.date}T00:00:00Z`)) &&
    point.usable !== false &&
    point.value !== null &&
    Number.isFinite(point.value) &&
    point.value > 0
  );
}

function dayDistance(left: string, right: string): number {
  return (Date.parse(`${right}T00:00:00Z`) - Date.parse(`${left}T00:00:00Z`)) / 86_400_000;
}

function alignedReturns(
  points: readonly MetricPoint[],
  flows: ReadonlyMap<string, number | null>,
): { returns: DatedReturn[]; invalidIntervals: number; values: ValidPoint[] } {
  const input = [...points].sort((left, right) => left.date.localeCompare(right.date));
  const counts = new Map<string, number>();
  for (const point of input) counts.set(point.date, (counts.get(point.date) ?? 0) + 1);
  const returns: DatedReturn[] = [];
  const values: ValidPoint[] = [];
  let invalidIntervals = 0;
  let previous: ValidPoint | null = null;
  for (const point of input) {
    if ((counts.get(point.date) ?? 0) > 1) {
      invalidIntervals += 1;
      previous = null;
      continue;
    }
    if (!isValidPoint(point)) {
      invalidIntervals += 1;
      previous = null;
      continue;
    }
    const current = { date: point.date, value: point.value };
    values.push(current);
    if (previous) {
      const distance = dayDistance(previous.date, current.date);
      let flow = 0;
      let flowKnown = true;
      for (const [flowDate, amount] of flows)
        if (flowDate > previous.date && flowDate <= current.date) {
          if (amount === null) flowKnown = false;
          else flow += amount;
        }
      const ret = flowKnown ? (current.value - flow) / previous.value - 1 : Number.NaN;
      if (
        !Number.isFinite(distance) ||
        distance <= 0 ||
        distance > 4 ||
        !Number.isFinite(ret) ||
        ret <= -1
      )
        invalidIntervals += 1;
      else returns.push({ start: previous.date, date: current.date, ret });
    }
    previous = current;
  }
  return { returns, invalidIntervals, values };
}

function flowMap(flows: readonly ExternalCashFlow[] | undefined): Map<string, number | null> {
  const result = new Map<string, number | null>();
  for (const flow of flows ?? []) {
    const current = result.get(flow.date);
    if (flow.amount === null || !Number.isFinite(flow.amount)) result.set(flow.date, null);
    else if (current !== null) result.set(flow.date, (current ?? 0) + flow.amount);
  }
  return result;
}

function mean(values: readonly number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function sampleVariance(values: readonly number[], meanValue: number): number {
  if (values.length < 2) return NaN;
  return values.reduce((sum, value) => sum + (value - meanValue) ** 2, 0) / (values.length - 1);
}

export function computePortfolioMetrics(input: {
  valuePoints: readonly MetricPoint[];
  benchmarkPoints?: readonly MetricPoint[];
  externalCashFlows?: readonly ExternalCashFlow[];
  minObservations?: number;
}): PortfolioMetrics {
  const empty: PortfolioMetrics = {
    dailyVolatility: null,
    annualizedVolatility: null,
    beta: null,
    alpha: null,
    maxDrawdown: null,
    observationDays: 0,
    excludedIntervals: 0,
    pairedObservationDays: 0,
    startDate: null,
    endDate: null,
  };
  const flows = flowMap(input.externalCashFlows);
  const aligned = alignedReturns(input.valuePoints, flows);
  const returns = aligned.returns;
  let drawdown: number | null = null;
  if (returns.length >= 1 && aligned.invalidIntervals === 0) {
    let compounded = aligned.values[0]!.value;
    const path = [compounded];
    for (const entry of returns) {
      compounded *= 1 + entry.ret;
      path.push(compounded);
    }
    drawdown = maxDrawdown(path);
  }
  const minObservations =
    Number.isFinite(input.minObservations) && (input.minObservations ?? 0) >= 2
      ? Math.floor(input.minObservations!)
      : MIN_OBSERVATIONS;
  if (returns.length < minObservations)
    return {
      ...empty,
      observationDays: returns.length,
      excludedIntervals: aligned.invalidIntervals,
      maxDrawdown: drawdown,
      startDate: aligned.values[0]?.date ?? null,
      endDate: aligned.values.at(-1)?.date ?? null,
    };
  const meanReturn = mean(returns.map((entry) => entry.ret));
  const variance = sampleVariance(
    returns.map((entry) => entry.ret),
    meanReturn,
  );
  if (!Number.isFinite(variance)) return { ...empty, maxDrawdown: drawdown };
  const dailyVolatility = Math.sqrt(variance);
  const annualizedVolatility = dailyVolatility * Math.sqrt(TRADING_DAYS);

  let beta: number | null = null;
  let alpha: number | null = null;
  let pairedObservationDays = 0;
  if (input.benchmarkPoints) {
    const benchmark = alignedReturns(input.benchmarkPoints, new Map());
    const benchmarkByDate = new Map(
      benchmark.returns.map((entry) => [`${entry.start}|${entry.date}`, entry.ret]),
    );
    const pairs = returns.flatMap((entry) => {
      const benchmarkReturn = benchmarkByDate.get(`${entry.start}|${entry.date}`);
      return benchmarkReturn === undefined
        ? []
        : [{ portfolio: entry.ret, benchmark: benchmarkReturn }];
    });
    pairedObservationDays = pairs.length;
    if (pairs.length >= minObservations) {
      const meanPortfolio = mean(pairs.map((pair) => pair.portfolio));
      const meanBenchmark = mean(pairs.map((pair) => pair.benchmark));
      const benchmarkVariance = sampleVariance(
        pairs.map((pair) => pair.benchmark),
        meanBenchmark,
      );
      if (Number.isFinite(benchmarkVariance) && benchmarkVariance > 0) {
        const covariance =
          pairs.reduce(
            (sum, pair) =>
              sum + (pair.portfolio - meanPortfolio) * (pair.benchmark - meanBenchmark),
            0,
          ) /
          (pairs.length - 1);
        const candidateBeta = covariance / benchmarkVariance;
        const candidateAlpha =
          meanPortfolio * TRADING_DAYS - candidateBeta * meanBenchmark * TRADING_DAYS;
        if (Number.isFinite(candidateBeta)) beta = candidateBeta;
        if (Number.isFinite(candidateAlpha)) alpha = candidateAlpha;
      }
    }
  }

  return {
    dailyVolatility: dailyVolatility,
    annualizedVolatility: Number.isFinite(annualizedVolatility) ? annualizedVolatility : null,
    beta: beta,
    alpha: alpha,
    maxDrawdown: drawdown,
    observationDays: returns.length,
    excludedIntervals: aligned.invalidIntervals,
    pairedObservationDays,
    startDate: aligned.values[0]?.date ?? null,
    endDate: aligned.values.at(-1)?.date ?? null,
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
