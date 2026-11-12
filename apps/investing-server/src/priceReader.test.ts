import { expect, test, vi } from "vitest";
import { createInMemorySharedPriceStore } from "@lavega/adapters";
import { priceInstrumentKey } from "@lavega/core";
import { readPriceBars } from "./priceReader.js";

/* The dashboard's one price read seam. The store answers by instrument key
 * (issue #307); the read model still works in symbols, so every bar comes back
 * under every symbol that asked for that key. */

const key = (symbol: string, currency = "EUR") => priceInstrumentKey({ symbol, currency });

test("one bulk read, one symbol per key, no per-symbol fan-out", async () => {
  const store = createInMemorySharedPriceStore();
  const bars = [{ date: "2026-01-02", close: 120, currency: "USD" }];
  const getRanges = vi.fn().mockResolvedValue(new Map([[key("AAPL", "USD"), bars]]));
  const getRange = vi.spyOn(store, "getRange");
  const keys = [{ key: key("AAPL", "USD") }, { key: key("MSFT", "USD") }];
  expect(
    await readPriceBars({ ...store, getRanges }, keys, (instrument) =>
      instrument === key("AAPL", "USD") ? ["AAPL"] : ["MSFT"],
    ),
  ).toEqual({
    bars: [{ ...bars[0], symbol: "AAPL" }],
    failed: 0,
  });
  expect(getRanges).toHaveBeenCalledWith(keys);
  expect(getRange).not.toHaveBeenCalled();
});

test("failed bulk read reports degradation without retrying every key", async () => {
  const store = createInMemorySharedPriceStore();
  const getRange = vi.spyOn(store, "getRange");
  const getRanges = vi.fn().mockRejectedValue(new Error("database unavailable"));
  expect(
    await readPriceBars(
      { ...store, getRanges },
      [{ key: key("AAPL", "USD") }, { key: key("MSFT", "USD") }],
      () => ["AAPL"],
    ),
  ).toEqual({
    bars: [],
    failed: 2,
  });
  expect(getRange).not.toHaveBeenCalled();
});

test("a key shared by two broker codes serves both symbols from one series", async () => {
  const store = createInMemorySharedPriceStore();
  const instrument = "isin:US0378331005:USD";
  await store.upsert(instrument, [{ date: "2026-01-02", close: 120, currency: "USD" }]);
  const result = await readPriceBars(store, [{ key: instrument }], () => ["AAPL", "AAPL.NASDAQ"]);
  expect(result.failed).toBe(0);
  expect(result.bars.map((bar) => bar.symbol).sort()).toEqual(["AAPL", "AAPL.NASDAQ"]);
});
