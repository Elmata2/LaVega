import { expect, test, vi } from "vitest";
import type { Position, Trade } from "@lavega/core";
import { createPriceOrchestrator, discoverPriceSyncTargets, type PriceSyncTarget } from "./priceOrchestrator.js";

const position = (symbol: string, quantity = 1): Position => ({ tenantId: "local", entity: "personal", symbol, quantity, averagePrice: 10, marketPrice: 10, marketValue: 10, currency: "EUR", asOf: "2026-08-20" });
const trade = (symbol: string, date: string): Trade => ({ id: `${symbol}:${date}`, tenantId: "local", entity: "personal", symbol, date, side: "buy", quantity: 1, price: 10, amount: 10, currency: "EUR", commission: 0 });
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
  expect(orchestrator.status("local")).toMatchObject({ status: "waiting", completed: 1, remainingSymbols: ["NEXT"] });
  release();
  await expect(run).resolves.toMatchObject({ status: "completed", completed: 2 });
});

test("empty discovery completes without a provider request", async () => {
  const sync = vi.fn();
  const orchestrator = createPriceOrchestrator({ discover: () => [], sync, paceMs: 0 });

  await expect(orchestrator.run("local")).resolves.toMatchObject({ status: "completed", total: 0, remainingSymbols: [] });
  expect(sync).not.toHaveBeenCalled();
});
