import { expect, test } from "vitest";
import { createApp } from "./app.js";
import {
  createMemorySyncRunStore,
  createSyncRun,
  MAX_HOPS,
  parseSyncRunRow,
  toSyncState,
  type LaneOutcome,
  type SyncRunLaneReads,
} from "./syncRun.js";

const laneReads = (): SyncRunLaneReads => ({
  vault: "unlocked",
  holdings: {
    status: "completed",
    syncedAt: null,
    waitUntil: null,
    message: null,
    positionsRead: 0,
  },
  history: {
    status: "idle",
    syncedAt: null,
    waitUntil: null,
    message: null,
    pages: 0,
    ordersRead: 0,
    historyProgress: null,
  },
  prices: {
    status: "idle",
    syncedAt: null,
    waitUntil: null,
    message: null,
    total: 0,
    completed: 0,
    currentSymbol: null,
    remainingSymbols: [],
  },
  problems: [],
});

function harness(
  options: {
    lanes?: Partial<{
      holdings: () => Promise<LaneOutcome>;
      history: () => Promise<LaneOutcome>;
      prices: () => Promise<LaneOutcome>;
    }>;
    env?: Record<string, string>;
    chain?: number[];
  } = {},
) {
  const store = createMemorySyncRunStore();
  const calls: string[] = [];
  const continuations: number[] = [];
  const runs: Array<Promise<unknown>> = [];
  let holdings = options.lanes?.holdings ?? (async () => ({ status: "completed", pending: false }));
  const syncRun = createSyncRun({
    store,
    now: () => Date.now(),
    lanes: {
      holdings: async () => {
        calls.push("holdings");
        return holdings();
      },
      history: async () => {
        calls.push("history");
        return options.lanes?.history?.() ?? { status: "completed", pending: false };
      },
      prices: async () => {
        calls.push("prices");
        return options.lanes?.prices?.() ?? { status: "completed", pending: false };
      },
      letter: async () => undefined,
    },
    readLanes: async () => laneReads(),
    continueRun: async (hop) => {
      continuations.push(hop);
      options.chain?.push(hop);
    },
    background: async (work) => {
      runs.push(work);
    },
    reportProblem: () => undefined,
    env: (name) => options.env?.[name],
  });
  return { syncRun, store, calls, continuations, runs };
}

test("two refresh intents one second apart make one run and one set of lane calls", async () => {
  const { syncRun, calls, runs } = harness();
  const first = await syncRun.requestRefresh(false);
  const second = await syncRun.requestRefresh(false);
  expect(first.claimed).toBe(true);
  expect(second.claimed).toBe(false);
  await Promise.all(runs);
  expect(calls).toEqual(["holdings", "history", "prices"]);
});

test("a stale lease is taken over by the next refresh", async () => {
  const { syncRun, store, calls } = harness();
  await store.claim(
    {
      phase: "running",
      lease: { id: "dead", heartbeatAt: new Date(Date.now() - 120_000).toISOString() },
      runId: "old",
      hop: 0,
      startedAt: new Date(Date.now() - 120_000).toISOString(),
      resumeAt: null,
      finishedAt: null,
      outcome: null,
      force: false,
    },
    new Date(Date.now() - 60_000).toISOString(),
  );
  const result = await syncRun.requestRefresh(false);
  expect(result.claimed).toBe(true);
  await syncRun.runNow(false).catch(() => undefined);
  expect(calls.length).toBeGreaterThan(0);
});

test("a wait inside the budget sleeps and finishes in the same invocation", async () => {
  let waited = false;
  const { syncRun, store, calls, runs, continuations } = harness({
    lanes: {
      prices: async () => {
        if (!waited) {
          waited = true;
          return { status: "waiting", pending: true, waitUntilMs: Date.now() + 5 };
        }
        return { status: "completed", pending: false };
      },
    },
  });
  const result = await syncRun.requestRefresh(false);
  await Promise.all(runs);
  const row = await store.get();
  expect(result.claimed).toBe(true);
  expect(calls).toEqual(["holdings", "history", "prices", "prices"]);
  expect(continuations).toEqual([]);
  expect(row?.outcome).toBe("done");
  expect(row?.lease).toBeNull();
});

test("a wait longer than the budget releases the lease and asks for one continuation", async () => {
  const { syncRun, store, continuations, runs } = harness({
    lanes: {
      history: async () => ({
        status: "waiting",
        pending: true,
        waitUntilMs: Date.now() + 230_000,
      }),
    },
    env: { INVESTING_SYNC_CHAIN: "on", INVESTING_SYNC_BUDGET_MS: "240000" },
  });
  await syncRun.requestRefresh(false);
  await Promise.all(runs);
  const row = await store.get();
  expect(continuations).toEqual([1]);
  expect(row?.resumeAt).not.toBeNull();
  expect(row?.lease).toBeNull();
  expect(row?.outcome).toBeNull();
});

