import { readFileSync } from "node:fs";
import { expect, test } from "vitest";
import { readAccountTrades } from "./trades.js";

/* Issue #317: account statement -> `Trade[]` plus the trade cash flows.
 *
 * The fixture is the sanitized real NL statement from #313: 29 data rows, newest
 * first, EUR and USD, four executions (a sell, a full AutoFX buy and two partial
 * fills of one order). Every amount, balance, ISIN and product is synthetic. */

const ACCOUNT_HEADER =
  "Datum,Tijd,Valutadatum,Product,ISIN,Omschrijving,FX,Mutatie,,Saldo,,Order Id";

const fixture = (): string =>
  readFileSync(new URL("../__fixtures__/degiro/nl/account.csv", import.meta.url), "utf8");

type RowOptions = {
  date?: string;
  time?: string;
  description: string;
  isin?: string;
  product?: string;
  currency?: string;
  /** Signed `Mutatie` with a dot decimal. */
  amount?: string;
  balance?: string;
  orderId?: string;
};

/** Quote a cell, because every free-text description of ours holds a comma. */
const quote = (value: string): string => `"${value.replace(/"/g, '""')}"`;

/** One account-statement row; the FX column stays empty, as on the fixture. */
const row = ({
  date = "01-01-2026",
  time = "09:00",
  description,
  isin = "NL0VORB00029",
  product = "VOORBEELD AANDEEL",
  currency = "EUR",
  amount = "-10.00",
  balance = "0.00",
  orderId = "",
}: RowOptions): string =>
  [
    date,
    time,
    date,
    quote(product),
    isin,
    quote(description),
    "",
    currency,
    amount,
    currency,
    balance,
    orderId,
  ].join(",");

const csv = (...rows: string[]): string => [ACCOUNT_HEADER, ...rows].join("\n");

const ORDER_003 = "00000000-0000-4000-8000-000000000003";
const ORDER_002 = "00000000-0000-4000-8000-000000000002";
const ORDER_001 = "00000000-0000-4000-8000-000000000001";

test("the fixture yields its four executions in file order", () => {
  const { trades, problems } = readAccountTrades(fixture());

  expect(problems).toEqual([]);
  expect(trades).toHaveLength(4);
  expect(
    trades.map((trade) => ({
      date: trade.date,
      executionAt: trade.executionAt,
      side: trade.side,
      quantity: trade.quantity,
      price: trade.price,
      amount: trade.amount,
      currency: trade.currency,
      commission: trade.commission,
      symbol: trade.symbol,
      isin: trade.isin,
      description: trade.description,
      brokerTradeId: trade.brokerTradeId,
    })),
  ).toEqual([
    {
      date: "2026-01-22",
      executionAt: "2026-01-22T13:05:00",
      side: "sell",
      quantity: 3,
      price: 55.5867,
      amount: 166.76,
      currency: "EUR",
      commission: 0.71,
      symbol: "NL0VORB00029",
      isin: "NL0VORB00029",
      description: "VOORBEELD DIVIDEND AANDEEL",
      brokerTradeId: ORDER_003,
    },
    {
      date: "2026-01-16",
      executionAt: "2026-01-16T14:20:00",
      side: "buy",
      quantity: 5,
      price: 19.648,
      amount: -98.24,
      currency: "USD",
      commission: 0.71,
      symbol: "IE0VORB00033",
      isin: "IE0VORB00033",
      description: "VOORBEELD TECHNOLOGIE FONDS",
      brokerTradeId: ORDER_002,
    },
    {
      date: "2026-01-12",
      executionAt: "2026-01-12T11:07:00",
      side: "buy",
      quantity: 1,
      price: 49.12,
      amount: -49.12,
      currency: "EUR",
      commission: 0.71,
      symbol: "NL0VORB00029",
      isin: "NL0VORB00029",
      description: "VOORBEELD DIVIDEND AANDEEL",
      brokerTradeId: ORDER_001,
    },
    {
      date: "2026-01-12",
      executionAt: "2026-01-12T11:00:00",
      side: "buy",
      quantity: 2,
      price: 49.12,
      amount: -98.24,
      currency: "EUR",
      commission: 0.71,
      symbol: "NL0VORB00029",
      isin: "NL0VORB00029",
      description: "VOORBEELD DIVIDEND AANDEEL",
      brokerTradeId: ORDER_001,
    },
  ]);
});

