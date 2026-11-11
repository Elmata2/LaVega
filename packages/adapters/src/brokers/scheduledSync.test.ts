import { type CredentialStore, type Position } from "@lavega/core";
import { expect, test, vi } from "vitest";
import type { BrokerResult, BrokerSyncRequest } from "./BrokerAccessAdapter.js";
import {
  createMemoryBrokerSyncStateStore,
  syncScheduledBrokers,
  type BrokerSyncOperationStore,
  type BrokerSyncState,
} from "./scheduledSync.js";

const credentials = {
  async getCredentials(tenantId: string, broker: "ibkr" | "trading212") {
    return broker === "trading212"
      ? { broker, tenantId, token: "key", secret: "secret" }
      : { broker, tenantId, token: "key", queryId: "1" };
  },
  async putCredentials() {},
} as unknown as CredentialStore;

function adapters(sync: (request: BrokerSyncRequest) => Promise<BrokerResult>) {
  return [{ broker: "trading212" as const, adapter: { sync } }];
}

/** A credential store whose answer for each broker the test controls, including
 *  a thrown error for a broker whose stored credentials cannot be decrypted. */
function credentialsWith(get: (broker: "ibkr" | "trading212") => unknown): CredentialStore {
  return {
    async getCredentials(_tenantId: string, broker: "ibkr" | "trading212") {
      return get(broker);
    },
    async putCredentials() {},
  } as unknown as CredentialStore;
}

const empty = (overrides: {
  positions?: BrokerResult["sections"]["positions"]["rows"];
  trades?: BrokerResult["sections"]["trades"]["rows"];
  problems?: string[];
  tradesComplete?: boolean;
  positionsComplete?: boolean;
  cashBalancesComplete?: boolean;
  resume?: BrokerResult["resume"];
  retryAfter?: string;
  fullStreams?: BrokerResult["fullStreams"];
}): BrokerResult => ({
  sections: {
    positions: {
      status: overrides.positionsComplete === false ? "unavailable" : "complete",
      rows: overrides.positions ?? [],
    },
    trades: {
      status: overrides.tradesComplete === false ? "partial" : "complete",
      rows: overrides.trades ?? [],
    },
    dividends: { status: "complete", rows: [] },
    cashBalances: {
      status: overrides.cashBalancesComplete === false ? "unavailable" : "complete",
      rows: [],
    },
    cashFlows: { status: "complete", rows: [] },
  },
  source: "trading-212",
  ...(overrides.fullStreams ? { fullStreams: overrides.fullStreams } : {}),
  problems: overrides.problems ?? [],
  resume: overrides.resume,
  retryAfter: overrides.retryAfter,
});

test("order rebuild starts at first page, then resumes saved cursor", async () => {
  const operations = createMemoryBrokerSyncStateStore();
  const sync = vi.fn(async () =>
    empty({
      tradesComplete: false,
      resume: {
        ordersNextPagePath: "/api/v0/equity/history/orders?cursor=2",
        transactionsComplete: true,
        dividendsComplete: true,
      },
    }),
  );
  const input = {
    lanes: ["holdings", "history"] as const,
    adapters: adapters(sync),
    credentials,
    operations,
    tenantId: "local",
    entity: "personal",
    force: true,
    now: new Date("2026-09-23T12:00:00.000Z"),
  };

  await syncScheduledBrokers({ ...input, rebuildOrders: true });
  expect(sync).toHaveBeenLastCalledWith(
    expect.objectContaining({
      resume: { ordersComplete: false, transactionsComplete: true, dividendsComplete: true },
    }),
  );

  await syncScheduledBrokers(input);
  expect(sync).toHaveBeenLastCalledWith(
    expect.objectContaining({
      resume: {
        ordersNextPagePath: "/api/v0/equity/history/orders?cursor=2",
        transactionsComplete: true,
        dividendsComplete: true,
      },
    }),
  );
});

/** Stores a cursor the way a finished run would, so a test can start from it. */
async function seed(store: BrokerSyncOperationStore, state: BrokerSyncState) {
  const progress = { status: "completed" as const, message: null, updatedAt: null, leaseId: null };
  await store.claim("trading212", {
    leaseId: "seed",
    staleBefore: "9999-12-31T23:59:59.999Z",
    progress,
  });
  await store.commit("trading212", {
    leaseId: "seed",
    credentialGeneration: 1,
    state,
    progress,
    data: null,
  });
}

