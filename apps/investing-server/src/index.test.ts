import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { afterEach, expect, test, vi } from "vitest";
import { createRuntimeBrokerCredentialSetup, createRuntimeBrokerSync } from "./index.js";
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
    if (request.url === "/api/v0/equity/history/orders") {
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
  const sync = createRuntimeBrokerSync(undefined, credentials);

  const [first, second] = await Promise.all([sync(true), sync(true)]);

  expect(orderRequests).toBe(1);
  expect(positionRequests).toBe(1);
  expect(first.problems).toEqual(second.problems);
});
