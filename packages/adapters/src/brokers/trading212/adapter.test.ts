import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { afterEach, expect, test, vi } from "vitest";
import { createTrading212Adapter } from "./adapter.js";

const servers: ReturnType<typeof createServer>[] = [];

afterEach(async () => {
  vi.useRealTimers();
  await Promise.all(
    servers
      .splice(0)
      .map((server) => new Promise<void>((resolve) => server.close(() => resolve()))),
  );
});

async function serve(
  handler: (request: IncomingMessage, response: ServerResponse) => void,
): Promise<string> {
  const server = createServer(handler);
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("Loopback server did not open a port");
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
    createdAt: "2024-03-11T12:00:00Z",
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

function isPositions(request: IncomingMessage): boolean {
  return request.url === "/api/v0/equity/positions";
}

function json(response: ServerResponse, status: number, body: unknown) {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(body));
}

function standardNonOrder(
  request: IncomingMessage,
  response: ServerResponse,
  positions = [holding("AAPL")],
) {
  if (isPositions(request)) return json(response, 200, positions);
  if (request.url === "/api/v0/equity/account/summary") {
    return json(response, 200, {
      currency: "EUR",
      cash: { availableToTrade: 100, inPies: 0, reservedForOrders: 0 },
    });
  }
  return json(response, 200, { items: [], nextPagePath: null });
}

test("sync follows nextPagePath, sends Basic auth, and maps every order", async () => {
  vi.useFakeTimers({ now: new Date("2026-08-21T09:00:00Z"), shouldAdvanceTime: true });
  const paths: string[] = [];
  const baseUrl = await serve((request, response) => {
    paths.push(request.url ?? "");
    expect(request.headers.authorization).toBe(
      `Basic ${Buffer.from("token:secret").toString("base64")}`,
    );
    if (isOrderHistory(request)) {
      json(response, 200, { items: [order(1, "AAPL")], nextPagePath: "/next" });
    } else if (request.url === "/next") {
      json(response, 200, { items: [order(2, "MSFT", "SELL")] });
    } else standardNonOrder(request, response);
  });

  const result = await createTrading212Adapter({ token: "token", secret: "secret", baseUrl }).sync({
    entity: "Holding BV",
  });

  expect(paths).toEqual([
    "/api/v0/equity/positions",
    "/api/v0/equity/account/summary",
    "/api/v0/equity/history/orders?limit=50",
    "/next",
    "/api/v0/equity/history/transactions?limit=50",
    "/api/v0/equity/history/dividends?limit=50",
  ]);
  expect(result.source).toBe("trading-212");
  expect(result.problems).toEqual([]);
  // `asOf` is the date the broker was read, not the date the holding was opened.
  expect(result.positions).toMatchObject([
    {
      entity: "Holding BV",
      symbol: "AAPL",
      isin: "US0378331005",
      quantity: 3,
      averagePrice: 150.25,
      marketPrice: 175.5,
      marketValue: 526.5,
      currency: "USD",
      asOf: "2026-08-21",
    },
  ]);
  expect(result.trades).toMatchObject([
    {
      entity: "Holding BV",
      symbol: "AAPL",
      side: "buy",
      quantity: 2,
      price: 10,
      amount: 20,
      brokerTradeId: "10",
    },
    { entity: "Holding BV", symbol: "MSFT", side: "sell" },
  ]);
  expect(result.cashBalances).toMatchObject([
    { broker: "trading212", entity: "Holding BV", currency: "EUR", amount: 100 },
  ]);
});

test("maps one trade per fill and does not use order-level filledValue as fill amount", async () => {
  const baseUrl = await serve((request, response) => {
    if (isOrderHistory(request)) json(response, 200, { items: [order(1, "AAPL")] });
    else standardNonOrder(request, response);
  });

  const result = await createTrading212Adapter({ token: "token", secret: "secret", baseUrl }).sync({
    entity: "BV",
  });

  expect(result.problems).toEqual([]);
  expect(result.trades).toMatchObject([{ symbol: "AAPL", quantity: 2, price: 10, amount: 20 }]);
});

