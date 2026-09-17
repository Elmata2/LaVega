import { useEffect, useRef, useState } from "react";
import { PORTFOLIO_RANGES, type InvestingDashboardData, type PortfolioRange } from "@lavega/core";
import { DASHBOARD_REFRESH_EVENT } from "./priceSync";

export type DashboardState =
  | { status: "loading" }
  | { status: "ready"; data: InvestingDashboardData; refreshError?: string }
  | { status: "error"; message: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isPortfolioRanges(value: unknown): value is Record<PortfolioRange, unknown[]> {
  return isRecord(value) && PORTFOLIO_RANGES.every((range) => Array.isArray(value[range]));
}

function isAllocation(value: unknown): boolean {
  return isRecord(value) && Array.isArray(value.buckets) && Array.isArray(value.unpriced);
}

/** Decodes the network contract; rejects a payload missing a required field. */
function isDashboardData(value: unknown): value is InvestingDashboardData {
  if (!isRecord(value)) return false;
  if (typeof value.presentationCurrency !== "string") return false;
  if (typeof value.dataVersion !== "number") return false;
  if (!isPortfolioRanges(value.portfolio)) return false;
  if (!isRecord(value.allocation)) return false;
  if (!isAllocation(value.allocation.instrument) || !isAllocation(value.allocation.entity))
    return false;
  if (!Array.isArray(value.benchmarks)) return false;
  if (!Array.isArray(value.externalCashFlows)) return false;
  if (!Array.isArray(value.positions)) return false;
  if (!Array.isArray(value.problems)) return false;
  if (value.position !== null && !isRecord(value.position)) return false;
  return true;
}

/** Drops entries a decoded array is not required to keep: genuinely optional
 * contract fields stay as-is, but a non-object entry inside an array field
 * can never render and is normalized away instead of crashing the page. */
function normalizeDashboardData(data: InvestingDashboardData): InvestingDashboardData {
  const portfolio = {} as Record<
    PortfolioRange,
    InvestingDashboardData["portfolio"][PortfolioRange]
  >;
  for (const range of PORTFOLIO_RANGES) portfolio[range] = data.portfolio[range].filter(isRecord);
  return {
    ...data,
    portfolio,
    benchmarks: data.benchmarks.filter(isRecord),
    positions: data.positions.filter(isRecord),
  };
}

async function fetchDashboard(
  symbol: string | undefined,
  signal: AbortSignal,
): Promise<InvestingDashboardData> {
  const query = symbol ? `?symbol=${encodeURIComponent(symbol)}` : "";
  const response = await fetch(`/api/investing/dashboard${query}`, { signal });
  if (!response.ok) throw new Error(`Failed to load dashboard: ${response.status}`);
  const payload: unknown = await response.json();
  if (!isDashboardData(payload)) throw new Error("Dashboard data has an invalid format.");
  return normalizeDashboardData(payload);
}

function isAbortError(reason: unknown): boolean {
  return reason instanceof DOMException && reason.name === "AbortError";
}

/** Owns the dashboard's read model for one query identity (the optional
 * position symbol). Only the latest request for that identity may update
 * state: switching identity or firing a refresh aborts the request in
 * flight, so a slower, older response can never overwrite a newer one. */
export function useDashboard(symbol?: string): DashboardState {
  const [state, setState] = useState<DashboardState>({ status: "loading" });
  const queryRef = useRef<string | undefined>(undefined);
  useEffect(() => {
    const queryChanged = queryRef.current !== symbol;
    queryRef.current = symbol;
    let cancelled = false;
    let activeController: AbortController | null = null;
    const load = () => {
      activeController?.abort();
      const controller = new AbortController();
      activeController = controller;
      setState((previous) =>
        !queryChanged && previous.status === "ready" ? previous : { status: "loading" },
      );
      void fetchDashboard(symbol, controller.signal)
        .then((data) => {
          if (cancelled || controller.signal.aborted) return;
          setState({ status: "ready", data });
        })
        .catch((reason: unknown) => {
          if (cancelled || controller.signal.aborted || isAbortError(reason)) return;
          const message = reason instanceof Error ? reason.message : "Failed to load dashboard";
          setState((previous) =>
            previous.status === "ready"
              ? { ...previous, refreshError: message }
              : { status: "error", message },
          );
        });
    };
    load();
    window.addEventListener(DASHBOARD_REFRESH_EVENT, load);
    return () => {
      cancelled = true;
      activeController?.abort();
      window.removeEventListener(DASHBOARD_REFRESH_EVENT, load);
    };
  }, [symbol]);
  return state;
}
