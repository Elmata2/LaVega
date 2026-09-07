import { createServer, type ServerResponse } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test, vi } from "vitest";
import { createMemoryBrokerSyncStateStore } from "@lavega/adapters";
import { createFileCredentialStore } from "./fileCredentialStore.js";
import { createRuntimeBrokerDataCache, createRuntimeBrokerSync } from "./index.js";

test("resumed broker history survives final pages, file reload, and a later full replacement", async () => {
  let run = 1;
  const orderPaths: string[] = [];
  const order = (id: number) => ({
    fill: { id, filledAt: "2026-08-18T10:15:00Z", price: 10, quantity: 1, type: "TRADE" },
    order: { id, ticker: "AAPL_US_EQ", side: "BUY", currency: "EUR" },
  });
  const dividend = (reference: string) => ({
    reference,
    ticker: "AAPL_US_EQ",
    paidOn: "2026-08-18",
    amount: 1,
    currency: "EUR",
  });
  const json = (response: ServerResponse, body: unknown, status = 200) => {
    response.writeHead(status, { "content-type": "application/json" });
    response.end(JSON.stringify(body));
  };
  const server = createServer((request, response) => {
    const path = request.url ?? "";
    if (path === "/api/v0/equity/positions") return json(response, []);
    if (path === "/api/v0/equity/account/summary")
      return json(response, {
        currency: "EUR",
        cash: { availableToTrade: 100, inPies: 0, reservedForOrders: 0 },
      });
    if (path.startsWith("/api/v0/equity/history/orders")) {
      orderPaths.push(path);
      return json(
        response,
        run === 4 ? { items: [order(3)] } : { items: [order(1)], nextPagePath: "/orders-next" },
      );
    }
    if (path === "/orders-next") {
      orderPaths.push(path);
      return run === 1 ? json(response, {}, 503) : json(response, { items: [order(2)] });
    }
    if (path.startsWith("/api/v0/equity/history/transactions"))
      return json(response, {
        items:
          run === 4
            ? []
            : [
                {
                  reference: "deposit",
                  type: "DEPOSIT",
                  dateTime: "2026-08-18",
                  amount: 100,
                  currency: "EUR",
                },
              ],
      });
    if (path.startsWith("/api/v0/equity/history/dividends"))
      return json(
        response,
        run === 4 ? { items: [] } : { items: [dividend("first")], nextPagePath: "/dividends-next" },
      );
    if (path === "/dividends-next")
      return run === 2 ? json(response, {}, 503) : json(response, { items: [dividend("second")] });
    return json(response, {}, 404);
  });
  const directory = await mkdtemp(join(tmpdir(), "lavega-resume-history-"));
  try {
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Missing server address");
    vi.stubEnv("TRADING212_BASE_URL", `http://127.0.0.1:${address.port}`);
    const file = join(directory, "vault.json");
    const credentials = createFileCredentialStore(file);
    await credentials.setup("test-passphrase");
    await credentials.putCredentials({
      broker: "trading212",
      tenantId: "local",
      token: "test",
      secret: "test",
    });
    const state = createMemoryBrokerSyncStateStore();
    const syncOnce = async (failPersistence = false) => {
      const restored = createFileCredentialStore(file);
      expect(await restored.unlock("test-passphrase")).toBe(true);
      const cache = createRuntimeBrokerDataCache(await restored.getBrokerData());
      const sync = createRuntimeBrokerSync(
        async (result) => {
          cache.apply(result);
          if (failPersistence) throw new Error("Snapshot persistence failed");
          await restored.putBrokerData(cache.snapshot());
        },
        restored,
        state,
      );
      await sync(true);
      return cache.read();
    };
    const first = await syncOnce();
    expect(first.trades).toHaveLength(1);
    expect((await state.get("trading212")).resume?.ordersNextPagePath).toContain("orders-next");
    run = 2;
    const second = await syncOnce();
    expect(second.trades).toHaveLength(2);
    expect(second.dividends).toHaveLength(1);
    expect(second.cashFlows).toHaveLength(1);
    expect((await state.get("trading212")).resume?.ordersComplete).toBe(true);
    run = 3;
    const pausedState = await state.get("trading212");
    await expect(syncOnce(true)).rejects.toThrow("Snapshot persistence failed");
    expect(await state.get("trading212")).toEqual(pausedState);
    const final = await syncOnce();
    expect(final.trades.map((trade) => trade.brokerTradeId)).toEqual(["1", "2"]);
    expect(final.dividends).toHaveLength(2);
    expect(final.cashFlows).toHaveLength(1);
    expect((await state.get("trading212")).resume).toBeNull();
    expect((await state.get("trading212")).lastSyncedAt).not.toBeNull();
    expect(orderPaths.filter((path) => path.includes("/history/orders"))).toHaveLength(1);
    run = 4;
    const replacement = await syncOnce();
    expect(replacement.trades.map((trade) => trade.brokerTradeId)).toEqual(["3"]);
    expect(replacement.dividends).toEqual([]);
    expect(replacement.cashFlows).toEqual([]);
  } finally {
    vi.unstubAllEnvs();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
    await rm(directory, { recursive: true, force: true });
  }
});
