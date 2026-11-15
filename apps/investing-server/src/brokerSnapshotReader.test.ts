import { expect, test, vi } from "vitest";
import { createBrokerDataCache } from "@lavega/adapters";
import { createBrokerSnapshotReader } from "./brokerSnapshotReader.js";
import type { RuntimeBrokerDataSnapshot } from "./runtimeBrokerData.js";

const snapshot = (symbol: string): RuntimeBrokerDataSnapshot => ({
  trading212: {
    positions: [
      {
        symbol,
        entity: "personal",
        quantity: 1,
        averagePrice: 10,
        marketPrice: 10,
        marketValue: 10,
        currency: "EUR",
        asOf: "2026-09-01",
      },
    ],
    trades: [],
    dividends: [],
  },
});

test("overlapping hosted reads share one load and tenants keep separate snapshots", async () => {
  let now = 0;
  vi.spyOn(Date, "now").mockImplementation(() => now);
  const loads = new Map<string, ReturnType<typeof vi.fn>>();
  const readers = ["a", "b"].map((tenant) => {
    const cache = createBrokerDataCache(snapshot(tenant));
    const load = vi.fn(async () => snapshot(`${tenant}-new`));
    loads.set(tenant, load);
    return createBrokerSnapshotReader({
      cache,
      load,
      hosted: true,
      isSyncing: () => false,
      ttlMs: 15_000,
    });
  });
  now = 15_000;
  const [first, second, other] = await Promise.all([
    readers[0]!.read("fresh"),
    readers[0]!.read("cached"),
    readers[1]!.read("fresh"),
  ]);
  expect(first.positions[0]?.symbol).toBe("a-new");
  expect(second.positions[0]?.symbol).toBe("a-new");
  expect(other.positions[0]?.symbol).toBe("b-new");
  expect(loads.get("a")).toHaveBeenCalledOnce();
  expect(loads.get("b")).toHaveBeenCalledOnce();
  vi.restoreAllMocks();
});

test("strict read fails during local sync; cached read keeps in-process state", async () => {
  let syncing = true;
  const load = vi.fn(async () => snapshot("remote"));
  const reader = createBrokerSnapshotReader({
    cache: createBrokerDataCache(snapshot("local")),
    load,
    hosted: true,
    isSyncing: () => syncing,
    ttlMs: 0,
  });
  expect((await reader.read("cached")).positions[0]?.symbol).toBe("local");
  await expect(reader.read("fresh")).rejects.toThrow("Broker data sync is still running");
  expect(load).not.toHaveBeenCalled();
  syncing = false;
  expect((await reader.read("fresh")).positions[0]?.symbol).toBe("remote");
});