function run(
  sync: (request: BrokerSyncRequest) => Promise<BrokerResult>,
  operations: BrokerSyncOperationStore,
  now: Date,
  force = true,
) {
  return syncScheduledBrokers({
    lanes: ["holdings", "history"],
    adapters: adapters(sync),
    credentials,
    operations,
    tenantId: "local",
    entity: "BV",
    force,
    now,
  });
}

test("a rate-limited sync holds off the next run, even a forced one", async () => {
  const state = createMemoryBrokerSyncStateStore();
  const retryAfter = "2026-08-19T12:05:00.000Z";
  const sync = vi.fn(async () =>
    empty({ problems: ["Trading 212 rate limit reached"], retryAfter }),
  );

  const first = await run(sync, state, new Date("2026-08-19T12:00:00.000Z"));
  expect(first.outcomes[0]?.status).toBe("problem");

  const second = await run(sync, state, new Date("2026-08-19T12:01:00.000Z"));

  expect(sync).toHaveBeenCalledTimes(1);
  expect(second.outcomes[0]?.status).toBe("skipped");
  expect(second.problems).toEqual([`trading212: rate-limited by the broker until ${retryAfter}`]);
});

test("the hold-off expires with the provider window", async () => {
  const state = createMemoryBrokerSyncStateStore();
  const sync = vi.fn(async () =>
    empty({ problems: ["Trading 212 rate limit reached"], retryAfter: "2026-08-19T12:05:00.000Z" }),
  );
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
  await seed(state, { lastSyncedAt: null, retryAfter: "2026-08-19T12:05:00.000Z" });
  const sync = vi.fn(async () => empty({}));

  await run(sync, state, new Date("2026-08-19T12:06:00.000Z"));

  expect(await state.get("trading212")).toEqual({
    lastSyncedAt: "2026-08-19T12:06:00.000Z",
    holdingsSyncedAt: "2026-08-19T12:06:00.000Z",
    retryAfter: null,
    resume: null,
  });
});

/* A first Trading 212 sync reads the whole order history, page by page, at six
 * requests per minute. Treating every row-level problem as a failed run left
 * `lastSyncedAt` unset, so the next app open replayed that entire history from
 * page one — the sync visibly finished and then started over, forever. */
test("row problems do not condemn the next run to replaying the whole history", async () => {
  const state = createMemoryBrokerSyncStateStore();
  const position: Position = {
    entity: "BV",
    symbol: "AAPL",
    quantity: 3,
    averagePrice: 100,
    marketPrice: 120,
    marketValue: 360,
    currency: "EUR",
    asOf: "2026-08-19",
  };
  const sync = vi.fn(async () =>
    empty({
      positions: [position],
      problems: [
        "Trading 212 transaction future-1 has unknown type NEW_KIND; provider sign was preserved",
      ],
    }),
  );

  await run(sync, state, new Date("2026-08-19T12:00:00.000Z"));
  // Five minutes later the holdings lane is due again (cheap, two requests) but
  // the history lane is not: the whole-history replay is what must not recur.
  const second = await run(sync, state, new Date("2026-08-19T12:05:00.000Z"), false);

  expect(sync).toHaveBeenCalledTimes(2);
  expect(sync).toHaveBeenLastCalledWith(expect.objectContaining({ lanes: ["holdings"] }));
  expect(second.outcomes[0]?.status).toBe("problem");
});

test("a truncated history keeps retrying, because nothing complete ever landed", async () => {
  const state = createMemoryBrokerSyncStateStore();
  const sync = vi.fn(async () =>
    empty({ problems: ["Trading 212 order history page failed"], tradesComplete: false }),
  );

  await run(sync, state, new Date("2026-08-19T12:00:00.000Z"));
  await run(sync, state, new Date("2026-08-19T12:05:00.000Z"), false);

  expect(sync).toHaveBeenCalledTimes(2);
});

