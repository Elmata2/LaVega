import type { Position, Trade } from "@lavega/core";
import type { PriceSyncInput, PriceSyncResult } from "@lavega/adapters";

export type PriceSyncTarget = PriceSyncInput & { kind: "current" | "closed" | "benchmark"; isin?: string };

export type PriceSyncProgress = {
  /** `paused` means the host budget ran out with symbols left: the run is
   *  resumable and the caller is expected to post again to continue it. */
  status: "idle" | "running" | "waiting" | "paused" | "completed" | "problem";
  total: number;
  completed: number;
  remainingSymbols: string[];
  currentSymbol: string | null;
  waitUntil: string | null;
  updatedAt: string | null;
  message: string | null;
  problems: string[];
  leaseId?: string;
};

/**
 * Where a run's progress lives between invocations.
 *
 * A serverless deployment answers the status poll from whichever instance the
 * request lands on, which is rarely the one doing the work. Progress kept in
 * process memory there can only ever report "idle", and a run interrupted by
 * the host's time limit leaves nothing behind to resume from.
 */
export type PriceSyncProgressStore = {
  get(tenantId: string): Promise<PriceSyncProgress | null>;
  put(tenantId: string, progress: PriceSyncProgress, leaseId?: string): Promise<boolean | void>;
  claim?(tenantId: string, progress: PriceSyncProgress, staleBefore: string): Promise<PriceSyncProgress | null>;
};

export function createInMemoryPriceSyncProgressStore(): PriceSyncProgressStore {
  const rows = new Map<string, PriceSyncProgress>();
  return {
    async get(tenantId) {
      return rows.get(tenantId) ?? null;
    },
    async put(tenantId, progress) {
      rows.set(tenantId, progress);
      return true;
    },
    async claim(tenantId, progress, staleBefore) {
      const stored = rows.get(tenantId);
      const active = stored?.status === "running" || stored?.status === "waiting";
      const fresh = stored?.updatedAt && Date.parse(stored.updatedAt) >= Date.parse(staleBefore);
      if (active && fresh) return stored;
      rows.set(tenantId, progress);
      return null;
    },
  };
}

const idleProgress = (): PriceSyncProgress => ({
  status: "idle",
  total: 0,
  completed: 0,
  remainingSymbols: [],
  currentSymbol: null,
  waitUntil: null,
  updatedAt: null,
  message: null,
  problems: [],
});

class PriceSyncLeaseLost extends Error {
  constructor() {
    super("Price synchronization lease was taken over by another invocation");
  }
}

const newLeaseId = () => globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;

/** When one invocation has to stop so the host does not kill it mid-symbol.
 *  Local and Docker runs have no host limit and get none, exactly like the
 *  broker sync budget they share a name with. */
export function priceSyncDeadlineMs(environment: (name: string) => string | undefined, now = Date.now()): number | undefined {
  for (const name of ["INVESTING_PRICE_SYNC_BUDGET_MS", "INVESTING_SYNC_BUDGET_MS"]) {
    const budget = Number(environment(name));
    if (Number.isFinite(budget) && budget > 0) return now + budget;
  }
  if (environment("VERCEL")) return now + 45_000;
  return undefined;
}

function instrument(target: Position | Trade, kind: PriceSyncTarget["kind"], backfillFrom: string): PriceSyncTarget {
  return {
    kind,
    symbol: target.symbol,
    ticker: target.symbol,
    exchange: "UNKNOWN",
    currency: target.currency,
    backfillFrom,
    ...(target.isin ? { isin: target.isin } : {}),
  };
}

/** Discover one ordered target per symbol: current holdings, closed holdings, then benchmarks. */
export function discoverPriceSyncTargets(input: {
  positions: readonly Position[];
  trades: readonly Trade[];
  benchmarkSymbols?: readonly string[];
}): PriceSyncTarget[] {
  const earliestTrade = new Map<string, Trade>();
  for (const trade of [...input.trades].sort((left, right) => left.date.localeCompare(right.date))) {
    const key = trade.symbol.toUpperCase();
    if (!earliestTrade.has(key)) earliestTrade.set(key, trade);
  }

  const targets: PriceSyncTarget[] = [];
  const seen = new Set<string>();
  for (const position of input.positions.filter((value) => value.quantity !== 0)) {
    const key = position.symbol.toUpperCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const firstTrade = earliestTrade.get(key);
    // Without trade history there is no real backfill anchor; position.asOf is
    // only a snapshot date and would limit Yahoo to a ~1-day window.
    targets.push(instrument(position, "current", firstTrade?.date ?? "2000-01-01"));
  }
  for (const [key, trade] of earliestTrade) {
    if (seen.has(key)) continue;
    seen.add(key);
    targets.push(instrument(trade, "closed", trade.date));
  }

  const portfolioStart = [...earliestTrade.values()].map((trade) => trade.date).sort()[0];
  if (portfolioStart) {
    for (const symbol of input.benchmarkSymbols ?? []) {
      const normalized = symbol.trim();
      const key = normalized.toUpperCase();
      if (!normalized || seen.has(key)) continue;
      seen.add(key);
      targets.push({ kind: "benchmark", symbol: normalized, ticker: normalized, exchange: "UNKNOWN", currency: "EUR", backfillFrom: portfolioStart });
    }
  }
  return targets;
}

