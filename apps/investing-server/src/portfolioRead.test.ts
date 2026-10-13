import { expect, test, vi } from "vitest";
import { ManagedRuntime } from "effect";
import {
  createBrokerDataCache,
  createInMemoryPriceStore,
  type BrokerDataSnapshot,
  type PriceStore,
} from "@lavega/adapters";
import { emptyInvestingDashboard, type InvestingDashboardData, type PriceBar } from "@lavega/core";
import {
  PortfolioRead,
  PortfolioReadError,
  portfolioReadLayer,
  type PortfolioReadSources,
} from "./portfolioRead.js";
import { createBrokerSnapshotReader } from "./brokerSnapshotReader.js";
import { createDashboardCache, type DashboardCache } from "./dashboardCache.js";
import type { ServerTiming } from "./serverTiming.js";
import type { BrokerSyncState, BrokerSyncProgressRecord } from "@lavega/adapters";

const TENANT = "tenant";
const DASHBOARD_CACHE_TTL_MS = 15_000;

function snapshot(quantity = 1): BrokerDataSnapshot {
  return {
    trading212: {
      positions: [
        {
          symbol: "AAPL",
          quantity,
          averagePrice: 100,
          marketPrice: 100,
          marketValue: quantity * 100,
          currency: "EUR",
          entity: "personal",
          asOf: "2026-09-06",
        },
      ],
      trades: [],
      dividends: [],
    },
  };
}

type Snapshots = {
  get(key: string): Promise<{ version: number; dashboard: unknown }>;
  put(key: string, version: number, dashboard: unknown): Promise<void>;
};

type SyncStateReader = Pick<
  {
    get(broker: string): Promise<BrokerSyncState>;
    progress(broker: string): Promise<BrokerSyncProgressRecord | null>;
  },
  "get" | "progress"
>;

function syncState(
  state: BrokerSyncState = { lastSyncedAt: null, resume: null },
  progress: BrokerSyncProgressRecord | null = null,
): SyncStateReader {
  return { get: async () => state, progress: async () => progress };
}

const healthyFx = {
  getLatestRate: async () => ({ rate: undefined, problems: [] as string[] }),
  getHistoricalRates: async () => ({ rates: [], problems: [] as string[] }),
} as unknown as PortfolioReadSources["fxProvider"];

function makeSources(
  input: {
    data?: BrokerDataSnapshot;
    loadBrokerData?: () => Promise<void>;
    snapshots?: Snapshots | null;
    dashboardCache?: DashboardCache;
    sync?: SyncStateReader;
    priceStore?: PriceStore;
    priceDataVersion?: () => number;
    benchmarks?: readonly string[];
  } = {},
): PortfolioReadSources {
  const brokerData = createBrokerDataCache(input.data ?? {});
  const brokerSnapshot = createBrokerSnapshotReader({
    cache: brokerData,
    load: async () => ({}),
    hosted: false,
    isSyncing: () => false,
    ttlMs: DASHBOARD_CACHE_TTL_MS,
  });
  return {
    priceStore: input.priceStore ?? createInMemoryPriceStore(),
    loadBrokerData: input.loadBrokerData ?? (async () => undefined),
    brokerData,
    brokerSnapshot,
    dashboardSnapshots: input.snapshots ?? null,
    dashboardCache: input.dashboardCache ?? createDashboardCache(),
    syncState: input.sync ?? syncState(),
    fxProvider: healthyFx,
    benchmarks: () => input.benchmarks ?? [],
    priceDataVersion: input.priceDataVersion ?? (() => 0),
  };
}

async function runRead(
  sources: PortfolioReadSources,
  input: { symbol?: string; timing?: ServerTiming } = {},
): Promise<InvestingDashboardData> {
  const runtime = ManagedRuntime.make(portfolioReadLayer(sources));
  return runtime.runPromise(PortfolioRead.use((read) => read.read({ tenantId: TENANT, ...input })));
}

function phaseRecorder(): { timing: ServerTiming; phases: string[] } {
  const phases: string[] = [];
  return {
    phases,
    timing: {
      measure: async (name, run) => {
        phases.push(name);
        return run();
      },
      header: () => phases.join(", "),
    },
  };
}

