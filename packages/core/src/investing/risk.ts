import type { InvestingDashboardData } from "./dashboard.js";
import { computePortfolioMetrics } from "./summary.js";

export const RISK_MINIMUM_OBSERVATIONS = 60;
export type RiskRange = "6M" | "1Y" | "All";

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
  const missingPrices = [...new Set(points.flatMap((point) => point.unpriced))].sort();
  const missingCash = [...new Set(points.flatMap((point) => point.cashUnknown))].sort();
  const missingHoldings = [
    ...new Set(points.flatMap((point) => point.holdingsUnknown ?? [])),
  ].sort();
  const estimatedPrices = points.some((point) => point.forwardFilled.length > 0);
  const usable = (point: (typeof points)[number]) =>
    point.unpriced.length === 0 &&
    point.cashUnknown.length === 0 &&
    (point.holdingsUnknown?.length ?? 0) === 0 &&
    point.forwardFilled.length === 0;
  const comparable = benchmark?.currency === data.presentationCurrency;
  const computed = computePortfolioMetrics({
    valuePoints: points.map((point) => ({
      date: point.date,
      value: usable(point) ? point.value : null,
    })),
    externalCashFlows: data.externalCashFlows,
    benchmarkPoints: comparable ? benchmark?.points : undefined,
    minObservations: RISK_MINIMUM_OBSERVATIONS,
  });
  const complete = points.every(usable) && computed.excludedIntervals === 0;
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
  if (missingPrices.length) reasons.push(`Prices missing for ${missingPrices.length} instruments.`);
  if (missingHoldings.length)
    reasons.push(`Ownership history incomplete for ${missingHoldings.length} holdings.`);
  if (estimatedPrices) reasons.push("Some dates use carried-forward prices.");
  if (!complete)
    reasons.push("A complete return history is required; partial values are excluded.");
  if (computed.observationDays < RISK_MINIMUM_OBSERVATIONS)
    reasons.push(`At least ${RISK_MINIMUM_OBSERVATIONS} valid daily returns are required.`);
  if (!benchmark) reasons.push("Add a benchmark with Compare above to calculate beta and alpha.");
  else if (!comparable)
    reasons.push(
      `Beta and alpha need a ${data.presentationCurrency}-quoted benchmark; ${benchmark.symbol} is quoted in ${benchmark.currency}.`,
    );
  else if (available && metrics.beta === null)
    reasons.push(
      "Beta and alpha need 60 matching return intervals and a benchmark with non-zero variance.",
    );
  return {
    metrics,
    risk: {
      status: available ? ("estimate" as const) : ("unavailable" as const),
      range,
      from: points[0]?.date ?? null,
      to: points.at(-1)?.date ?? null,
      minimumObservations: RISK_MINIMUM_OBSERVATIONS,
      benchmark: benchmark
        ? { symbol: benchmark.symbol, name: benchmark.name, currency: benchmark.currency }
        : null,
      benchmarks: data.benchmarks.map(({ symbol, name, currency }) => ({ symbol, name, currency })),
      reasons,
      missingHoldings,
      missingPrices,
      currency: data.presentationCurrency,
    },
  };
}

export type HistoricalRisk = ReturnType<typeof buildHistoricalRisk>["risk"];
