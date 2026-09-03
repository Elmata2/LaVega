import { expect, test, vi } from "vitest";
import type { Position, Trade } from "@lavega/core";
import { createInMemoryPriceSyncProgressStore, createPriceOrchestrator, discoverPriceSyncTargets, priceSyncDeadlineMs, type PriceSyncTarget } from "./priceOrchestrator.js";

const position = (symbol: string, quantity = 1): Position => ({ entity: "personal", symbol, quantity, averagePrice: 10, marketPrice: 10, marketValue: 10, currency: "EUR", asOf: "2026-08-20" });
const trade = (symbol: string, date: string): Trade => ({ id: `${symbol}:${date}`, entity: "personal", symbol, date, side: "buy", quantity: 1, price: 10, amount: 10, currency: "EUR", commission: 0 });
const result = (problems: string[] = []) => ({ bars: [], fetched: true, problems });

test("discovers current, closed, and benchmark symbols in request order with correct starts", () => {
  const targets = discoverPriceSyncTargets({
    positions: [position("ASML"), position("ZERO", 0)],
    trades: [trade("CLOSED", "2024-02-01"), trade("ASML", "2025-03-04"), trade("ASML", "2024-01-02")],
    benchmarkSymbols: ["^STOXX50E", "ASML"],
  });

  expect(targets.map(({ symbol, kind, backfillFrom }) => ({ symbol, kind, backfillFrom }))).toEqual([
    { symbol: "ASML", kind: "current", backfillFrom: "2024-01-02" },
    { symbol: "CLOSED", kind: "closed", backfillFrom: "2024-02-01" },
    { symbol: "^STOXX50E", kind: "benchmark", backfillFrom: "2024-01-02" },
  ]);
});

test("position without trades backfills full history, not the snapshot date", () => {
  const targets = discoverPriceSyncTargets({ positions: [position("AMD_US_EQ")], trades: [] });
  expect(targets).toHaveLength(1);
  expect(targets[0]!.backfillFrom).not.toBe("2026-08-20");
});

test("concurrent tenant triggers join one orchestration", async () => {
  let release!: () => void;
  const pending = new Promise<void>((resolve) => { release = resolve; });
  const sync = vi.fn(async () => { await pending; return result(); });
  const target: PriceSyncTarget = { kind: "current", symbol: "ASML", ticker: "ASML", exchange: "AMS", currency: "EUR", backfillFrom: "2024-01-01" };
  const orchestrator = createPriceOrchestrator({ discover: () => [target], sync, paceMs: 0 });

  const first = orchestrator.run("local");
  const second = orchestrator.run("local");
  release();

  expect(await first).toEqual(await second);
  expect(sync).toHaveBeenCalledOnce();
});

test("partial failure continues later symbols and remains retryable on next run", async () => {
  const targets: PriceSyncTarget[] = [
    { kind: "current", symbol: "FAIL", ticker: "FAIL", exchange: "UNKNOWN", currency: "EUR", backfillFrom: "2024-01-01" },
    { kind: "closed", symbol: "OK", ticker: "OK", exchange: "UNKNOWN", currency: "EUR", backfillFrom: "2024-02-01" },
  ];
  const sync = vi.fn(async (target: PriceSyncTarget) => result(target.symbol === "FAIL" ? ["rate limited"] : []));
  const orchestrator = createPriceOrchestrator({ discover: () => targets, sync, paceMs: 0 });

  await expect(orchestrator.run("local")).resolves.toMatchObject({ status: "problem", completed: 2, problems: ["FAIL: rate limited"] });
  await orchestrator.run("local");

  expect(sync.mock.calls.map(([target]) => target.symbol)).toEqual(["FAIL", "OK", "FAIL", "OK"]);
});

test("reports waiting state and remaining symbols during 300 ms pacing", async () => {
  let release!: () => void;
  const pending = new Promise<void>((resolve) => { release = resolve; });
  const wait = vi.fn(() => pending);
  const targets: PriceSyncTarget[] = [
    { kind: "current", symbol: "NOW", ticker: "NOW", exchange: "UNKNOWN", currency: "EUR", backfillFrom: "2024-01-01" },
    { kind: "closed", symbol: "NEXT", ticker: "NEXT", exchange: "UNKNOWN", currency: "EUR", backfillFrom: "2024-02-01" },
  ];
  const orchestrator = createPriceOrchestrator({ discover: () => targets, sync: async () => result(), wait });

  const run = orchestrator.run("local");
  await vi.waitFor(() => expect(wait).toHaveBeenCalledWith(300));
  await expect(orchestrator.status("local")).resolves.toMatchObject({ status: "waiting", completed: 1, remainingSymbols: ["NEXT"] });
  release();
  await expect(run).resolves.toMatchObject({ status: "completed", completed: 2 });
});

