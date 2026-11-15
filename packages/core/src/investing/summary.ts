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

/** Where one sector weight came from: a provider's own reported sector or
 *  fund look-through, a System One classifier inference, the owner's manual
 *  correction, or no data at all. Optional and defaulted to "unknown" by the
 *  coverage reader (buildSectorCoverage) so a vector built before this field
 *  existed — or a test literal that omits it — still counts as uncovered
 *  rather than silently misattributed to "provider". */
export type SectorWeightSource = "provider" | "inferred" | "correction" | "unknown";
export type SectorWeight = { sector: string; weight: number; source?: SectorWeightSource };

/** Share of priced portfolio value attributable to each SectorWeightSource,
 *  including the residual buildSectorExposure folds into "Unknown" — that
 *  residual is uncovered by definition, so it always counts as "unknown"
 *  coverage. Sums to 1 for a fully-priced portfolio, modulo the same
 *  publisher-rounding tolerance buildSectorExposure applies (see
 *  SECTOR_RESIDUAL_EPSILON). */
export type SectorCoverage = Record<SectorWeightSource, number>;

/** A resolved weight vector rarely sums to exactly 1: Yahoo rounds each of
 *  up to 11 published sector weights to 4 decimals, so a normal equity
 *  ETF's vector sums to 0.9995-0.9998 and leaves a 0.0002-0.0005 residual
 *  before any float arithmetic even runs. This is a rounding tolerance, not
 *  float-noise sizing — below it, a shortfall is publisher rounding, not a
 *  real unclassified share, so it is dropped instead of manufacturing a
 *  phantom Unknown row. */
export const SECTOR_RESIDUAL_EPSILON = 1e-3;

/** Sort-order rounding: two bucket weights within this distance are
 *  indistinguishable, so sector name — not float dust — decides their order. */
const SECTOR_SORT_PRECISION = 1e-9;

function roundForSort(weight: number): number {
  return Math.round(weight / SECTOR_SORT_PRECISION) * SECTOR_SORT_PRECISION;
}

type PricedPosition = { symbol: string; marketValue: number };

function pricedPositions(
  positions: readonly { symbol: string; marketValue: number | null }[],
): PricedPosition[] {
  return positions.filter(
    (position): position is PricedPosition =>
      position.marketValue !== null && position.marketValue > 0,
  );
}

// Only ever scale an overshoot down. A vector that sums below 1 keeps its
// true residual — it is never normalized up into full coverage.
function weightScale(vector: readonly SectorWeight[]): { covered: number; scale: number } {
  const covered = vector.reduce((sum, { weight }) => sum + weight, 0);
  return { covered, scale: covered > 1 ? 1 / covered : 1 };
}

export function buildSectorExposure(
  positions: readonly { symbol: string; marketValue: number | null }[],
  weightsBySymbol: ReadonlyMap<string, readonly SectorWeight[]>,
): SectorExposure[] {
  const totalsBySector = new Map<string, number>();
  let total = 0;
  for (const position of pricedPositions(positions)) {
    const vector = weightsBySymbol.get(position.symbol.toUpperCase()) ?? [];
    const { covered, scale } = weightScale(vector);
    for (const { sector, weight } of vector) {
      totalsBySector.set(
        sector,
        (totalsBySector.get(sector) ?? 0) + position.marketValue * weight * scale,
      );
    }
    const residual = Math.max(0, 1 - covered * scale);
    if (residual > SECTOR_RESIDUAL_EPSILON)
      totalsBySector.set(
        "Unknown",
        (totalsBySector.get("Unknown") ?? 0) + position.marketValue * residual,
      );
    total += position.marketValue;
  }
  if (total <= 0) return [];
  return [...totalsBySector.entries()]
    .map(([sector, value]) => ({ sector, weight: value / total }))
    .sort((left, right) => {
      const byWeight = roundForSort(right.weight) - roundForSort(left.weight);
      return byWeight !== 0 ? byWeight : left.sector.localeCompare(right.sector);
    });
}

/** The same value-weighting as buildSectorExposure, bucketed by source
 *  instead of by sector — how much of the portfolio's priced value rests on
 *  a provider's own data versus an inference versus the owner's own word,
 *  versus nothing at all. */
export function buildSectorCoverage(
  positions: readonly { symbol: string; marketValue: number | null }[],
  weightsBySymbol: ReadonlyMap<string, readonly SectorWeight[]>,
): SectorCoverage {
  const totals: Record<SectorWeightSource, number> = {
    provider: 0,
    inferred: 0,
    correction: 0,
    unknown: 0,
  };
  let total = 0;
  for (const position of pricedPositions(positions)) {
    const vector = weightsBySymbol.get(position.symbol.toUpperCase()) ?? [];
    const { covered, scale } = weightScale(vector);
    for (const { weight, source } of vector)
      totals[source ?? "unknown"] += position.marketValue * weight * scale;
    const residual = Math.max(0, 1 - covered * scale);
    if (residual > SECTOR_RESIDUAL_EPSILON) totals.unknown += position.marketValue * residual;
    total += position.marketValue;
  }
  if (total <= 0) return { provider: 0, inferred: 0, correction: 0, unknown: 0 };
  return {
    provider: totals.provider / total,
    inferred: totals.inferred / total,
    correction: totals.correction / total,
    unknown: totals.unknown / total,
  };
}