test("the chain is off by default: no self-request, the resume point stays for the next trigger", async () => {
  const { syncRun, store, continuations, runs } = harness({
    env: { INVESTING_SYNC_BUDGET_MS: "240000" },
    lanes: {
      history: async () => ({
        status: "waiting",
        pending: true,
        waitUntilMs: Date.now() + 230_000,
      }),
    },
  });
  await syncRun.requestRefresh(false);
  await Promise.all(runs);
  expect(continuations).toEqual([]);
  expect((await store.get())?.resumeAt).not.toBeNull();
});

test("at the hop limit work left stops the run instead of continuing", async () => {
  const { syncRun, store, continuations, runs } = harness({
    lanes: {
      history: async () => ({
        status: "waiting",
        pending: true,
        waitUntilMs: Date.now() + 230_000,
      }),
    },
    env: { INVESTING_SYNC_CHAIN: "on", INVESTING_SYNC_BUDGET_MS: "240000" },
  });
  await syncRun.requestRefresh(false);
  await Promise.all(runs);
  const row = await store.get();
  const accepted = await syncRun.acceptContinue({ runId: row!.runId!, hop: MAX_HOPS });
  expect(accepted).toBe(true);
  await Promise.all(runs);
  const stopped = await store.get();
  expect(stopped?.outcome).toBe("stopped-at-hop-limit");
  expect(stopped?.lease).toBeNull();
  expect(continuations).toEqual([1]);
});

test("the state read reports the run and its outcome", async () => {
  const { syncRun } = harness();
  await syncRun.requestRefresh(false);
  const state = await syncRun.readState();
  expect(state.run.id).not.toBeNull();
  expect(state.run.hop).toBe(0);
  expect(state.vault).toBe("unlocked");
});

test("parseSyncRunRow strips lease from terminal rows and toSyncState marks terminal rows inactive", () => {
  const nowMs = Date.parse("2026-11-26T12:00:00.000Z");
  const parsed = parseSyncRunRow({
    lease: { id: "stale-lease", heartbeatAt: new Date(nowMs).toISOString() },
    runId: "run-1",
    hop: 20,
    startedAt: new Date(nowMs - 10_000).toISOString(),
    finishedAt: new Date(nowMs).toISOString(),
    outcome: "stopped-at-hop-limit",
    force: false,
  });
  expect(parsed?.phase).toBe("terminal");
  expect(parsed?.lease).toBeNull();
  const view = toSyncState(parsed, laneReads(), nowMs);
  expect(view.active).toBe(false);
  expect(view.run).toEqual({ id: "run-1", hop: 20, outcome: "stopped-at-hop-limit" });
});

test("app drive advances from completed history to prices lane even when progress.history is populated", async () => {
  const lanesCalled: string[] = [];
  process.env.CRON_SECRET = "test-secret";
  try {
    const app = createApp({
      brokerSync: async (_force, lanes) => {
        lanesCalled.push(...lanes);
        return { outcomes: [], problems: [], committed: {} };
      },
      brokerSyncStatus: async () => ({
        status: "completed",
        pages: 1,
        ordersRead: 5,
        positionsRead: 2,
        waitUntil: null,
        remaining: null,
        updatedAt: new Date().toISOString(),
        message: "Done",
        history: {
          trading212: {
            lastSyncedAt: new Date().toISOString(),
            retryAfter: null,
            ordersComplete: true,
            transactionsComplete: true,
            dividendsComplete: true,
          },
          ibkr: {
            lastSyncedAt: null,
            retryAfter: null,
            ordersComplete: true,
            transactionsComplete: true,
            dividendsComplete: true,
          },
        },
      }),
      marketDataConsentStore: {
        get: async (tenantId) => ({
          tenantId,
          accepted: true,
          decidedAt: new Date().toISOString(),
          disclosureVersion: "v1",
        }),
        set: async () => undefined,
      },
      priceSyncTargets: () => {
        lanesCalled.push("prices");
        return [];
      },
    });
    const response = await app.request("/api/sync/drive", {
      method: "POST",
      headers: {
        authorization: "Bearer test-secret",
        "content-type": "application/json",
      },
      body: JSON.stringify({ force: false }),
    });
    expect(response.status).toBe(200);
    expect(lanesCalled).toEqual(["holdings", "history", "prices"]);
  } finally {
    delete process.env.CRON_SECRET;
  }
});
