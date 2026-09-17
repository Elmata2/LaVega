import { useSyncExternalStore } from "react";
import {
  DASHBOARD_REFRESH_EVENT,
  PRICE_SYNC_EXHAUSTED_MESSAGE,
  runPriceSyncUntilComplete,
  type PriceSyncProgress,
} from "./priceSync";

export type BrokerProgress = {
  status: "idle" | "running" | "waiting" | "completed" | "problem";
  pages: number;
  ordersRead: number;
  positionsRead: number;
  waitUntil: string | null;
  remaining: number | null;
  updatedAt: string | null;
  message: string | null;
};

export type SyncSnapshot = {
  broker: BrokerProgress | null;
  price: PriceSyncProgress | null;
  priceProblem: string | null;
  vault: "empty" | "locked" | "unlocked" | "unknown";
};

type SyncResult = { problems?: string[] } | null;

const idleSnapshot: SyncSnapshot = {
  broker: null,
  price: null,
  priceProblem: null,
  vault: "unknown",
};
let snapshot = idleSnapshot;
let brokerRun: Promise<SyncResult> | null = null;
let priceRun: Promise<string[]> | null = null;
let pollRun: Promise<void> | null = null;
let pollTimer: number | null = null;
let wakeQueued = false;
let refreshedPriceRun: string | null = null;
const listeners = new Set<() => void>();

function brokerActive(status?: BrokerProgress["status"]): boolean {
  return status === "running" || status === "waiting";
}

function priceActive(status?: PriceSyncProgress["status"]): boolean {
  return status === "running" || status === "waiting" || status === "paused";
}

function publish(next: Partial<SyncSnapshot>) {
  snapshot = { ...snapshot, ...next };
  listeners.forEach((listener) => listener());
}

function dispatchDashboardRefresh() {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(DASHBOARD_REFRESH_EVENT));
}

async function readJson<T>(url: string): Promise<T | null> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Sync status failed: ${response.status}`);
  return (await response.json()) as T;
}

function validBroker(value: BrokerProgress | null): value is BrokerProgress {
  return (
    value !== null && ["idle", "running", "waiting", "completed", "problem"].includes(value.status)
  );
}

function validPrice(value: PriceSyncProgress | null): value is PriceSyncProgress {
  return (
    value !== null &&
    ["idle", "running", "waiting", "paused", "completed", "problem"].includes(value.status)
  );
}

function clearPollTimer() {
  if (pollTimer !== null && typeof window !== "undefined") window.clearTimeout(pollTimer);
  pollTimer = null;
}

function schedulePoll(active: boolean) {
  clearPollTimer();
  if (!active || listeners.size === 0 || typeof window === "undefined") return;
  pollTimer = window.setTimeout(() => void poll(), 1_000);
}

async function poll() {
  if (pollRun) {
    wakeQueued = true;
    return pollRun;
  }
  pollRun = (async () => {
    let retry = false;
    try {
      const [broker, price, vault] = await Promise.all([
        readJson<BrokerProgress>("/api/brokers/sync/status"),
        readJson<PriceSyncProgress>("/api/prices/sync/status"),
        readJson<{ status?: string }>("/api/brokers/credentials/status"),
      ]);
      const next: Partial<SyncSnapshot> = {};
      if (validBroker(broker)) next.broker = broker;
      if (validPrice(price)) next.price = price;
      if (vault && ["empty", "locked", "unlocked"].includes(vault.status ?? ""))
        next.vault = vault.status as SyncSnapshot["vault"];
      publish(next);
      if (
        price?.updatedAt &&
        (price.status === "completed" || price.status === "problem") &&
        refreshedPriceRun !== price.updatedAt
      ) {
        refreshedPriceRun = price.updatedAt;
        dispatchDashboardRefresh();
      }
    } catch {
      retry = true;
    } finally {
      pollRun = null;
      if (wakeQueued) {
        wakeQueued = false;
        void poll();
      } else {
        schedulePoll(
          retry || brokerActive(snapshot.broker?.status) || priceActive(snapshot.price?.status),
        );
      }
    }
  })();
  return pollRun;
}

export function wakeSyncSession() {
  if (listeners.size === 0) return;
  clearPollTimer();
  void poll();
}

export function subscribeSyncSession(listener: () => void) {
  listeners.add(listener);
  wakeSyncSession();
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) clearPollTimer();
  };
}

export function useSyncSession(): SyncSnapshot {
  return useSyncExternalStore(
    subscribeSyncSession,
    () => snapshot,
    () => idleSnapshot,
  );
}

async function readSyncResult(response: Response): Promise<SyncResult> {
  return (await response.json().catch(() => null)) as SyncResult;
}

export function continuePriceSync(): Promise<string[]> {
  if (!priceRun) {
    priceRun = (async () => {
      publish({ priceProblem: null });
      const problems = await runPriceSyncUntilComplete();
      if (problems.includes(PRICE_SYNC_EXHAUSTED_MESSAGE)) publish({ priceProblem: problems[0] });
      return problems;
    })().finally(() => {
      priceRun = null;
      wakeSyncSession();
    });
  }
  return priceRun;
}

export function startBrokerSync(force = false): Promise<SyncResult> {
  if (!brokerRun) {
    brokerRun = (async () => {
      const response = await fetch(`/api/brokers/sync${force ? "?force=true" : ""}`, {
        method: "POST",
      });
      const result = await readSyncResult(response);
      if (!response.ok && result) throw new Error(result.problems?.[0] ?? "Broker sync failed.");
      dispatchDashboardRefresh();
      void continuePriceSync();
      return result;
    })().finally(() => {
      brokerRun = null;
      wakeSyncSession();
    });
  }
  wakeSyncSession();
  return brokerRun;
}