test("a current stored dashboard is served without reading the vault", async () => {
  const stored = { ...emptyInvestingDashboard(), dataVersion: 7, problems: ["from the store"] };
  const loadBrokerData = vi.fn(async () => undefined);
  const snapshots: Snapshots = {
    get: async () => ({ version: 1, dashboard: stored }),
    put: vi.fn(async () => undefined),
  };
  const priceStore = createInMemoryPriceStore();
  const priceRead = vi.spyOn(priceStore, "getRange");

  const result = await runRead(
    makeSources({ data: snapshot(), loadBrokerData, snapshots, priceStore }),
  );

  expect(result).toBe(stored);
  expect(loadBrokerData).not.toHaveBeenCalled();
  expect(priceRead).not.toHaveBeenCalled();
});

test("a failed price read returns a dashboard plus a problem and stores nothing", async () => {
  const snapshots: Snapshots = {
    get: async () => ({ version: 5, dashboard: null }),
    put: vi.fn(async () => undefined),
  };
  const priceStore = createInMemoryPriceStore();
  vi.spyOn(priceStore, "getRange").mockRejectedValue(new Error("timeout exceeded"));

  const result = await runRead(makeSources({ data: snapshot(), snapshots, priceStore }));

  expect(result.positions.length).toBeGreaterThan(0);
  expect(result.problems).toContain("Price data could not be fully loaded");
  expect(snapshots.put).not.toHaveBeenCalled();
});

test("a dashboard a sync replaced mid-build is stored under the version it was built against and never served", async () => {
  const store = new Map<string, { version: number; dashboard: unknown }>();
  let sourceVersion = 1;
  const snapshots: Snapshots = {
    get: async (key) => {
      const held = store.get(key);
      return {
        version: sourceVersion,
        dashboard: held?.version === sourceVersion ? held.dashboard : null,
      };
    },
    put: async (key, version, dashboard) => {
      store.set(key, { version, dashboard });
    },
  };
  const loadBrokerData = vi.fn(async () => undefined);
  const priceStore = createInMemoryPriceStore();
  vi.spyOn(priceStore, "getRange").mockImplementation(async () => {
    // The price read moves the source version while the dashboard is building.
    sourceVersion += 1;
    return [];
  });
  const sources = makeSources({ data: snapshot(), loadBrokerData, snapshots, priceStore });

  await runRead(sources);
  // The build stored under the version it read before the source moved on.
  expect(store.get("")?.version).toBe(1);
  expect(sourceVersion).toBe(2);
  // The repository stops serving that blob once the source version moved past it.
  expect((await snapshots.get("")).dashboard).toBeNull();

  sources.dashboardCache.invalidate();
  await runRead(sources);
  expect(loadBrokerData).toHaveBeenCalledTimes(2);
});

test("Trading 212 cash is reconciled from the merged history and its proof is surfaced", async () => {
  const data: BrokerDataSnapshot = {
    trading212: {
      positions: [],
      trades: [],
      dividends: [],
      cashBalances: [
        {
          entity: "personal",
          broker: "trading212",
          currency: "EUR",
          amount: 100,
          asOf: "2026-09-06",
        },
      ],
      cashFlows: [
        {
          id: "deposit-1",
          entity: "personal",
          broker: "trading212",
          date: "2026-09-05",
          currency: "EUR",
          amount: 100,
          kind: "deposit",
        },
      ],
    },
  };

  const proven = await runRead(
    makeSources({
      data,
      sync: syncState({ lastSyncedAt: "2026-09-06T00:00:00.000Z", resume: null }),
    }),
  );
  expect(
    proven.problems.some((problem) => problem.startsWith("Trading 212 cash history unproven")),
  ).toBe(false);

  const unproven = await runRead(
    makeSources({
      data,
      sync: syncState({ lastSyncedAt: null, resume: { ordersNextPagePath: "/next" } }),
    }),
  );
  expect(unproven.problems).toContain(
    "Trading 212 cash history unproven: Trading 212 cash history is not complete: pagination is unfinished",
  );
});

