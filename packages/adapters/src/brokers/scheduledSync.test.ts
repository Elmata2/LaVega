import { LOCAL_TENANT_ID, type CredentialStore, type Position } from "@lavega/core";
import { expect, test, vi } from "vitest";
import type { BrokerResult } from "./BrokerAccessAdapter.js";
import { createMemoryBrokerSyncStateStore, syncScheduledBrokers } from "./scheduledSync.js";

const credentials = {
  async getCredentials(tenantId: string, broker: "ibkr" | "trading212") {
    return broker === "trading212"
      ? { broker, tenantId, token: "key", secret: "secret" }
      : { broker, tenantId, token: "key", queryId: "1" };
  },
  async putCredentials() {},
} as unknown as CredentialStore;

function adapters(sync: () => Promise<BrokerResult>) {
  return [{ broker: "trading212" as const, adapter: { sync } }];
}

const empty = (overrides: Partial<BrokerResult>): BrokerResult => ({ positions: [], trades: [], source: "trading-212", problems: [], ...overrides });

function run(sync: () => Promise<BrokerResult>, state: ReturnType<typeof createMemoryBrokerSyncStateStore>, now: Date, force = true) {
  return syncScheduledBrokers({ adapters: adapters(sync), credentials, state, tenantId: LOCAL_TENANT_ID, entity: "BV", force, now });
}

test("a rate-limited sync holds off the next run, even a forced one", async () => {
  const state = createMemoryBrokerSyncStateStore();
  const retryAfter = "2026-08-19T12:05:00.000Z";
  const sync = vi.fn(async () => empty({ problems: ["Trading 212 rate limit reached"], retryAfter }));

  const first = await run(sync, state, new Date("2026-08-19T12:00:00.000Z"));
  expect(first.outcomes[0]?.status).toBe("problem");

  const second = await run(sync, state, new Date("2026-08-19T12:01:00.000Z"));

  expect(sync).toHaveBeenCalledTimes(1);
  expect(second.outcomes[0]?.status).toBe("skipped");
  expect(second.problems).toEqual([`trading212: rate-limited by the broker until ${retryAfter}`]);
});

test("the hold-off expires with the provider window", async () => {
  const state = createMemoryBrokerSyncStateStore();
  const sync = vi.fn(async () => empty({ problems: ["Trading 212 rate limit reached"], retryAfter: "2026-08-19T12:05:00.000Z" }));
  await run(sync, state, new Date("2026-08-19T12:00:00.000Z"));

  await run(sync, state, new Date("2026-08-19T12:06:00.000Z"));

  expect(sync).toHaveBeenCalledTimes(2);
});

test("a problem that is not a rate limit stays immediately retryable", async () => {
  const state = createMemoryBrokerSyncStateStore();
  const sync = vi.fn(async () => empty({ problems: ["credentials are not configured"] }));
  await run(sync, state, new Date("2026-08-19T12:00:00.000Z"));

  const second = await run(sync, state, new Date("2026-08-19T12:00:01.000Z"));

  expect(sync).toHaveBeenCalledTimes(2);
  expect(second.outcomes[0]?.status).toBe("problem");
});

test("a successful sync clears a stored hold-off", async () => {
  const state = createMemoryBrokerSyncStateStore();
  await state.put("trading212", { lastSyncedAt: null, retryAfter: "2026-08-19T12:05:00.000Z" });
  const sync = vi.fn(async () => empty({}));

  await run(sync, state, new Date("2026-08-19T12:06:00.000Z"));

  expect(await state.get("trading212")).toEqual({ lastSyncedAt: "2026-08-19T12:06:00.000Z", retryAfter: null, resume: null });
});

/* A first Trading 212 sync reads the whole order history, page by page, at six
 * requests per minute. Treating every row-level problem as a failed run left
 * `lastSyncedAt` unset, so the next app open replayed that entire history from
 * page one — the sync visibly finished and then started over, forever. */
