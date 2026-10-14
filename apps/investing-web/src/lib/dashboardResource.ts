import { useCallback, useSyncExternalStore } from "react";
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

function isComposition(value: unknown): boolean {
  return (
    isRecord(value) &&
    Array.isArray(value.topPositions) &&
    typeof value.pricedHoldings === "number" &&
    typeof value.missingHoldings === "number" &&
    typeof value.estimatedHoldings === "number"
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
  if (!isComposition(value.composition)) return false;
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

/* One read model per query identity (the optional position symbol). Every
 * consumer of the same identity reads this one entry, so mounting a second
 * consumer starts no second request and every subscriber sees the same
 * payload. The cancellation/generation rules from #121 live here now: each
 * identity has one controller and one generation, and only the newest request
 * for that identity may write the entry. */
type DashboardEntry = {
  state: DashboardState;
  controller: AbortController | null;
  generation: number;
  symbol: string | undefined;
};

const entries = new Map<string, DashboardEntry>();
const listeners = new Map<string, Set<() => void>>();

function entryFor(symbol: string | undefined): DashboardEntry {
  const key = queryKey(symbol);
  let entry = entries.get(key);
  if (!entry) {
    entry = { state: shownOrLoading(symbol), controller: null, generation: 0, symbol };
    entries.set(key, entry);
  }
  return entry;
}

function notify(key: string): void {
  const set = listeners.get(key);
  if (!set) return;
  for (const listener of set) listener();
}

function isAbortError(reason: unknown): boolean {
  return reason instanceof DOMException && reason.name === "AbortError";
}

function load(symbol: string | undefined): void {
  const entry = entryFor(symbol);
  entry.controller?.abort();
  const controller = new AbortController();
  entry.controller = controller;
  const generation = (entry.generation += 1);
  if (entry.state.status === "error") entry.state = shownOrLoading(symbol);
  notify(queryKey(symbol));
  void fetchDashboard(symbol, controller.signal)
    .then((data) => {
      if (controller.signal.aborted || generation !== entry.generation) return;
      remember(symbol, data);
      entry.state = { status: "ready", data };
      notify(queryKey(symbol));
    })
    .catch((reason: unknown) => {
      if (controller.signal.aborted || generation !== entry.generation || isAbortError(reason))
        return;
      const message = reason instanceof Error ? reason.message : "Failed to load dashboard";
      entry.state =
        entry.state.status === "ready"
          ? { ...entry.state, refreshError: message }
          : { status: "error", message };
      notify(queryKey(symbol));
    });
}

/** Subscribe one consumer to one query identity. The first subscriber for an
 * identity starts its read; the last one to leave aborts the request in flight
 * so a late completion cannot populate the next mount. This is the function
 * `useSyncExternalStore` drives. */
export function subscribeToDashboard(
  symbol: string | undefined,
  listener: () => void,
): () => void {
  const key = queryKey(symbol);
  let set = listeners.get(key);
  if (!set) {
    set = new Set();
    listeners.set(key, set);
  }
  set.add(listener);
  if (set.size === 1) load(symbol);
  return () => {
    const current = listeners.get(key);
    if (!current) return;
    current.delete(listener);
    if (current.size > 0) return;
    listeners.delete(key);
    entries.get(key)?.controller?.abort();
    entries.delete(key);
  };
}

/** The read action: reload the query identity from the network. A refresh
 * fired for the whole app reloads each identity that has a subscriber once,
 * not once per mount. */
export function readDashboard(symbol?: string): void {
  load(symbol);
}

function refreshAll(): void {
  for (const [key, set] of listeners) {
    if (set.size === 0) continue;
    load(key === "" ? undefined : key);
  }
}

if (typeof window !== "undefined")
  window.addEventListener(DASHBOARD_REFRESH_EVENT, () => refreshAll());

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
  for (const entry of entries.values()) entry.controller?.abort();
  entries.clear();
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

function snapshotFor(symbol: string | undefined): DashboardState {
  return entryFor(symbol).state;
}

/** Reads one query identity's shared read model. Every consumer of the same
 * symbol subscribes to the same entry: two of them share one request and one
 * cached model. */
export function useDashboard(symbol?: string): DashboardState {
  const subscribe = useCallback(
    (listener: () => void) => subscribeToDashboard(symbol, listener),
    [symbol],
  );
  const getSnapshot = useCallback(() => snapshotFor(symbol), [symbol]);
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