test("a symbol selects its detail and an unseen symbol returns no detail", async () => {
  const sources = makeSources({ data: snapshot() });
  const selected = await runRead(sources, { symbol: "aapl" });
  const unknown = await runRead(sources, { symbol: "closed-unknown" });

  expect(selected.position).toMatchObject({ symbol: "AAPL", status: "open" });
  expect(unknown.position).toBeNull();
});

test("a configured benchmark keeps its curated display name", async () => {
  const result = await runRead(makeSources({ data: snapshot(), benchmarks: ["^GDAXI"] }));
  expect(result.benchmarks[0]?.name).toBe("DAX");
});

test("a durable sync problem reaches the dashboard even though this read did not run the sync", async () => {
  const result = await runRead(
    makeSources({
      data: snapshot(),
      sync: syncState(
        { lastSyncedAt: null, resume: null },
        {
          status: "problem",
          message: "trading212: a synchronization is already running",
          updatedAt: "2026-09-06T00:00:00.000Z",
          leaseId: null,
        },
      ),
    }),
  );
  expect(result.problems).toContain("trading212: a synchronization is already running");
});

test("Server-Timing names a built dashboard's phases and a stored one's, and nothing else", async () => {
  const built = phaseRecorder();
  const snapshots: Snapshots = {
    get: async () => ({ version: 1, dashboard: null }),
    put: async () => undefined,
  };
  await runRead(makeSources({ data: snapshot(), snapshots }), { timing: built.timing });
  expect(built.phases).toEqual(["stored", "broker", "prices", "fx", "build", "store"]);

  const storedDashboard = { ...emptyInvestingDashboard(), dataVersion: 3 };
  const stored = phaseRecorder();
  await runRead(
    makeSources({
      data: snapshot(),
      snapshots: {
        get: async () => ({ version: 1, dashboard: storedDashboard }),
        put: async () => undefined,
      },
    }),
    { timing: stored.timing },
  );
  expect(stored.phases).toEqual(["stored"]);
});

test("the in-process cache recomputes only after its data version changes", async () => {
  const priceStore = createInMemoryPriceStore();
  const getRange = vi.spyOn(priceStore, "getRange");
  const sources = makeSources({ data: snapshot(), priceStore });

  await runRead(sources);
  const afterFirst = getRange.mock.calls.length;
  await runRead(sources);
  expect(getRange).toHaveBeenCalledTimes(afterFirst);

  sources.dashboardCache.invalidate();
  await runRead(sources);
  expect(getRange.mock.calls.length).toBeGreaterThan(afterFirst);
});

test("the read never hands Postgres a year-zero date", async () => {
  const priceStore = createInMemoryPriceStore();
  const getRange = vi
    .spyOn(priceStore, "getRange")
    .mockImplementation(async (_tenantId, _symbol, from, to) => {
      for (const date of [from, to])
        if (date?.startsWith("0000-"))
          throw new Error(`date/time field value out of range: "${date}"`);
      return [] as PriceBar[];
    });

  const result = await runRead(
    makeSources({ data: snapshot(), priceStore, benchmarks: ["^GSPC"] }),
  );

  expect(getRange).toHaveBeenCalled();
  for (const [, , from, to] of getRange.mock.calls) {
    expect(String(from ?? "")).not.toMatch(/^0000-/);
    expect(String(to ?? "")).not.toMatch(/^0000-/);
  }
  expect(result.problems.join("\n")).not.toContain("date/time field value out of range");
});

test("the read fails with a typed error when there is no broker data at all", async () => {
  const runtime = ManagedRuntime.make(
    portfolioReadLayer(
      makeSources({
        loadBrokerData: async () => {
          throw new Error("credential vault is locked");
        },
      }),
    ),
  );

  const error = await runtime
    .runPromise(PortfolioRead.use((read) => read.read({ tenantId: TENANT })))
    .then(
      () => null,
      (cause: unknown) => cause,
    );

  expect(error).toBeInstanceOf(PortfolioReadError);
  expect((error as PortfolioReadError).message).toBe("credential vault is locked");
});
