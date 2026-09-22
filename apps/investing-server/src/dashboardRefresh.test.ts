import { afterEach, expect, test, vi } from "vitest";
import { createInMemoryPriceStore } from "@lavega/adapters";
import type { BrokerSyncResume } from "@lavega/adapters";
import type { InvestingDashboardData } from "@lavega/core";
import type { RuntimeBrokerDataSnapshot } from "./runtimeBrokerData.js";
import type { RuntimeCredentialStore } from "./credentialStore.js";
import { createRuntimeApp } from "./index.js";

const persistence = vi.hoisted(() => ({
  snapshots: new Map<string, RuntimeBrokerDataSnapshot>(),
  reads: vi.fn(),
  credentials: vi.fn(async () => null),
  connected: false,
  resume: null as BrokerSyncResume | null,
  /* Stored dashboards, standing in for investing.dashboard_snapshots. Null is
   * a database without the table, so the other tests keep building. */
  dashboards: null as Map<string, { version: number; dashboard: unknown }> | null,
  sourceVersion: 0,
}));

vi.mock("@lavega/database", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@lavega/database")>()),
  createDashboardSnapshotRepository: (_db: unknown, tenantId: string) => ({
    async get(key: string) {
      if (!persistence.dashboards) throw new Error("no dashboard table");
      const stored = persistence.dashboards.get(`${tenantId}\u0000${key}`);
      const version = persistence.sourceVersion;
      return { version, dashboard: stored?.version === version ? stored.dashboard : null };
    },
    async put(key: string, version: number, dashboard: unknown) {
      persistence.dashboards?.set(`${tenantId}\u0000${key}`, { version, dashboard });
    },
  }),
}));

vi.mock("./credentialStore.js", () => ({
  runtimeDatabase: () => ({}),
  credentialsArePerTenant: () => true,
  createRuntimeCredentialStore: (tenantId: string): RuntimeCredentialStore => ({
    status: async () => "unlocked",
    setup: async () => undefined,
    unlock: async () => true,
    lock: () => undefined,
    getCredentials: ((candidateTenantId: string, broker: string) =>
      persistence.connected && broker === "trading212"
        ? Promise.resolve({ broker, tenantId: candidateTenantId, token: "test", secret: "test" })
        : persistence.credentials()) as RuntimeCredentialStore["getCredentials"],
    putCredentials: async () => undefined,
    getBrokerData: async () => {
      persistence.reads(tenantId);
      return structuredClone(persistence.snapshots.get(tenantId) ?? {});
    },
    putBrokerData: async (snapshot) => {
      persistence.snapshots.set(tenantId, structuredClone(snapshot));
    },
  }),
}));

/* The Neon operation store reads the stored broker data when it claims and
 * writes it when it commits, so the fake keeps those on the same map the
 * credential store uses. */
vi.mock("./neonStores.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("./neonStores.js")>();
  const { createMemoryBrokerSyncStateStore } = await import("@lavega/adapters");
  return {
    ...original,
    createNeonBrokerSyncStateStore: (_database: unknown, tenantId: string) => {
      const leases = createMemoryBrokerSyncStateStore();
      const state = (broker: string) => ({
        lastSyncedAt: null,
        resume: broker === "trading212" ? persistence.resume : null,
      });
      return {
        ...leases,
        get: async (broker: string) => state(broker),
        claim: async (broker: string, input: Parameters<typeof leases.claim>[1]) => {
          const claim = await leases.claim(broker as "trading212", input);
          persistence.reads(tenantId);
          return {
            ...claim,
            state: state(broker),
            data: persistence.snapshots.get(tenantId)?.[broker as "trading212"] ?? null,
          };
        },
        commit: async (broker: string, input: Parameters<typeof leases.commit>[1]) => {
          const committed = await leases.commit(broker as "trading212", input);
          if (committed && input.data)
            persistence.snapshots.set(tenantId, {
              ...persistence.snapshots.get(tenantId),
              [broker]: structuredClone(input.data),
            });
          return committed;
        },
      };
    },
  };
});