test("sync returns collected trades and problem when later page fails", async () => {
  const baseUrl = await serve((request, response) => {
    if (isOrderHistory(request))
      json(response, 200, { items: [order(1, "AAPL")], nextPagePath: "/next" });
    else if (request.url === "/next") json(response, 503, { error: "unavailable" });
    else standardNonOrder(request, response);
  });

  const result = await createTrading212Adapter({ token: "token", secret: "secret", baseUrl }).sync({
    entity: "BV",
  });

  expect(result.trades).toHaveLength(1);
  expect(result.tradesComplete).toBe(false);
  expect(result.problems).toEqual(["Trading 212 request failed with HTTP 503"]);
  expect(result.resume?.ordersNextPagePath).toContain("/next");
});

test("the next sync continues order history from the stored nextPagePath", async () => {
  const paths: string[] = [];
  const baseUrl = await serve((request, response) => {
    paths.push(request.url ?? "");
    if (isOrderHistory(request))
      json(response, 200, { items: [order(1, "AAPL")], nextPagePath: "/next" });
    else if (request.url === "/next") json(response, 200, { items: [order(2, "MSFT", "SELL")] });
    else standardNonOrder(request, response);
  });
  const adapter = createTrading212Adapter({ token: "token", secret: "secret", baseUrl });
  const first = await adapter.sync({ entity: "BV" });
  expect(first.trades).toHaveLength(2);

  paths.length = 0;
  const second = await adapter.sync({
    entity: "BV",
    resume: { ordersNextPagePath: `${baseUrl}/next`, ordersComplete: false },
  });

  expect(paths.filter((path) => path.startsWith("/api/v0/equity/history/orders"))).toEqual([]);
  expect(paths).toContain("/next");
  expect(second.trades).toMatchObject([{ symbol: "MSFT", side: "sell" }]);
  expect(second.tradesComplete).toBe(true);
  expect(second.resume).toBeUndefined();
});

test("holdings failure returns trades and holdings problem", async () => {
  const baseUrl = await serve((request, response) => {
    if (isOrderHistory(request)) json(response, 200, { items: [order(1, "AAPL")] });
    else if (isPositions(request)) json(response, 503, { error: "unavailable" });
    else standardNonOrder(request, response);
  });
  const result = await createTrading212Adapter({ token: "token", secret: "secret", baseUrl }).sync({
    entity: "BV",
  });
  expect(result.trades).toHaveLength(1);
  expect(result.positions).toEqual([]);
  expect(result.positionsComplete).toBe(false);
  expect(result.tradesComplete).toBe(true);
  expect(result.problems).toEqual(["Trading 212 holdings request failed with HTTP 503"]);
});

test("rejected credentials return empty arrays and Trading 212 problem", async () => {
  const baseUrl = await serve((_request, response) =>
    json(response, 401, { error: "unauthorized" }),
  );

  const result = await createTrading212Adapter({ token: "wrong", secret: "wrong", baseUrl }).sync({
    entity: "BV",
  });

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
    return standardNonOrder(request, response);
  });

  const result = await createTrading212Adapter({ token: "token", secret: "secret", baseUrl }).sync({
    entity: "BV",
  });

  expect(orderRequests).toBe(3);
  expect(result.problems).toEqual([]);
  expect(result.trades).toHaveLength(1);
});

test("malformed order-history payload becomes a problem without throwing", async () => {
  const baseUrl = await serve((request, response) => {
    if (isOrderHistory(request)) json(response, 200, { orders: [] });
    else standardNonOrder(request, response);
  });

  const result = await createTrading212Adapter({ token: "token", secret: "secret", baseUrl }).sync({
    entity: "BV",
  });

  expect(result.trades).toEqual([]);
  expect(result.problems).toEqual(["Trading 212 order-history response is malformed"]);
});

test("maps sell fills with negative quantities to positive quantity and side sell", async () => {
  const baseUrl = await serve((request, response) => {
    if (isOrderHistory(request)) {
      json(response, 200, {
        items: [
          {
            fill: {
              id: 3,
              type: "TRADE",
              filledAt: "2026-08-18T10:15:00Z",
              price: 12,
              quantity: -1.5,
            },
            order: {
              id: 3,
              ticker: "AAPL",
              side: "SELL",
              currency: "USD",
              instrument: { ticker: "AAPL", currency: "USD" },
            },
          },
        ],
      });
    } else standardNonOrder(request, response);
  });

  const result = await createTrading212Adapter({ token: "token", secret: "secret", baseUrl }).sync({
    entity: "BV",
  });

  expect(result.problems).toEqual([]);
  expect(result.trades).toMatchObject([{ side: "sell", quantity: 1.5, amount: 18 }]);
});

