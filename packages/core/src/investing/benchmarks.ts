import type { PortfolioValuePoint } from "./portfolio.js";
import { isPriceFresh } from "./calendar.js";

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
export type MwrPoint = { date: string; xirr: number | null };
export type ExternalCashFlow = { date: string; amount: number | null };
export type IndexedSeriesPoint = {
  date: string;
  portfolioReturn: number | null;
  benchmarkReturns: Record<string, number | null>;
  portfolioValue: number | null;
  benchmarkValues: Record<string, number | null>;
  portfolioXirr: number | null;
  benchmarkXirr: Record<string, number | null>;
  unpriced: string[];
  cashUnknown: string[];
};

export function validateBenchmarkSymbols(symbols: readonly string[]): string[] {
  const normalized = symbols.map((symbol) => symbol.trim().toUpperCase());
  if (normalized.some((symbol) => !symbol)) throw new Error("Benchmark symbol is required");
  if (normalized.length > MAX_BENCHMARKS)
    throw new Error(`Select at most ${MAX_BENCHMARKS} benchmarks`);
  if (new Set(normalized).size !== normalized.length)
    throw new Error("Benchmark symbols must be unique");
  return normalized;
}

export function deriveChartMode(benchmarkIds: readonly string[]): ChartMode {
  return benchmarkIds.length === 0 ? "euros" : "indexed";
}

/** Rebase on original visible-window start. Unknown start never moves the anchor. */
export function computeReturnSeries(
  points: readonly { date: string; value: number | null }[],
): ReturnPoint[] {
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
  externalFlows: readonly ExternalCashFlow[],
): ReturnPoint[] {
  const flows = aggregateFlows(externalFlows);
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
    const flow = flows.has(point.date) ? flows.get(point.date)! : 0;
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

function aggregateFlows(flows: readonly ExternalCashFlow[]): Map<string, number | null> {
  const result = new Map<string, number | null>();
  for (const flow of flows) {
    const current = result.get(flow.date);
    result.set(
      flow.date,
      current === null || flow.amount === null ? null : (current ?? 0) + flow.amount,
    );
  }
  return result;
}

type DatedAmount = { date: string; amount: number };

/** Solve annualized return with actual day distances and no fabricated fallback. */
export function solveXirr(cashFlows: readonly DatedAmount[]): number | null {
  const byDate = new Map<string, number>();
  for (const cashFlow of cashFlows) {
    if (!Number.isFinite(cashFlow.amount) || !/^\d{4}-\d{2}-\d{2}$/.test(cashFlow.date))
      return null;
    byDate.set(cashFlow.date, (byDate.get(cashFlow.date) ?? 0) + cashFlow.amount);
  }
  const values = [...byDate]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([date, amount]) => ({ date, amount }));
  if (
    values.length < 2 ||
    !values.some(({ amount }) => amount < 0) ||
    !values.some(({ amount }) => amount > 0)
  )
    return null;
  const start = Date.parse(`${values[0]!.date}T00:00:00Z`);
  const end = Date.parse(`${values.at(-1)!.date}T00:00:00Z`);
  if (!Number.isFinite(start) || end <= start) return null;
  const dated = values.map(({ date, amount }) => ({
    years: (Date.parse(`${date}T00:00:00Z`) - start) / 31_536_000_000,
    amount,
  }));
  if (dated.length === 2) {
    const ratio = dated[1]!.amount / -dated[0]!.amount;
    const rate = ratio > 0 ? Math.pow(ratio, 1 / dated[1]!.years) - 1 : Number.NaN;
    return Number.isFinite(rate) && rate > -1 ? rate : null;
  }
  const npv = (logGrowth: number) =>
    dated.reduce((sum, item) => sum + item.amount * Math.exp(-item.years * logGrowth), 0);

  // Search on log(1 + rate). This covers rates near -100% without unstable powers.
  const lower = Math.log(1e-9);
  const upper = Math.log(1_000_001);
  const samples = 128;
  let previousX = lower;
  let previousValue = npv(previousX);
  const brackets: Array<[number, number]> = [];
  for (let index = 1; index <= samples; index += 1) {
    const x = lower + ((upper - lower) * index) / samples;
    const value = npv(x);
    if (
      Number.isFinite(previousValue) &&
      Number.isFinite(value) &&
      (value === 0 || Math.sign(value) !== Math.sign(previousValue))
    ) {
      brackets.push([previousX, x]);
    }
    previousX = x;
    previousValue = value;
  }
  if (brackets.length !== 1) return null;
  let [left, right] = brackets[0]!;
  let leftValue = npv(left);
  for (let iteration = 0; iteration < 160; iteration += 1) {
    const middle = (left + right) / 2;
    const middleValue = npv(middle);
    if (!Number.isFinite(middleValue)) return null;
    if (Math.abs(middleValue) < 1e-9 || Math.abs(right - left) < 1e-12) {
      const rate = Math.expm1(middle);
      return Number.isFinite(rate) ? rate : null;
    }
    if (Math.sign(middleValue) === Math.sign(leftValue)) {
      left = middle;
      leftValue = middleValue;
    } else {
      right = middle;
    }
  }
  return null;
}

/** Calculate since-window money-weighted return at every possible crosshair date. */
export function computeXirrSeries(
  points: readonly { date: string; value: number | null }[],
  externalFlows: readonly ExternalCashFlow[],
): MwrPoint[] {
  const start = points[0];
  if (!start || start.value === null || start.value <= 0)
    return points.map(({ date }) => ({ date, xirr: null }));
  const startValue = start.value;
  const flows = [...aggregateFlows(externalFlows)].sort(([left], [right]) =>
    left.localeCompare(right),
  );
  return points.map((point) => {
    if (point.value === null || point.value <= 0 || point.date <= start.date)
      return { date: point.date, xirr: null };
    const dated: DatedAmount[] = [{ date: start.date, amount: -startValue }];
    for (const [date, amount] of flows) {
      if (date < start.date || date > point.date || amount === 0) continue;
      if (amount === null) return { date: point.date, xirr: null };
      dated.push({ date, amount: -amount });
    }
    dated.push({ date: point.date, amount: point.value });
    return { date: point.date, xirr: solveXirr(dated) };
  });
}

