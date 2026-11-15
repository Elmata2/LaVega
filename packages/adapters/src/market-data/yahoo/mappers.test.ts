import { expect, test } from "vitest";
import { mapYahooChart, mapYahooDividends, mapYahooSplits } from "./mappers.js";

test("maps chart arrays into dated price points and drops missing closes", () => {
  expect(
    mapYahooChart({
      timestamp: [0, 86400],
      indicators: {
        quote: [{ open: [1, 2], high: [2, 3], low: [0, 1], close: [1.5, null], volume: [10, 20] }],
      },
    }),
  ).toEqual([{ date: "1970-01-01", open: 1, high: 2, low: 0, close: 1.5, volume: 10 }]);
});

test("maps corporate actions", () => {
  expect(mapYahooDividends({ dividends: { x: { date: 0, amount: 1.2 } } })).toEqual([
    { date: "1970-01-01", amount: 1.2 },
  ]);
  expect(
    mapYahooSplits({ splits: { x: { date: 0, numerator: 2, denominator: 1, splitRatio: "2:1" } } }),
  ).toEqual([{ date: "1970-01-01", ratio: 2, description: "2:1 split" }]);
});