test("ignores non-trade fill rows and maps nested instruments", async () => {
  const baseUrl = await serve((request, response) => {
    if (isOrderHistory(request)) {
      json(response, 200, {
        items: [
          {
            fill: {
              id: 1,
              type: "STOCK_SPLIT",
              filledAt: "2026-08-18T10:15:00Z",
              price: 0,
              quantity: 1,
            },
            order: {
              id: 1,
              ticker: "AAPL",
              side: "BUY",
              currency: "USD",
              instrument: { ticker: "AAPL", currency: "USD" },
            },
          },
          {
            fill: {
              id: 2,
              type: "TRADE",
              filledAt: "2026-08-18T10:15:00Z",
              price: 10,
              quantity: 1,
            },
            order: {
              id: 2,
              ticker: "AAPL",
              side: "BUY",
              currency: "USD",
              instrument: { ticker: "AAPL", isin: "US0378331005", currency: "USD" },
            },
          },
        ],
      });
    } else standardNonOrder(request, response);
  });

  const result = await createTrading212Adapter({ token: "token", secret: "secret", baseUrl }).sync({
    entity: "BV",
  });

  expect(result.problems).toEqual([]);
  expect(result.trades).toMatchObject([{ symbol: "AAPL", isin: "US0378331005" }]);
});

test("schema-mismatched order rows become problems instead of silent empty success", async () => {
  const baseUrl = await serve((request, response) => {
    if (isOrderHistory(request))
      json(response, 200, { items: [{ id: 1, ticker: "AAPL", filledQuantity: 1, fillPrice: 10 }] });
    else standardNonOrder(request, response);
  });
  const result = await createTrading212Adapter({ token: "token", secret: "secret", baseUrl }).sync({
    entity: "BV",
  });
  expect(result.trades).toEqual([]);
  expect(result.problems).toEqual(["Trading 212 historical order fill is missing or invalid"]);
});

test("a pending order without a fill is skipped, not reported as a problem", async () => {
  const baseUrl = await serve((request, response) => {
    if (isOrderHistory(request))
      json(response, 200, {
        items: [
          { order: { id: 7, ticker: "AAPL", side: "BUY", currency: "EUR", status: "NEW" } },
          order(1, "AAPL"),
        ],
      });
    else standardNonOrder(request, response);
  });
  const result = await createTrading212Adapter({ token: "token", secret: "secret", baseUrl }).sync({
    entity: "BV",
  });
  expect(result.problems).toEqual([]);
  expect(result.trades).toMatchObject([{ symbol: "AAPL" }]);
});

test("malformed holdings rows become problems without taking trades down", async () => {
  const baseUrl = await serve((request, response) => {
    if (isOrderHistory(request)) json(response, 200, { items: [order(1, "AAPL")] });
    else if (isPositions(request)) json(response, 200, [{ ticker: "", quantity: "not-a-number" }]);
    else standardNonOrder(request, response);
  });
  const result = await createTrading212Adapter({ token: "token", secret: "secret", baseUrl }).sync({
    entity: "BV",
  });
  expect(result.trades).toHaveLength(1);
  expect(result.positions).toEqual([]);
  expect(result.problems).toEqual(["Trading 212 position instrument is missing or invalid"]);
});

