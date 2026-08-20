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
    fill: {
      id: id * 10,
      filledAt: "2026-08-18T10:15:00Z",
      price: 10,
      quantity: 2,
      type: "TRADE",
    },
    order: {
      id,
      ticker,
      side: direction,
      currency: "EUR",
      filledQuantity: 2,
      filledValue: 99,
      instrument: {
        ticker,
        isin: "US0378331005",
        name: `${ticker} Holding`,
        currency: "EUR",
      },
    },
  };
}

function holding(ticker: string) {
  return {
    averagePricePaid: 150.25,
    createdAt: "2026-08-18T12:00:00Z",
    currentPrice: 175.5,
    instrument: {
      ticker,
      isin: "US0378331005",
      name: "Apple Inc.",
      currency: "USD",
    },
    quantity: 3,
    walletImpact: {
      currency: "USD",
      currentValue: 526.5,
      totalCost: 450.75,
    },
  };
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
    { entity: "Holding BV", symbol: "AAPL", side: "buy", quantity: 2, price: 10, amount: 20, brokerTradeId: "10" },
    { entity: "Holding BV", symbol: "MSFT", side: "sell" },
  ]);
});

test("maps one trade per fill and does not use order-level filledValue as fill amount", async () => {
  const baseUrl = await serve((request, response) => {
    if (isOrderHistory(request)) json(response, 200, { items: [order(1, "AAPL")] });
    else json(response, 200, [holding("AAPL")]);
  });

  const result = await createTrading212Adapter({ token: "token", secret: "secret", baseUrl }).sync({ entity: "BV" });

  expect(result.problems).toEqual([]);
  expect(result.trades).toMatchObject([{ symbol: "AAPL", quantity: 2, price: 10, amount: 20 }]);
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

test("ignores non-trade fill rows and maps nested instruments", async () => {
  const baseUrl = await serve((request, response) => {
    if (isOrderHistory(request)) {
      json(response, 200, {
        items: [
          { fill: { id: 1, type: "STOCK_SPLIT", filledAt: "2026-08-18T10:15:00Z", price: 0, quantity: 1 }, order: { id: 1, ticker: "AAPL", side: "BUY", currency: "USD", instrument: { ticker: "AAPL", currency: "USD" } } },
          { fill: { id: 2, type: "TRADE", filledAt: "2026-08-18T10:15:00Z", price: 10, quantity: 1 }, order: { id: 2, ticker: "AAPL", side: "BUY", currency: "USD", instrument: { ticker: "AAPL", isin: "US0378331005", currency: "USD" } } },
        ],
      });
    } else json(response, 200, [holding("AAPL")]);
  });

  const result = await createTrading212Adapter({ token: "token", secret: "secret", baseUrl }).sync({ entity: "BV" });

  expect(result.problems).toEqual([]);
  expect(result.trades).toMatchObject([{ symbol: "AAPL", isin: "US0378331005" }]);
});

test("schema-mismatched order rows become problems instead of silent empty success", async () => {
  const baseUrl = await serve((request, response) => {
    if (isOrderHistory(request)) json(response, 200, { items: [{ id: 1, ticker: "AAPL", filledQuantity: 1, fillPrice: 10 }] });
    else json(response, 200, [holding("AAPL")]);
  });
  const result = await createTrading212Adapter({ token: "token", secret: "secret", baseUrl }).sync({ entity: "BV" });
  expect(result.trades).toEqual([]);
  expect(result.problems).toEqual(["Trading 212 historical order fill is missing or invalid"]);
});

test("malformed holdings rows become problems without taking trades down", async () => {
  const baseUrl = await serve((request, response) => {
    if (isOrderHistory(request)) json(response, 200, { items: [order(1, "AAPL")] });
    else json(response, 200, [{ ticker: "", quantity: "not-a-number" }]);
  });
  const result = await createTrading212Adapter({ token: "token", secret: "secret", baseUrl }).sync({ entity: "BV" });
  expect(result.trades).toHaveLength(1);
  expect(result.positions).toEqual([]);
  expect(result.problems).toEqual(["Trading 212 position instrument is missing or invalid"]);
});
