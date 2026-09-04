import { expect, test } from "vitest";
import {
  bucketAllocationByEntity,
  bucketAllocationByInstrument,
  bucketPricedAllocation,
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
