import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test, vi } from "vitest";
import { createInMemoryPriceStore, createMemoryBrokerSyncStateStore } from "@lavega/adapters";
import { createRuntimeApp, createRuntimeBrokerCredentialSetup, createRuntimeBrokerDataCache, createRuntimeBrokerSync } from "./index.js";
import { createFileCredentialStore } from "./fileCredentialStore.js";

const servers: ReturnType<typeof createServer>[] = [];

afterEach(async () => {
  vi.unstubAllEnvs();
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
});

async function serve(handler: (request: IncomingMessage, response: ServerResponse) => void): Promise<string> {
  const server = createServer(handler);
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Loopback server did not open a port");
  return `http://127.0.0.1:${address.port}`;
}

function json(response: ServerResponse, body: unknown) {
  response.writeHead(200, { "content-type": "application/json" });
  response.end(JSON.stringify(body));
}

function fakeVault(status: "empty" | "locked" | "unlocked") {
  return {
    status: vi.fn(async () => status),
    setup: vi.fn(async () => undefined),
    unlock: vi.fn(async () => true),
    lock: vi.fn(),
    putCredentials: vi.fn(async () => undefined),
  } as unknown as ReturnType<typeof createFileCredentialStore>;
}

test("credential setup creates encrypted vault and stores IBKR credentials", async () => {
  const vault = fakeVault("empty");
  await createRuntimeBrokerCredentialSetup(vault)({ broker: "ibkr", token: "flex-token", queryId: "123456", passphrase: "vault-passphrase" });

  expect(vault.setup).toHaveBeenCalledWith("vault-passphrase");
  expect(vault.putCredentials).toHaveBeenCalledWith({ broker: "ibkr", tenantId: "local", token: "flex-token", queryId: "123456" });
});

test("credential setup rejects wrong passphrase before replacing stored credentials", async () => {
  const vault = fakeVault("unlocked");
  vault.unlock = vi.fn(async () => false);

  await expect(createRuntimeBrokerCredentialSetup(vault)({ broker: "trading212", token: "api-key", secret: "api-secret", passphrase: "wrong" })).rejects.toThrow("Vault passphrase is incorrect");
  expect(vault.lock).not.toHaveBeenCalled();
  expect(vault.putCredentials).not.toHaveBeenCalled();
});

test("runtime broker sync coalesces concurrent runs", async () => {
  let orderRequests = 0;
  let positionRequests = 0;
  const baseUrl = await serve(async (request, response) => {
    await new Promise((resolve) => setTimeout(resolve, 10));
    if ((request.url ?? "").startsWith("/api/v0/equity/history/orders")) {
      orderRequests += 1;
      return json(response, { items: [{ id: 1, ticker: "AAPL", direction: "BUY", filledQuantity: 1, fillPrice: 10, totalCost: 10, currency: "EUR", dateExecuted: "2026-08-18T10:15:00Z" }] });
    }
    positionRequests += 1;
    return json(response, [{ ticker: "AAPL", quantity: 1, averagePrice: 10, currentPrice: 10, marketValue: 10, currency: "EUR", asOf: "2026-08-18T10:15:00Z" }]);
  });
  vi.stubEnv("TRADING212_BASE_URL", baseUrl);
  const credentials = {
    getCredentials: vi.fn(async (_tenantId: string, broker: string) => broker === "trading212" ? { broker: "trading212", tenantId: "local", token: "token", secret: "secret" } : null),
  } as unknown as ReturnType<typeof createFileCredentialStore>;
  const sync = createRuntimeBrokerSync(undefined, credentials, createMemoryBrokerSyncStateStore());

  const [first, second] = await Promise.all([sync(true), sync(true)]);

  expect(orderRequests).toBe(1);
  expect(positionRequests).toBe(1);
  expect(first.problems).toEqual(second.problems);
});

test("cached broker skip retains last successful positions", () => {
  const cache = createRuntimeBrokerDataCache();
  cache.apply({
    outcomes: [{ broker: "trading212", status: "synced", lastSyncedAt: "2026-08-19T14:00:00.000Z", result: { positions: [{ tenantId: "local", symbol: "AAPL", quantity: 1, averagePrice: 10, marketPrice: 10, marketValue: 10, currency: "EUR", entity: "BV", asOf: "2026-08-19" }], trades: [], source: "trading-212", problems: [] } }],
    problems: [],
  });
  cache.apply({
    outcomes: [{ broker: "trading212", status: "skipped", lastSyncedAt: "2026-08-19T14:00:00.000Z", result: null }],
    problems: [],
  });

  expect(cache.read().positions).toHaveLength(1);
  expect(cache.read().positions[0]?.symbol).toBe("AAPL");
});

