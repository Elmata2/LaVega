import { describe, expect, test } from "vitest";
import { assignTradeIds } from "./hash.js";

const trade = {
  entity: "personal",
  date: "2026-08-18",
  symbol: "AAPL",
  side: "buy" as const,
  quantity: 2,
  price: 100,
  amount: -200,
  currency: "USD",
  commission: 1,
};

describe("assignTradeIds", () => {
  test("creates stable IDs and separates repeated executions", () => {
    const [first, second] = assignTradeIds([trade, trade]);
    const [again] = assignTradeIds([trade]);

    expect(first?.id).toBe(again?.id);
    expect(first?.id).not.toBe(second?.id);
  });

  test("includes broker trade ID in identity", () => {
    const [one, two] = assignTradeIds([
      { ...trade, brokerTradeId: "1" },
      { ...trade, brokerTradeId: "2" },
    ]);

    expect(one?.id).not.toBe(two?.id);
  });
});
