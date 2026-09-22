import { useEffect, useRef, useState } from "react";
import {
  PORTFOLIO_RANGES,
  type Allocation,
  type InvestingDashboardData,
  type PortfolioRange,
} from "@lavega/core";
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

function isAllocation(value: unknown): value is { buckets: unknown[]; unpriced: unknown[] } {
  return isRecord(value) && Array.isArray(value.buckets) && Array.isArray(value.unpriced);
}

function isAllocationBucket(value: unknown): value is Allocation["buckets"][number] {
  return (
    isRecord(value) &&
    typeof value.key === "string" &&
    typeof value.label === "string" &&
    (typeof value.value === "number" || value.value === null) &&
    typeof value.unpriced === "boolean"
  );
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
  const normalizeAllocation = (allocation: {
    buckets: unknown[];
    unpriced: unknown[];
  }): Allocation => ({
    buckets: allocation.buckets.filter(isAllocationBucket),
    unpriced: allocation.unpriced.filter((entry): entry is string => typeof entry === "string"),
  });
  return {
    ...data,
    portfolio,
    benchmarks: data.benchmarks.filter(isRecord),
    positions: data.positions.filter(isRecord),
    allocation: {
      instrument: normalizeAllocation(data.allocation.instrument),
      entity: normalizeAllocation(data.allocation.entity),
    },
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

const STORAGE_PREFIX = "lavega.investing.dashboard.";

/* The last dashboard each query showed, so a page opened again renders it at
 * once while its request refreshes it. It belongs to one signed-in user: a new
 * owner starts empty, and only that owner's overview is kept across reloads. */
const lastShown = new Map<string, InvestingDashboardData>();
let owner: string | null = null;

const queryKey = (symbol: string | undefined) => symbol ?? "";

function shownOrLoading(symbol: string | undefined): DashboardState {
  const data = lastShown.get(queryKey(symbol));
  return data ? { status: "ready", data } : { status: "loading" };
}

export function setDashboardOwner(userId: string | null): void {
  if (userId === owner) return;
  owner = userId;
  lastShown.clear();
  if (!userId) return;
  try {
    const stored: unknown = JSON.parse(localStorage.getItem(STORAGE_PREFIX + userId) ?? "null");
    if (isDashboardData(stored)) lastShown.set("", normalizeDashboardData(stored));
  } catch {
    // Unreadable storage only costs the head start; the request still loads the page.
  }
}

export function forgetDashboards(): void {
  owner = null;
  lastShown.clear();
  try {
    for (const key of Object.keys(localStorage))
      if (key.startsWith(STORAGE_PREFIX)) localStorage.removeItem(key);
  } catch {
    // Storage that cannot be listed cannot hold a dashboard either.
  }
}

function remember(symbol: string | undefined, data: InvestingDashboardData) {
  lastShown.set(queryKey(symbol), data);
  if (!owner || symbol) return;
  try {
    localStorage.setItem(STORAGE_PREFIX + owner, JSON.stringify(data));
  } catch {
    // Full or disabled storage: the in-memory copy still serves navigation.
  }
}

function isAbortError(reason: unknown): boolean {
  return reason instanceof DOMException && reason.name === "AbortError";
}

/** Owns the dashboard's read model for one query identity (the optional
 * position symbol). Only the latest request for that identity may update
 * state: switching identity or firing a refresh aborts the request in
 * flight, so a slower, older response can never overwrite a newer one. */
export function useDashboard(symbol?: string): DashboardState {
  const [state, setState] = useState<DashboardState>(() => shownOrLoading(symbol));
  const queryRef = useRef<string | undefined>(undefined);
  useEffect(() => {
    const queryChanged = queryRef.current !== symbol;
    queryRef.current = symbol;
    let cancelled = false;
    let queryChangedForNextLoad = queryChanged;
    let activeController: AbortController | null = null;
    const load = () => {
      activeController?.abort();
      const controller = new AbortController();
      activeController = controller;
      setState((previous) =>
        !queryChangedForNextLoad && previous.status === "ready" ? previous : shownOrLoading(symbol),
      );
      queryChangedForNextLoad = false;
      void fetchDashboard(symbol, controller.signal)
        .then((data) => {
          if (cancelled || controller.signal.aborted) return;
          remember(symbol, data);
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
