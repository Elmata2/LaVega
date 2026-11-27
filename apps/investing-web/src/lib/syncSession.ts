import { useSyncExternalStore } from "react";
import {
  decodeSyncRefreshState,
  decodeSyncRunState,
  type SyncRefreshState,
  type SyncRunStateView,
} from "@lavega/core";
import type { HistoryProgress } from "./historyGate";

/** Fired whenever a lane this page was watching reaches a completed read, so
 *  the dashboard resource refetches once per lane instead of per poll. */
export const DASHBOARD_REFRESH_EVENT = "lavega:dashboard-refresh";

export type BrokerProgress = {
  status: "idle" | "running" | "waiting" | "completed" | "problem";
  pages: number;
  ordersRead: number;
  positionsRead: number;
  waitUntil: string | null;
  remaining: number | null;
  updatedAt: string | null;
  message: string | null;
  history: HistoryProgress | null;
};

export type PriceSyncProgress = {
  status: "idle" | "running" | "waiting" | "paused" | "completed" | "problem";
  total: number;
  completed: number;
  remainingSymbols: string[];
  currentSymbol: string | null;
  waitUntil: string | null;
  updatedAt: string | null;
  message: string | null;
  problems: string[];
};

/** Whether the last state read reached the server. "retrying" keeps polling
 *  with backoff because a run is known to be active; "offline" means the read
 *  failed with nothing active, so polling waits for the next wake. */
export type SyncConnection = "online" | "retrying" | "offline";

export type SyncSnapshot = {
  broker: BrokerProgress | null;
  price: PriceSyncProgress | null;
  priceProblem: string | null;
  vault: "empty" | "locked" | "unlocked" | "unknown";
  connection: SyncConnection;
};

type PollLoop =
  | { kind: "stopped" }
  | { kind: "reading"; rerun: boolean; controller: AbortController }
  | { kind: "scheduled"; timer: ReturnType<typeof setTimeout> };

type RefreshFlight = {
  force: boolean;
  promise: Promise<{ problems: string[] } | null>;
};

type QueuedForceRefresh = {
  promise: Promise<{ problems: string[] } | null>;
  resolve: (value: { problems: string[] } | null) => void;
};

/* One state read every two seconds while a run is active. The server owns the
 * run now; this page only reports it and asks the dashboard to refetch when a
 * lane finishes. A failed read backs off up to 30 s so a flapping network does
 * not become a request storm. */
const ACTIVE_POLL_MS = 2_000;
const MAX_RETRY_MS = 30_000;

const initialSnapshot: SyncSnapshot = {
  broker: null,
  price: null,
  priceProblem: null,
  vault: "unknown",
  connection: "online",
};
let snapshot = initialSnapshot;
let lastState: SyncRunStateView | null = null;
let loop: PollLoop = { kind: "stopped" };
let failedReads = 0;
let refresh: RefreshFlight | null = null;
let queuedForceRefresh: QueuedForceRefresh | null = null;
let sessionGeneration = 0;
const listeners = new Set<() => void>();

function dispatchDashboardRefresh() {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(DASHBOARD_REFRESH_EVENT));
}

/** One lane's status rolled up for the old one-line broker status. Problem
 *  outranks running: a lane that failed must not read as still working. */
function brokerStatus(state: SyncRunStateView): BrokerProgress["status"] {
  const lanes = [state.holdings.status, state.history.status];
  if (lanes.includes("problem")) return "problem";
  if (lanes.includes("running")) return "running";
  if (lanes.includes("waiting")) return "waiting";
  if (lanes.every((status) => status === "completed")) return "completed";
  return "idle";
}

function toBrokerProgress(state: SyncRunStateView): BrokerProgress {
  return {
    status: brokerStatus(state),
    pages: state.history.pages,
    ordersRead: state.history.ordersRead,
    positionsRead: state.holdings.positionsRead,
    waitUntil: state.history.waitUntil ?? state.holdings.waitUntil,
    remaining: null,
    updatedAt: state.history.syncedAt ?? state.holdings.syncedAt,
    message: state.history.message ?? state.holdings.message,
    history: (state.history.historyProgress as HistoryProgress | null) ?? null,
  };
}

function toPriceProgress(state: SyncRunStateView): PriceSyncProgress {
  return {
    status: state.prices.status,
    total: state.prices.total,
    completed: state.prices.completed,
    remainingSymbols: [...state.prices.remainingSymbols],
    currentSymbol: state.prices.currentSymbol,
    waitUntil: state.prices.waitUntil,
    updatedAt: state.prices.syncedAt,
    message: state.prices.message,
    problems: [],
  };
}

/** A lane's `syncedAt` changing is the one durable proof that it finished a
 *  read, so that is what invalidates the dashboard, once per lane. */
function lanesThatCompleted(previous: SyncRunStateView | null, next: SyncRunStateView): number {
  if (!previous) return 0;
  const changed = (before: string | null | undefined, after: string | null) =>
    after !== null && after !== (before ?? null);
  return [
    changed(previous?.holdings.syncedAt, next.holdings.syncedAt),
    changed(previous?.history.syncedAt, next.history.syncedAt),
    changed(previous?.prices.syncedAt, next.prices.syncedAt),
  ].filter(Boolean).length;
}

function publish(next: Partial<SyncSnapshot>): void {
  snapshot = { ...snapshot, ...next };
  listeners.forEach((listener) => listener());
}

