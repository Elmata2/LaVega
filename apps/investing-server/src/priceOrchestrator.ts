import type { Position, Trade } from "@lavega/core";
import { isValidIsin, priceInstrumentKey } from "@lavega/core";
import {
  isPartnerBudgetUnavailable,
  isPartnerWait,
  type PriceSyncInput,
  type PriceSyncResult,
} from "@lavega/adapters";

export type PriceSyncTarget = PriceSyncInput & {
  kind: "current" | "closed" | "benchmark";
  isin?: string;
  /** The shared series this target reads and writes (issue #307). */
  instrumentKey: string;
  /** The `sym:` key an earlier release stored this series under, for the first
   *  write of an `isin:` key. */
  instrumentAlias?: string;
  /** A problem line to report once for this sync (a symbol whose rows disagree
   *  about its ISIN). Already formatted as `"<symbol>: <reason>"`. */
  problem?: string;
  /** The execution venue the broker printed for this instrument, as a MIC
   *  (DeGiro's `Uitvoeringsplaats`, e.g. `XLON`). A listing hint for ISIN
   *  resolution: it picks among OpenFIGI's candidates and never invents one. */
  venue?: string;
  /** The broker reports no ticker for this holding, so the symbol is the ISIN
   *  itself. OpenFIGI ambiguity then cannot be settled by the broker symbol,
   *  so the run reports it instead of pretending the first listing was meant. */
  noTicker?: boolean;
};

/** The key pair for one instrument: the identity key plus the `sym:` alias an
 *  earlier release stored it under, when this is an `isin:` key. */
export function instrumentKeys(input: { symbol: string; isin?: string; currency: string }): {
  key: string;
  alias?: string;
} {
  const key = priceInstrumentKey(input);
  if (!key.startsWith("isin:")) return { key };
  return { key, alias: priceInstrumentKey({ symbol: input.symbol, currency: input.currency }) };
}

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
  put(tenantId: string, progress: PriceSyncProgress, leaseId: string): Promise<boolean>;
  claim(
    tenantId: string,
    progress: PriceSyncProgress,
    staleBefore: string,
  ): Promise<PriceSyncProgress | null>;
};

