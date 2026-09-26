import { useEffect, useState } from "react";
import type { HistoricalRisk, PortfolioMetrics, RiskRange, SectorExposure } from "@lavega/core";

export type PortfolioSummary = {
  metrics: PortfolioMetrics;
  sectors: SectorExposure[];
  topPositions: Array<{ symbol: string; weight: number }>;
  risk: HistoricalRisk;
  composition?: { pricedHoldings: number; missingHoldings: number; estimatedHoldings: number };
};

type SummaryState =
  | { status: "loading" }
  | { status: "ready"; data: PortfolioSummary }
  | { status: "error"; message: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

const isString = (value: unknown): boolean => typeof value === "string";
const isDateOrNull = (value: unknown): boolean => value === null || isString(value);
const hasStrings = (value: unknown, ...keys: string[]): boolean =>
  isRecord(value) && keys.every((key) => isString(value[key]));
const isArrayOf = (value: unknown, check: (entry: unknown) => boolean): boolean =>
  Array.isArray(value) && value.every(check);

/** Decodes the network contract, nested fields included: the card renders
 * these text fields and counts as-is, and nothing above it catches a render
 * error. Numbers it formats (weights, ratios) fall back to "Unavailable". */
function isPortfolioSummary(value: unknown): value is PortfolioSummary {
  if (!isRecord(value) || !isRecord(value.metrics) || !isRecord(value.risk)) return false;
  const { metrics, risk } = value;
  return (
    typeof metrics.observationDays === "number" &&
    typeof metrics.pairedObservationDays === "number" &&
    hasStrings(risk, "status", "currency") &&
    isDateOrNull(risk.from) &&
    isDateOrNull(risk.to) &&
    isArrayOf(risk.reasons, isString) &&
    isArrayOf(risk.missingPrices, isString) &&
    isArrayOf(risk.missingHoldings, isString) &&
    isArrayOf(risk.benchmarks, (entry) => hasStrings(entry, "symbol", "name", "currency")) &&
    (risk.benchmark === null ||
      risk.benchmark === undefined ||
      hasStrings(risk.benchmark, "symbol")) &&
    isArrayOf(value.sectors, (entry) => hasStrings(entry, "sector")) &&
    isArrayOf(value.topPositions, (entry) => hasStrings(entry, "symbol"))
  );
}

function isAbortError(reason: unknown): boolean {
  return reason instanceof DOMException && reason.name === "AbortError";
}

async function fetchPortfolioSummary(
  range: RiskRange,
  benchmark: string,
  signal: AbortSignal,
): Promise<PortfolioSummary> {
  const query = new URLSearchParams({ range });
  if (benchmark) query.set("benchmark", benchmark);
  let response: Response;
  try {
    response = await fetch(`/api/investing/summary?${query}`, { signal });
  } catch (reason) {
    if (isAbortError(reason)) throw reason;
    throw new Error("Failed to load summary: network error.");
  }
  if (!response.ok) throw new Error(`Failed to load summary: ${response.status}`);
  const payload: unknown = await response.json().catch(() => undefined);
  if (!isPortfolioSummary(payload)) throw new Error("Summary has an invalid format.");
  return payload;
}

/** Owns the summary request for one range and benchmark. It loads again only
 * when those, the benchmark revision or an explicit refresh change: broker and
 * price updates are left to the user's Refresh risk, by design. */
export function usePortfolioSummary(
  range: RiskRange,
  benchmark: string,
  revision: string,
): { state: SummaryState; refresh: () => void } {
  const [refreshes, setRefreshes] = useState(0);
  const requestKey = JSON.stringify([range, benchmark, revision, refreshes]);
  const [state, setState] = useState<{ key: string; result: SummaryState }>({
    key: "",
    result: { status: "loading" },
  });
  useEffect(() => {
    const controller = new AbortController();
    void fetchPortfolioSummary(range, benchmark, controller.signal)
      .then((data) => {
        if (!controller.signal.aborted)
          setState({ key: requestKey, result: { status: "ready", data } });
      })
      .catch((reason: unknown) => {
        if (controller.signal.aborted || isAbortError(reason)) return;
        setState({
          key: requestKey,
          result: {
            status: "error",
            message: reason instanceof Error ? reason.message : "Failed to load summary",
          },
        });
      });
    return () => controller.abort();
  }, [range, benchmark, requestKey]);
  return {
    state: state.key === requestKey ? state.result : { status: "loading" },
    refresh: () => setRefreshes((value) => value + 1),
  };
}
