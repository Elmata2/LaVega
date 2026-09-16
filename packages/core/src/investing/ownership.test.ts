import { expect, test } from "vitest";
import type { FxRate } from "../fx.js";
import type { Position, PriceBar, Trade } from "./model.js";
import { computePortfolioValueSeries } from "./portfolio.js";
import { buildCurrentPositions } from "./positions.js";
import { anchoredSnapshotQuantity, ownershipKey } from "./ownership.js";

const RATES: FxRate = { date: "2026-09-14", base: "EUR", rates: { EUR: 1, USD: 1.1 } };

const BARS: PriceBar[] = [{ symbol: "A", date: "2026-09-14", close: 10, currency: "EUR" }];

function position(overrides: Partial<Position> & Pick<Position, "quantity" | "asOf">): Position {
  return {
    entity: "x",
    symbol: "A",
    averagePrice: null,
    marketPrice: null,
    marketValue: null,
    currency: "EUR",
    ...overrides,
  };
}

function currentValue(positions: Position[], trades: Trade[] = []): number | null {
  const rows = buildCurrentPositions({
    positions,
    trades,
    dividends: [],
    priceBars: BARS,
    presentationCurrency: "EUR",
    fxRates: RATES,
    today: "2026-09-14",
  });
  return rows.reduce((sum, row) => sum + (row.marketValue ?? 0), 0);
}

function latestPositionsValue(positions: Position[], trades: Trade[] = []): number | null {
  const series = computePortfolioValueSeries(positions, trades, BARS, "EUR", RATES, {
    today: "2026-09-14",
  });
  return series.at(-1)?.positionsValue ?? null;
}

test("ownership keys separate brokers and accounts but keep legacy rows together", () => {
  expect(ownershipKey({ entity: "x" })).toBe(ownershipKey({ entity: "x" }));
  expect(ownershipKey({ entity: "x" })).not.toBe(ownershipKey({ entity: "x", broker: "ibkr" }));
  expect(ownershipKey({ entity: "x", broker: "ibkr" })).not.toBe(
    ownershipKey({ entity: "x", broker: "trading212" }),
  );
  expect(ownershipKey({ entity: "x", broker: "ibkr", account: "U1" })).not.toBe(
    ownershipKey({ entity: "x", broker: "ibkr", account: "U2" }),
  );
  expect(ownershipKey({ entity: "x", broker: "ibkr" })).not.toBe(
    ownershipKey({ entity: "y", broker: "ibkr" }),
  );
});

/* The defect in FIN-01: the dashboard summed two dated snapshots of one
 * account while the portfolio series read the later one as superseding the
 * earlier. Whichever number is right, both views have to report it. */
test("dashboard and portfolio agree on successive snapshots of one legacy account", () => {
  const positions = [
    position({ quantity: 1, asOf: "2026-09-11" }),
    position({ quantity: 2, asOf: "2026-09-14" }),
  ];

  expect(anchoredSnapshotQuantity(positions)).toBe(2);
  expect(currentValue(positions)).toBe(20);
  expect(latestPositionsValue(positions)).toBe(20);
});

test("two brokers on different dates keep independent timelines", () => {
  const positions = [
    position({ broker: "ibkr", quantity: 1, asOf: "2026-09-11" }),
    position({ broker: "trading212", quantity: 2, asOf: "2026-09-14" }),
  ];

  expect(anchoredSnapshotQuantity(positions)).toBe(3);
  expect(currentValue(positions)).toBe(30);
  expect(latestPositionsValue(positions)).toBe(30);
});

test("two brokers reporting on the same date add up", () => {
  const positions = [
    position({ broker: "ibkr", quantity: 1, asOf: "2026-09-14" }),
    position({ broker: "trading212", quantity: 2, asOf: "2026-09-14" }),
  ];

  expect(currentValue(positions)).toBe(30);
  expect(latestPositionsValue(positions)).toBe(30);
});

test("one broker selling out does not erase what the other still holds", () => {
  const positions = [
    position({ broker: "ibkr", quantity: 3, asOf: "2026-09-11" }),
    position({ broker: "ibkr", quantity: 0, asOf: "2026-09-14" }),
    position({ broker: "trading212", quantity: 2, asOf: "2026-09-14" }),
  ];
  const trades: Trade[] = [
    {
      id: "sell-ibkr",
      entity: "x",
      broker: "ibkr",
      date: "2026-09-12",
      symbol: "A",
      side: "sell",
      quantity: 3,
      price: 10,
      amount: 30,
      currency: "EUR",
      commission: 0,
    },
  ];

  expect(anchoredSnapshotQuantity(positions)).toBe(2);
  expect(currentValue(positions, trades)).toBe(20);
  expect(latestPositionsValue(positions, trades)).toBe(20);
});

test("the same symbol in two entities stays two holdings", () => {
  const positions = [
    position({ entity: "x", broker: "ibkr", quantity: 1, asOf: "2026-09-11" }),
    position({ entity: "y", broker: "ibkr", quantity: 2, asOf: "2026-09-14" }),
  ];

  const rows = buildCurrentPositions({
    positions,
    trades: [],
    dividends: [],
    priceBars: BARS,
    presentationCurrency: "EUR",
    fxRates: RATES,
    today: "2026-09-14",
  });

  expect(rows.map((row) => [row.entity, row.quantity])).toEqual([
    ["x", 1],
    ["y", 2],
  ]);
  expect(latestPositionsValue(positions)).toBe(30);
});

test("a broker's average cost counts once per anchor, not once per dated snapshot", () => {
  const positions = [
    position({ broker: "ibkr", quantity: 2, averagePrice: 4, asOf: "2026-09-11" }),
    position({ broker: "ibkr", quantity: 2, averagePrice: 4, asOf: "2026-09-14" }),
  ];

  const rows = buildCurrentPositions({
    positions,
    trades: [],
    dividends: [],
    priceBars: BARS,
    presentationCurrency: "EUR",
    fxRates: RATES,
    today: "2026-09-14",
  });

  expect(rows[0]?.returns.remainingCostBasis).toBe(8);
});