test("an unfinished history stores the resume cursor and does not set lastSyncedAt", async () => {
  const state = createMemoryBrokerSyncStateStore();
  const resume = { ordersNextPagePath: "/api/v0/equity/history/orders?limit=50&cursor=300" };
  const sync = vi.fn(async () =>
    empty({
      trades: [
        {
          entity: "BV",
          date: "2026-08-19",
          symbol: "AAPL",
          side: "buy",
          quantity: 1,
          price: 10,
          amount: 10,
          currency: "EUR",
          commission: 0,
          brokerTradeId: "1",
        },
      ],
      positions: [
        {
          entity: "BV",
          symbol: "AAPL",
          quantity: 3,
          averagePrice: 100,
          marketPrice: 120,
          marketValue: 360,
          currency: "EUR",
          asOf: "2026-08-19",
        },
      ],
      problems: [
        "Trading 212 sync paused before the host time limit; remaining history resumes on the next run",
      ],
      tradesComplete: false,
      retryAfter: "2026-08-19T12:01:00.000Z",
      resume,
    }),
  );

  await run(sync, state, new Date("2026-08-19T12:00:00.000Z"));

  expect(await state.get("trading212")).toEqual({
    lastSyncedAt: null,
    holdingsSyncedAt: "2026-08-19T12:00:00.000Z",
    retryAfter: "2026-08-19T12:01:00.000Z",
    resume,
  });
});

test("a holdings failure does not set lastSyncedAt, so the next open retries", async () => {
  const state = createMemoryBrokerSyncStateStore();
  const sync = vi.fn(async () =>
    empty({
      trades: [
        {
          entity: "BV",
          date: "2026-08-19",
          symbol: "AAPL",
          side: "buy",
          quantity: 1,
          price: 10,
          amount: 10,
          currency: "EUR",
          commission: 0,
          brokerTradeId: "1",
        },
      ],
      problems: ["Trading 212 holdings request failed with HTTP 503"],
      positionsComplete: false,
    }),
  );

  await run(sync, state, new Date("2026-08-19T12:00:00.000Z"));
  const second = await run(sync, state, new Date("2026-08-19T12:05:00.000Z"), false);

  // History completed, so the history gate is satisfied; holdings did not, so
  // the next open retries the holdings lane specifically.
  expect(await state.get("trading212")).toMatchObject({ lastSyncedAt: "2026-08-19T12:00:00.000Z" });
  expect((await state.get("trading212")).holdingsSyncedAt).toBeUndefined();
  expect(sync).toHaveBeenCalledTimes(2);
  expect(sync).toHaveBeenLastCalledWith(expect.objectContaining({ lanes: ["holdings"] }));
  expect(second.outcomes[0]?.status).toBe("problem");
});

test("the next run after the cooldown passes the stored resume into sync", async () => {
  const state = createMemoryBrokerSyncStateStore();
  const resume = { ordersNextPagePath: "/api/v0/equity/history/orders?limit=50&cursor=300" };
  await seed(state, { lastSyncedAt: null, retryAfter: "2026-08-19T12:01:00.000Z", resume });
  const sync = vi.fn(async () => empty({}));

  await run(sync, state, new Date("2026-08-19T12:01:01.000Z"));

  expect(sync).toHaveBeenCalledWith(
    expect.objectContaining({
      entity: "BV",
      lanes: ["holdings", "history"],
      resume,
      deadlineMs: undefined,
    }),
  );
});

test("the scheduler passes the same absolute deadline to the adapter", async () => {
  const state = createMemoryBrokerSyncStateStore();
  const sync = vi.fn(async () => empty({}));
  const deadlineMs = 1_797_854_400_000;

  await syncScheduledBrokers({
    lanes: ["holdings", "history"],
    adapters: adapters(sync),
    credentials,
    operations: state,
    tenantId: "local",
    entity: "BV",
    force: true,
    now: new Date("2026-08-19T12:00:00.000Z"),
    deadlineMs,
  });

  expect(sync).toHaveBeenCalledWith(
    expect.objectContaining({
      entity: "BV",
      lanes: ["holdings", "history"],
      deadlineMs,
    }),
  );
});

