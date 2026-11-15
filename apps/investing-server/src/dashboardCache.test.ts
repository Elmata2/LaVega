import { expect, test, vi } from "vitest";
import { createDashboardCache } from "./dashboardCache.js";

test("dashboard cache reuses a tenant query inside its TTL", () => {
  let now = 0;
  const cache = createDashboardCache({ now: () => now });
  const data = { positions: ["AAPL"] } as never;

  cache.set({ tenantId: "user-a", key: "\u0000SPY" }, data);
  now = 14_999;

  expect(cache.get({ tenantId: "user-a", key: "\u0000SPY" })).toBe(data);
  expect(cache.get({ tenantId: "user-b", key: "\u0000SPY" })).toBeNull();
  now = 15_000;
  expect(cache.get({ tenantId: "user-a", key: "\u0000SPY" })).toBeNull();
});

test("dashboard cache invalidates only changed tenant", () => {
  const cache = createDashboardCache();
  const first = { positions: ["AAPL"] } as never;
  const second = { positions: ["MSFT"] } as never;

  cache.set({ tenantId: "user-a", key: "" }, first);
  cache.set({ tenantId: "user-b", key: "" }, second);
  cache.invalidate("user-a");

  expect(cache.get({ tenantId: "user-a", key: "" })).toBeNull();
  expect(cache.get({ tenantId: "user-b", key: "" })).toBe(second);
});

test("dashboard cache drops entries after a source update", () => {
  const cache = createDashboardCache();
  cache.set({ tenantId: "user-a", key: "" }, { positions: ["AAPL"] } as never);
  cache.invalidate();

  expect(cache.get({ tenantId: "user-a", key: "" })).toBeNull();
});

test("dashboard cache shares concurrent loads", async () => {
  const cache = createDashboardCache();
  let resolve!: (value: never) => void;
  const loader = vi.fn(
    () =>
      new Promise<never>((done) => {
        resolve = done;
      }),
  );
  const first = cache.load({ tenantId: "user-a", key: "" }, loader);
  const second = cache.load({ tenantId: "user-a", key: "" }, loader);
  resolve({ positions: ["AAPL"] } as never);
  expect(await first).toBe(await second);
  expect(loader).toHaveBeenCalledOnce();
});
