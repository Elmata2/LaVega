import type { InvestingDashboardData } from "./dashboard.js";
import { computePortfolioMetrics } from "./summary.js";

export const RISK_MINIMUM_OBSERVATIONS = 60;
/** 0.5% of the date's portfolio value. An unaccounted slice this small
 *  perturbs a daily return by far less than a typical daily move, so it
 *  cannot meaningfully change a volatility or drawdown estimate; anything
 *  larger can, so the date stays disqualified. */
export const RISK_MATERIALITY_THRESHOLD = 0.005;
export type RiskRange = "6M" | "1Y" | "All";

export function benchmarkCurrencyMismatchReason(
  presentationCurrency: string,
  benchmark: { symbol: string; currency: string },
): string {
  return `Beta and alpha need a ${presentationCurrency}-quoted benchmark; ${benchmark.symbol} is quoted in ${benchmark.currency}.`;
}

/** Historical account risk. Partial valuations are never market returns. */
export function buildHistoricalRisk(
  data: InvestingDashboardData,
  range: RiskRange = "1Y",
  benchmarkSymbol?: string,
) {
  const points = data.portfolio[range];
  const benchmark = benchmarkSymbol
    ? data.benchmarks.find((item) => item.symbol === benchmarkSymbol)
    : data.benchmarks[0];
  const isImmaterial = (point: (typeof points)[number]): boolean => {
    const hasUnresolved =
      point.unpriced.length > 0 ||
      point.forwardFilled.length > 0 ||
      (point.holdingsUnknown?.length ?? 0) > 0;
    if (!hasUnresolved) return true;
    const unaccounted = point.unaccountedValue;
    if (unaccounted == null || point.value == null) return false;
    return Math.abs(unaccounted) <= RISK_MATERIALITY_THRESHOLD * Math.abs(point.value);
  };
  const known = (point: (typeof points)[number]) =>
    point.cashUnknown.length === 0 && isImmaterial(point);
  let start = points.length;
  while (start > 0 && known(points[start - 1]!)) start -= 1;
  const window = points.slice(start);
  const earlier = points.slice(0, start);
  const missingPrices = [...new Set(earlier.flatMap((point) => point.unpriced))].sort();
  const missingCash = [...new Set(earlier.flatMap((point) => point.cashUnknown))].sort();
  const missingHoldings = [
    ...new Set(earlier.flatMap((point) => point.holdingsUnknown ?? [])),
  ].sort();
  const estimatedPrices = earlier.some((point) => point.forwardFilled.length > 0);
  const coverage =
    window.length === 0
      ? null
      : Math.min(
          ...window.map((point) => {
            if (!point.value) return 1;
            return 1 - Math.abs(point.unaccountedValue ?? 0) / Math.abs(point.value);
          }),
        );
  const negativeCashDays = window.filter(
    (point) => point.cashValue !== null && point.cashValue < -0.01,
  ).length;
  const comparable = benchmark?.currency === data.presentationCurrency;
  const computed = computePortfolioMetrics({
    valuePoints: window.map((point) => ({ date: point.date, value: point.value })),
    externalCashFlows: data.externalCashFlows,
    benchmarkPoints: comparable ? benchmark?.points : undefined,
    minObservations: RISK_MINIMUM_OBSERVATIONS,
  });
  const complete = window.length > 0 && computed.excludedIntervals === 0;
  const available = complete && computed.observationDays >= RISK_MINIMUM_OBSERVATIONS;
  const metrics = available
    ? computed
    : {
        ...computed,
        dailyVolatility: null,
        annualizedVolatility: null,
        beta: null,
        alpha: null,
        maxDrawdown: null,
      };
  const reasons: string[] = [];
  if (missingCash.length) reasons.push(`Cash history missing: ${missingCash.join(", ")}.`);
  if (negativeCashDays > 0)
    reasons.push(
      `Cash balance is below zero on ${negativeCashDays} dates; risk estimates may be inaccurate.`,
    );
  if (missingPrices.length) reasons.push(`Prices missing for ${missingPrices.length} instruments.`);
  if (missingHoldings.length)
    reasons.push(`Ownership history incomplete for ${missingHoldings.length} holdings.`);
  if (estimatedPrices) reasons.push("Some dates use carried-forward prices.");
  if (coverage !== null && coverage < 1)
    reasons.push(
      `Estimate covers ${(coverage * 100).toFixed(2)}% of portfolio value; the rest carries uncertain ownership or pricing but is too small to change the result.`,
    );
  if (window.length === 0) reasons.push("No recent date has complete data.");
  else if (start > 0)
    reasons.push(
      `Measured from ${window[0]!.date}; earlier dates in this range lack complete data.`,
    );
  if (window.length > 0 && computed.excludedIntervals > 0)
    reasons.push("Some return intervals could not be measured and are excluded.");
  if (computed.observationDays < RISK_MINIMUM_OBSERVATIONS)
    reasons.push(`At least ${RISK_MINIMUM_OBSERVATIONS} valid daily returns are required.`);
  if (!benchmark) reasons.push("Add a benchmark with Compare above to calculate beta and alpha.");
  else if (!comparable)
    reasons.push(benchmarkCurrencyMismatchReason(data.presentationCurrency, benchmark));
  else if (available && metrics.beta === null)
    reasons.push(
      "Beta and alpha need 60 matching return intervals and a benchmark with non-zero variance.",
    );
  return {
    metrics,
    risk: {
      status: available ? ("estimate" as const) : ("unavailable" as const),
      range,
      from: window[0]?.date ?? null,
      to: window.at(-1)?.date ?? null,
      minimumObservations: RISK_MINIMUM_OBSERVATIONS,
      benchmark: benchmark
        ? { symbol: benchmark.symbol, name: benchmark.name, currency: benchmark.currency }
        : null,
      benchmarks: data.benchmarks.map(({ symbol, name, currency }) => ({ symbol, name, currency })),
      reasons,
      missingHoldings,
      missingPrices,
      coverage,
      currency: data.presentationCurrency,
    },
  };
}

export type HistoricalRisk = ReturnType<typeof buildHistoricalRisk>["risk"];