/** Align closes to requested dates with shared five-business-day fill limit. */
export function alignBenchmarkValues(
  dates: readonly string[],
  points: readonly { date: string; value: number | null }[],
): Array<{ date: string; value: number | null }> {
  const sorted = [...points]
    .filter((point) => point.value !== null)
    .sort((left, right) => left.date.localeCompare(right.date));
  let cursor = 0;
  let latest: (typeof sorted)[number] | undefined;
  return [...dates].map((date) => {
    while (cursor < sorted.length && sorted[cursor]!.date <= date) {
      latest = sorted[cursor];
      cursor += 1;
    }
    return {
      date,
      value: !latest || !isPriceFresh(latest.date, date) ? null : latest.value,
    };
  });
}

export function computeBenchmarkXirrSeries(
  portfolio: readonly { date: string; value: number | null }[],
  benchmark: readonly { date: string; value: number | null }[],
  externalFlows: readonly ExternalCashFlow[],
): MwrPoint[] {
  const start = portfolio[0];
  const requestedDates = [
    ...new Set([...portfolio.map(({ date }) => date), ...externalFlows.map(({ date }) => date)]),
  ].sort();
  const prices = new Map(
    alignBenchmarkValues(requestedDates, benchmark).map((point) => [point.date, point.value]),
  );
  const startPrice = start ? prices.get(start.date) : null;
  if (
    !start ||
    start.value === null ||
    start.value <= 0 ||
    startPrice === null ||
    startPrice === undefined ||
    startPrice <= 0
  ) {
    return portfolio.map(({ date }) => ({ date, xirr: null }));
  }
  const flows = [...aggregateFlows(externalFlows)].sort(([left], [right]) =>
    left.localeCompare(right),
  );
  return portfolio.map((point) => {
    const terminalPrice = prices.get(point.date);
    if (
      point.date <= start.date ||
      terminalPrice === null ||
      terminalPrice === undefined ||
      terminalPrice <= 0
    )
      return { date: point.date, xirr: null };
    let units = start.value! / startPrice;
    const dated: DatedAmount[] = [{ date: start.date, amount: -start.value! }];
    for (const [date, amount] of flows) {
      if (date < start.date || date > point.date || amount === 0) continue;
      const flowPrice = prices.get(date);
      if (amount === null || flowPrice === null || flowPrice === undefined || flowPrice <= 0)
        return { date: point.date, xirr: null };
      units += amount / flowPrice;
      dated.push({ date, amount: -amount });
    }
    const terminalValue = units * terminalPrice;
    if (!Number.isFinite(terminalValue) || terminalValue <= 0)
      return { date: point.date, xirr: null };
    dated.push({ date: point.date, amount: terminalValue });
    return { date: point.date, xirr: solveXirr(dated) };
  });
}

export function buildIndexedSeries(
  portfolio: readonly PortfolioValuePoint[],
  benchmarks: readonly BenchmarkSeries[],
  externalFlows: readonly ExternalCashFlow[] = [],
): IndexedSeriesPoint[] {
  const reachablePortfolio = portfolio.map((point) => ({
    date: point.date,
    value: point.cashUnknown.length ? null : point.value,
  }));
  const portfolioReturns = computeTimeWeightedReturnSeries(reachablePortfolio, externalFlows);
  const portfolioXirr = computeXirrSeries(reachablePortfolio, externalFlows);
  const alignedValues = new Map(
    benchmarks.map((benchmark) => [
      benchmark.symbol,
      alignBenchmarkValues(
        portfolio.map(({ date }) => date),
        benchmark.points,
      ),
    ]),
  );
  const benchmarkReturns = new Map(
    benchmarks.map((benchmark) => {
      const aligned = alignedValues.get(benchmark.symbol) ?? [];
      return [
        benchmark.symbol,
        new Map(computeReturnSeries(aligned).map((point) => [point.date, point.cumulativeReturn])),
      ];
    }),
  );
  const benchmarkXirr = new Map(
    benchmarks.map((benchmark) => [
      benchmark.symbol,
      computeBenchmarkXirrSeries(reachablePortfolio, benchmark.points, externalFlows),
    ]),
  );
  return portfolio.map((point, index) => ({
    date: point.date,
    portfolioReturn: portfolioReturns[index]?.cumulativeReturn ?? null,
    benchmarkReturns: Object.fromEntries(
      benchmarks.map((benchmark) => [
        benchmark.symbol,
        benchmarkReturns.get(benchmark.symbol)?.get(point.date) ?? null,
      ]),
    ),
    portfolioValue: point.value,
    benchmarkValues: Object.fromEntries(
      benchmarks.map((benchmark) => [
        benchmark.symbol,
        alignedValues.get(benchmark.symbol)?.[index]?.value ?? null,
      ]),
    ),
    portfolioXirr: portfolioXirr[index]?.xirr ?? null,
    benchmarkXirr: Object.fromEntries(
      benchmarks.map((benchmark) => [
        benchmark.symbol,
        benchmarkXirr.get(benchmark.symbol)?.[index]?.xirr ?? null,
      ]),
    ),
    unpriced: point.unpriced,
    cashUnknown: point.cashUnknown,
  }));
}
