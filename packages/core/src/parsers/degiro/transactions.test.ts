import { readFileSync } from "node:fs";
import { expect, test } from "vitest";
import { readDeGiroTransactions } from "./transactions.js";

/* Issue #318: the transaction export -> trades.
 *
 * The fixtures are the sanitized real NL/EN exports from #313: 25 rows, newest
 * first, 24 Order Ids because one order has two partial fills. Every amount,
 * ISIN and product is synthetic. The overlap fixture is hand-built against the
 * account fixture so one execution appears in both exports. */

const NL_HEADER =
  "Datum,Tijd,Product,ISIN,Beurs,Uitvoeringsplaats,Aantal,Koers,,Lokale waarde,,Waarde EUR,Wisselkoers,AutoFX Kosten,Transactiekosten en/of kosten van derden EUR,Totaal EUR,Order ID";

const ORDER_003 = "00000000-0000-4000-8000-000000000003";
const ORDER_002 = "00000000-0000-4000-8000-000000000002";
const ORDER_001 = "00000000-0000-4000-8000-000000000001";

const fixture = (path: string): string =>
  readFileSync(new URL(`../__fixtures__/degiro/${path}`, import.meta.url), "utf8");

/** One 17-column row; only the fields a test varies are exposed. */
const row = ({ quantity, price }: { quantity: string; price: string }): string =>
  [
    "01-01-2026",
    "09:00",
    "VOORBEELD AANDEEL",
    "NL0VORB00029",
    "EAM",
    "XAMS",
    quantity,
    `"${price}"`,
    "EUR",
    `"-10,00"`,
    "EUR",
    `"-10,00"`,
    `"1,0000"`,
    `"0,00"`,
    `"-0,71"`,
    `"-10,71"`,
    "00000000-0000-4000-8000-000000000099",
  ].join(",");

const csv = (...rows: string[]): string => [NL_HEADER, ...rows].join("\n");

test("the fixture yields 25 trades with 24 Order Ids, partial fills kept apart", () => {
  const { trades, problems } = readDeGiroTransactions(fixture("nl/transactions.csv"));

  expect(problems).toEqual([]);
  expect(trades).toHaveLength(25);
  expect(new Set(trades.map((trade) => trade.brokerTradeId)).size).toBe(24);
  // Both fills share an Order Id but have their own time and their own row.
  expect(
    trades.filter((trade) => trade.brokerTradeId === "11111111-1111-4111-8111-000000000000"),
  ).toHaveLength(2);
});

test("the first fixture row carries venue, local value, FX rate and fee", () => {
  const [first] = readDeGiroTransactions(fixture("nl/transactions.csv")).trades;
  if (first === undefined) throw new Error("fixture row missing");

  expect({
    date: first.date,
    executionAt: first.executionAt,
    isin: first.isin,
    symbol: first.symbol,
    description: first.description,
    side: first.side,
    quantity: first.quantity,
    price: first.price,
    amount: first.amount,
    currency: first.currency,
    commission: first.commission,
    venue: first.venue,
    fxRate: first.fxRate,
    brokerTradeId: first.brokerTradeId,
  }).toEqual({
    date: "2025-02-06",
    executionAt: "2025-02-06T12:01:00",
    isin: "XS00TX000007",
    symbol: "XS00TX000007",
    description: "VOORBEELD GLOBAL EQUITY ETF",
    side: "buy",
    quantity: 2,
    price: 19.07,
    amount: -38.14,
    currency: "USD",
    commission: 3.76,
    venue: "XLON",
    fxRate: 2.817,
    brokerTradeId: "11111111-1111-4111-8111-000000000000",
  });
  // The transaction export is not a ledger: its trades carry no settlement.
  expect("settlement" in first).toBe(false);
});

test("the EN export parses to the same trades as the NL export", () => {
  expect(readDeGiroTransactions(fixture("en/transactions.csv")).trades).toEqual(
    readDeGiroTransactions(fixture("nl/transactions.csv")).trades,
  );
});

test("the period spans the oldest and newest execution", () => {
  expect(readDeGiroTransactions(fixture("nl/transactions.csv")).period).toEqual({
    from: "2022-03-30",
    to: "2025-02-06",
  });
});

test("a quantity with a zero price is a transfer or corporate action, not a trade", () => {
  const { trades, problems } = readDeGiroTransactions(csv(row({ quantity: "5", price: "0,0000" })));

  expect(trades).toEqual([]);
  expect(problems).toHaveLength(1);
  expect(problems[0]).toMatch(/rij 2/);
  expect(problems[0]).toMatch(/geen koers/);
});

test("a zero quantity is reported and yields no trade", () => {
  const { trades, problems } = readDeGiroTransactions(
    csv(row({ quantity: "0", price: "10,0000" })),
  );

  expect(trades).toEqual([]);
  expect(problems).toHaveLength(1);
  expect(problems[0]).toMatch(/rij 2/);
});

test("the overlap fixture reads its sell and both partial fills from the cash sign", () => {
  const { trades, problems } = readDeGiroTransactions(fixture("nl/transactions-overlap.csv"));

  expect(problems).toEqual([]);
  expect(trades).toHaveLength(4);
  const sell = trades.find((trade) => trade.brokerTradeId === ORDER_003);
  expect(sell).toMatchObject({ side: "sell", amount: 166.76, currency: "EUR" });
  expect(trades.filter((trade) => trade.brokerTradeId === ORDER_001)).toHaveLength(2);
  expect(trades.some((trade) => trade.brokerTradeId === ORDER_002)).toBe(true);
});

test("the overlap fixture keeps the verified NL transactions header", () => {
  expect(fixture("nl/transactions-overlap.csv").split("\n")[0]).toBe(NL_HEADER);
});