/** Store one state body. Returns the number of lane completions it proved. */
function acceptState(state: SyncRunStateView, connection?: SyncConnection): number {
  const completed = lanesThatCompleted(lastState, state);
  lastState = state;
  const priceProblem =
    state.prices.status === "problem"
      ? (state.prices.message ?? "Price history could not be updated.")
      : null;
  publish({
    broker: toBrokerProgress(state),
    price: toPriceProgress(state),
    priceProblem,
    vault: state.vault,
    ...(connection !== undefined ? { connection } : {}),
  });
  return completed;
}

function active(state: SyncRunStateView | null): boolean {
  return state?.active === true;
}

function stopLoop(): void {
  if (loop.kind === "reading") loop.controller.abort();
  else if (loop.kind === "scheduled") clearTimeout(loop.timer);
  loop = { kind: "stopped" };
}

async function readState(): Promise<void> {
  const controller = new AbortController();
  const generation = sessionGeneration;
  loop = { kind: "reading", rerun: false, controller };
  let state: SyncRunStateView | null = null;
  try {
    const response = await fetch("/api/sync/state", { signal: controller.signal });
    if (!response.ok) throw new Error(`Sync state failed: ${response.status}`);
    state = decodeSyncRunState(await response.json());
  } catch {
    state = null;
  }
  if (controller.signal.aborted || generation !== sessionGeneration) return;

  failedReads = state === null ? failedReads + 1 : 0;
  const running =
    active(state) ||
    refresh !== null ||
    queuedForceRefresh !== null ||
    (state === null && active(lastState));
  const completed =
    state === null
      ? (publish({ connection: running ? "retrying" : "offline" }), 0)
      : acceptState(state, "online");
  if (completed > 0) dispatchDashboardRefresh();

  const rerun = loop.kind === "reading" && loop.controller === controller && loop.rerun;
  loop = { kind: "stopped" };
  if (listeners.size === 0) return;
  if (rerun) {
    void readState();
    return;
  }
  if (!running) return;
  const delay =
    state === null ? Math.min(ACTIVE_POLL_MS * 2 ** failedReads, MAX_RETRY_MS) : ACTIVE_POLL_MS;
  loop = { kind: "scheduled", timer: setTimeout(() => void readState(), delay) };
}

export function wakeSyncSession() {
  if (listeners.size === 0) return;
  if (loop.kind === "reading") {
    loop.rerun = true;
    return;
  }
  if (loop.kind === "scheduled") clearTimeout(loop.timer);
  void readState();
}

export function subscribeSyncSession(listener: () => void) {
  listeners.add(listener);
  wakeSyncSession();
  return () => {
    listeners.delete(listener);
    if (listeners.size > 0) return;
    stopLoop();
  };
}

export function resetSyncSession(): void {
  sessionGeneration += 1;
  stopLoop();
  snapshot = initialSnapshot;
  lastState = null;
  failedReads = 0;
  refresh = null;
  if (queuedForceRefresh) {
    queuedForceRefresh.resolve(null);
    queuedForceRefresh = null;
  }
  listeners.forEach((listener) => listener());
}

export function readSyncSnapshot(): SyncSnapshot {
  return snapshot;
}

export function useSyncSession(): SyncSnapshot {
  return useSyncExternalStore(subscribeSyncSession, readSyncSnapshot, () => initialSnapshot);
}

function startRefresh(force: boolean): Promise<{ problems: string[] } | null> {
  const generation = sessionGeneration;
  const pending = (async () => {
    try {
      const response = await fetch("/api/sync/refresh", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ force }),
      });
      if (generation !== sessionGeneration) return null;
      const body: unknown = await response.json().catch(() => null);
      if (generation !== sessionGeneration) return null;
      if (!response.ok) {
        const problems = (body as { problems?: unknown } | null)?.problems;
        return {
          problems: Array.isArray(problems) ? problems.map(String) : ["Broker sync failed."],
        };
      }
      const state = decodeSyncRefreshState(body);
      failedReads = 0;
      acceptState(state, "online");
      wakeSyncSession();
      return { problems: [...state.problems] };
    } catch {
      if (generation === sessionGeneration && snapshot.connection !== "online")
        publish({ connection: "retrying" });
      return null;
    } finally {
      if (generation === sessionGeneration) {
        refresh = null;
        if (queuedForceRefresh) {
          const next = queuedForceRefresh;
          queuedForceRefresh = null;
          void startRefresh(true).then(next.resolve);
        }
      }
    }
  })();
  refresh = { force, promise: pending };
  return pending;
}

/**
 * The ONE refresh intent. The server claims or joins the run, answers with the
 * state it is now in, and the page reads `GET /api/sync/state` while that run is
 * active. Callers that overlap share one POST and one run; a forced refresh
 * arriving during a non-forced one queues a follow-up forced POST instead of
 * dropping the force flag.
 */
export function requestRefresh(force = false): Promise<{ problems: string[] } | null> {
  let result: Promise<{ problems: string[] } | null>;
  if (!refresh) {
    result = startRefresh(force);
  } else if (force && !refresh.force) {
    if (!queuedForceRefresh) {
      let resolve!: (value: { problems: string[] } | null) => void;
      const promise = new Promise<{ problems: string[] } | null>((res) => {
        resolve = res;
      });
      queuedForceRefresh = { promise, resolve };
    }
    result = queuedForceRefresh.promise;
  } else {
    result = refresh.promise;
  }
  wakeSyncSession();
  return result;
}

/** Kept for the call sites that only need the state shape typed. */
export type RefreshResult = SyncRefreshState;

/** A broker that never had credentials saved is not a sync failure; the
 *  overview status line and the profile page hide that noise the same way. */
export function filterVisibleSyncProblems(problems: readonly string[]): string[] {
  return problems.filter((problem) => !/credentials are not configured/i.test(problem));
}