/**
 * Runs price synchronization as budgeted, resumable slices.
 *
 * One call does as many symbols as the host's remaining time allows, writes
 * what is left to the progress store, and returns. The caller keeps calling
 * until the status is terminal. That is what makes the work survive a
 * serverless invocation: nothing continues after the response, so nothing is
 * lost when the instance goes away.
 */
export function createPriceOrchestrator(input: {
  discover: (tenantId: string) => Promise<PriceSyncTarget[]> | PriceSyncTarget[];
  sync: (target: PriceSyncTarget, tenantId: string) => Promise<PriceSyncResult>;
  progressStore?: PriceSyncProgressStore;
  /** Absolute epoch milliseconds this invocation must stop by. */
  deadline?: () => number | undefined;
  paceMs?: number;
  /** Time held back for the symbol in hand, so a run stops between symbols
   *  rather than being killed inside a provider request. */
  pauseMarginMs?: number;
  /** How long a `running` row from another instance is believed before this
   *  one takes the work over. */
  takeoverAfterMs?: number;
  now?: () => Date;
  wait?: (milliseconds: number) => Promise<void>;
}) {
  const store = input.progressStore ?? createInMemoryPriceSyncProgressStore();
  const local = new Map<string, PriceSyncProgress>();
  const inFlight = new Map<string, Promise<PriceSyncProgress>>();
  const paceMs = input.paceMs ?? 300;
  const pauseMarginMs = input.pauseMarginMs ?? 10_000;
  const takeoverAfterMs = input.takeoverAfterMs ?? 30_000;
  const persistEveryMs = 2_000;
  const now = input.now ?? (() => new Date());
  const wait = input.wait ?? ((milliseconds) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds)));
  const terminal = (status: PriceSyncProgress["status"]) => status !== "running" && status !== "waiting";

  const lastPersistedAt = new Map<string, number>();
  const update = async (tenantId: string, next: Omit<PriceSyncProgress, "updatedAt">, leaseId?: string): Promise<PriceSyncProgress> => {
    const value = { ...next, updatedAt: now().toISOString() };
    local.set(tenantId, value);
    /* Every symbol would mean a row write per Yahoo call. The poll only needs
     * to see movement, and a resumable run only needs the row to be right when
     * it stops, so intermediate states are written on a timer. */
    const at = now().getTime();
    if (terminal(value.status) || at - (lastPersistedAt.get(tenantId) ?? 0) >= persistEveryMs) {
      lastPersistedAt.set(tenantId, at);
      const stored = await store.put(tenantId, value, leaseId).catch(() => undefined);
      if (stored === false) throw new PriceSyncLeaseLost();
    }
    return value;
  };

  const start = (tenantId: string, deadline = input.deadline?.()): Promise<PriceSyncProgress> => {
    const active = inFlight.get(tenantId);
    if (active) return active;
    const leaseId = newLeaseId();
    const execute = async (): Promise<PriceSyncProgress> => {
      const stored = await store.get(tenantId).catch(() => null);
      /* Another instance is already working this tenant. Starting a second run
       * would double the provider traffic and let two writers fight over one
       * progress row; a stale row means that instance died, so we take over. */
      if (stored?.status === "running" && stored.updatedAt && now().getTime() - Date.parse(stored.updatedAt) < takeoverAfterMs) return stored;

      let targets: PriceSyncTarget[];
      try {
        targets = await input.discover(tenantId);
      } catch (error) {
        const problem = error instanceof Error ? error.message : "Price target discovery failed";
        return update(tenantId, { status: "problem", total: 0, completed: 0, remainingSymbols: [], currentSymbol: null, waitUntil: null, message: "Price synchronization could not start", problems: [problem] });
      }

      /* A paused run names the symbols it never reached. Resuming from that
       * list, rather than from the full set, is what keeps repeated slices
       * cheap: a symbol already stored costs neither a request nor a read. */
      const paused = stored?.status === "paused" ? stored : null;
      const pending = new Set(paused?.remainingSymbols ?? []);
      const resumed = paused ? targets.filter((target) => pending.has(target.symbol)) : [];
      const queue = resumed.length > 0 ? resumed : targets;
      const total = resumed.length > 0 ? Math.max(paused!.total, queue.length) : queue.length;
      const done = total - queue.length;
      const problems: string[] = resumed.length > 0 ? [...paused!.problems] : [];

      if (queue.length === 0) return update(tenantId, { status: "completed", total, completed: total, remainingSymbols: [], currentSymbol: null, waitUntil: null, message: total ? "Price synchronization completed" : "No price symbols to synchronize", problems });
      const remainingFrom = (index: number) => queue.slice(index).map((target) => target.symbol);
      const pause = (index: number) => update(tenantId, { status: "paused", total, completed: done + index, remainingSymbols: remainingFrom(index), currentSymbol: null, waitUntil: null, message: "Price synchronization paused for the host time budget", problems: [...problems] }, leaseId);

      const started = { status: "running" as const, total, completed: done, remainingSymbols: remainingFrom(0), currentSymbol: null, waitUntil: null, updatedAt: now().toISOString(), message: "Price synchronization started", problems: [...problems], leaseId };
      local.set(tenantId, started);
      const busy = await store.claim?.(tenantId, started, new Date(now().getTime() - takeoverAfterMs).toISOString());
      if (busy) return busy;
      if (!store.claim) await update(tenantId, { status: "running", total, completed: done, remainingSymbols: remainingFrom(0), currentSymbol: null, waitUntil: null, message: "Price synchronization started", problems: [...problems], leaseId }, leaseId);
      for (let index = 0; index < queue.length; index += 1) {
        if (deadline !== undefined && now().getTime() + pauseMarginMs >= deadline) return pause(index);
        const target = queue[index]!;
        await update(tenantId, { status: "running", total, completed: done + index, remainingSymbols: remainingFrom(index), currentSymbol: target.symbol, waitUntil: null, message: `Synchronizing ${target.symbol}`, problems: [...problems], leaseId }, leaseId);
        try {
          const result = await input.sync(target, tenantId);
          problems.push(...result.problems.map((problem) => `${target.symbol}: ${problem}`));
        } catch (error) {
          problems.push(`${target.symbol}: ${error instanceof Error ? error.message : "Price synchronization failed"}`);
        }
        if (index < queue.length - 1) {
          if (deadline !== undefined && now().getTime() + paceMs + pauseMarginMs >= deadline) return pause(index + 1);
          const waitUntil = new Date(now().getTime() + paceMs).toISOString();
          await update(tenantId, { status: "waiting", total, completed: done + index + 1, remainingSymbols: remainingFrom(index + 1), currentSymbol: null, waitUntil, message: "Waiting before next price request", problems: [...problems], leaseId }, leaseId);
          await wait(paceMs);
        }
      }
      return update(tenantId, { status: problems.length ? "problem" : "completed", total, completed: total, remainingSymbols: [], currentSymbol: null, waitUntil: null, message: problems.length ? "Price synchronization completed with problems" : "Price synchronization completed", problems }, leaseId);
    };
    /* Cleared here rather than from a `.finally` on a derived promise: that one
     * runs a microtask later than the caller it hands the result to, so the
     * next run would join the finished one instead of starting. */
    const run = (async () => {
      try {
        return await execute();
      } catch (error) {
        if (error instanceof PriceSyncLeaseLost) return (await store.get(tenantId).catch(() => null)) ?? idleProgress();
        throw error;
      } finally {
        inFlight.delete(tenantId);
      }
    })();
    inFlight.set(tenantId, run);
    return run;
  };

  return {
    run: start,
    /* A run in this process holds the newest state; the store holds the state
     * of a run in some other one. */
    status: async (tenantId: string): Promise<PriceSyncProgress> => {
      if (inFlight.has(tenantId)) return structuredClone(local.get(tenantId) ?? idleProgress());
      const stored = await store.get(tenantId).catch(() => null);
      return structuredClone(stored ?? local.get(tenantId) ?? idleProgress());
    },
  };
}
