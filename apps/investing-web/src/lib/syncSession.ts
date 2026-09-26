import { useSyncExternalStore } from "react";
import {
  DASHBOARD_REFRESH_EVENT,
  runPriceSyncUntilComplete,
  type PriceSyncOutcome,
  type PriceSyncProgress,
} from "./priceSync";

import type { HistoryProgress } from "./historyGate";

export type BrokerProgress = {
  status: "idle" | "running" | "waiting" | "completed" | "problem";
  pages: number;
  ordersRead: number;
  positionsRead: number;
  waitUntil: string | null;
  remaining: number | null;
  updatedAt: string | null;
  message: string | null;
  /* De server stuurt dit al mee en de client liet het vallen. Het is het enige
   * veld dat zegt of een geschiedenis tot de laatste pagina is gelezen, en
   * zonder dat rekent het dashboard door op de helft ervan. */
  history: HistoryProgress | null;
};

/** Whether the last status read reached every channel. "retrying" keeps
 * polling with backoff because a run is known to be active; "offline" means
 * the read failed with nothing active, so polling waits for the next wake. */
export type SyncConnection = "online" | "retrying" | "offline";

export type SyncSnapshot = {
  broker: BrokerProgress | null;
  price: PriceSyncProgress | null;
  priceProblem: string | null;
  vault: "empty" | "locked" | "unlocked" | "unknown";
  connection: SyncConnection;
};

type SyncResult = { problems?: string[] } | null;

/* One status read at a time. A wake during a read only marks it for one
 * immediate rerun; a wake while a timer waits replaces the timer. */
type PollLoop =
  | { kind: "stopped" }
  | { kind: "reading"; rerun: boolean }
  | { kind: "scheduled"; timer: ReturnType<typeof setTimeout> };

const ACTIVE_POLL_MS = 1_000;
const MAX_RETRY_MS = 30_000;

const initialSnapshot: SyncSnapshot = {
  broker: null,
  price: null,
  priceProblem: null,
  vault: "unknown",
  connection: "online",
};
let snapshot = initialSnapshot;
let loop: PollLoop = { kind: "stopped" };
let failedReads = 0;
let brokerRun: Promise<SyncResult> | null = null;
let priceRun: Promise<PriceSyncOutcome> | null = null;
const listeners = new Set<() => void>();

function brokerActive(status?: BrokerProgress["status"]): boolean {
  return status === "running" || status === "waiting";
}

function priceActive(status?: PriceSyncProgress["status"]): boolean {
  return status === "running" || status === "waiting";
}

/* A paused row waits for someone to post again. This page only does that while
 * it owns a continuation (priceRun), so a paused row alone, such as a cron
 * slice or an exhausted run, is at rest and must not keep polling. */
function priceUnfinished(status?: PriceSyncProgress["status"]): boolean {
  return priceActive(status) || status === "paused";
}

function terminal(status?: string): boolean {
  return status === "completed" || status === "problem";
}

function dispatchDashboardRefresh() {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(DASHBOARD_REFRESH_EVENT));
}

/* Invalidates the dashboard when a channel this page saw unfinished reaches a
 * final state, so a sync that finished in the background still shows up.
 * Returns whether it did. */
function publish(next: Partial<SyncSnapshot>): boolean {
  const finished = Boolean(
    (next.broker && brokerActive(snapshot.broker?.status) && terminal(next.broker.status)) ||
    (next.price && priceUnfinished(snapshot.price?.status) && terminal(next.price.status)),
  );
  snapshot = { ...snapshot, ...next };
  listeners.forEach((listener) => listener());
  if (finished) dispatchDashboardRefresh();
  return finished;
}

const BROKER_STATUSES = new Set(["idle", "running", "waiting", "completed", "problem"]);
const PRICE_STATUSES = new Set([...BROKER_STATUSES, "paused"]);
const VAULT_STATUSES = new Set(["empty", "locked", "unlocked"]);

function statusOf(value: unknown): unknown {
  return typeof value === "object" && value !== null && "status" in value
    ? value.status
    : undefined;
}

function isBroker(value: unknown): value is BrokerProgress {
  return BROKER_STATUSES.has(String(statusOf(value)));
}

function isPrice(value: unknown): value is PriceSyncProgress {
  return PRICE_STATUSES.has(String(statusOf(value)));
}

