import { expect, test, vi } from "vitest";
import { createInMemoryPriceStore } from "@lavega/adapters";
import { readPriceBars } from "./priceReader.js";

test("dashboard reads all requested symbols through the bulk store seam", async () => {
  const store = createInMemoryPriceStore();
  const bars = [{ symbol: "AAPL", date: "2026-01-02", close: 120, currency: "USD" }];
  const getRanges = vi.fn().mockResolvedValue(bars);
  const getRange = vi.spyOn(store, "getRange");
  expect(await readPriceBars({ ...store, getRanges }, "tenant-a", ["AAPL", "MSFT"])).toEqual({
    bars,
    failed: 0,
  });
  expect(getRanges).toHaveBeenCalledWith("tenant-a", ["AAPL", "MSFT"]);
  expect(getRange).not.toHaveBeenCalled();
});

test("failed bulk read reports degradation without retrying every symbol", async () => {
  const store = createInMemoryPriceStore();
  const getRange = vi.spyOn(store, "getRange");
  const getRanges = vi.fn().mockRejectedValue(new Error("database unavailable"));
  expect(await readPriceBars({ ...store, getRanges }, "tenant-a", ["AAPL", "MSFT"])).toEqual({
    bars: [],
    failed: 2,
  });
  expect(getRange).not.toHaveBeenCalled();
});

test("stores without bulk reads retain successful symbols after a partial failure", async () => {
  const store = createInMemoryPriceStore();
  const bars = [{ symbol: "AAPL", date: "2026-01-02", close: 120, currency: "USD" }];
  vi.spyOn(store, "getRange")
    .mockResolvedValueOnce(bars)
    .mockRejectedValueOnce(new Error("bad symbol"));
  expect(await readPriceBars(store, "tenant-a", ["AAPL", "MSFT"])).toEqual({ bars, failed: 1 });
});
