import { expect, test } from "vitest";
import { bucketAllocationByBroker, bucketAllocationByInstrument } from "./allocation.js";
import type { Position } from "./model.js";

const positions: Position[] = [
  { tenantId: "local", entity: "Broker A", symbol: "AAPL", description: "Apple", quantity: 2, averagePrice: 100, marketPrice: 110, marketValue: 220, currency: "USD", asOf: "2026-01-05" },
  { tenantId: "local", entity: "Broker A", symbol: "MSFT", quantity: 1, averagePrice: 200, marketPrice: 200, marketValue: 200, currency: "EUR", asOf: "2026-01-05" },
  { tenantId: "local", entity: "Broker B", symbol: "AAPL", quantity: 1, averagePrice: 100, marketPrice: 100, marketValue: 100, currency: "USD", asOf: "2026-01-05" },
  { tenantId: "local", entity: "Broker B", symbol: "MISSING", quantity: 3, averagePrice: null, marketPrice: null, marketValue: null, currency: "USD", asOf: "2026-01-05" },
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

test("buckets brokers and keeps missing FX or price unpriced", () => {
  const result = bucketAllocationByBroker(positions, "EUR", { ...fx, rates: {} });
  expect(result.buckets).toEqual([
    { key: "Broker A", label: "Broker A", value: 200, unpriced: true },
    { key: "Broker B", label: "Broker B", value: null, unpriced: true },
  ]);
  expect(result.unpriced).toEqual(["Broker A", "Broker B"]);
});

test("uses quantity times market price when market value is absent", () => {
  const [position] = positions;
  expect(bucketAllocationByInstrument([{ ...position, marketValue: null }], "EUR", fx).buckets[0].value).toBe(110);
});

test("empty holdings return empty allocation", () => {
  expect(bucketAllocationByBroker([], "EUR", fx)).toEqual({ buckets: [], unpriced: [] });
});