function isVault(value: unknown): value is { status: Exclude<SyncSnapshot["vault"], "unknown"> } {
  return VAULT_STATUSES.has(String(statusOf(value)));
}

async function readChannel<T>(url: string, valid: (value: unknown) => value is T): Promise<T> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Sync status failed: ${response.status}`);
  const value: unknown = await response.json();
  if (!valid(value)) throw new Error(`Sync status has an invalid format: ${url}`);
  return value;
}

async function readStatus() {
  loop = { kind: "reading", rerun: false };
  const [broker, price, vault] = await Promise.allSettled([
    readChannel("/api/brokers/sync/status", isBroker),
    readChannel("/api/prices/sync/status", isPrice),
    readChannel("/api/brokers/credentials/status", isVault),
  ]);
  const failed = [broker, price, vault].some((read) => read.status === "rejected");
  failedReads = failed ? failedReads + 1 : 0;
  const next: Partial<SyncSnapshot> = {
    ...(broker.status === "fulfilled" && { broker: broker.value }),
    ...(price.status === "fulfilled" && { price: price.value }),
    ...(vault.status === "fulfilled" && { vault: vault.value.status }),
  };
  const active =
    brokerRun !== null ||
    priceRun !== null ||
    brokerActive((next.broker ?? snapshot.broker)?.status) ||
    priceActive((next.price ?? snapshot.price)?.status);
  publish({ ...next, connection: !failed ? "online" : active ? "retrying" : "offline" });
  const rerun = loop.kind === "reading" && loop.rerun;
  loop = { kind: "stopped" };
  if (listeners.size === 0) return;
  if (rerun) {
    void readStatus();
    return;
  }
  if (!active) return;
  const delay = failed ? Math.min(ACTIVE_POLL_MS * 2 ** failedReads, MAX_RETRY_MS) : ACTIVE_POLL_MS;
  loop = { kind: "scheduled", timer: setTimeout(() => void readStatus(), delay) };
}

export function wakeSyncSession() {
  if (listeners.size === 0) return;
  if (loop.kind === "reading") {
    loop.rerun = true;
    return;
  }
  if (loop.kind === "scheduled") clearTimeout(loop.timer);
  void readStatus();
}

export function subscribeSyncSession(listener: () => void) {
  listeners.add(listener);
  wakeSyncSession();
  return () => {
    listeners.delete(listener);
    if (listeners.size > 0 || loop.kind !== "scheduled") return;
    clearTimeout(loop.timer);
    loop = { kind: "stopped" };
  };
}

export function readSyncSnapshot(): SyncSnapshot {
  return snapshot;
}

export function useSyncSession(): SyncSnapshot {
  return useSyncExternalStore(subscribeSyncSession, readSyncSnapshot, () => initialSnapshot);
}

async function readSyncResult(response: Response): Promise<SyncResult> {
  return (await response.json().catch(() => null)) as SyncResult;
}

/** Drives price sync until the server has nothing left for this run. Callers
 * that overlap share one run and its outcome. */
export function continuePriceSync(): Promise<PriceSyncOutcome> {
  if (!priceRun) {
    publish({ priceProblem: null });
    priceRun = runPriceSyncUntilComplete((progress) => {
      const refreshed = isPrice(progress) && publish({ price: progress });
      if (!refreshed) dispatchDashboardRefresh();
    })
      .then((outcome) => {
        if (outcome.kind === "incomplete") publish({ priceProblem: outcome.message });
        return outcome;
      })
      .finally(() => {
        priceRun = null;
        wakeSyncSession();
      });
    wakeSyncSession();
  }
  return priceRun;
}

/** Starts a broker sync, or joins the one already running, then continues
 * price sync. Every start path (app open, manual, save, unlock) goes through
 * here so they share polling, invalidation and terminal outcomes. */
export function startBrokerSync(force = false): Promise<SyncResult> {
  if (!brokerRun) {
    brokerRun = (async () => {
      const response = await fetch(`/api/brokers/sync${force ? "?force=true" : ""}`, {
        method: "POST",
      });
      const result = await readSyncResult(response);
      /* A non-OK answer without a JSON body is a proxy cutting the request off
       * (Cloudflare 524 after ~100 s) while the server keeps syncing, so the
       * run continues as if it succeeded. Only the server's own JSON error
       * fails the start. */
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
