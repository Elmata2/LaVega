import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { afterEach, expect, test } from "vitest";
import { createTrading212Adapter } from "./adapter.js";

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

function order(id: number, ticker: string, direction = "BUY") {
  return {
    id,
    ticker,
    direction,
    filledQuantity: 2,
    fillPrice: 10,
    totalCost: 20,
    currency: "EUR",
    dateExecuted: "2026-08-18T10:15:00Z",
    fees: 0.1,
  };
}

function holding(ticker: string) {
  return { ticker, isin: "US0378331005", name: "Apple Inc.", quantity: 3, averagePrice: 150.25, currentPrice: 175.5, marketValue: 526.5, currency: "USD", asOf: "2026-08-18T12:00:00Z" };
}

function isOrderHistory(request: IncomingMessage): boolean {
  return (request.url ?? "").startsWith("/api/v0/equity/history/orders");
}

function json(response: ServerResponse, status: number, body: unknown) {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(body));
}

test("sync follows nextPagePath, sends Basic auth, and maps every order", async () => {
  const paths: string[] = [];
  const baseUrl = await serve((request, response) => {
    paths.push(request.url ?? "");
    expect(request.headers.authorization).toBe(`Basic ${Buffer.from("token:secret").toString("base64")}`);
    if (isOrderHistory(request)) {
      json(response, 200, { items: [order(1, "AAPL")] , nextPagePath: "/next" });
    } else if (request.url === "/next") {
      json(response, 200, { items: [order(2, "MSFT", "SELL")] });
    } else {
      json(response, 200, [holding("AAPL")]);
    }
  });

  const result = await createTrading212Adapter({ token: "token", secret: "secret", baseUrl }).sync({ entity: "Holding BV" });

  expect(paths).toEqual(["/api/v0/equity/history/orders?limit=50", "/next", "/api/v0/equity/positions"]);
  expect(result.source).toBe("trading-212");
  expect(result.problems).toEqual([]);
  expect(result.positions).toMatchObject([{ entity: "Holding BV", symbol: "AAPL", isin: "US0378331005", quantity: 3, averagePrice: 150.25, marketPrice: 175.5, marketValue: 526.5, currency: "USD", asOf: "2026-08-18" }]);
  expect(result.trades).toMatchObject([
    { entity: "Holding BV", symbol: "AAPL", side: "buy", quantity: 2, price: 10, amount: 20, brokerTradeId: "1" },
    { entity: "Holding BV", symbol: "MSFT", side: "sell" },
  ]);
});

test("sync returns collected trades and problem when later page fails", async () => {
  const baseUrl = await serve((request, response) => {
    if (isOrderHistory(request)) json(response, 200, { items: [order(1, "AAPL")], nextPagePath: "/next" });
    else if (request.url === "/next") json(response, 503, { error: "unavailable" });
    else json(response, 200, [holding("AAPL")]);
  });

  const result = await createTrading212Adapter({ token: "token", secret: "secret", baseUrl }).sync({ entity: "BV" });

  expect(result.trades).toHaveLength(1);
  expect(result.problems).toEqual(["Trading 212 request failed with HTTP 503"]);
});

test("holdings failure returns trades and holdings problem", async () => {
  const baseUrl = await serve((request, response) => {
    if (isOrderHistory(request)) json(response, 200, { items: [order(1, "AAPL")] });
    else json(response, 503, { error: "unavailable" });
  });
  const result = await createTrading212Adapter({ token: "token", secret: "secret", baseUrl }).sync({ entity: "BV" });
  expect(result.trades).toHaveLength(1);
  expect(result.positions).toEqual([]);
  expect(result.problems).toEqual(["Trading 212 holdings request failed with HTTP 503"]);
});

test("rejected credentials return empty arrays and Trading 212 problem", async () => {
  const baseUrl = await serve((_request, response) => json(response, 401, { error: "unauthorized" }));

  const result = await createTrading212Adapter({ token: "wrong", secret: "wrong", baseUrl }).sync({ entity: "BV" });

  expect(result.positions).toEqual([]);
  expect(result.trades).toEqual([]);
  expect(result.problems[0]).toContain("Trading 212");
});

test("retries rate-limited order-history request using Retry-After", async () => {
  let orderRequests = 0;
  const baseUrl = await serve((request, response) => {
    if (isOrderHistory(request)) {
      orderRequests += 1;
      if (orderRequests <= 2) {
        response.writeHead(429, { "retry-after": "0" });
        response.end(JSON.stringify({ error: "too many requests" }));
        return;
      }
      return json(response, 200, { items: [order(1, "AAPL")] });
    }
    return json(response, 200, [holding("AAPL")]);
  });

  const result = await createTrading212Adapter({ token: "token", secret: "secret", baseUrl }).sync({ entity: "BV" });

  expect(orderRequests).toBe(3);
  expect(result.problems).toEqual([]);
  expect(result.trades).toHaveLength(1);
});

test("malformed order-history payload becomes a problem without throwing", async () => {
  const baseUrl = await serve((request, response) => {
    if (isOrderHistory(request)) json(response, 200, { orders: [] });
    else json(response, 200, [holding("AAPL")]);
  });

  const result = await createTrading212Adapter({ token: "token", secret: "secret", baseUrl }).sync({ entity: "BV" });

  expect(result.trades).toEqual([]);
  expect(result.problems).toEqual(["Trading 212 order-history response is malformed"]);
});

test("ignores non-security order rows and maps nested instruments", async () => {
  const baseUrl = await serve((request, response) => {
    if (isOrderHistory(request)) {
      json(response, 200, {
        items: [
          { id: 1, type: "CASH_ADJUSTMENT", dateCreated: "2026-08-18T10:15:00Z" },
          { id: 2, instrument: { ticker: "AAPL", isin: "US0378331005" }, direction: "BUY", filledQuantity: 1, fillPrice: 10, currency: "USD", dateExecuted: "2026-08-18T10:15:00Z" },
        ],
      });
    } else json(response, 200, [holding("AAPL")]);
  });

  const result = await createTrading212Adapter({ token: "token", secret: "secret", baseUrl }).sync({ entity: "BV" });

  expect(result.problems).toEqual([]);
  expect(result.trades).toMatchObject([{ symbol: "AAPL", isin: "US0378331005" }]);
});

test("malformed holdings rows become problems without taking trades down", async () => {
  const baseUrl = await serve((request, response) => {
    if (isOrderHistory(request)) json(response, 200, { items: [order(1, "AAPL")] });
    else json(response, 200, [{ ticker: "", quantity: "not-a-number" }]);
  });
  const result = await createTrading212Adapter({ token: "token", secret: "secret", baseUrl }).sync({ entity: "BV" });
  expect(result.trades).toHaveLength(1);
  expect(result.positions).toEqual([]);
  expect(result.problems).toEqual(["Trading 212 position symbol is missing"]);
});
