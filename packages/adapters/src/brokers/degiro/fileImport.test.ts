import { expect, test } from "vitest";
import { createDeGiroFileImport } from "./fileImport.js";

test("DeGiro file import stamps caller entity on every trade", async () => {
  const text = "Date;Product;ISIN;Quantity;Price;Total;Currency;Order ID\n2026-08-14;ETF;IE00TEST;2;10;20;EUR;1";
  const result = await createDeGiroFileImport().load({ filename: "transactions.csv", text, entity: "BV1" });
  expect(result.source).toBe("DeGiro");
  expect(result.problems).toEqual([]);
  expect(result.positions).toEqual([]);
  expect(result.trades).toMatchObject([{ entity: "BV1", symbol: "ETF", side: "sell", quantity: 2 }]);
});

test("DeGiro file import returns problems for empty input", async () => {
  const result = await createDeGiroFileImport().load({ filename: "empty.csv", text: "", entity: "BV1" });
  expect(result.positions).toEqual([]);
  expect(result.trades).toEqual([]);
  expect(result.problems.length).toBeGreaterThan(0);
});

test("DeGiro file import stamps caller entity on positions", async () => {
  const text = "Product;ISIN;Symbol;Amount;Price;Value;Currency;Date\nETF;IE00TEST;VUAA;2;10;20;EUR;2026-08-18";
  const result = await createDeGiroFileImport().load({ filename: "portfolio.csv", text, entity: "BV2" });
  expect(result.source).toBe("DeGiro");
  expect(result.problems).toEqual([]);
  expect(result.trades).toEqual([]);
  expect(result.positions).toEqual([{ tenantId: "local", entity: "BV2", symbol: "VUAA", isin: "IE00TEST", quantity: 2, averagePrice: null, marketPrice: 10, marketValue: 20, currency: "EUR", asOf: "2026-08-18" }]);
});