test("row problems do not condemn the next run to replaying the whole history", async () => {
  const state = createMemoryBrokerSyncStateStore();
  const position: Position = { tenantId: LOCAL_TENANT_ID, entity: "BV", symbol: "AAPL", quantity: 3, averagePrice: 100, marketPrice: 120, marketValue: 360, currency: "EUR", asOf: "2026-08-19" };
  const sync = vi.fn(async () => empty({ positions: [position], problems: ["Trading 212 transaction 87456cce has ambiguous TRANSFER direction"] }));

  await run(sync, state, new Date("2026-08-19T12:00:00.000Z"));
  const second = await run(sync, state, new Date("2026-08-19T12:05:00.000Z"), false);

  expect(sync).toHaveBeenCalledTimes(1);
  expect(second.outcomes[0]?.status).toBe("skipped");
});

test("a truncated history keeps retrying, because nothing complete ever landed", async () => {
  const state = createMemoryBrokerSyncStateStore();
  const sync = vi.fn(async () => empty({ problems: ["Trading 212 order history page failed"], tradesComplete: false }));

  await run(sync, state, new Date("2026-08-19T12:00:00.000Z"));
  await run(sync, state, new Date("2026-08-19T12:05:00.000Z"), false);

  expect(sync).toHaveBeenCalledTimes(2);
});

test("an unfinished history stores the resume cursor and does not set lastSyncedAt", async () => {
  const state = createMemoryBrokerSyncStateStore();
  const resume = { ordersNextPagePath: "/api/v0/equity/history/orders?limit=50&cursor=300" };
  const sync = vi.fn(async () => empty({
    trades: [{ tenantId: LOCAL_TENANT_ID, entity: "BV", date: "2026-08-19", symbol: "AAPL", side: "buy", quantity: 1, price: 10, amount: 10, currency: "EUR", commission: 0, brokerTradeId: "1" }],
    positions: [{ tenantId: LOCAL_TENANT_ID, entity: "BV", symbol: "AAPL", quantity: 3, averagePrice: 100, marketPrice: 120, marketValue: 360, currency: "EUR", asOf: "2026-08-19" }],
    problems: ["Trading 212 sync paused before the host time limit; remaining history resumes on the next run"],
    tradesComplete: false,
    retryAfter: "2026-08-19T12:01:00.000Z",
    resume,
  }));

  await run(sync, state, new Date("2026-08-19T12:00:00.000Z"));

  expect(await state.get("trading212")).toEqual({ lastSyncedAt: null, retryAfter: "2026-08-19T12:01:00.000Z", resume });
});

test("a holdings failure does not set lastSyncedAt, so the next open retries", async () => {
  const state = createMemoryBrokerSyncStateStore();
  const sync = vi.fn(async () => empty({
    trades: [{ tenantId: LOCAL_TENANT_ID, entity: "BV", date: "2026-08-19", symbol: "AAPL", side: "buy", quantity: 1, price: 10, amount: 10, currency: "EUR", commission: 0, brokerTradeId: "1" }],
    problems: ["Trading 212 holdings request failed with HTTP 503"],
    positionsComplete: false,
  }));

  await run(sync, state, new Date("2026-08-19T12:00:00.000Z"));
  const second = await run(sync, state, new Date("2026-08-19T12:05:00.000Z"), false);

  expect(await state.get("trading212")).toMatchObject({ lastSyncedAt: null });
  expect(sync).toHaveBeenCalledTimes(2);
  expect(second.outcomes[0]?.status).toBe("problem");
});

test("the next run after the cooldown passes the stored resume into sync", async () => {
  const state = createMemoryBrokerSyncStateStore();
  const resume = { ordersNextPagePath: "/api/v0/equity/history/orders?limit=50&cursor=300" };
  await state.put("trading212", { lastSyncedAt: null, retryAfter: "2026-08-19T12:01:00.000Z", resume });
  const sync = vi.fn(async () => empty({}));

  await run(sync, state, new Date("2026-08-19T12:01:01.000Z"));

  expect(sync).toHaveBeenCalledWith({ entity: "BV", resume });
});
