import { expect, test } from "vitest";
import { holdingIdentityLine, isIsinSymbol } from "./holdingIdentity";

test("recognises an ISIN after trimming and upper-casing", () => {
  expect(isIsinSymbol("XS00PF000003")).toBe(true);
  expect(isIsinSymbol("  xs00pf000003 ")).toBe(true);
  expect(isIsinSymbol("AAPL")).toBe(false);
  expect(isIsinSymbol("XS00PF000003X")).toBe(false);
  expect(isIsinSymbol(undefined)).toBe(false);
});

test("an ISIN with a product name yields the entity and quantity", () => {
  expect(
    holdingIdentityLine({
      symbol: "XS00PF000003",
      description: "VOORBEELD GLOBAL EQUITY ETF",
      entity: "DeGiro",
      quantity: 3,
    }),
  ).toBe("DeGiro · 3 shares");
});

test("a ticker keeps its existing identity line", () => {
  expect(
    holdingIdentityLine({
      symbol: "AAPL",
      description: "Apple Inc.",
      entity: "Trading 212",
      quantity: 1,
    }),
  ).toBe("AAPL · Trading 212 · 1 shares");
});

test("an ISIN without a product name still identifies the holding", () => {
  expect(holdingIdentityLine({ symbol: "XS00PF000003", entity: "DeGiro", quantity: 3 })).toBe(
    "XS00PF000003 · DeGiro · 3 shares",
  );
});