test("empty discovery completes without a provider request", async () => {
  const sync = vi.fn();
  const orchestrator = createPriceOrchestrator({ discover: () => [], sync, paceMs: 0 });

  await expect(orchestrator.run("local")).resolves.toMatchObject({ status: "completed", total: 0, remainingSymbols: [] });
  expect(sync).not.toHaveBeenCalled();
});

const symbolTarget = (symbol: string): PriceSyncTarget => ({ kind: "current", symbol, ticker: symbol, exchange: "UNKNOWN", currency: "EUR", backfillFrom: "2024-01-01" });

test("run stops on the host budget and names what is left instead of continuing past it", async () => {
  const targets = ["ONE", "TWO", "THREE"].map(symbolTarget);
  let clock = 0;
  const sync = vi.fn(async (_target: PriceSyncTarget) => { clock += 4_000; return result(); });
  const orchestrator = createPriceOrchestrator({ discover: () => targets, sync, paceMs: 0, pauseMarginMs: 3_000, now: () => new Date(clock) });

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
  const sync = vi.fn(async (_target: PriceSyncTarget) => { clock += 4_000; return result(); });
  const orchestrator = createPriceOrchestrator({ discover: () => targets, sync, paceMs: 0, pauseMarginMs: 3_000, progressStore, now: () => new Date(clock) });

  await orchestrator.run("local", 10_000);
  await expect(orchestrator.run("local", clock + 60_000)).resolves.toMatchObject({ status: "completed", total: 3, completed: 3, remainingSymbols: [] });
  // Symbols the first slice already stored cost the second one no request at all.
  expect(sync.mock.calls.map(([target]) => target.symbol)).toEqual(["ONE", "TWO", "THREE"]);
});

test("progress survives the process that produced it", async () => {
  const progressStore = createInMemoryPriceSyncProgressStore();
  const shared = { discover: () => [symbolTarget("ONE")], sync: async () => result(), paceMs: 0, progressStore };
  await createPriceOrchestrator(shared).run("local");

  // A second instance answers the status poll from the row, not from memory it never had.
  await expect(createPriceOrchestrator(shared).status("local")).resolves.toMatchObject({ status: "completed", total: 1, completed: 1, updatedAt: expect.any(String) });
});

test("a fresh run by another instance is left alone rather than doubled", async () => {
  const progressStore = createInMemoryPriceSyncProgressStore();
  await progressStore.put("local", { status: "running", total: 2, completed: 1, remainingSymbols: ["TWO"], currentSymbol: "TWO", waitUntil: null, updatedAt: new Date().toISOString(), message: null, problems: [] });
  const sync = vi.fn(async () => result());
  const orchestrator = createPriceOrchestrator({ discover: () => [symbolTarget("TWO")], sync, paceMs: 0, progressStore });

  await expect(orchestrator.run("local")).resolves.toMatchObject({ status: "running", currentSymbol: "TWO" });
  expect(sync).not.toHaveBeenCalled();
});

test("a stale run is taken over so a dead instance cannot strand the work", async () => {
  const progressStore = createInMemoryPriceSyncProgressStore();
  await progressStore.put("local", { status: "running", total: 1, completed: 0, remainingSymbols: ["TWO"], currentSymbol: "TWO", waitUntil: null, updatedAt: new Date(Date.now() - 120_000).toISOString(), message: null, problems: [] });
  const sync = vi.fn(async () => result());
  const orchestrator = createPriceOrchestrator({ discover: () => [symbolTarget("TWO")], sync, paceMs: 0, progressStore });

  await expect(orchestrator.run("local")).resolves.toMatchObject({ status: "completed" });
  expect(sync).toHaveBeenCalledOnce();
});

test("the budget is the broker sync budget unless prices are given their own", () => {
  const environment = (values: Record<string, string>) => (name: string) => values[name];
  expect(priceSyncDeadlineMs(environment({ INVESTING_SYNC_BUDGET_MS: "240000" }), 1_000)).toBe(241_000);
  expect(priceSyncDeadlineMs(environment({ INVESTING_SYNC_BUDGET_MS: "240000", INVESTING_PRICE_SYNC_BUDGET_MS: "60000" }), 1_000)).toBe(61_000);
  expect(priceSyncDeadlineMs(environment({ VERCEL: "1" }), 1_000)).toBe(46_000);
  // A local or Docker run has no host limit, so it waits out the whole list.
  expect(priceSyncDeadlineMs(environment({}), 1_000)).toBeUndefined();
});
