import { expect, test } from "vitest";
import type { Trade } from "./model.js";
import { normalizeTradeQuantity, orderTrades } from "./quantity.js";

function trade(id: string, date: string, executionAt?: string): Trade {
  return {
    id,
    entity: "personal",
    date,
    ...(executionAt ? { executionAt } : {}),
    symbol: "AAPL",
    side: "buy",
    quantity: 1,
    price: 10,
    amount: 10,
    currency: "EUR",
    commission: 0,
  };
}

test("normalizes signed buy and sell quantities", () => {
  expect(normalizeTradeQuantity("buy", -10)).toBe(10);
  expect(normalizeTradeQuantity("sell", -2)).toBe(2);
  expect(() => normalizeTradeQuantity("sell", 0)).toThrow();
});

test("orders timestamps while preserving date-only source slots", () => {
  const rows = [
    trade("late", "2026-08-18", "2026-08-18T10:00:00Z"),
    trade("date-only", "2026-08-18"),
    trade("early", "2026-08-18", "2026-08-18T09:00:00Z"),
  ];
  expect(orderTrades(rows).map(({ id }) => id)).toEqual(["early", "date-only", "late"]);
  expect(orderTrades(rows, "reverse-chronological").map(({ id }) => id)).toEqual([
    "late",
    "date-only",
    "early",
  ]);
});