test("the fixture's ten trade-bucket rows are ten cash flows, in file order", () => {
  const { cashFlows } = readAccountTrades(fixture());

  expect(cashFlows).toHaveLength(10);
  expect(
    cashFlows.map((flow) => ({
      date: flow.date,
      currency: flow.currency,
      amount: flow.amount,
      kind: flow.kind,
      description: flow.description,
      brokerFlowId: flow.brokerFlowId ?? null,
    })),
  ).toEqual([
    {
      date: "2026-01-22",
      currency: "EUR",
      amount: 0.71,
      kind: "fee",
      description: "DEGIRO Transactiekosten en/of kosten van derden",
      brokerFlowId: null,
    },
    {
      date: "2026-01-22",
      currency: "EUR",
      amount: 166.76,
      kind: "other",
      description: "Verkoop 3 @ 55,5867 EUR",
      brokerFlowId: null,
    },
    {
      date: "2026-01-16",
      currency: "USD",
      amount: 98.24,
      kind: "other",
      description: "Valuta Creditering",
      brokerFlowId: ORDER_002,
    },
    {
      date: "2026-01-16",
      currency: "EUR",
      amount: -89.96,
      kind: "other",
      description: "Valuta Debitering",
      brokerFlowId: ORDER_002,
    },
    {
      date: "2026-01-16",
      currency: "EUR",
      amount: 0.71,
      kind: "fee",
      description: "DEGIRO Transactiekosten en/of kosten van derden",
      brokerFlowId: null,
    },
    {
      date: "2026-01-16",
      currency: "USD",
      amount: -98.24,
      kind: "other",
      description: "Koop 5 @ 19,648 USD",
      brokerFlowId: null,
    },
    {
      date: "2026-01-12",
      currency: "EUR",
      amount: 0.71,
      kind: "fee",
      description: "DEGIRO Transactiekosten en/of kosten van derden",
      brokerFlowId: null,
    },
    {
      date: "2026-01-12",
      currency: "EUR",
      amount: -49.12,
      kind: "other",
      description: "Koop 1 @ 49,12 EUR",
      brokerFlowId: null,
    },
    {
      date: "2026-01-12",
      currency: "EUR",
      amount: 0.71,
      kind: "fee",
      description: "DEGIRO Transactiekosten en/of kosten van derden",
      brokerFlowId: null,
    },
    {
      date: "2026-01-12",
      currency: "EUR",
      amount: -98.24,
      kind: "other",
      description: "Koop 2 @ 49,12 EUR",
      brokerFlowId: null,
    },
  ]);
});

test("brokerFlowId sits only on the AutoFX legs, so same-currency rows stay distinct", () => {
  const { cashFlows } = readAccountTrades(fixture());

  /* Core dedupes cash flows by (entity, broker, currency, brokerFlowId ?? id).
   * A fill and its fee share the order's Datum and would collapse into one
   * event if both carried the Order Id, silently under-counting the cash walk.
   * Only the two legs of the AutoFX conversion are not one movement. */
  const withOrderId = cashFlows.filter((flow) => flow.brokerFlowId !== undefined);
  expect(withOrderId).toHaveLength(2);
  expect(withOrderId.every((flow) => flow.kind === "other")).toBe(true);
  expect(withOrderId.map((flow) => flow.description)).toEqual([
    "Valuta Creditering",
    "Valuta Debitering",
  ]);
  expect(withOrderId.every((flow) => flow.brokerFlowId === ORDER_002)).toBe(true);

  for (const flow of cashFlows) {
    if (flow.kind === "fee" || /^(koop|verkoop|buy|sell)\b/i.test(flow.description ?? "")) {
      expect(flow.brokerFlowId).toBeUndefined();
    }
  }
});

test("the side comes from the verb, never from the Mutatie sign", () => {
  const { trades } = readAccountTrades(fixture());
  const sell = trades.find((trade) => trade.brokerTradeId === ORDER_003)!;
  const buy = trades.find((trade) => trade.brokerTradeId === ORDER_002)!;

  // A sell reports positive cash and a buy negative cash; the verb decides.
  expect(sell.amount).toBeGreaterThan(0);
  expect(sell.side).toBe("sell");
  expect(buy.amount).toBeLessThan(0);
  expect(buy.side).toBe("buy");
});

test("no trade carries a settlement: the ledger row already is the trade cash", () => {
  for (const trade of readAccountTrades(fixture()).trades) {
    expect("settlement" in trade).toBe(false);
  }
});

