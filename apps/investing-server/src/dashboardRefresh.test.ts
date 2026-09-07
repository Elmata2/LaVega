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

vi.mock("./neonStores.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("./neonStores.js")>();
  return {
    ...original,
    createNeonBrokerSyncStateStore: () => ({
      get: async (broker: string) => ({
        lastSyncedAt: null,
        resume: broker === "trading212" ? persistence.resume : null,
      }),
      put: async () => undefined,
    }),
  };
});

vi.mock("@lavega/adapters", async (importOriginal) => {
  const original = await importOriginal<typeof import("@lavega/adapters")>();
  return {
    ...original,
    createFrankfurterFxProvider: () => ({ getLatestRate: async () => ({ problems: [] }) }),
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
    expect(persistence.reads).toHaveBeenCalledTimes(1);
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
  expect(persistence.snapshots.get("tenant")?.trading212?.trades).toEqual(
    updated.trading212!.trades,
  );
  expect(persistence.reads).toHaveBeenCalledTimes(2);
});
