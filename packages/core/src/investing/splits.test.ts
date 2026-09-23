import { expect, test } from "vitest";
import type { Position, PriceBar, Trade } from "./model.js";
import { inCurrentShareUnits } from "./splits.js";

const trade = (id: string, date: string, quantity: number, price: number): Trade => ({
  id,
  entity: "personal",
  broker: "trading212",
  date,
  symbol: "IBKR_US_EQ",
  side: "buy",
  quantity,
  price,
  amount: quantity * price,
  currency: "USD",
  commission: 0,
});

const bars: PriceBar[] = [
  { symbol: "IBKR_US_EQ", date: "2025-06-17", close: 50, currency: "USD", split: 1 },
  { symbol: "IBKR_US_EQ", date: "2025-06-18", close: 51, currency: "USD", split: 4 },
  { symbol: "OTHER", date: "2025-06-18", close: 10, currency: "USD", split: 2 },
];

test("scales trades before a split into today's share units", () => {
  const { trades } = inCurrentShareUnits(
    [],
    [trade("before", "2025-06-17", 0.1, 200), trade("on", "2025-06-18", 0.15, 52)],
    bars,
  );

  expect(trades).toMatchObject([
    { id: "before", quantity: 0.4, price: 50, amount: 20 },
    { id: "on", quantity: 0.15, price: 52 },
  ]);
});

test("scales a broker snapshot taken before a split", () => {
  const snapshot: Position = {
    entity: "personal",
    symbol: "IBKR_US_EQ",
    quantity: 1,
    averagePrice: 200,
    marketPrice: 200,
    marketValue: 200,
    currency: "USD",
    asOf: "2025-06-17",
  };
  const { positions } = inCurrentShareUnits(
    [snapshot, { ...snapshot, asOf: "2025-06-18" }],
    [],
    bars,
  );

  expect(positions.map(({ quantity, averagePrice }) => ({ quantity, averagePrice }))).toEqual([
    { quantity: 4, averagePrice: 50 },
    { quantity: 1, averagePrice: 200 },
  ]);
});

test("returns the same records when no split applies", () => {
  const trades = [trade("after", "2025-07-01", 1, 60)];

  expect(inCurrentShareUnits([], trades, bars).trades[0]).toBe(trades[0]);
});