test("partial fills keep their own commission, so one Order Id is not billed twice", () => {
  const { trades } = readAccountTrades(fixture());
  const partialFills = trades.filter((trade) => trade.brokerTradeId === ORDER_001);

  expect(partialFills).toHaveLength(2);
  // Each fill has its own 0.71 fee row. Summing the whole Order Id would
  // report 1.42 on both.
  expect(partialFills.map((trade) => trade.commission)).toEqual([0.71, 0.71]);
  expect(trades.every((trade) => trade.commission !== 1.42)).toBe(true);
});

test("an unknown trade-bucket text still moves cash and reports the row", () => {
  const text = csv(
    row({
      description: "Kosten van iets",
      amount: "-5.00",
      orderId: "00000000-0000-4000-8000-000000000009",
    }),
  );
  const { trades, cashFlows, problems } = readAccountTrades(text);

  // The Order Id makes it trade cash; only the wording is unknown, so the flow
  // stays and the trade facts do not exist.
  expect(trades).toEqual([]);
  expect(cashFlows).toHaveLength(1);
  expect(cashFlows[0]!.kind).toBe("other");
  expect(cashFlows[0]!.amount).toBe(-5);
  expect(problems).toEqual([
    'rij 2: onbekende transactieregel "Kosten van iets" — als "overig" geboekt',
  ]);
});

test("an unparseable execution reports the row, emits its cash and no trade", () => {
  const text = csv(
    row({
      description: "Koop veel @ 10,00 EUR",
      amount: "-10.00",
      orderId: "00000000-0000-4000-8000-000000000010",
    }),
  );
  const { trades, cashFlows, problems } = readAccountTrades(text);

  expect(trades).toEqual([]);
  expect(cashFlows).toHaveLength(1);
  expect(cashFlows[0]!.amount).toBe(-10);
  expect(problems).toEqual([expect.stringMatching(/^rij 2: onleesbare uitvoering /)]);
});

test("a trade row with an unusable date or amount is reported and skipped", () => {
  const text = csv(
    row({
      date: "31-02-2026",
      description: "Koop 1 @ 10,00 EUR",
      amount: "-10.00",
      orderId: "00000000-0000-4000-8000-000000000011",
    }),
    row({
      description: "Koop 1 @ 10,00 EUR",
      amount: "onbekend",
      orderId: "00000000-0000-4000-8000-000000000012",
    }),
  );
  const { trades, cashFlows, problems } = readAccountTrades(text);

  expect(trades).toEqual([]);
  expect(cashFlows).toEqual([]);
  expect(problems).toEqual([
    'rij 2: onmogelijke datum "31-02-2026"',
    'rij 3: geen bedrag bij "Koop 1 @ 10,00 EUR"',
  ]);
});

test("quantity and price tokens are locale-free inside Omschrijving", () => {
  const text = csv(
    row({
      description: "Koop 19,648 @ 1.234,56 EUR",
      amount: "-24300.00",
      orderId: "00000000-0000-4000-8000-000000000013",
    }),
    row({
      description: "Koop 19.648 @ 49.12 EUR",
      amount: "-965.00",
      orderId: "00000000-0000-4000-8000-000000000014",
    }),
  );
  const { trades, problems } = readAccountTrades(text);

  expect(problems).toEqual([]);
  expect(trades.map((trade) => ({ quantity: trade.quantity, price: trade.price }))).toEqual([
    { quantity: 19.648, price: 1234.56 },
    { quantity: 19.648, price: 49.12 },
  ]);
});

test("a file that is not an account statement explains itself instead of guessing", () => {
  const transactions = readFileSync(
    new URL("../__fixtures__/degiro/nl/transactions.csv", import.meta.url),
    "utf8",
  );
  const other = readAccountTrades(transactions);
  expect(other.trades).toEqual([]);
  expect(other.cashFlows).toEqual([]);
  expect(other.problems).toEqual([
    "geen DeGiro rekeningoverzicht: dit bestand is een transactions-export",
  ]);

  const empty = readAccountTrades("");
  expect(empty.trades).toEqual([]);
  expect(empty.problems).toHaveLength(1);
  expect(empty.problems[0]).toMatch(/leeg bestand/);
});

test("trades and flows carry broker degiro and no entity", () => {
  const { trades, cashFlows } = readAccountTrades(fixture());
  for (const trade of trades) expect("entity" in trade).toBe(false);
  for (const flow of cashFlows) {
    expect(flow.broker).toBe("degiro");
    expect("entity" in flow).toBe(false);
  }
});
