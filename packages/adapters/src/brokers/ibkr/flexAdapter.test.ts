import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { afterAll, afterEach, beforeAll, expect, test } from "vitest";
import { createIbkrFlexAdapter } from "./flexAdapter.js";

const report = `<FlexStatements><FlexStatement><OpenPositions>
  <OpenPosition symbol="AAPL" isin="US0378331005" position="2" avgPrice="100" markPrice="110" positionValue="220" currency="USD" reportDate="20260818" description="Apple &amp; Co" />
</OpenPositions><Trades>
  <Trade symbol="AAPL" transactionID="tx-1" tradeDate="20260818;101500" buySell="BUY" quantity="2" tradePrice="100" proceeds="-200" ibCommission="1" currency="USD" />
</Trades><CashReport>
  <CashReportCurrency accountId="U1" currency="USD" toDate="20260818" endingCash="150" />
</CashReport><StatementOfFunds>
  <StatementOfFundsLine accountId="U1" transactionID="deposit-1" date="20260810" currency="USD" activityCode="DEP" activityDescription="Deposit" amount="100" />
</StatementOfFunds></FlexStatement></FlexStatements>`;

let server: ReturnType<typeof createServer>;
let endpoint = "";
let requests: string[] = [];
let handler: (request: IncomingMessage, response: ServerResponse) => void;

beforeAll(async () => {
  server = createServer((request, response) => handler(request, response));
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Loopback server did not bind");
  endpoint = `http://127.0.0.1:${address.port}/SendRequest`;
});

afterEach(() => {
  requests = [];
  handler = () => {
    throw new Error("Unexpected request");
  };
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
});

function respond(response: ServerResponse, body: string, status = 200): void {
  response.writeHead(status, { "content-type": "application/xml" });
  response.end(body);
}

function adapter(token = "valid-token") {
  return createIbkrFlexAdapter({
    token,
    queryId: "42",
    endpoint,
    initialWaitMs: 0,
    pollDelayMs: 1,
    maxDownloadAttempts: 3,
  });
}

test("sync completes SendRequest plus not-ready then ready GetStatement flow", async () => {
  let polls = 0;
  handler = (request, response) => {
    requests.push(request.url ?? "");
    if (request.url?.startsWith("/SendRequest"))
      return respond(
        response,
        "<FlexStatementResponse><ReferenceCode>ref-1</ReferenceCode></FlexStatementResponse>",
      );
    polls += 1;
    respond(
      response,
      polls === 1
        ? "<FlexStatementResponse><Status>Statement generation in progress</Status></FlexStatementResponse>"
        : report,
    );
  };

  await expect(adapter().sync({ entity: "personal" })).resolves.toEqual({
    source: "ibkr-flex",
    problems: [],
    dividends: [],
    cashBalances: [
      { entity: "personal", broker: "ibkr", currency: "USD", amount: 150, asOf: "2026-08-18" },
    ],
    cashFlows: [
      expect.objectContaining({
        entity: "personal",
        broker: "ibkr",
        currency: "USD",
        amount: 100,
        kind: "deposit",
        brokerFlowId: "U1:deposit-1",
      }),
    ],
    positions: [
      {
        entity: "personal",
        symbol: "AAPL",
        isin: "US0378331005",
        description: "Apple & Co",
        quantity: 2,
        averagePrice: 100,
        marketPrice: 110,
        marketValue: 220,
        currency: "USD",
        asOf: "2026-08-18",
      },
    ],
    trades: [
      {
        entity: "personal",
        date: "2026-08-18",
        symbol: "AAPL",
        side: "buy",
        quantity: 2,
        price: 100,
        amount: -200,
        currency: "USD",
        commission: 1,
        brokerTradeId: "tx-1",
      },
    ],
  });
  expect(requests).toHaveLength(3);
  expect(requests[0]).toContain("t=valid-token");
  expect(requests[1]).toContain("q=ref-1");
});

test("sync reports bounded timeout without throwing", async () => {
  handler = (request, response) =>
    respond(
      response,
      request.url?.startsWith("/SendRequest")
        ? "<FlexStatementResponse><ReferenceCode>never-ready</ReferenceCode></FlexStatementResponse>"
        : "<FlexStatementResponse><Status>Statement generation in progress</Status></FlexStatementResponse>",
    );

  await expect(adapter().sync({ entity: "personal" })).resolves.toEqual({
    positions: [],
    trades: [],
    source: "ibkr-flex",
    problems: [expect.stringContaining("statement generation timed out")],
  });
});

test("sync reports rejected token without throwing", async () => {
  handler = (_request, response) =>
    respond(
      response,
      "<FlexStatementResponse><ErrorCode>1019</ErrorCode><ErrorMessage>Invalid token</ErrorMessage></FlexStatementResponse>",
    );

  await expect(adapter("expired-token").sync({ entity: "personal" })).resolves.toEqual({
    positions: [],
    trades: [],
    source: "ibkr-flex",
    problems: [expect.stringContaining("IBKR error 1019: Invalid token")],
  });
});

test("sync reports malformed or unexpected payload without throwing", async () => {
  handler = (request, response) =>
    respond(
      response,
      request.url?.startsWith("/SendRequest")
        ? "<FlexStatementResponse><ReferenceCode>malformed</ReferenceCode></FlexStatementResponse>"
        : '<FlexStatements><FlexStatement><OpenPositions><OpenPosition symbol="AAPL"',
    );

  await expect(adapter().sync({ entity: "personal" })).resolves.toEqual({
    positions: [],
    trades: [],
    dividends: [],
    cashBalances: [],
    cashFlows: [],
    source: "ibkr-flex",
    problems: [expect.stringContaining("malformed")],
  });
});

test("separate syncs do not share in-flight statement state", async () => {
  let reference = 0;
  handler = (request, response) => {
    if (request.url?.startsWith("/SendRequest")) {
      reference += 1;
      return respond(
        response,
        `<FlexStatementResponse><ReferenceCode>ref-${reference}</ReferenceCode></FlexStatementResponse>`,
      );
    }
    respond(response, report);
  };

  await Promise.all([adapter().sync({ entity: "one" }), adapter().sync({ entity: "two" })]);
  expect(reference).toBe(2);
});
