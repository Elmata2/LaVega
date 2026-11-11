import { expect, test } from "vitest";
import {
  ALLOCATION_DENOMINATOR_RULE,
  bucketAllocationByEntity,
  bucketAllocationByInstrument,
  bucketPricedAllocation,
  buildAllocationLadder,
  ladderDrillDown,
} from "./allocation.js";
import type { Position } from "./model.js";

const positions: Position[] = [
  {
    entity: "Privé",
    symbol: "AAPL",
    description: "Apple",
    quantity: 2,
    averagePrice: 100,
    marketPrice: 110,
    marketValue: 220,
    currency: "USD",
    asOf: "2026-01-05",
  },
  {
    entity: "Privé",
    symbol: "MSFT",
    quantity: 1,
    averagePrice: 200,
    marketPrice: 200,
    marketValue: 200,
    currency: "EUR",
    asOf: "2026-01-05",
  },
  {
    entity: "Holding BV",
    symbol: "AAPL",
    quantity: 1,
    averagePrice: 100,
    marketPrice: 100,
    marketValue: 100,
    currency: "USD",
    asOf: "2026-01-05",
  },
  {
    entity: "Holding BV",
    symbol: "MISSING",
    quantity: 3,
    averagePrice: null,
    marketPrice: null,
    marketValue: null,
    currency: "USD",
    asOf: "2026-01-05",
  },
];
const fx = { base: "EUR", date: "2026-01-05", rates: { USD: 2 } };

test("buckets instruments after FX conversion and merges same symbol", () => {
  expect(bucketAllocationByInstrument(positions, "EUR", fx)).toEqual({
    buckets: [
      { key: "AAPL", label: "Apple", value: 160, unpriced: false },
      { key: "MISSING", label: "MISSING", value: null, unpriced: true },
      { key: "MSFT", label: "MSFT", value: 200, unpriced: false },
    ],
    unpriced: ["MISSING"],
  });
});

test("buckets entities and keeps missing FX or price unpriced", () => {
  const result = bucketAllocationByEntity(positions, "EUR", { ...fx, rates: {} });
  expect(result.buckets).toEqual([
    { key: "Holding BV", label: "Holding BV", value: null, unpriced: true },
    { key: "Privé", label: "Privé", value: 200, unpriced: true },
  ]);
  expect(result.unpriced).toEqual(["Holding BV", "Privé"]);
});

test("uses quantity times market price when market value is absent", () => {
  const [position] = positions;
  expect(
    bucketAllocationByInstrument([{ ...position, marketValue: null }], "EUR", fx).buckets[0].value,
  ).toBe(110);
});

test("empty holdings return empty allocation", () => {
  expect(bucketAllocationByEntity([], "EUR", fx)).toEqual({ buckets: [], unpriced: [] });
});

test("buckets current capped values without falling back to broker snapshot prices", () => {
  expect(
    bucketPricedAllocation(
      [
        { symbol: "AAPL", entity: "Privé", description: "Apple", marketValue: 120 },
        { symbol: "OLD", entity: "Privé", marketValue: null },
      ],
      "instrument",
    ),
  ).toEqual({
    buckets: [
      { key: "AAPL", label: "Apple", value: 120, unpriced: false },
      { key: "OLD", label: "OLD", value: null, unpriced: true },
    ],
    unpriced: ["OLD"],
  });
});

test("keeps priced entity subtotal when another holding is unpriced", () => {
  expect(
    bucketPricedAllocation(
      [
        { symbol: "AAPL", entity: "Privé", description: "Apple", marketValue: 120 },
        { symbol: "OLD", entity: "Privé", marketValue: null },
      ],
      "entity",
    ),
  ).toEqual({
    buckets: [{ key: "Privé", label: "Privé", value: 120, unpriced: false }],
    unpriced: ["OLD"],
  });
});

/* WS4.6 acceptance (#297): cash appears in the ladder; the unclassified bucket
 * is labelled; weights sum to at most 100% and the denominator rule is
 * documented. */

test("cash is a ladder bucket and counts in the documented denominator", () => {
  const ladder = buildAllocationLadder({
    holdings: [
      { key: "AAPL", label: "Apple", value: 750 },
      { key: "ASML", label: "ASML", value: 250 },
    ],
    cash: [{ value: 250 }],
  });
  expect(ladder.denominatorRule).toBe(ALLOCATION_DENOMINATOR_RULE);
  expect(ladder).toMatchObject({
    cash: 250,
    holdings: 1000,
    total: 1250,
    denominator: 1250,
    weightsSum: 1,
  });
  expect(ladder.rows.map((row) => [row.kind, row.label, row.weight])).toEqual([
    ["holding", "Apple", 0.6],
    ["holding", "ASML", 0.2],
    ["cash", "Cash", 0.2],
  ]);
});

test("a negative cash balance cannot shrink the invested part below the holdings", () => {
  const ladder = buildAllocationLadder({
    holdings: [{ key: "AAPL", label: "Apple", value: 1000 }],
    cash: [{ value: -200 }],
  });
  // max(1000 - 200, 1000) = 1000, so the weights sum to 80%, not 100%.
  expect(ladder.denominator).toBe(1000);
  expect(ladder.weightsSum).toBeCloseTo(0.8, 10);
  expect(ladder.weightsSum!).toBeLessThanOrEqual(1);
});

test("an unclassified holding is a real, labelled bucket", () => {
  const ladder = buildAllocationLadder({
    holdings: [
      { key: "AAPL", label: "Apple", value: 600 },
      { key: "", label: "Legacy row", value: 200 },
      { key: "unknown", label: "Unmapped", value: 200 },
    ],
  });
  const unclassified = ladder.rows.find((row) => row.kind === "unclassified")!;
  expect(unclassified).toMatchObject({
    key: "unclassified",
    label: "Unclassified",
    value: 400,
    weight: 0.4,
  });
  expect(ladder.weightsSum).toBe(1);
});

test("an unpriced holding carries no weight and never invents value", () => {
  const ladder = buildAllocationLadder({
    holdings: [
      { key: "AAPL", label: "Apple", value: 500 },
      { key: "MYSTERY", label: "Mystery", value: null },
    ],
    cash: [{ value: null }],
  });
  expect(ladder.rows.find((row) => row.key === "MYSTERY")?.weight).toBeNull();
  expect(ladder.rows.find((row) => row.key === "cash")?.unpriced).toBe(true);
  expect(ladder.unpriced).toEqual(["Cash", "Mystery"]);
  expect(ladder.weightsSum).toBeLessThanOrEqual(1);
});

test("the instrument ladder drills down inside one parent entity", () => {
  const holdings = [
    { key: "AAPL", label: "Apple", value: 600, parentKey: "personal" },
    { key: "ASML", label: "ASML", value: 400, parentKey: "personal" },
    { key: "BTC", label: "Bitcoin", value: 100, parentKey: "crypto" },
  ];
  expect(ladderDrillDown(holdings, "personal").map((row) => row.key)).toEqual(["AAPL", "ASML"]);
});