test("maps paginated cash and dividends, deduplicates references, and falls back to account currency", async () => {
  const paths: string[] = [];
  const baseUrl = await serve((request, response) => {
    paths.push(request.url ?? "");
    if (isOrderHistory(request)) return json(response, 200, { items: [] });
    if (isPositions(request)) return json(response, 200, []);
    if (request.url === "/api/v0/equity/account/summary") {
      return json(response, 200, {
        id: 7,
        currency: "EUR",
        cash: { availableToTrade: 250, inPies: 0, reservedForOrders: 0 },
        ignored: "future-field",
      });
    }
    if ((request.url ?? "").startsWith("/api/v0/equity/history/transactions")) {
      return json(response, 200, {
        items: [
          {
            amount: 100,
            currency: "EUR",
            dateTime: "2026-08-01T10:00:00Z",
            reference: "deposit-1",
            type: "DEPOSIT",
            ignored: true,
          },
          { amount: 2, dateTime: "2026-08-02T10:00:00Z", reference: "fee-1", type: "FEE" },
          {
            amount: -1,
            dateTime: "2026-08-02T11:00:00Z",
            reference: "deposit-reversal",
            type: "DEPOSIT",
          },
        ],
        nextPagePath: "/cash-page-2?cursor=opaque",
      });
    }
    if (request.url === "/cash-page-2?cursor=opaque") {
      return json(response, 200, {
        items: [
          {
            amount: 100,
            currency: "EUR",
            dateTime: "2026-08-01T10:00:00Z",
            reference: "deposit-1",
            type: "DEPOSIT",
          },
          {
            amount: 10,
            currency: "EUR",
            dateTime: "2026-08-03T10:00:00Z",
            reference: "withdraw-1",
            type: "WITHDRAW",
          },
        ],
        nextPagePath: null,
      });
    }
    if ((request.url ?? "").startsWith("/api/v0/equity/history/dividends")) {
      return json(response, 200, {
        items: [
          {
            amount: 3.5,
            paidOn: "2026-08-04T10:00:00Z",
            reference: "dividend-1",
            ticker: "AAPL_US_EQ",
            type: "ORDINARY",
            instrument: {
              ticker: "AAPL_US_EQ",
              isin: "US0378331005",
              name: "Apple",
              currency: "USD",
            },
            grossAmountPerShare: 99,
          },
        ],
        nextPagePath: null,
      });
    }
    return json(response, 404, {});
  });

  const result = await createTrading212Adapter({ token: "token", secret: "secret", baseUrl }).sync({
    entity: "Holding BV",
  });

  expect(result.problems).toEqual([]);
  expect(result.cashBalances).toMatchObject([
    { amount: 250, currency: "EUR", broker: "trading212" },
  ]);
  expect(result.cashFlows).toMatchObject([
    { brokerFlowId: "deposit-1", amount: 100, kind: "deposit", currency: "EUR" },
    { brokerFlowId: "fee-1", amount: -2, kind: "fee", currency: "EUR" },
    { brokerFlowId: "deposit-reversal", amount: -1, kind: "deposit", currency: "EUR" },
    { brokerFlowId: "withdraw-1", amount: -10, kind: "withdrawal", currency: "EUR" },
  ]);
  expect(result.dividends).toMatchObject([
    {
      brokerDividendId: "dividend-1",
      broker: "trading212",
      amount: 3.5,
      currency: "EUR",
      symbol: "AAPL_US_EQ",
      isin: "US0378331005",
    },
  ]);
  expect(paths).toContain("/cash-page-2?cursor=opaque");
});

test("counts inPies and reservedForOrders toward the balance instead of discarding it", async () => {
  const baseUrl = await serve((request, response) => {
    if (isOrderHistory(request)) return json(response, 200, { items: [] });
    if (isPositions(request)) return json(response, 200, []);
    if (request.url === "/api/v0/equity/account/summary") {
      return json(response, 200, {
        currency: "EUR",
        cash: { availableToTrade: 100, inPies: 5, reservedForOrders: 2 },
      });
    }
    if ((request.url ?? "").startsWith("/api/v0/equity/history/transactions")) {
      return json(response, 200, {
        items: [
          {
            amount: 10,
            currency: "EUR",
            dateTime: "2026-08-01T10:00:00Z",
            reference: "transfer-1",
            type: "TRANSFER",
          },
          {
            amount: -4,
            currency: "EUR",
            dateTime: "2026-08-02T10:00:00Z",
            reference: "future-1",
            type: "NEW_KIND",
            extra: "kept-compatible",
          },
          { amount: "invalid", dateTime: "bad", reference: "bad-1", type: "DEPOSIT" },
        ],
      });
    }
    return json(response, 200, { items: [] });
  });

  const result = await createTrading212Adapter({ token: "token", secret: "secret", baseUrl }).sync({
    entity: "BV",
  });

  expect(result.cashBalances).toEqual([
    expect.objectContaining({ broker: "trading212", currency: "EUR", amount: 107 }),
  ]);
  expect(result.cashFlows).toMatchObject([{ brokerFlowId: "future-1", amount: -4, kind: "other" }]);
  expect(result.problems).toEqual(
    expect.arrayContaining([
      "Trading 212 transaction transfer-1 has ambiguous TRANSFER direction",
      "Trading 212 transaction future-1 has unknown type NEW_KIND; provider sign was preserved",
      "Trading 212 transaction amount is missing or invalid",
    ]),
  );
});

