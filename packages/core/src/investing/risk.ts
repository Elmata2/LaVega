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

  // Max drawdown needs a genuinely continuous, fully priced series: one
  // unknown date makes the compounded path unobservable, so it still uses
  // only the most recent unbroken run of complete dates.
  let start = points.length;
  while (start > 0 && known(points[start - 1]!)) start -= 1;
  const window = points.slice(start);

  // Volatility, beta and alpha are each built from independent daily
  // intervals, so one unknown date should drop only the interval(s) that
  // touch it, not every earlier date. Mark every point's usability and let
  // computePortfolioMetrics exclude just the bad intervals, keeping the real
  // history around them.
  const unknownPoints = points.filter((point) => !known(point));
  const missingPrices = [...new Set(unknownPoints.flatMap((point) => point.unpriced))].sort();
  const missingCash = [...new Set(unknownPoints.flatMap((point) => point.cashUnknown))].sort();
  const missingHoldings = [
    ...new Set(unknownPoints.flatMap((point) => point.holdingsUnknown ?? [])),
  ].sort();
  const estimatedPrices = unknownPoints.some((point) => point.forwardFilled.length > 0);
  const estimatedCash = [...new Set(points.flatMap((point) => point.cashEstimated ?? []))].sort();
  const knownPoints = points.filter(known);
  const coverage =
    knownPoints.length === 0
      ? null
      : Math.min(
          ...knownPoints.map((point) => {
            if (!point.value) return 1;
            return 1 - Math.abs(point.unaccountedValue ?? 0) / Math.abs(point.value);
          }),
        );
  const negativeCashDays = knownPoints.filter(
    (point) => point.cashValue !== null && point.cashValue < -0.01,
  ).length;
  const comparable = benchmark?.currency === data.presentationCurrency;
  const computed = computePortfolioMetrics({
    valuePoints: points.map((point) => ({
      date: point.date,
      value: point.value,
      usable: known(point),
    })),
    externalCashFlows: data.externalCashFlows,
    benchmarkPoints: comparable ? benchmark?.points : undefined,
    minObservations: RISK_MINIMUM_OBSERVATIONS,
  });
  const drawdown = computePortfolioMetrics({
    valuePoints: window.map((point) => ({ date: point.date, value: point.value })),
    externalCashFlows: data.externalCashFlows,
  }).maxDrawdown;
  const lastKnown = points.length > 0 && known(points.at(-1)!);
  const available = lastKnown && computed.observationDays >= RISK_MINIMUM_OBSERVATIONS;
  const metrics = available
    ? { ...computed, maxDrawdown: drawdown }
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
  if (estimatedCash.length)
    reasons.push(
      `Cash for ${estimatedCash.join(", ")} is walked from history the broker could not prove complete.`,
    );
  if (coverage !== null && coverage < 1)
    reasons.push(
      `Estimate covers ${(coverage * 100).toFixed(2)}% of portfolio value; the rest carries uncertain ownership or pricing but is too small to change the result.`,
    );
  if (window.length === 0)
    reasons.push("No recent date has a continuous, fully priced history for maximum drawdown.");
  else if (start > 0)
    reasons.push(
      `Maximum drawdown is measured from ${window[0]!.date}; earlier dates lack a continuous, fully priced history.`,
    );
  if (computed.excludedIntervals > 0)
    reasons.push(
      "Return intervals that touch an incomplete date are excluded from volatility and beta.",
    );
  if (!lastKnown) reasons.push("Today's data is not yet complete, so the estimate is not shown.");
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
      from: computed.startDate,
      to: computed.endDate,
      drawdownFrom: (window[0]?.date ?? null) as string | null,
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