vi.mock("@lavega/adapters", async (importOriginal) => {
  const original = await importOriginal<typeof import("@lavega/adapters")>();
  return {
    ...original,
    createFrankfurterFxProvider: () => ({
      getLatestRate: async () => ({ problems: [] }),
      getHistoricalRates: async () => ({ rates: [], problems: [] }),
    }),
  };
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  persistence.snapshots.clear();
  persistence.reads.mockClear();
  persistence.credentials.mockReset().mockResolvedValue(null);
  persistence.connected = false;
  persistence.resume = null;
  persistence.dashboards = null;
  persistence.sourceVersion = 0;
});

function snapshot(quantity: number): RuntimeBrokerDataSnapshot {
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

test("warm dashboard instances reload shared broker and price data after fifteen seconds", async () => {
  let now = Date.now();
  vi.spyOn(Date, "now").mockImplementation(() => now);
  persistence.snapshots.set("tenant", snapshot(1));
  const priceStore = createInMemoryPriceStore();
  const priceReads = vi.spyOn(priceStore, "getRange");
  const first = await createRuntimeApp({ priceStore, resolveTenantId: () => "tenant" });
  const second = await createRuntimeApp({ priceStore, resolveTenantId: () => "tenant" });
  const read = async (app: typeof first) => {
    const response = await app.request("/api/investing/dashboard");
    expect(response.status).toBe(200);
    return response.json() as Promise<InvestingDashboardData>;
  };
  expect((await read(first)).positions[0]?.quantity).toBe(1);
  expect((await read(second)).positions[0]?.quantity).toBe(1);
  const initialPriceReads = priceReads.mock.calls.length;
  persistence.snapshots.set("tenant", snapshot(2));
  now += 14_999;
  expect((await read(first)).positions[0]?.quantity).toBe(1);
  expect(priceReads).toHaveBeenCalledTimes(initialPriceReads);
  expect(persistence.reads).toHaveBeenCalledTimes(2);
  now += 1;
  expect((await read(first)).positions[0]?.quantity).toBe(2);
  expect((await read(second)).positions[0]?.quantity).toBe(2);
  expect(persistence.reads).toHaveBeenCalledTimes(4);
  expect(priceReads.mock.calls.length).toBeGreaterThan(initialPriceReads);
});

test("a stored dashboard is served by any instance without reading the vault", async () => {
  persistence.dashboards = new Map();
  persistence.snapshots.set("tenant", snapshot(1));
  const priceStore = createInMemoryPriceStore();
  const read = async () => {
    const app = await createRuntimeApp({ priceStore, resolveTenantId: () => "tenant" });
    const response = await app.request("/api/investing/dashboard");
    return ((await response.json()) as InvestingDashboardData).positions[0]?.quantity;
  };

  expect(await read()).toBe(1);
  expect(persistence.reads).toHaveBeenCalledTimes(1);

  expect(await read()).toBe(1);
  expect(persistence.reads).toHaveBeenCalledTimes(1);

  persistence.snapshots.set("tenant", snapshot(2));
  persistence.sourceVersion += 1;
  expect(await read()).toBe(2);
  expect(persistence.reads).toHaveBeenCalledTimes(2);
});

test("Server-Timing tells a built dashboard from a stored one", async () => {
  persistence.dashboards = new Map();
  persistence.snapshots.set("tenant", snapshot(1));
  const priceStore = createInMemoryPriceStore();
  const phases = async () => {
    const app = await createRuntimeApp({ priceStore, resolveTenantId: () => "tenant" });
    const response = await app.request("/api/investing/dashboard");
    return [...(response.headers.get("Server-Timing") ?? "").matchAll(/(\w+);dur=/g)].map(
      (match) => match[1],
    );
  };

  expect(await phases()).toEqual([
    "runtime",
    "stored",
    "broker",
    "prices",
    "fx",
    "build",
    "store",
    "total",
  ]);
  expect(await phases()).toEqual(["runtime", "stored", "total"]);
});

test("requests that never show positions do not read the broker snapshots", async () => {
  persistence.snapshots.set("tenant", snapshot(1));
  const app = await createRuntimeApp({
    priceStore: createInMemoryPriceStore(),
    resolveTenantId: () => "tenant",
  });

  expect((await app.request("/api/brokers/sync/status")).status).toBe(200);
  expect((await app.request("/api/brokers/credentials/status")).status).toBe(200);
  expect(persistence.reads).not.toHaveBeenCalled();

  const dashboard = await app.request("/api/investing/dashboard");
  expect(((await dashboard.json()) as InvestingDashboardData).positions[0]?.quantity).toBe(1);
  expect(persistence.reads).toHaveBeenCalledTimes(1);
});

test("dashboard refresh does not replace broker data during a local sync", async () => {
  let now = Date.now();
  vi.spyOn(Date, "now").mockImplementation(() => now);
  persistence.snapshots.set("tenant", snapshot(1));
  const app = await createRuntimeApp({
    priceStore: createInMemoryPriceStore(),
    resolveTenantId: () => "tenant",
  });
  await app.request("/api/investing/dashboard");
  let release!: (value: null) => void;
  let started!: () => void;
  const waiting = new Promise<void>((resolve) => {
    started = resolve;
  });
  persistence.credentials.mockImplementationOnce(() => {
    started();
    return new Promise<null>((resolve) => {
      release = resolve;
    });
  });
  const sync = app.request("/api/brokers/sync", { method: "POST" });
  await waiting;
  try {
    now += 15_000;
    persistence.snapshots.set("tenant", snapshot(2));
    const response = await app.request("/api/investing/dashboard");
    const data = (await response.json()) as InvestingDashboardData;
    expect(data.positions[0]?.quantity).toBe(1);
    // The dashboard, plus the claim the running sync took: the refresh read none.
    expect(persistence.reads).toHaveBeenCalledTimes(2);
  } finally {
    release(null);
    await sync;
  }
  const response = await app.request("/api/investing/dashboard");
  const data = (await response.json()) as InvestingDashboardData;
  expect(data.positions[0]?.quantity).toBe(2);
});

test("a resumed sync merges the latest persisted history instead of its warm snapshot", async () => {
  const initial = snapshot(1);
  persistence.snapshots.set("tenant", initial);
  const app = await createRuntimeApp({
    priceStore: createInMemoryPriceStore(),
    resolveTenantId: () => "tenant",
  });
  await app.request("/api/investing/dashboard");
  const updated = snapshot(2);
  updated.trading212!.trades = [
    {
      id: "trading212:1",
      brokerTradeId: "1",
      entity: "personal",
      symbol: "AAPL",
      date: "2026-09-05",
      side: "buy",
      quantity: 2,
      price: 100,
      amount: 200,
      currency: "EUR",
      commission: 0,
    },
  ];
  persistence.snapshots.set("tenant", updated);
  persistence.connected = true;
  persistence.resume = {
    ordersComplete: true,
    transactionsComplete: true,
    dividendsNextPagePath: "https://live.trading212.com/dividends-next",
  };
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL | Request) => {
      const path = new URL(
        typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
      ).pathname;
      const body = path.endsWith("/positions")
        ? []
        : path.endsWith("/summary")
          ? { currency: "EUR", cash: { availableToTrade: 100, inPies: 0, reservedForOrders: 0 } }
          : { items: [] };
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }),
  );
  const response = await app.request("/api/brokers/sync", { method: "POST" });
  expect(response.status).toBe(200);
  // Same trades, same ids; loading a snapshot only adds the broker its own key
  // already named.
  expect(persistence.snapshots.get("tenant")?.trading212?.trades).toEqual(
    updated.trading212!.trades.map((trade) => ({ ...trade, broker: "trading212" })),
  );
  // The dashboard, plus one claim per scheduled broker.
  expect(persistence.reads).toHaveBeenCalledTimes(3);
});
