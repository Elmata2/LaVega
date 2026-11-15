import { expect, test } from "vitest";
import type { FxRate } from "../fx.js";
import type { PriceBar } from "./model.js";
import { valuePosition } from "./valuation.js";

const RATES: FxRate[] = [
  { base: "EUR", date: "2026-09-07", rates: { USD: 1 } },
  { base: "EUR", date: "2026-09-14", rates: { USD: 2 } },
];

function bar(date: string, close: number, currency = "EUR"): PriceBar {
  return { symbol: "A", date, close, currency };
}

function value(bars: PriceBar[], valuationDate = "2026-09-14", fxRates: FxRate[] = RATES) {
  return valuePosition({
    bars,
    quantity: 2,
    valuationDate,
    presentationCurrency: "EUR",
    fxRates,
  });
}

test("a close on the valuation date prices the holding", () => {
  expect(value([bar("2026-09-11", 8), bar("2026-09-14", 10)])).toMatchObject({
    quality: "priced",
    quoteDate: "2026-09-14",
    price: 10,
    value: 20,
  });
});

test("five business days old still values, six does not", () => {
  expect(value([bar("2026-09-07", 10)])).toMatchObject({
    quality: "forward-filled",
    quoteDate: "2026-09-07",
    value: 20,
  });
  expect(value([bar("2026-09-04", 10)])).toMatchObject({
    quality: "unpriced",
    quoteDate: "2026-09-04",
    price: null,
    value: null,
  });
});

test("no close at all leaves every monetary fact null", () => {
  expect(value([])).toEqual({
    quality: "unpriced",
    quoteDate: null,
    quoteCurrency: null,
    price: null,
    value: null,
    dailyChange: null,
    dailyChangePercentage: null,
  });
});

test("a future-dated bar never becomes the current value", () => {
  expect(value([bar("2026-09-14", 10), bar("2026-09-21", 999)])).toMatchObject({
    quality: "priced",
    quoteDate: "2026-09-14",
    value: 20,
  });
  expect(value([bar("2026-09-21", 999)])).toMatchObject({
    quality: "unpriced",
    quoteDate: null,
    value: null,
  });
});

test("a weekend valuation date keeps Friday's close usable", () => {
  expect(value([bar("2026-09-11", 10)], "2026-09-12")).toMatchObject({
    quality: "forward-filled",
    quoteDate: "2026-09-11",
    value: 20,
  });
});

test("a missing FX rate reports missing-fx instead of an unconverted number", () => {
  expect(value([bar("2026-09-14", 10, "USD")], "2026-09-14", [])).toEqual({
    quality: "missing-fx",
    quoteDate: "2026-09-14",
    quoteCurrency: "USD",
    price: null,
    value: null,
    dailyChange: null,
    dailyChangePercentage: null,
  });
});

test("the daily change needs a prior close from the recent past", () => {
  expect(value([bar("2026-09-11", 8), bar("2026-09-14", 10)])).toMatchObject({
    dailyChange: 4,
    dailyChangePercentage: 0.25,
  });
  expect(value([bar("2026-08-03", 8), bar("2026-09-14", 10)])).toMatchObject({
    value: 20,
    dailyChange: null,
    dailyChangePercentage: null,
  });
  expect(value([bar("2026-09-14", 10)])).toMatchObject({
    value: 20,
    dailyChange: null,
    dailyChangePercentage: null,
  });
});

test("both closes convert at the valuation date, so FX moves are not daily change", () => {
  expect(value([bar("2026-09-11", 10, "USD"), bar("2026-09-14", 10, "USD")])).toMatchObject({
    dailyChange: 0,
    dailyChangePercentage: 0,
  });
});
