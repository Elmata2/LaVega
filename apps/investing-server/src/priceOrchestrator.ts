import type { Position, Trade } from "@lavega/core";
import type { PriceSyncInput, PriceSyncResult } from "@lavega/adapters";

export type PriceSyncTarget = PriceSyncInput & { kind: "current" | "closed" | "benchmark"; isin?: string };

export type PriceSyncProgress = {
  status: "idle" | "running" | "waiting" | "completed" | "problem";
  total: number;
  completed: number;
  remainingSymbols: string[];
  currentSymbol: string | null;
  waitUntil: string | null;
  updatedAt: string | null;
  message: string | null;
  problems: string[];
};

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
    targets.push(instrument(position, "current", firstTrade?.date ?? position.asOf));
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

export function createPriceOrchestrator(input: {
  discover: (tenantId: string) => Promise<PriceSyncTarget[]> | PriceSyncTarget[];
  sync: (target: PriceSyncTarget) => Promise<PriceSyncResult>;
  paceMs?: number;
  now?: () => Date;
  wait?: (milliseconds: number) => Promise<void>;
}) {
  const progress = new Map<string, PriceSyncProgress>();
  const inFlight = new Map<string, Promise<PriceSyncProgress>>();
  const paceMs = input.paceMs ?? 300;
  const now = input.now ?? (() => new Date());
  const wait = input.wait ?? ((milliseconds) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds)));
  const update = (tenantId: string, next: Omit<PriceSyncProgress, "updatedAt">): PriceSyncProgress => {
    const value = { ...next, updatedAt: now().toISOString() };
    progress.set(tenantId, value);
    return value;
  };

  const start = (tenantId: string): Promise<PriceSyncProgress> => {
    const active = inFlight.get(tenantId);
    if (active) return active;
    const run = (async () => {
      let targets: PriceSyncTarget[];
      try {
        targets = await input.discover(tenantId);
      } catch (error) {
        const problem = error instanceof Error ? error.message : "Price target discovery failed";
        return update(tenantId, { status: "problem", total: 0, completed: 0, remainingSymbols: [], currentSymbol: null, waitUntil: null, message: "Price synchronization could not start", problems: [problem] });
      }
      const base = { total: targets.length, completed: 0, remainingSymbols: targets.map((target) => target.symbol), currentSymbol: null, waitUntil: null, message: targets.length ? "Price synchronization started" : "No price symbols to synchronize", problems: [] as string[] };
      if (targets.length === 0) return update(tenantId, { ...base, status: "completed" });
      update(tenantId, { ...base, status: "running" });
      const problems: string[] = [];
      for (let index = 0; index < targets.length; index += 1) {
        const target = targets[index]!;
        update(tenantId, { status: "running", total: targets.length, completed: index, remainingSymbols: targets.slice(index).map((value) => value.symbol), currentSymbol: target.symbol, waitUntil: null, message: `Synchronizing ${target.symbol}`, problems: [...problems] });
        try {
          const result = await input.sync(target);
          problems.push(...result.problems.map((problem) => `${target.symbol}: ${problem}`));
        } catch (error) {
          problems.push(`${target.symbol}: ${error instanceof Error ? error.message : "Price synchronization failed"}`);
        }
        if (index < targets.length - 1) {
          const waitUntil = new Date(now().getTime() + paceMs).toISOString();
          update(tenantId, { status: "waiting", total: targets.length, completed: index + 1, remainingSymbols: targets.slice(index + 1).map((value) => value.symbol), currentSymbol: null, waitUntil, message: "Waiting before next price request", problems: [...problems] });
          await wait(paceMs);
        }
      }
      return update(tenantId, { status: problems.length ? "problem" : "completed", total: targets.length, completed: targets.length, remainingSymbols: [], currentSymbol: null, waitUntil: null, message: problems.length ? "Price synchronization completed with problems" : "Price synchronization completed", problems });
    })();
    inFlight.set(tenantId, run);
    void run.finally(() => { if (inFlight.get(tenantId) === run) inFlight.delete(tenantId); });
    return run;
  };

  return {
    run: start,
    status: (tenantId: string): PriceSyncProgress => structuredClone(progress.get(tenantId) ?? idleProgress()),
  };
}