test("repeated cash-history nextPagePath stops with an explicit partial-history problem", async () => {
  const baseUrl = await serve((request, response) => {
    if (isOrderHistory(request)) return json(response, 200, { items: [] });
    if (isPositions(request)) return json(response, 200, []);
    if (request.url === "/api/v0/equity/account/summary")
      return json(response, 200, {
        currency: "EUR",
        cash: { availableToTrade: 1, inPies: 0, reservedForOrders: 0 },
      });
    if ((request.url ?? "").startsWith("/api/v0/equity/history/transactions"))
      return json(response, 200, { items: [], nextPagePath: "/loop" });
    if (request.url === "/loop") return json(response, 200, { items: [], nextPagePath: "/loop" });
    return json(response, 200, { items: [] });
  });

  const result = await createTrading212Adapter({ token: "token", secret: "secret", baseUrl }).sync({
    entity: "BV",
  });
  expect(result.problems).toContain("Trading 212 transactions pagination repeated nextPagePath");
});

test("repeated order-history nextPagePath stops with an explicit partial-history problem", async () => {
  const baseUrl = await serve((request, response) => {
    if (isOrderHistory(request))
      return json(response, 200, { items: [order(1, "AAPL")], nextPagePath: "/loop" });
    if (request.url === "/loop")
      return json(response, 200, { items: [order(2, "MSFT")], nextPagePath: "/loop" });
    return standardNonOrder(request, response);
  });

  const result = await createTrading212Adapter({ token: "token", secret: "secret", baseUrl }).sync({
    entity: "BV",
  });
  expect(result.tradesComplete).toBe(false);
  expect(result.problems).toContain("Trading 212 orders pagination repeated nextPagePath");
});

test("skipped non-trade fills are counted per page in diagnostics", async () => {
  const events: Array<{ type: string; skipped?: number; skippedTypes?: string[] }> = [];
  const baseUrl = await serve((request, response) => {
    if (isOrderHistory(request)) {
      return json(response, 200, {
        items: [
          {
            fill: {
              id: 1,
              type: "STOCK_SPLIT",
              filledAt: "2026-08-18T10:15:00Z",
              price: 0,
              quantity: 1,
            },
            order: {
              id: 1,
              ticker: "AAPL",
              side: "BUY",
              currency: "USD",
              instrument: { ticker: "AAPL", currency: "USD" },
            },
          },
          order(2, "AAPL"),
        ],
      });
    }
    return standardNonOrder(request, response);
  });

  const result = await createTrading212Adapter({
    token: "token",
    secret: "secret",
    baseUrl,
    diagnostics: (event) => {
      if (event.type === "history-page")
        events.push({ type: event.type, skipped: event.skipped, skippedTypes: event.skippedTypes });
    },
  }).sync({ entity: "BV" });

  expect(result.trades).toHaveLength(1);
  expect(events).toEqual([
    { type: "history-page", skipped: 1, skippedTypes: ["STOCK_SPLIT"] },
  ]);
});

test("average price falls back to walletImpact totalCost when averagePricePaid is missing", async () => {
  const baseUrl = await serve((request, response) => {
    if (isOrderHistory(request)) return json(response, 200, { items: [] });
    if (isPositions(request)) {
      return json(response, 200, [
        {
          quantity: 3,
          currentPrice: 175.5,
          instrument: { ticker: "AAPL", currency: "USD" },
          walletImpact: { currency: "USD", currentValue: 526.5, totalCost: 450.75 },
        },
      ]);
    }
    return standardNonOrder(request, response, []);
  });

  const result = await createTrading212Adapter({ token: "token", secret: "secret", baseUrl }).sync({
    entity: "BV",
  });
  expect(result.positions).toMatchObject([{ symbol: "AAPL", averagePrice: 150.25 }]);
});
