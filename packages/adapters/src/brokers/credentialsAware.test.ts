import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { afterEach, expect, test, vi } from "vitest";
import type { CredentialStore } from "@lavega/core";
import { createCredentialsAwareBrokerAdapters, trading212DeadlineMs } from "./credentialsAware.js";

const servers: ReturnType<typeof createServer>[] = [];

afterEach(async () => {
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

function json(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(body));
}

function memoryCredentials(stored: Partial<Record<"ibkr" | "trading212", unknown>>): CredentialStore {
  return {
    async getCredentials(_tenantId, broker) {
      return (stored[broker] ?? null) as never;
    },
    async putCredentials() {},
  };
}

test("adapters report missing credentials with their own wording", async () => {
  const adapters = createCredentialsAwareBrokerAdapters({ credentials: memoryCredentials({}), environment: () => undefined });

  expect(adapters.map((entry) => entry.broker)).toEqual(["ibkr", "trading212"]);

  const ibkr = await adapters[0].adapter.sync({ entity: "personal" });
  expect(ibkr).toMatchObject({ positions: [], trades: [], source: "ibkr-flex", problems: ["IBKR: credentials are not configured"] });

  const trading212 = await adapters[1].adapter.sync({ entity: "personal" });
  expect(trading212).toMatchObject({ positions: [], trades: [], source: "trading-212", problems: ["Trading 212: credentials are not configured"] });
});

test("stored credentials reach the broker adapters together with env config", async () => {
  const baseUrl = await serve((request, response) => {
    if ((request.url ?? "").startsWith("/api/v0/equity/history/orders")) return json(response, 200, { items: [] });
    if ((request.url ?? "").startsWith("/api/v0/equity/history/transactions") || (request.url ?? "").startsWith("/api/v0/equity/history/dividends")) return json(response, 200, { items: [], nextPagePath: null });
    if ((request.url ?? "").startsWith("/api/v0/equity/positions")) return json(response, 200, []);
    if ((request.url ?? "").startsWith("/api/v0/equity/account")) return json(response, 200, { currency: "EUR", cash: { availableToTrade: 0, inPies: 0, reservedForOrders: 0 } });
    return json(response, 200, { items: [], nextPagePath: null });
  });
  const events: unknown[] = [];
  const adapters = createCredentialsAwareBrokerAdapters({
    credentials: memoryCredentials({
      ibkr: { broker: "ibkr", tenantId: "local", token: "flex-token", queryId: "42" },
      trading212: { broker: "trading212", tenantId: "local", token: "api-key", secret: "api-secret" },
    }),
    environment: (name) => (name === "TRADING212_BASE_URL" ? baseUrl : undefined),
    onTrading212Diagnostic: (event) => events.push(event),
  });

  const trading212 = await adapters[1].adapter.sync({ entity: "personal" });
  expect(trading212.problems).toEqual([]);
  expect(trading212.positions).toEqual([]);

  // Diagnostics flow through to the caller and keep the structured-log line.
  const log = vi.spyOn(console, "log").mockImplementation(() => {});
  try {
    await adapters[1].adapter.sync({ entity: "personal" });
    expect(events.length).toBeGreaterThan(0);
    expect(log).toHaveBeenCalledWith(expect.stringContaining('"event":"investing.trading212.http"'));
  } finally {
    log.mockRestore();
  }
});

test("Vercel without an explicit budget uses a short host deadline", () => {
  expect(trading212DeadlineMs((name) => name === "VERCEL" ? "1" : undefined, 1_000)).toBe(46_000);
});

test("INVESTING_SYNC_BUDGET_MS overrides the Vercel default", () => {
  expect(trading212DeadlineMs((name) => name === "INVESTING_SYNC_BUDGET_MS" ? "240000" : name === "VERCEL" ? "1" : undefined, 1_000)).toBe(241_000);
});

test("a local runtime without Vercel has no host deadline", () => {
  expect(trading212DeadlineMs(() => undefined, 1_000)).toBeUndefined();
});