export function createInMemoryPriceSyncProgressStore(): PriceSyncProgressStore {
  const rows = new Map<string, PriceSyncProgress>();
  return {
    async get(tenantId) {
      return rows.get(tenantId) ?? null;
    },
    async put(tenantId, progress, leaseId) {
      if (!leaseId || rows.get(tenantId)?.leaseId !== leaseId) return false;
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

const newLeaseId = () =>
  globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;

export type SyncBudgets = {
  /** The whole function invocation (the nightly cron's pass over every tenant). */
  cronMs: number | undefined;
  /** One tenant's request: broker sync plus the price slice that follows it. */
  sliceMs: number | undefined;
};

/** The hosted function limit is 300s; leave the rest for persistence and the host. */
const HOSTED_CRON_BUDGET_MS = 240_000;
const HOSTED_SLICE_BUDGET_MS = 45_000;

const positiveBudget = (value: string | undefined): number | undefined => {
  const budget = Number(value);
  return Number.isFinite(budget) && budget > 0 ? budget : undefined;
};

/** Where every time budget is read, so the cron and the request handlers agree.
 *  Local and Docker runs have no host limit and get none, exactly like the
 *  broker sync budget they share a name with. */
export function syncBudgets(environment: (name: string) => string | undefined): SyncBudgets {
  const hosted = Boolean(environment("VERCEL"));
  const cron = positiveBudget(environment("INVESTING_SYNC_BUDGET_MS"));
  return {
    cronMs: cron ?? (hosted ? HOSTED_CRON_BUDGET_MS : undefined),
    sliceMs:
      positiveBudget(environment("INVESTING_PRICE_SYNC_BUDGET_MS")) ??
      cron ??
      (hosted ? HOSTED_SLICE_BUDGET_MS : undefined),
  };
}

/** When one invocation has to stop so the host does not kill it mid-symbol. */
export function priceSyncDeadlineMs(
  environment: (name: string) => string | undefined,
  now = Date.now(),
): number | undefined {
  const { sliceMs } = syncBudgets(environment);
  return sliceMs === undefined ? undefined : now + sliceMs;
}

function instrument(
  target: Position | Trade,
  kind: PriceSyncTarget["kind"],
  backfillFrom: string,
  isin?: string,
  venue?: string,
): PriceSyncTarget {
  const keys = instrumentKeys({
    symbol: target.symbol,
    ...(isin ? { isin } : {}),
    currency: target.currency,
  });
  return {
    kind,
    symbol: target.symbol,
    ticker: target.symbol,
    exchange: "UNKNOWN",
    currency: target.currency,
    backfillFrom,
    instrumentKey: keys.key,
    ...(keys.alias ? { instrumentAlias: keys.alias } : {}),
    ...(isin ? { isin } : {}),
    ...(venue ? { venue } : {}),
    /* An ISIN-shaped symbol is the only identity this broker gave us. */
    ...(isValidIsin(target.symbol) ? { noTicker: true } : {}),
  };
}

/** The keys a READ needs for these symbols: one per symbol, deduplicated by
 *  instrument so a series shared by two broker codes is fetched once. The
 *  benchmark symbols are read even when no trade exists yet, which is why this
 *  is not `discoverPriceSyncTargets`. */
export function priceReadKeys(input: {
  positions: readonly Position[];
  trades: readonly Trade[];
  benchmarkSymbols?: readonly string[];
}): Array<{ symbol: string; key: string; alias?: string }> {
  const instruments = isinsBySymbol(input);
  const out: Array<{ symbol: string; key: string; alias?: string }> = [];
  const seenSymbol = new Set<string>();
  const add = (symbol: string, currency: string) => {
    const normalized = symbol.trim();
    const upper = normalized.toUpperCase();
    if (!normalized || seenSymbol.has(upper)) return;
    seenSymbol.add(upper);
    const found = instruments.get(upper);
    const keys = instrumentKeys({
      symbol: normalized,
      ...(found?.isin ? { isin: found.isin } : {}),
      currency,
    });
    out.push({
      symbol: normalized,
      key: keys.key,
      ...(keys.alias ? { alias: keys.alias } : {}),
    });
  };
  for (const position of input.positions) add(position.symbol, position.currency);
  for (const trade of input.trades) add(trade.symbol, trade.currency);
  for (const benchmark of input.benchmarkSymbols ?? []) add(benchmark, "EUR");
  return out;
}

/**
 * The ISIN a symbol's series is stored under, and whether its rows disagree.
 * Rule from issue #307: the open position's ISIN when there is one, else the
 * most recent trade's ISIN. Two different valid ISINs under one plain ticker
 * mean two instruments; the run picks deterministically and reports the
 * conflict once instead of silently merging them.
 */
function isinsBySymbol(input: {
  positions: readonly Position[];
  trades: readonly Trade[];
}): Map<string, { isin?: string; conflict: boolean }> {
  const valid = (value: string | undefined): value is string => {
    const isin = value?.trim().toUpperCase();
    return isin !== undefined && /^[A-Z]{2}[A-Z0-9]{9}[0-9]$/.test(isin);
  };
  const seen = new Map<string, Set<string>>();
  const remember = (symbol: string, isin: string | undefined) => {
    if (!valid(isin)) return;
    const key = symbol.toUpperCase();
    const set = seen.get(key) ?? new Set<string>();
    set.add(isin.trim().toUpperCase());
    seen.set(key, set);
  };
  const openPositionIsin = new Map<string, string>();
  for (const position of input.positions) {
    remember(position.symbol, position.isin);
    if (
      position.quantity !== 0 &&
      valid(position.isin) &&
      !openPositionIsin.has(position.symbol.toUpperCase())
    )
      openPositionIsin.set(position.symbol.toUpperCase(), position.isin.trim().toUpperCase());
  }
  // Ascending date so the last write per symbol is the most recent trade.
  const recentTradeIsin = new Map<string, string>();
  for (const trade of [...input.trades].sort((left, right) =>
    left.date.localeCompare(right.date),
  )) {
    remember(trade.symbol, trade.isin);
    if (valid(trade.isin))
      recentTradeIsin.set(trade.symbol.toUpperCase(), trade.isin.trim().toUpperCase());
  }
  const out = new Map<string, { isin?: string; conflict: boolean }>();
  for (const symbol of new Set([
    ...input.positions.map((position) => position.symbol.toUpperCase()),
    ...input.trades.map((trade) => trade.symbol.toUpperCase()),
  ])) {
    const isin = openPositionIsin.get(symbol) ?? recentTradeIsin.get(symbol);
    out.set(symbol, {
      ...(isin ? { isin } : {}),
      conflict: (seen.get(symbol)?.size ?? 0) > 1,
    });
  }
  return out;
}

/** Discover one target per symbol, with selected benchmarks first so comparison does not wait behind the full holdings backfill. */
export function discoverPriceSyncTargets(input: {
  positions: readonly Position[];
  trades: readonly Trade[];
  benchmarkSymbols?: readonly string[];
}): PriceSyncTarget[] {
  const instruments = isinsBySymbol(input);
  const identity = (symbol: string) => {
    const found = instruments.get(symbol.toUpperCase());
    return {
      ...(found?.isin ? { isin: found.isin } : {}),
      ...(found?.conflict ? { problem: `${symbol}: conflicting ISINs` } : {}),
    };
  };
  const earliestTrade = new Map<string, Trade>();
  for (const trade of [...input.trades].sort((left, right) =>
    left.date.localeCompare(right.date),
  )) {
    const key = trade.symbol.toUpperCase();
    if (!earliestTrade.has(key)) earliestTrade.set(key, trade);
  }

  /* The venue hint comes from the execution the broker printed for this
   * instrument. The most recent one wins: a listing the user still trades on is
   * the listing the next import will quote, and a stale venue would resolve to
   * the exchange they left. */
  const venueBySymbol = new Map<string, string>();
  for (const trade of [...input.trades].sort((left, right) =>
    right.date.localeCompare(left.date),
  )) {
    const venue = trade.venue?.trim().toUpperCase();
    if (!venue) continue;
    const key = trade.symbol.toUpperCase();
    if (!venueBySymbol.has(key)) venueBySymbol.set(key, venue);
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
    targets.push({
      ...instrument(
        position,
        "current",
        firstTrade?.date ?? "2000-01-01",
        identity(position.symbol).isin,
        venueBySymbol.get(key),
      ),
      ...(identity(position.symbol).problem ? { problem: identity(position.symbol).problem } : {}),
    });
  }
  for (const [key, trade] of earliestTrade) {
    if (seen.has(key)) continue;
    seen.add(key);
    targets.push({
      ...instrument(
        trade,
        "closed",
        trade.date,
        identity(trade.symbol).isin,
        venueBySymbol.get(key),
      ),
      ...(identity(trade.symbol).problem ? { problem: identity(trade.symbol).problem } : {}),
    });
  }

  const portfolioStart = [...earliestTrade.values()].map((trade) => trade.date).sort()[0];
  if (portfolioStart) {
    for (const symbol of input.benchmarkSymbols ?? []) {
      const normalized = symbol.trim();
      const key = normalized.toUpperCase();
      if (!normalized || seen.has(key)) continue;
      seen.add(key);
      const keys = instrumentKeys({ symbol: normalized, currency: "EUR" });
      targets.push({
        kind: "benchmark",
        symbol: normalized,
        ticker: normalized,
        exchange: "UNKNOWN",
        currency: "EUR",
        backfillFrom: portfolioStart,
        instrumentKey: keys.key,
      });
    }
  }
  const benchmarkOrder = new Map(
    (input.benchmarkSymbols ?? []).map((symbol, index) => [symbol.trim().toUpperCase(), index]),
  );
  const unselectedOrder = input.benchmarkSymbols?.length ?? 0;
  return targets.sort(
    (left, right) =>
      (benchmarkOrder.get(left.symbol.toUpperCase()) ?? unselectedOrder) -
      (benchmarkOrder.get(right.symbol.toUpperCase()) ?? unselectedOrder),
  );
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
  /** `deadline` is this run's absolute stop time, so the caller can hand it to
   *  the partner budget: a request slot after it ends the slice, not the symbol. */
  sync: (
    target: PriceSyncTarget,
    tenantId: string,
    context: { deadline: number | undefined; leaseId: string },
  ) => Promise<PriceSyncResult>;
  progressStore?: PriceSyncProgressStore;
  /** Absolute epoch milliseconds this invocation must stop by. */
  deadline?: () => number | undefined;
  /** Time held back for the symbol in hand, so a run stops between symbols
   *  rather than being killed inside a provider request. */
  pauseMarginMs?: number;
  /** How long a `running` row from another instance is believed before this
   *  one takes the work over. */
  takeoverAfterMs?: number;
  /** Maximum time between durable heartbeats while provider work is in flight. */
  heartbeatEveryMs?: number;
  /** How often the run loop re-reads discover() to notice a benchmark selected
   *  after it started. This is a store round trip (the benchmark selection
   *  table), not free: it is time-throttled, not called once per symbol, so a
   *  long sync does not multiply it by its symbol count. */
  benchmarkRecheckEveryMs?: number;
  now?: () => Date;
}) {
  const store = input.progressStore ?? createInMemoryPriceSyncProgressStore();
  const local = new Map<string, PriceSyncProgress>();
  const inFlight = new Map<string, Promise<PriceSyncProgress>>();
  const pauseMarginMs = input.pauseMarginMs ?? 10_000;
  const takeoverAfterMs = input.takeoverAfterMs ?? 30_000;
  const heartbeatEveryMs = Math.min(input.heartbeatEveryMs ?? 10_000, takeoverAfterMs / 3);
  const benchmarkRecheckEveryMs = input.benchmarkRecheckEveryMs ?? 5_000;
  const persistEverySymbols = 5;
  const now = input.now ?? (() => new Date());
  const terminal = (status: PriceSyncProgress["status"]) =>
    status !== "running" && status !== "waiting";

  const sinceLastPersist = new Map<string, number>();
  const lastPersistAt = new Map<string, number>();
  const update = async (
    tenantId: string,
    next: Omit<PriceSyncProgress, "updatedAt">,
    leaseId: string,
  ): Promise<PriceSyncProgress> => {
    const value = { ...next, updatedAt: now().toISOString() };
    /* Count symbols to avoid a write for every cheap cache hit. Also renew
     * after elapsed time so the lease does not expire during a long slice. */
    const elapsed = sinceLastPersist.get(tenantId);
    if (
      terminal(value.status) ||
      elapsed === undefined ||
      elapsed >= persistEverySymbols ||
      now().getTime() - (lastPersistAt.get(tenantId) ?? -Infinity) >= heartbeatEveryMs
    ) {
      const stored = await store.put(tenantId, value, leaseId);
      if (stored === false) throw new PriceSyncLeaseLost();
      sinceLastPersist.set(tenantId, 0);
      lastPersistAt.set(tenantId, now().getTime());
    } else {
      sinceLastPersist.set(tenantId, elapsed + 1);
    }
    local.set(tenantId, value);
    return value;
  };

  const start = (tenantId: string, deadline = input.deadline?.()): Promise<PriceSyncProgress> => {
    const active = inFlight.get(tenantId);
    if (active) return active;
    const leaseId = newLeaseId();
    const execute = async (): Promise<PriceSyncProgress> => {
      const stored = await store.get(tenantId);
      /* Another instance is already working this tenant. Starting a second run
       * would double the provider traffic and let two writers fight over one
       * progress row; a stale row means that instance died, so we take over. */
      if (
        stored?.status === "running" &&
        stored.updatedAt &&
        now().getTime() - Date.parse(stored.updatedAt) < takeoverAfterMs
      )
        return stored;

      const claimed = {
        ...idleProgress(),
        status: "running" as const,
        updatedAt: now().toISOString(),
        message: "Discovering price symbols",
        leaseId,
      };
      const busy = await store.claim(
        tenantId,
        claimed,
        new Date(now().getTime() - takeoverAfterMs).toISOString(),
      );
      if (busy) return busy;
      local.set(tenantId, claimed);
      lastPersistAt.set(tenantId, now().getTime());

      let targets: PriceSyncTarget[];
      try {
        targets = await input.discover(tenantId);
      } catch (error) {
        const problem = error instanceof Error ? error.message : "Price target discovery failed";
        return update(
          tenantId,
          {
            status: "problem",
            total: 0,
            completed: 0,
            remainingSymbols: [],
            currentSymbol: null,
            waitUntil: null,
            message: "Price synchronization could not start",
            problems: [problem],
          },
          leaseId,
        );
      }

      /* A paused run names the symbols it never reached. Include selected
       * benchmarks again because one may have been added during the last slice.
       * Cached benchmark bars avoid a second provider request. */
      const paused = stored?.status === "paused" ? stored : null;
      const pending = new Set(paused?.remainingSymbols ?? []);
      const resumed = paused
        ? targets.filter((target) => pending.has(target.symbol) || target.kind === "benchmark")
        : [];
      const queue = resumed.length > 0 ? resumed : targets;
      let total = resumed.length > 0 ? paused!.completed + queue.length : queue.length;
      const done = total - queue.length;
      const problems: string[] = resumed.length > 0 ? [...paused!.problems] : [];
      /* One line per conflicting symbol per sync, not per slice. Already
       * formatted by discovery. */
      const discoveryProblems = [
        ...new Set(queue.flatMap((target) => (target.problem ? [target.problem] : []))),
      ];
      problems.push(...discoveryProblems);

      if (queue.length === 0)
        return update(
          tenantId,
          {
            status: "completed",
            total,
            completed: total,
            remainingSymbols: [],
            currentSymbol: null,
            waitUntil: null,
            message: total ? "Price synchronization completed" : "No price symbols to synchronize",
            problems,
          },
          leaseId,
        );
      const remainingFrom = (index: number) => queue.slice(index).map((target) => target.symbol);
      const pause = (
        index: number,
        message = "Price synchronization paused for the host time budget",
      ) =>
        update(
          tenantId,
          {
            status: "paused",
            total,
            completed: done + index,
            remainingSymbols: remainingFrom(index),
            currentSymbol: null,
            waitUntil: null,
            message,
            problems: [...problems],
          },
          leaseId,
        );

      sinceLastPersist.delete(tenantId);
      await update(
        tenantId,
        {
          status: "running",
          total,
          completed: done,
          remainingSymbols: remainingFrom(0),
          currentSymbol: null,
          waitUntil: null,
          message: "Price synchronization started",
          problems: [...problems],
          leaseId,
        },
        leaseId,
      );
      let lastBenchmarkCheckAt = now().getTime();
      for (let index = 0; index < queue.length; index += 1) {
        if (deadline !== undefined && now().getTime() + pauseMarginMs >= deadline)
          return pause(index);
        /* Notice a benchmark selected after this run started, using only
         * state every instance shares (discover() reads positions/trades
         * and the benchmark selection store fresh each call) rather than an
         * in-process registry the instance serving the PUT could not reach
         * on Vercel. Skipped right after start: the queue was just built
         * from this same discover(). Time-throttled, not once per symbol:
         * discover() is a store round trip (the benchmark selection table),
         * and a long sync must not multiply that by its symbol count. Best-
         * effort: a failed re-discovery (for instance a broker sync holding
         * the read) just retries at the next due check instead of failing
         * the run. */
        if (index > 0 && now().getTime() - lastBenchmarkCheckAt >= benchmarkRecheckEveryMs) {
          lastBenchmarkCheckAt = now().getTime();
          let discovered: PriceSyncTarget[] = [];
          try {
            discovered = await input.discover(tenantId);
          } catch {
            discovered = [];
          }
          const known = new Set(queue.map((existing) => existing.symbol.toUpperCase()));
          let insertAt = index;
          for (const candidate of discovered) {
            if (candidate.kind !== "benchmark") continue;
            const key = candidate.symbol.toUpperCase();
            if (known.has(key)) continue;
            queue.splice(insertAt, 0, candidate);
            known.add(key);
            total += 1;
            insertAt += 1;
          }
        }
        const target = queue[index]!;
        await update(
          tenantId,
          {
            status: "running",
            total,
            completed: done + index,
            remainingSymbols: remainingFrom(index),
            currentSymbol: target.symbol,
            waitUntil: null,
            message: `Synchronizing ${target.symbol}`,
            problems: [...problems],
            leaseId,
          },
          leaseId,
        );
        let paused: { message?: string } | undefined;
        let heartbeatError: unknown;
        let heartbeat = Promise.resolve();
        const renew = () => {
          heartbeat = heartbeat.then(async () => {
            if (heartbeatError) return;
            const current = local.get(tenantId);
            if (!current) return;
            const value = { ...current, updatedAt: now().toISOString() };
            try {
              if (!(await store.put(tenantId, value, leaseId))) throw new PriceSyncLeaseLost();
              local.set(tenantId, value);
              lastPersistAt.set(tenantId, now().getTime());
            } catch (error) {
              heartbeatError = error;
            }
          });
        };
        const timer = setInterval(renew, heartbeatEveryMs);
        try {
          const result = await input.sync(target, tenantId, { deadline, leaseId });
          /* A key another run holds the claim for is not a failure and not
           * finished: the slice ends paused with this key still on the list,
           * and the next slice reads the rows that run wrote. */
          if (result.pending) {
            paused = {
              message: "Price synchronization paused for an instrument another run is updating",
            };
          } else {
            problems.push(...result.problems.map((problem) => `${target.symbol}: ${problem}`));
          }
        } catch (error) {
          /* The partner budget has no slot before the deadline, or cannot be
           * reached. Nothing was sent for this symbol, so it did not fail: the
           * slice ends and the symbol is tried again on the next one. */
          if (isPartnerWait(error)) paused = {};
          else if (isPartnerBudgetUnavailable(error))
            paused = {
              message: "Price synchronization paused: the shared request budget is unavailable",
            };
          else
            problems.push(
              `${target.symbol}: ${error instanceof Error ? error.message : "Price synchronization failed"}`,
            );
        } finally {
          clearInterval(timer);
          await heartbeat;
        }
        if (heartbeatError) throw heartbeatError;
        // Paused only after the heartbeat has settled, so it cannot overwrite the pause.
        if (paused) return pause(index, paused.message);
        if (now().getTime() - (lastPersistAt.get(tenantId) ?? -Infinity) >= heartbeatEveryMs) {
          const current = local.get(tenantId)!;
          if (!(await store.put(tenantId, { ...current, updatedAt: now().toISOString() }, leaseId)))
            throw new PriceSyncLeaseLost();
          lastPersistAt.set(tenantId, now().getTime());
        }
      }
      return update(
        tenantId,
        {
          status: problems.length ? "problem" : "completed",
          total,
          completed: total,
          remainingSymbols: [],
          currentSymbol: null,
          waitUntil: null,
          message: problems.length
            ? "Price synchronization completed with problems"
            : "Price synchronization completed",
          problems,
        },
        leaseId,
      );
    };
    /* Cleared here rather than from a `.finally` on a derived promise: that one
     * runs a microtask later than the caller it hands the result to, so the
     * next run would join the finished one instead of starting. */
    const run = (async () => {
      try {
        return await execute();
      } catch (error) {
        if (error instanceof PriceSyncLeaseLost)
          return (await store.get(tenantId).catch(() => null)) ?? idleProgress();
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
