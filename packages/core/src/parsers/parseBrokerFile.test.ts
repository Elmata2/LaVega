import { expect, test } from "vitest";
import { parseBrokerFile } from "./parseBrokerFile.js";

const DEGIRO = [
  "Date;Time;Product;ISIN;Exchange;Quantity;Price;Local value;Value;Exchange rate;Transaction costs;Total;Currency;Order ID",
  "2026-08-14;10:00;Vanguard S&P 500 ETF;IE00B3XXRP09;Euronext;2;100,50;201,00;201,00;1;-2,00;-203,00;EUR;ORD-1",
  "2026-08-15;11:00;Vanguard S&P 500 ETF;IE00B3XXRP09;Euronext;-1;101,00;-101,00;-101,00;1;-1,00;100,00;EUR;ORD-2",
].join("\n");

test("parseBrokerFile maps DeGiro transaction export to trades", () => {
  const result = parseBrokerFile("degiro-transactions.csv", DEGIRO);
  expect(result.source).toBe("DeGiro");
  expect(result.problems).toEqual([]);
  expect(result.positions).toEqual([]);
  expect(result.trades).toMatchObject([
    { date: "2026-08-14", symbol: "Vanguard S&P 500 ETF", isin: "IE00B3XXRP09", side: "buy", quantity: 2, price: 100.5, amount: -203, currency: "EUR", brokerTradeId: "ORD-1" },
    { date: "2026-08-15", side: "sell", quantity: 1, price: 101, amount: 100, brokerTradeId: "ORD-2" },
  ]);
});

test.each(["", "Date;Amount;Currency;Description\n2026-08-14;100;EUR;Deposit"])("parseBrokerFile reports unknown or cashflow-only input: %s", (text) => {
  const result = parseBrokerFile("degiro-cashflow.csv", text);
  expect(result.positions).toEqual([]);
  expect(result.trades).toEqual([]);
  expect(result.problems.length).toBeGreaterThan(0);
});

test("parseBrokerFile reports recognized empty DeGiro export", () => {
  const header = DEGIRO.split("\n", 1)[0];
  const result = parseBrokerFile("degiro-transactions.csv", header);
  expect(result.source).toBe("DeGiro");
  expect(result.trades).toEqual([]);
  expect(result.problems[0]).toContain("geen transacties");
});

const PORTFOLIO = [
  "Product;ISIN;Symbol;Amount;Price;Value;Currency;Date",
  "Vanguard S&P 500 ETF;IE00B3XXRP09;VUAA;2;101,25;202,50;EUR;2026-08-18",
  "Apple Inc.;US0378331005;AAPL;3;;;USD;2026-08-18",
].join("\n");

test("parseBrokerFile maps DeGiro portfolio export to positions", () => {
  const result = parseBrokerFile("Portfolio.csv", PORTFOLIO);
  expect(result.source).toBe("DeGiro");
  expect(result.problems).toEqual([]);
  expect(result.trades).toEqual([]);
  expect(result.positions).toEqual([
    { symbol: "VUAA", isin: "IE00B3XXRP09", quantity: 2, averagePrice: null, marketPrice: 101.25, marketValue: 202.5, currency: "EUR", asOf: "2026-08-18" },
    { symbol: "AAPL", isin: "US0378331005", quantity: 3, averagePrice: null, marketPrice: null, marketValue: null, currency: "USD", asOf: "2026-08-18" },
  ]);
});

test("parseBrokerFile reports recognized empty DeGiro portfolio export", () => {
  const result = parseBrokerFile("positions.csv", "Product;ISIN;Quantity;Value;Currency");
  expect(result.source).toBe("DeGiro");
  expect(result.positions).toEqual([]);
  expect(result.problems[0]).toContain("geen posities");
});
