import { afterEach, expect, test, vi } from "vitest";
import { createInMemoryPriceStore } from "@lavega/adapters";
import { UnreadableBrokerCredentialsError, type EncryptedBrokerRepository } from "@lavega/database";
import { createNeonCredentialStore } from "./neonCredentialStore.js";

const storeFactory = vi.hoisted(() => vi.fn());
vi.mock("./credentialStore.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./credentialStore.js")>()),
  createRuntimeCredentialStore: storeFactory,
  credentialsArePerTenant: () => true,
  runtimeDatabase: () => null,
}));

import { createRuntimeApp } from "./index.js";

const tenantId = "user-123";
type Row = { credentials: unknown; snapshot: unknown | null; credentialGeneration: number };

function repository(unreadable: string[]): EncryptedBrokerRepository {
  const rows = new Map<string, Row>();
  rows.set("ibkr", {
    credentials: { broker: "ibkr", tenantId, token: "ibkr-key", queryId: "123" },
    snapshot: {
      positions: [
        {
          symbol: "AAPL",
          entity: "personal",
          quantity: 1,
          averagePrice: 10,
          marketPrice: 10,
          marketValue: 10,
          currency: "USD",
          asOf: "2026-09-01",
        },
      ],
      trades: [],
      dividends: [],
    },
    credentialGeneration: 1,
  });
  rows.set("trading212", { credentials: {}, snapshot: null, credentialGeneration: 1 });
  return {
    async get<T>(broker: string) {
      if (unreadable.includes(broker)) throw new UnreadableBrokerCredentialsError();
      const row = rows.get(broker);
      return row ? { ...row, credentials: row.credentials as T } : null;
    },
    // One key seals both blobs, so a broker with unreadable credentials has
    // an unreadable snapshot too, which snapshots() drops.
    async snapshots() {
      return Object.fromEntries(
        [...rows]
          .filter(([broker, row]) => row.snapshot && !unreadable.includes(broker))
          .map(([broker, row]) => [broker, row.snapshot]),
      );
    },
    async put(broker, credentials) {
      unreadable.splice(unreadable.indexOf(broker), unreadable.includes(broker) ? 1 : 0);
      rows.set(broker, {
        credentials,
        snapshot: null,
        credentialGeneration: (rows.get(broker)?.credentialGeneration ?? 0) + 1,
      });
    },
    async putSnapshot(broker, snapshot, generation) {
      const row = rows.get(broker);
      if (!row || row.credentialGeneration !== generation) return false;
      rows.set(broker, { ...row, snapshot });
      return true;
    },
  };
}

afterEach(() => storeFactory.mockReset());

test.each([
  [["trading212"], "readable"],
  [["ibkr", "trading212"], "unreadable"],
] as const)(
  "runtime routes remain available with unreadable brokers",
  async (broken, ibkrState) => {
    const unreadable = [...broken];
    storeFactory.mockImplementation(() =>
      createNeonCredentialStore(repository(unreadable), tenantId),
    );
    const app = await createRuntimeApp({
      priceStore: createInMemoryPriceStore(),
      resolveTenantId: () => tenantId,
    });

    const status = await app.request("/api/brokers/credentials/status");
    expect(status.status).toBe(200);
    expect(await status.json()).toMatchObject({
      status: "unlocked",
      brokers: {
        ibkr: ibkrState,
        trading212: "unreadable",
      },
    });
    const dashboard = await app.request("/api/investing/dashboard?symbol=AAPL");
    expect(dashboard.status).toBe(200);
    const data = (await dashboard.json()) as {
      position: { symbol: string } | null;
      problems: string[];
    };
    expect(data.position?.symbol ?? null).toBe(ibkrState === "readable" ? "AAPL" : null);
    expect(data.problems).toContain(
      "Trading 212 credentials cannot be read. Reconnect broker to restore data.",
    );
    expect(
      data.problems.some((problem) => problem.includes("IBKR credentials cannot be read")),
    ).toBe(ibkrState === "unreadable");

    const save = await app.request("/api/brokers/credentials", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ broker: "trading212", token: "new-key", secret: "new-secret" }),
    });
    expect(save.status).toBe(204);
    expect(await (await app.request("/api/brokers/credentials/status")).json()).toMatchObject({
      brokers: { trading212: "readable" },
    });
  },
);

test("runtime reports storage outage instead of an empty vault", async () => {
  const failing = repository([]);
  failing.get = vi.fn(async () => {
    throw new Error("database unavailable");
  });
  storeFactory.mockImplementation(() => createNeonCredentialStore(failing, tenantId));
  const app = await createRuntimeApp({
    priceStore: createInMemoryPriceStore(),
    resolveTenantId: () => tenantId,
  });
  const status = await app.request("/api/brokers/credentials/status");
  expect(status.status).toBe(500);
  expect(await status.json()).toMatchObject({
    problems: ["Broker credential vault status could not be read"],
  });
  const dashboard = await app.request("/api/investing/dashboard?symbol=AAPL");
  expect(dashboard.status).toBe(200);
  expect(await dashboard.json()).toMatchObject({
    problems: ["Dashboard data could not be loaded"],
  });
});