test("runtime broker cache restores encrypted snapshot after restart", () => {
  const first = createRuntimeBrokerDataCache();
  first.apply({
    outcomes: [{ broker: "trading212", status: "synced", lastSyncedAt: "2026-08-19T14:00:00.000Z", result: { positions: [{ tenantId: "local", symbol: "AAPL", quantity: 1, averagePrice: 10, marketPrice: 10, marketValue: 10, currency: "EUR", entity: "BV", asOf: "2026-08-19" }], trades: [], source: "trading-212", problems: [] } }],
    problems: [],
  });

  const restarted = createRuntimeBrokerDataCache(first.snapshot());

  expect(restarted.read().positions).toHaveLength(1);
  expect(restarted.read().positions[0]?.symbol).toBe("AAPL");
});

test("runtime broker cache persists cash facts and increments data version", () => {
  const cache = createRuntimeBrokerDataCache();
  const before = cache.read().dataVersion;
  cache.apply({
    outcomes: [{
      broker: "ibkr",
      status: "synced",
      lastSyncedAt: "2026-08-19T14:00:00.000Z",
      result: {
        positions: [],
        trades: [],
        dividends: [],
        cashBalances: [{ tenantId: "local", entity: "BV", broker: "ibkr", currency: "EUR", amount: 250, asOf: "2026-08-19" }],
        cashFlows: [{ id: "flow", tenantId: "local", entity: "BV", broker: "ibkr", date: "2026-08-18", currency: "EUR", amount: 250, kind: "deposit" }],
        source: "ibkr-flex",
        problems: [],
      },
    }],
    problems: [],
  });

  expect(cache.read()).toMatchObject({ dataVersion: before + 1, cashBalances: [{ amount: 250 }], cashFlows: [{ id: "flow" }] });
  expect(createRuntimeBrokerDataCache(cache.snapshot()).read()).toMatchObject({ cashBalances: [{ amount: 250 }], cashFlows: [{ id: "flow" }] });
});

test("runtime dashboard recomputes only after data version changes", async () => {
  vi.stubEnv("INVESTING_DEV_FIXTURE", "1");
  vi.stubEnv("LAVEGA_VAULT_FILE", join(tmpdir(), `lavega-missing-${Date.now()}.json`));
  const store = createInMemoryPriceStore();
  const getRange = vi.spyOn(store, "getRange");
  const runtimeApp = await createRuntimeApp({ priceStore: store });

  const first = await runtimeApp.request("/api/investing/dashboard");
  const callsAfterFirst = getRange.mock.calls.length;
  const second = await runtimeApp.request("/api/investing/dashboard");
  expect(first.status).toBe(200);
  expect(second.status).toBe(200);
  expect(getRange).toHaveBeenCalledTimes(callsAfterFirst);

  await runtimeApp.request("/api/prices/cache", { method: "DELETE" });
  await runtimeApp.request("/api/investing/dashboard");
  expect(getRange.mock.calls.length).toBeGreaterThan(callsAfterFirst);
});

test("problem result cannot overwrite last successful broker snapshot", () => {
  const cache = createRuntimeBrokerDataCache();
  const result = (symbol: string) => ({ positions: [{ tenantId: "local", symbol, quantity: 1, averagePrice: 10, marketPrice: 10, marketValue: 10, currency: "EUR", entity: "BV", asOf: "2026-08-19" }], trades: [], source: "trading-212", problems: [] });
  cache.apply({ outcomes: [{ broker: "trading212", status: "synced", lastSyncedAt: "2026-08-19T14:00:00.000Z", result: result("AAPL") }], problems: [] });
  cache.apply({ outcomes: [{ broker: "trading212", status: "problem", lastSyncedAt: "2026-08-19T14:00:00.000Z", result: { ...result("MSFT"), problems: ["partial sync"] } }], problems: ["trading212: partial sync"] });

  expect(cache.read().positions[0]?.symbol).toBe("AAPL");
});

test("runtime unlocks persisted broker credentials after restart", async () => {
  const directory = await mkdtemp(join(tmpdir(), "lavega-runtime-vault-"));
  const filePath = join(directory, "credentials.json");
  try {
    const first = createFileCredentialStore(filePath);
    await first.setup("vault-passphrase");
    await first.putCredentials({ broker: "trading212", tenantId: "local", token: "api-key", secret: "api-secret" });

    const baseUrl = await serve((request, response) => {
      if ((request.url ?? "").startsWith("/api/v0/equity/history/orders")) return json(response, { items: [] });
      return json(response, []);
    });
    vi.stubEnv("LAVEGA_VAULT_FILE", filePath);
    vi.stubEnv("LAVEGA_VAULT_PASSPHRASE", "vault-passphrase");
    vi.stubEnv("TRADING212_BASE_URL", baseUrl);

    const runtimeApp = await createRuntimeApp({ priceStore: createInMemoryPriceStore() });
    const response = await runtimeApp.request("/api/brokers/sync?force=true", { method: "POST" });
    const result = await response.json() as { problems: string[] };
    const progress = await (await runtimeApp.request("/api/brokers/sync/status")).json() as { status: string; pages: number; ordersRead: number; positionsRead: number };

    expect(result.problems).not.toContain("trading212: credentials are not configured");
    expect(progress).toMatchObject({ status: "completed", pages: 1, ordersRead: 0, positionsRead: 0 });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