test("a second run while one is in flight waits for it instead of syncing again", async () => {
  const state = createMemoryBrokerSyncStateStore();
  let release!: () => void;
  const held = new Promise<void>((resolve) => (release = resolve));
  const sync = vi.fn(async () => {
    await held;
    return empty({});
  });

  const first = run(sync, state, new Date("2026-08-19T12:00:00.000Z"));
  const second = await run(sync, state, new Date("2026-08-19T12:00:01.000Z"));
  release();
  await first;

  expect(sync).toHaveBeenCalledTimes(1);
  expect(second.outcomes[0]?.status).toBe("skipped");
  expect(second.problems).toEqual(["trading212: a synchronization is already running"]);
});

test("a run that lost its lease stores neither its data nor its cursor", async () => {
  const state = createMemoryBrokerSyncStateStore();
  let release!: () => void;
  const held = new Promise<void>((resolve) => (release = resolve));
  const slow = vi.fn(async () => {
    await held;
    return empty({ positions: [{ id: "p1" } as unknown as Position] });
  });

  const evicted = run(slow, state, new Date("2026-08-19T12:00:00.000Z"));
  await run(async () => empty({}), state, new Date("2026-08-19T12:20:00.000Z"));
  release();
  const result = await evicted;

  expect(result.outcomes[0]?.status).toBe("skipped");
  expect(result.problems).toEqual([
    "trading212: the result was discarded, this run is no longer current",
  ]);
  expect(result.committed.trading212).toBeUndefined();
  expect(await state.get("trading212")).toMatchObject({
    lastSyncedAt: "2026-08-19T12:20:00.000Z",
  });
});

/* The owner never set up IBKR. A broker with no stored credentials is not a
 * sync failure, so it must not appear in `problems` or flip the stored
 * progress to "problem" — that is what turned the Status card red for
 * something the owner never asked LaVega to sync. */
test("a broker with no configured credentials is skipped, not a problem", async () => {
  const operations = createMemoryBrokerSyncStateStore();
  const ibkrSync = vi.fn();
  const trading212Sync = vi.fn(async () => empty({}));
  const creds = credentialsWith((broker) =>
    broker === "ibkr"
      ? null
      : { broker: "trading212", tenantId: "local", token: "key", secret: "secret" },
  );

  const result = await syncScheduledBrokers({
    lanes: ["holdings", "history"],
    adapters: [
      { broker: "ibkr", adapter: { sync: ibkrSync } },
      { broker: "trading212", adapter: { sync: trading212Sync } },
    ],
    credentials: creds,
    operations,
    tenantId: "local",
    entity: "BV",
    force: true,
    now: new Date("2026-09-30T09:00:00.000Z"),
  });

  expect(ibkrSync).not.toHaveBeenCalled();
  expect(result.outcomes.find((outcome) => outcome.broker === "ibkr")?.status).toBe("skipped");
  expect(result.outcomes.find((outcome) => outcome.broker === "trading212")?.status).toBe("synced");
  expect(result.problems).toEqual([]);
  expect((await operations.progress("ibkr"))?.status).not.toBe("problem");
});

/* Credentials that were configured and now fail to decrypt are a real
 * problem, unlike a broker that was never set up: `getCredentials` throws
 * instead of returning null, and that must still surface with a message. */
test("credentials that fail to decrypt stay a problem with a message", async () => {
  const operations = createMemoryBrokerSyncStateStore();
  const creds = credentialsWith((broker) => {
    if (broker === "ibkr") throw new Error("credentials could not be decrypted");
    return { broker: "trading212", tenantId: "local", token: "key", secret: "secret" };
  });

  const result = await syncScheduledBrokers({
    lanes: ["holdings", "history"],
    adapters: [{ broker: "ibkr", adapter: { sync: vi.fn() } }],
    credentials: creds,
    operations,
    tenantId: "local",
    entity: "BV",
    force: true,
    now: new Date("2026-09-30T09:00:00.000Z"),
  });

  expect(result.outcomes[0]?.status).toBe("problem");
  expect(result.problems).toEqual(["ibkr: credentials could not be decrypted"]);
  const stored = await operations.progress("ibkr");
  expect(stored?.status).toBe("problem");
  expect(stored?.message).toBe("ibkr: credentials could not be decrypted");
});

