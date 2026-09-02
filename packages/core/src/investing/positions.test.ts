import { expect, test } from "vitest";
import type { Dividend } from "./dividend.js";
import type { Position, PriceBar, Trade } from "./model.js";
import { buildCurrentPositions, calculatePositionReturn } from "./positions.js";

const rates = [
  { base: "EUR", date: "2026-01-02", rates: { USD: 2 } },
  { base: "EUR", date: "2026-01-03", rates: { USD: 1 } },
  { base: "EUR", date: "2026-01-04", rates: { USD: 2 } },
];

const trade = (overrides: Partial<Trade>): Trade => ({
  id: crypto.randomUUID(), entity: "Holding BV", date: "2026-01-02", symbol: "ACME",
  side: "buy", quantity: 10, price: 10, amount: 100, currency: "USD", commission: 2, ...overrides,
});

test("position return uses trade-date FX, average cost, sell fees, and dividends", () => {
  const trades = [
    trade({ id: "buy-1" }),
    trade({ id: "buy-2", date: "2026-01-03", quantity: 2, price: 12, amount: 24, commission: 1 }),
    trade({ id: "sell", date: "2026-01-04", side: "sell", quantity: 6, price: 15, amount: 90, commission: 3 }),
  ];
  const dividends: Dividend[] = [{ id: "dividend", entity: "Holding BV", broker: "ibkr", date: "2026-01-04", symbol: "ACME", amount: 10, currency: "USD" }];

  expect(calculatePositionReturn(6, 120, trades, dividends, "EUR", rates, { valuationDate: "2027-01-02" })).toEqual({
    status: "available",
    remainingCostBasis: 38,
    realizedCostBasisRemoved: 38,
    unrealizedGain: 82,
    realizedGain: 5.5,
    dividendsReceived: 5,
    totalReturn: 92.5,
    totalReturnPercentage: 92.5 / 76,
    sinceFirstBuyPercentage: expect.any(Number),
    firstBuyDate: "2026-01-02",
  });
});

test("position return stays unavailable for incomplete history and a zero denominator", () => {
  expect(calculatePositionReturn(2, 20, [trade({ quantity: 1 })], [], "EUR", rates).status).toBe("missing-cost");
  expect(calculatePositionReturn(10, 20, [trade({ commission: null })], [], "EUR", rates).status).toBe("missing-cost");
  const zero = calculatePositionReturn(0, 0, [trade({ amount: 0, price: 0, commission: 0 }), trade({ side: "sell", amount: 0, price: 0, commission: 0 })], [], "EUR", rates);
  expect(zero.totalReturnPercentage).toBeNull();
  expect(zero.sinceFirstBuyPercentage).toBeNull();
});

test("unpriced open position retains known realized and dividend components", () => {
  const trades = [trade({ id: "buy", quantity: 2, amount: 20, currency: "EUR", commission: 0 }), trade({ id: "sell", side: "sell", quantity: 1, amount: 15, currency: "EUR", commission: 1 })];
  const dividends: Dividend[] = [{ id: "dividend", entity: "Holding BV", broker: "ibkr", date: "2026-01-03", symbol: "ACME", amount: 2, currency: "EUR" }];
  expect(calculatePositionReturn(1, null, trades, dividends, "EUR", rates)).toMatchObject({ status: "unpriced", remainingCostBasis: 10, realizedGain: 4, dividendsReceived: 2, unrealizedGain: null, totalReturn: null });
});

test("current positions omit closed holdings and expose price quality, EUR weight, and missing FX", () => {
  const positions: Position[] = [
    { entity: "Holding BV", symbol: "ACME", quantity: 6, averagePrice: 10, marketPrice: 40, marketValue: 240, currency: "USD", asOf: "2026-01-09" },
    { entity: "Holding BV", symbol: "EURCO", quantity: 2, averagePrice: 10, marketPrice: 25, marketValue: 50, currency: "EUR", asOf: "2026-01-09" },
    { entity: "Holding BV", symbol: "CLOSED", quantity: 0, averagePrice: 10, marketPrice: 10, marketValue: 0, currency: "EUR", asOf: "2026-01-09" },
  ];
  const trades = [
    trade({ id: "acme", quantity: 6, amount: 60, commission: 0 }),
    trade({ id: "eurco", symbol: "EURCO", quantity: 2, amount: 20, price: 10, currency: "EUR", commission: 0 }),
  ];
  const bars: PriceBar[] = [
    { symbol: "ACME", date: "2026-01-05", close: 40, currency: "USD" },
    { symbol: "EURCO", date: "2026-01-09", close: 25, currency: "EUR" },
  ];
  const dividends: Dividend[] = [{ id: "acme-dividend", entity: "Holding BV", broker: "ibkr", date: "2026-01-04", symbol: "ACME", amount: 10, currency: "EUR" }];
  const result = buildCurrentPositions({ positions, trades, dividends, priceBars: bars, presentationCurrency: "EUR", fxRates: rates, today: "2026-01-09" });

  expect(result.map(({ symbol }) => symbol)).toEqual(["ACME", "EURCO"]);
  expect(result[0]).toMatchObject({ marketValue: 120, portfolioWeight: 120 / 170, priceStatus: "forward-filled" });
  expect(result[1]).toMatchObject({ marketValue: 50, portfolioWeight: 50 / 170, priceStatus: "priced" });
  const expectedSinceFirstBuy = calculatePositionReturn(6, 120, [trades[0]!], dividends, "EUR", rates, { valuationDate: "2026-01-05" }).sinceFirstBuyPercentage;
  expect(result[0]!.returns.sinceFirstBuyPercentage).toBeCloseTo(expectedSinceFirstBuy!);

  const missingFx = buildCurrentPositions({ positions: [positions[0]!], trades: [trades[0]!], dividends: [], priceBars: bars, presentationCurrency: "EUR", fxRates: { base: "EUR", date: "2026-01-01", rates: {} }, today: "2026-01-09" });
  expect(missingFx[0]).toMatchObject({ marketValue: null, portfolioWeight: null, priceStatus: "missing-fx", returns: { status: "missing-fx" } });
});

test("price becomes unknown after five business days", () => {
  const position: Position = { entity: "Holding BV", symbol: "ACME", quantity: 1, averagePrice: 10, marketPrice: 10, marketValue: 10, currency: "EUR", asOf: "2026-01-13" };
  const result = buildCurrentPositions({ positions: [position], trades: [trade({ quantity: 1, amount: 10, currency: "EUR", commission: 0 })], dividends: [], priceBars: [{ symbol: "ACME", date: "2026-01-02", close: 10, currency: "EUR" }], presentationCurrency: "EUR", fxRates: rates, today: "2026-01-13" });
  expect(result[0]).toMatchObject({ marketValue: null, portfolioWeight: null, priceStatus: "unpriced", returns: { status: "unpriced" } });
});
