import { expect, test, vi } from "vitest";
import type { Position, Trade } from "@lavega/core";
import { priceSyncLeaseContract } from "../../../packages/database/src/priceSyncLease.contract.js";
import {
  createInMemoryPriceSyncProgressStore,
  createPriceOrchestrator,
  discoverPriceSyncTargets,
  priceSyncDeadlineMs,
  type PriceSyncTarget,
} from "./priceOrchestrator.js";

const position = (symbol: string, quantity = 1): Position => ({
  entity: "personal",
  symbol,
  quantity,
  averagePrice: 10,
  marketPrice: 10,
  marketValue: 10,
  currency: "EUR",
  asOf: "2026-08-20",
});
const trade = (symbol: string, date: string): Trade => ({
  id: `${symbol}:${date}`,
  entity: "personal",
  symbol,
  date,
  side: "buy",
  quantity: 1,
  price: 10,
  amount: 10,
  currency: "EUR",
  commission: 0,
});
const result = (problems: string[] = [], fetched = true) => ({ bars: [], fetched, problems });

priceSyncLeaseContract("memory price progress", createInMemoryPriceSyncProgressStore);

async function waitForAssertion(assertion: () => void) {
  let lastError: unknown;
  for (let attempts = 0; attempts < 20; attempts += 1) {
    try {
      assertion();
      return;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  }
  throw lastError;
}

test("discovers selected benchmarks before holdings with correct starts", () => {
  const targets = discoverPriceSyncTargets({
    positions: [position("ASML"), position("ZERO", 0)],
    trades: [
      trade("CLOSED", "2024-02-01"),
      trade("ASML", "2025-03-04"),
      trade("ASML", "2024-01-02"),
    ],
    benchmarkSymbols: ["^STOXX50E", "ASML"],
  });

  expect(targets.map(({ symbol, kind, backfillFrom }) => ({ symbol, kind, backfillFrom }))).toEqual(
    [
      { symbol: "^STOXX50E", kind: "benchmark", backfillFrom: "2024-01-02" },
      { symbol: "ASML", kind: "current", backfillFrom: "2024-01-02" },
      { symbol: "CLOSED", kind: "closed", backfillFrom: "2024-02-01" },
    ],
  );
});

test("position without trades backfills full history, not the snapshot date", () => {
  const targets = discoverPriceSyncTargets({ positions: [position("AMD_US_EQ")], trades: [] });
  expect(targets).toHaveLength(1);
  expect(targets[0]!.backfillFrom).not.toBe("2026-08-20");
});

test("concurrent tenant triggers join one orchestration", async () => {
  let release!: () => void;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  const sync = vi.fn(async () => {
    await pending;
    return result();
  });
  const target: PriceSyncTarget = {
    kind: "current",
    symbol: "ASML",
    ticker: "ASML",
    exchange: "AMS",
    currency: "EUR",
    backfillFrom: "2024-01-01",
  };
  const orchestrator = createPriceOrchestrator({ discover: () => [target], sync, paceMs: 0 });

  const first = orchestrator.run("local");
  const second = orchestrator.run("local");
  release();

  expect(await first).toEqual(await second);
  expect(sync).toHaveBeenCalledOnce();
});

test("partial failure continues later symbols and remains retryable on next run", async () => {
  const targets: PriceSyncTarget[] = [
    {
      kind: "current",
      symbol: "FAIL",
      ticker: "FAIL",
      exchange: "UNKNOWN",
      currency: "EUR",
      backfillFrom: "2024-01-01",
    },
    {
      kind: "closed",
      symbol: "OK",
      ticker: "OK",
      exchange: "UNKNOWN",
      currency: "EUR",
      backfillFrom: "2024-02-01",
    },
  ];
  const sync = vi.fn(async (target: PriceSyncTarget) =>
    result(target.symbol === "FAIL" ? ["rate limited"] : []),
  );
  const orchestrator = createPriceOrchestrator({ discover: () => targets, sync, paceMs: 0 });

  await expect(orchestrator.run("local")).resolves.toMatchObject({
    status: "problem",
    completed: 2,
    problems: ["FAIL: rate limited"],
  });
  await orchestrator.run("local");

  expect(sync.mock.calls.map(([target]) => target.symbol)).toEqual(["FAIL", "OK", "FAIL", "OK"]);
});

test("reports waiting state and remaining symbols during 300 ms pacing", async () => {
  let release!: () => void;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  const wait = vi.fn(() => pending);
  const targets: PriceSyncTarget[] = [
    {
      kind: "current",
      symbol: "NOW",
      ticker: "NOW",
      exchange: "UNKNOWN",
      currency: "EUR",
      backfillFrom: "2024-01-01",
    },
    {
      kind: "closed",
      symbol: "NEXT",
      ticker: "NEXT",
      exchange: "UNKNOWN",
      currency: "EUR",
      backfillFrom: "2024-02-01",
    },
  ];
  const orchestrator = createPriceOrchestrator({
    discover: () => targets,
    sync: async () => result(),
    wait,
  });

  const run = orchestrator.run("local");
  await waitForAssertion(() => expect(wait).toHaveBeenCalledWith(300));
  await expect(orchestrator.status("local")).resolves.toMatchObject({
    status: "waiting",
    completed: 1,
    remainingSymbols: ["NEXT"],
  });
  release();
  await expect(run).resolves.toMatchObject({ status: "completed", completed: 2 });
});

test("empty discovery completes without a provider request", async () => {
  const sync = vi.fn();
  const orchestrator = createPriceOrchestrator({ discover: () => [], sync, paceMs: 0 });

  await expect(orchestrator.run("local")).resolves.toMatchObject({
    status: "completed",
    total: 0,
    remainingSymbols: [],
  });
  expect(sync).not.toHaveBeenCalled();
});

const symbolTarget = (symbol: string): PriceSyncTarget => ({
  kind: "current",
  symbol,
  ticker: symbol,
  exchange: "UNKNOWN",
  currency: "EUR",
  backfillFrom: "2024-01-01",
});

test("does not pace between cache-hit syncs", async () => {
  const targets = ["ONE", "TWO", "THREE"].map(symbolTarget);
  const sync = vi.fn(async () => result([], false));
  const wait = vi.fn(async () => {});
  const orchestrator = createPriceOrchestrator({ discover: () => targets, sync, paceMs: 10, wait });

  await expect(orchestrator.run("local")).resolves.toMatchObject({ status: "completed" });

  expect(wait).not.toHaveBeenCalled();
});

test("paces only after syncs that actually fetched", async () => {
  const targets = ["ONE", "TWO", "THREE"].map(symbolTarget);
  const sync = vi.fn(async (target: PriceSyncTarget) => result([], target.symbol !== "TWO"));
  const wait = vi.fn(async () => {});
  const orchestrator = createPriceOrchestrator({ discover: () => targets, sync, paceMs: 10, wait });

  await expect(orchestrator.run("local")).resolves.toMatchObject({ status: "completed" });

  // ONE fetched (paces before TWO), TWO cache hit (no pace before THREE).
  expect(wait).toHaveBeenCalledTimes(1);
});

test("throttles progress writes by symbol count so store latency cannot gate cache-hit throughput", async () => {
  const targets = Array.from({ length: 7 }, (_, index) => symbolTarget(`SYM${index}`));
  const sync = vi.fn(async () => result([], false));
  const put = vi.fn(async () => true);
  const progressStore = { get: vi.fn(async () => null), put, claim: vi.fn(async () => null) };
  const orchestrator = createPriceOrchestrator({
    discover: () => targets,
    sync,
    paceMs: 0,
    progressStore,
  });

  await expect(orchestrator.run("local")).resolves.toMatchObject({
    status: "completed",
    completed: 7,
  });

  // Symbol 0 starts the row (so a lost lease is still caught immediately),
  // symbol 5 crosses the throttle threshold, and the terminal write always
  // persists: three writes total, not one per cache-hit symbol.
  expect(put).toHaveBeenCalledTimes(3);
});

test("elapsed time forces progress renewal before symbol count threshold", async () => {
  let clock = 0;
  const backing = createInMemoryPriceSyncProgressStore();
  const put = vi.fn(backing.put);
  const orchestrator = createPriceOrchestrator({
    discover: () => ["ONE", "TWO"].map(symbolTarget),
    sync: async () => {
      clock += 11_000;
      return result([], false);
    },
    progressStore: { ...backing, put },
    now: () => new Date(clock),
    paceMs: 0,
  });
  await expect(orchestrator.run("tenant")).resolves.toMatchObject({ status: "completed" });
  expect(put.mock.calls.length).toBeGreaterThan(2);
});

test("memory progress store rejects writes from old or absent lease", async () => {
  const store = createInMemoryPriceSyncProgressStore();
  const first = {
    status: "running" as const,
    total: 0,
    completed: 0,
    remainingSymbols: [] as string[],
    currentSymbol: null,
    waitUntil: null,
    updatedAt: new Date(0).toISOString(),
    message: null,
    problems: [] as string[],
    leaseId: "first",
  };
  await store.claim("tenant", first, new Date(-1).toISOString());
  const next = { ...first, status: "completed" as const };
  await expect(store.put("tenant", next, "")).resolves.toBe(false);
  await expect(store.put("tenant", next, "stale")).resolves.toBe(false);
  await expect(store.get("tenant")).resolves.toEqual(first);
  await expect(store.put("tenant", next, "first")).resolves.toBe(true);
});

test("run stops on the host budget and names what is left instead of continuing past it", async () => {
  const targets = ["ONE", "TWO", "THREE"].map(symbolTarget);
  let clock = 0;
  const sync = vi.fn(async (_target: PriceSyncTarget) => {
    clock += 4_000;
    return result();
  });
  const orchestrator = createPriceOrchestrator({
    discover: () => targets,
    sync,
    paceMs: 0,
    pauseMarginMs: 3_000,
    now: () => new Date(clock),
  });

  await expect(orchestrator.run("local", 10_000)).resolves.toMatchObject({
    status: "paused",
    total: 3,
    completed: 2,
    remainingSymbols: ["THREE"],
  });
  expect(sync.mock.calls.map(([target]) => target.symbol)).toEqual(["ONE", "TWO"]);
});

test("a paused run resumes at the symbol it stopped on and finishes", async () => {
  const targets = ["ONE", "TWO", "THREE"].map(symbolTarget);
  const progressStore = createInMemoryPriceSyncProgressStore();
  let clock = 0;
  const sync = vi.fn(async (_target: PriceSyncTarget) => {
    clock += 4_000;
    return result();
  });
  const orchestrator = createPriceOrchestrator({
    discover: () => targets,
    sync,
    paceMs: 0,
    pauseMarginMs: 3_000,
    progressStore,
    now: () => new Date(clock),
  });

  await orchestrator.run("local", 10_000);
  await expect(orchestrator.run("local", clock + 60_000)).resolves.toMatchObject({
    status: "completed",
    total: 3,
    completed: 3,
    remainingSymbols: [],
  });
  // Symbols the first slice already stored cost the second one no request at all.
  expect(sync.mock.calls.map(([target]) => target.symbol)).toEqual(["ONE", "TWO", "THREE"]);
});

test("a resumed run uses fresh benchmark priority for its remaining symbols", async () => {
  const holdingsFirst = ["ONE", "TWO", "^AEX"].map(symbolTarget);
  let discovered = holdingsFirst;
  const progressStore = createInMemoryPriceSyncProgressStore();
  let clock = 0;
  const sync = vi.fn(async (_target: PriceSyncTarget) => {
    clock += 4_000;
    return result();
  });
  const orchestrator = createPriceOrchestrator({
    discover: () => discovered,
    sync,
    paceMs: 0,
    pauseMarginMs: 3_000,
    progressStore,
    now: () => new Date(clock),
  });

  await expect(orchestrator.run("local", 6_000)).resolves.toMatchObject({
    status: "paused",
    remainingSymbols: ["TWO", "^AEX"],
  });
  discovered = [holdingsFirst[2]!, ...holdingsFirst.slice(0, 2)];
  await expect(orchestrator.run("local", clock + 60_000)).resolves.toMatchObject({
    status: "completed",
  });
  expect(sync.mock.calls.map(([target]) => target.symbol)).toEqual(["ONE", "^AEX", "TWO"]);
});

test("a benchmark selected during a paused run joins its next slice", async () => {
  const holdings = ["ONE", "TWO", "THREE"].map(symbolTarget);
  let discovered = holdings;
  const progressStore = createInMemoryPriceSyncProgressStore();
  let clock = 0;
  const sync = vi.fn(async (_target: PriceSyncTarget) => {
    clock += 4_000;
    return result();
  });
  const orchestrator = createPriceOrchestrator({
    discover: () => discovered,
    sync,
    paceMs: 0,
    pauseMarginMs: 3_000,
    progressStore,
    now: () => new Date(clock),
  });

  await expect(orchestrator.run("local", 6_000)).resolves.toMatchObject({
    status: "paused",
    remainingSymbols: ["TWO", "THREE"],
  });
  discovered = [{ ...symbolTarget("^AEX"), kind: "benchmark" }, ...holdings];
  await expect(orchestrator.run("local", clock + 60_000)).resolves.toMatchObject({
    status: "completed",
    total: 4,
  });
  expect(sync.mock.calls.map(([target]) => target.symbol)).toEqual([
    "ONE",
    "^AEX",
    "TWO",
    "THREE",
  ]);
});

test("progress survives the process that produced it", async () => {
  const progressStore = createInMemoryPriceSyncProgressStore();
  const shared = {
    discover: () => [symbolTarget("ONE")],
    sync: async () => result(),
    paceMs: 0,
    progressStore,
  };
  await createPriceOrchestrator(shared).run("local");

  // A second instance answers the status poll from the row, not from memory it never had.
  await expect(createPriceOrchestrator(shared).status("local")).resolves.toMatchObject({
    status: "completed",
    total: 1,
    completed: 1,
    updatedAt: expect.any(String),
  });
});

test("a fresh run by another instance is left alone rather than doubled", async () => {
  const progressStore = createInMemoryPriceSyncProgressStore();
  await progressStore.claim(
    "local",
    {
      status: "running",
      total: 2,
      completed: 1,
      remainingSymbols: ["TWO"],
      currentSymbol: "TWO",
      waitUntil: null,
      updatedAt: new Date().toISOString(),
      message: null,
      problems: [],
      leaseId: "other",
    },
    new Date(Date.now() - 30_000).toISOString(),
  );
  const sync = vi.fn(async () => result());
  const orchestrator = createPriceOrchestrator({
    discover: () => [symbolTarget("TWO")],
    sync,
    paceMs: 0,
    progressStore,
  });

  await expect(orchestrator.run("local")).resolves.toMatchObject({
    status: "running",
    currentSymbol: "TWO",
  });
  expect(sync).not.toHaveBeenCalled();
});

test("a stale run is taken over so a dead instance cannot strand the work", async () => {
  const progressStore = createInMemoryPriceSyncProgressStore();
  await progressStore.claim(
    "local",
    {
      status: "running",
      total: 1,
      completed: 0,
      remainingSymbols: ["TWO"],
      currentSymbol: "TWO",
      waitUntil: null,
      updatedAt: new Date(Date.now() - 120_000).toISOString(),
      message: null,
      problems: [],
      leaseId: "stale",
    },
    new Date(Date.now() - 150_000).toISOString(),
  );
  const sync = vi.fn(async () => result());
  const orchestrator = createPriceOrchestrator({
    discover: () => [symbolTarget("TWO")],
    sync,
    paceMs: 0,
    progressStore,
  });

  await expect(orchestrator.run("local")).resolves.toMatchObject({ status: "completed" });
  expect(sync).toHaveBeenCalledOnce();
});

test("a worker that loses its durable lease stops before another provider request", async () => {
  const owner = {
    status: "running" as const,
    total: 1,
    completed: 0,
    remainingSymbols: ["TWO"],
    currentSymbol: "TWO",
    waitUntil: null,
    updatedAt: new Date().toISOString(),
    message: "New owner",
    problems: [],
    leaseId: "new-owner",
  };
  const progressStore = {
    get: vi.fn().mockResolvedValueOnce(null).mockResolvedValue(owner),
    put: vi.fn(async () => false),
    claim: vi.fn(async () => null),
  };
  const sync = vi.fn(async () => result());
  const orchestrator = createPriceOrchestrator({
    discover: () => [symbolTarget("TWO")],
    sync,
    paceMs: 0,
    progressStore,
  });

  await expect(orchestrator.run("local")).resolves.toMatchObject({
    leaseId: "new-owner",
    currentSymbol: "TWO",
  });
  expect(sync).not.toHaveBeenCalled();
  expect(progressStore.put).toHaveBeenCalled();
});

test.each(["start", "final"])(
  "durable %s write failure rejects instead of reporting completion",
  async (point) => {
    const backing = createInMemoryPriceSyncProgressStore();
    let writes = 0;
    const progressStore = {
      ...backing,
      put: async (...args: Parameters<typeof backing.put>) => {
        writes += 1;
        if ((point === "start" && writes === 1) || (point === "final" && writes === 2))
          throw new Error("storage unavailable");
        return backing.put(...args);
      },
    };
    const sync = vi.fn(async () => result());
    const orchestrator = createPriceOrchestrator({
      discover: () => [symbolTarget("ONE")],
      sync,
      progressStore,
      paceMs: 0,
    });
    await expect(orchestrator.run("local")).rejects.toThrow("storage unavailable");
    await expect(backing.get("local")).resolves.not.toMatchObject({ status: "completed" });
    if (point === "start") expect(sync).not.toHaveBeenCalled();
  },
);

test("failed progress read rejects before claim or provider work", async () => {
  const readError = new Error("storage unavailable");
  const store = {
    get: vi.fn(async () => {
      throw readError;
    }),
    claim: vi.fn(async () => null),
    put: vi.fn(async () => true),
  };
  const discover = vi.fn(async () => [symbolTarget("ONE")]);
  const sync = vi.fn(async () => result());
  const orchestrator = createPriceOrchestrator({ discover, sync, progressStore: store });

  await expect(orchestrator.run("tenant")).rejects.toBe(readError);
  expect(store.claim).not.toHaveBeenCalled();
  expect(store.put).not.toHaveBeenCalled();
  expect(discover).not.toHaveBeenCalled();
  expect(sync).not.toHaveBeenCalled();
});

test.each(["empty", "error"])("%s discovery cannot overwrite an active lease", async (kind) => {
  const store = createInMemoryPriceSyncProgressStore();
  const active = {
    status: "running" as const,
    total: 1,
    completed: 0,
    remainingSymbols: ["ONE"],
    currentSymbol: "ONE",
    waitUntil: null,
    updatedAt: new Date(0).toISOString(),
    message: null,
    problems: [] as string[],
    leaseId: "owner",
  };
  await store.claim("tenant", active, new Date(-1).toISOString());
  const discover = vi.fn(() => {
    if (kind === "error") throw new Error("discovery failed");
    return [];
  });
  const orchestrator = createPriceOrchestrator({
    discover,
    sync: async () => result(),
    progressStore: store,
    now: () => new Date(1_000),
  });
  await expect(orchestrator.run("tenant")).resolves.toMatchObject({ leaseId: "owner" });
  await expect(store.get("tenant")).resolves.toEqual(active);
  expect(discover).not.toHaveBeenCalled();
});

test("slow provider cannot publish stale progress after another worker claims expired lease", async () => {
  const store = createInMemoryPriceSyncProgressStore();
  let clock = 0;
  let release!: () => void;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  const sync = vi.fn(async () => {
    await pending;
    return result();
  });
  const first = createPriceOrchestrator({
    discover: () => [symbolTarget("ONE"), symbolTarget("TWO")],
    sync,
    progressStore: store,
    now: () => new Date(clock),
    takeoverAfterMs: 30_000,
    paceMs: 0,
  });
  const running = first.run("tenant");
  await waitForAssertion(() => expect(sync).toHaveBeenCalledTimes(1));
  clock = 31_000;
  const second = createPriceOrchestrator({
    discover: () => [],
    sync: async () => result(),
    progressStore: store,
    now: () => new Date(clock),
    takeoverAfterMs: 30_000,
  });
  const winner = await second.run("tenant");
  release();
  await expect(running).resolves.toEqual(winner);
  await expect(store.get("tenant")).resolves.toEqual(winner);
});

test("heartbeat keeps slow provider lease fresh past takeover threshold", async () => {
  vi.useFakeTimers();
  try {
    const store = createInMemoryPriceSyncProgressStore();
    let release!: () => void;
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    const sync = vi.fn(async () => {
      await pending;
      return result();
    });
    const clock = () => new Date(Date.now());
    const first = createPriceOrchestrator({
      discover: () => [symbolTarget("ONE")],
      sync,
      progressStore: store,
      now: clock,
      takeoverAfterMs: 30_000,
      heartbeatEveryMs: 5_000,
      paceMs: 0,
    });
    const running = first.run("tenant");
    await vi.waitFor(() => expect(sync).toHaveBeenCalledOnce());
    const owner = (await store.get("tenant"))?.leaseId;
    await vi.advanceTimersByTimeAsync(35_000);
    const secondSync = vi.fn(async () => result());
    const second = createPriceOrchestrator({
      discover: () => [symbolTarget("ONE")],
      sync: secondSync,
      progressStore: store,
      now: clock,
      takeoverAfterMs: 30_000,
    });
    await expect(second.run("tenant")).resolves.toMatchObject({ leaseId: owner });
    expect(secondSync).not.toHaveBeenCalled();
    release();
    await expect(running).resolves.toMatchObject({ status: "completed" });
  } finally {
    vi.useRealTimers();
  }
});

test("the budget is the broker sync budget unless prices are given their own", () => {
  const environment = (values: Record<string, string>) => (name: string) => values[name];
  expect(priceSyncDeadlineMs(environment({ INVESTING_SYNC_BUDGET_MS: "240000" }), 1_000)).toBe(
    241_000,
  );
  expect(
    priceSyncDeadlineMs(
      environment({ INVESTING_SYNC_BUDGET_MS: "240000", INVESTING_PRICE_SYNC_BUDGET_MS: "60000" }),
      1_000,
    ),
  ).toBe(61_000);
  expect(priceSyncDeadlineMs(environment({ VERCEL: "1" }), 1_000)).toBe(46_000);
  // A local or Docker run has no host limit, so it waits out the whole list.
  expect(priceSyncDeadlineMs(environment({}), 1_000)).toBeUndefined();
});