/* A prior run (or a prior version of this code) can leave a stored "problem"
 * with no message. The next run, even one that only skips, must overwrite it
 * rather than leaving the Status card red forever. */
test("a stored stale problem clears on the next run", async () => {
  const operations = createMemoryBrokerSyncStateStore();
  await operations.claim("ibkr", {
    leaseId: "stale",
    staleBefore: "2000-01-01T00:00:00.000Z",
    progress: {
      status: "running",
      message: null,
      updatedAt: "2026-09-29T16:40:00.000Z",
      leaseId: "stale",
    },
  });
  await operations.release("ibkr", "stale", {
    status: "problem",
    message: null,
    updatedAt: "2026-09-29T16:40:00.000Z",
    leaseId: "stale",
  });
  expect((await operations.progress("ibkr"))?.status).toBe("problem");

  await syncScheduledBrokers({
    lanes: ["holdings", "history"],
    adapters: [{ broker: "ibkr", adapter: { sync: vi.fn() } }],
    credentials: credentialsWith(() => null),
    operations,
    tenantId: "local",
    entity: "BV",
    force: true,
    now: new Date("2026-09-30T09:00:00.000Z"),
  });

  expect((await operations.progress("ibkr"))?.status).not.toBe("problem");
});

/* --- two freshness lanes (#304) -------------------------------------------- */

test("each lane has its own interval: holdings at 60 s, history at 15 min", async () => {
  const state = createMemoryBrokerSyncStateStore();
  const calls: Array<Record<string, unknown>> = [];
  const sync = vi.fn(async (request: Record<string, unknown>) => {
    calls.push(request);
    return empty({ fullStreams: ["orders", "transactions", "dividends"], positions: [] });
  });

  await run(sync, state, new Date("2026-08-19T12:00:00.000Z"));
  expect(calls[0]).toMatchObject({ lanes: ["holdings", "history"] });

  // 61 s later only the holdings lane is due: it retries, history does not.
  await run(sync, state, new Date("2026-08-19T12:01:01.000Z"), false);
  expect(calls[1]).toMatchObject({ lanes: ["holdings"] });
  expect(calls[1]).not.toHaveProperty("resume");

  // Inside the 15-minute history interval nothing runs.
  await run(sync, state, new Date("2026-08-19T12:02:00.000Z"), false);
  expect(sync).toHaveBeenCalledTimes(2);

  // Past it, history runs as a tail (the first run recorded a full read) and
  // holdings is due too.
  await run(sync, state, new Date("2026-08-19T12:16:00.000Z"), false);
  expect(calls[2]).toMatchObject({ lanes: ["holdings", "history"] });
  expect(calls[2]?.fullReadStreams).toEqual([]);
  expect(calls[2]?.knownHistory).toMatchObject({
    tradeIds: new Set(),
    cashFlowIds: new Set(),
    dividendIds: new Set(),
  });
});

test("a first history run with no per-stream full-read record reads every stream in full", async () => {
  const state = createMemoryBrokerSyncStateStore();
  const calls: Array<Record<string, unknown>> = [];
  const sync = vi.fn(async (request: Record<string, unknown>) => {
    calls.push(request);
    return empty({ fullStreams: ["orders", "transactions", "dividends"] });
  });

  await syncScheduledBrokers({
    lanes: ["history"],
    adapters: adapters(sync),
    credentials,
    operations: state,
    tenantId: "local",
    entity: "BV",
    force: true,
    now: new Date("2026-08-19T12:00:00.000Z"),
  });

  expect(calls[0]).toMatchObject({
    lanes: ["history"],
    fullReadStreams: ["orders", "transactions", "dividends"],
  });
  expect(calls[0]).not.toHaveProperty("knownHistory");
  // Only the holdings lane was not requested, so the cursor still advances.
  expect((await state.get("trading212")).lastSyncedAt).toBe("2026-08-19T12:00:00.000Z");
  expect((await state.get("trading212")).fullReadAt).toEqual({
    orders: "2026-08-19T12:00:00.000Z",
    transactions: "2026-08-19T12:00:00.000Z",
    dividends: "2026-08-19T12:00:00.000Z",
  });
});

test("a holdings-only run reads two requests' worth of sections and leaves history untouched", async () => {
  const state = createMemoryBrokerSyncStateStore();
  await seed(state, { lastSyncedAt: "2026-08-01T00:00:00.000Z" });
  const calls: Array<Record<string, unknown>> = [];
  const sync = vi.fn(async (request: Record<string, unknown>) => {
    calls.push(request);
    return empty({ positions: [] });
  });

  await syncScheduledBrokers({
    lanes: ["holdings"],
    adapters: adapters(sync),
    credentials,
    operations: state,
    tenantId: "local",
    entity: "BV",
    now: new Date("2026-08-19T12:00:00.000Z"),
  });

  expect(calls).toHaveLength(1);
  expect(calls[0]).toMatchObject({ lanes: ["holdings"] });
  expect(calls[0]).not.toHaveProperty("resume");
  expect(calls[0]).not.toHaveProperty("fullReadStreams");
  const stored = await state.get("trading212");
  expect(stored.holdingsSyncedAt).toBe("2026-08-19T12:00:00.000Z");
  // The history gate was not touched by a holdings read.
  expect(stored.lastSyncedAt).toBe("2026-08-01T00:00:00.000Z");
});

test("forced holdings keep a 5 s floor; forced history bypasses the 15 min gate", async () => {
  const state = createMemoryBrokerSyncStateStore();
  const sync = vi.fn(async () => empty({}));
  await syncScheduledBrokers({
    lanes: ["holdings"],
    adapters: adapters(sync),
    credentials,
    operations: state,
    tenantId: "local",
    entity: "BV",
    now: new Date("2026-08-19T12:00:00.000Z"),
  });
  expect(sync).toHaveBeenCalledTimes(1);

  // Forced inside 5 s: skipped, no problem line.
  const early = await syncScheduledBrokers({
    lanes: ["holdings"],
    adapters: adapters(sync),
    credentials,
    operations: state,
    tenantId: "local",
    entity: "BV",
    force: true,
    now: new Date("2026-08-19T12:00:03.000Z"),
  });
  expect(sync).toHaveBeenCalledTimes(1);
  expect(early.outcomes[0]?.status).toBe("skipped");
  expect(early.problems).toEqual([]);

  // Forced after the floor: due.
  await syncScheduledBrokers({
    lanes: ["holdings"],
    adapters: adapters(sync),
    credentials,
    operations: state,
    tenantId: "local",
    entity: "BV",
    force: true,
    now: new Date("2026-08-19T12:00:06.000Z"),
  });
  expect(sync).toHaveBeenCalledTimes(2);

  await syncScheduledBrokers({
    lanes: ["history"],
    adapters: adapters(sync),
    credentials,
    operations: state,
    tenantId: "local",
    entity: "BV",
    force: true,
    now: new Date("2026-08-19T12:00:30.000Z"),
  });
  expect(sync).toHaveBeenCalledTimes(3);
});

test("IBKR reads its one Flex statement only on the history lane", async () => {
  const state = createMemoryBrokerSyncStateStore();
  const ibkr = vi.fn(async () => empty({}));
  const onlyHoldings = await syncScheduledBrokers({
    lanes: ["holdings"],
    adapters: [{ broker: "ibkr", adapter: { sync: ibkr } }],
    credentials,
    operations: state,
    tenantId: "local",
    entity: "BV",
    now: new Date("2026-08-19T12:00:00.000Z"),
  });
  expect(ibkr).not.toHaveBeenCalled();
  expect(onlyHoldings.outcomes[0]?.status).toBe("skipped");
  expect(onlyHoldings.problems).toEqual([]);

  await syncScheduledBrokers({
    lanes: ["history"],
    adapters: [{ broker: "ibkr", adapter: { sync: ibkr } }],
    credentials,
    operations: state,
    tenantId: "local",
    entity: "BV",
    now: new Date("2026-08-19T12:00:00.000Z"),
  });
  expect(ibkr).toHaveBeenCalledTimes(1);
  expect(ibkr).toHaveBeenCalledWith(expect.objectContaining({ lanes: ["history"] }));
});
