import { describe, expect, test } from "vitest";
import type { PriceBar } from "@lavega/core";
import type { PriceCoverage, PriceStore } from "./PriceStore.js";

const bars: PriceBar[] = [
  { symbol: "AAA", date: "2026-01-01", close: 10, currency: "EUR" },
  { symbol: "AAA", date: "2026-01-02", close: 11, currency: "EUR" },
  { symbol: "AAA", date: "2026-01-03", close: 12, currency: "EUR" },
  { symbol: "BBB", date: "2026-01-02", close: 20, currency: "USD" },
];
const coverage: PriceCoverage = {
  symbol: "AAA",
  from: "2026-01-01",
  to: "2026-01-03",
  listing: "AAA.AS",
  currency: "EUR",
};

export function registerPriceStoreContract(name: string, createStore: () => PriceStore): void {
  describe(`${name} PriceStore contract`, () => {
    test("returns inclusive range ends and filters by symbol", async () => {
      const store = createStore();
      await store.upsert("local", bars);
      expect(await store.getRange("local", "AAA", "2026-01-01", "2026-01-03")).toEqual(
        bars.slice(0, 3),
      );
    });

    test("returns empty and single-day ranges", async () => {
      const store = createStore();
      await store.upsert("local", bars);
      expect(await store.getRange("local", "AAA", "2025-01-01", "2025-01-31")).toEqual([]);
      expect(await store.getRange("local", "AAA", "2026-01-02", "2026-01-02")).toEqual([bars[1]]);
    });

    test("isolates tenants: one tenant's bars never serve another's query", async () => {
      const store = createStore();
      const other: PriceBar = { symbol: "AAA", date: "2026-01-02", close: 777, currency: "EUR" };
      await store.upsert("local", bars);
      await store.upsert("other", [other]);
      expect(await store.getRange("other", "AAA", "2026-01-01", "2026-01-03")).toEqual([other]);
      expect(await store.getRange("local", "AAA", "2026-01-01", "2026-01-03")).toEqual(
        bars.slice(0, 3),
      );
      expect(await store.lastDate("other", "AAA")).toBe("2026-01-02");
    });

    test("the same bar written for two tenants stays two rows", async () => {
      const store = createStore();
      await store.upsert("local", [bars[0]!]);
      await store.upsert("other", [{ ...bars[0]!, close: 42 }]);
      expect(await store.getRange("local", "AAA", "2026-01-01", "2026-01-01")).toEqual([bars[0]]);
      expect(await store.getRange("other", "AAA", "2026-01-01", "2026-01-01")).toEqual([
        { ...bars[0]!, close: 42 },
      ]);
    });

    test("returns null lastDate on empty store and latest date otherwise", async () => {
      const store = createStore();
      expect(await store.lastDate("local", "AAA")).toBeNull();
      await store.upsert("local", bars);
      expect(await store.lastDate("local", "AAA")).toBe("2026-01-03");
      expect(await store.lastDate("local", "MISSING")).toBeNull();
    });

    test("upsert overwrites duplicate bar", async () => {
      const store = createStore();
      await store.upsert("local", [bars[0]!]);
      await store.upsert("local", [{ ...bars[0]!, close: 99 }]);
      expect(await store.getRange("local", "AAA", "2026-01-01", "2026-01-01")).toEqual([
        { ...bars[0]!, close: 99 },
      ]);
    });

    test("replaceRange makes the given bars the symbol's whole history in the window", async () => {
      const store = createStore();
      await store.upsert("local", bars);
      await store.upsert("other", [bars[1]!]);
      const replaced = { ...bars[1]!, close: 50, currency: "USD" };

      await store.replaceRange("local", "AAA", [replaced], "2026-01-02", "2026-01-03");

      expect(await store.getRange("local", "AAA")).toEqual([bars[0], replaced]);
      expect(await store.getRange("local", "BBB")).toEqual([bars[3]]);
      expect(await store.getRange("other", "AAA")).toEqual([bars[1]]);
    });

    test("replaceRange without bounds replaces the symbol's whole history", async () => {
      const store = createStore();
      await store.upsert("local", bars);

      await store.replaceRange("local", "AAA", []);

      expect(await store.getRange("local", "AAA")).toEqual([]);
      expect(await store.lastDate("local", "AAA")).toBeNull();
      expect(await store.getRange("local", "BBB")).toEqual([bars[3]]);
    });

    test("purgeAll leaves store readable and empty", async () => {
      const store = createStore();
      await store.upsert("local", bars);
      await store.putCoverage("local", coverage);
      await store.purgeAll();
      expect(await store.getRange("local", "AAA", "2026-01-01", "2026-01-03")).toEqual([]);
      expect(await store.lastDate("local", "AAA")).toBeNull();
      expect(await store.getCoverage("local", "AAA")).toBeNull();
    });

    test("coverage is null until recorded, and the latest record replaces it", async () => {
      const store = createStore();
      expect(await store.getCoverage("local", "AAA")).toBeNull();
      await store.putCoverage("local", coverage);
      expect(await store.getCoverage("local", "AAA")).toEqual(coverage);
      const widened = { ...coverage, from: "2025-06-02", listing: null, currency: "USD" };
      await store.putCoverage("local", widened);
      expect(await store.getCoverage("local", "AAA")).toEqual(widened);
      expect(await store.getCoverage("local", "BBB")).toBeNull();
    });

    test("isolates coverage between tenants", async () => {
      const store = createStore();
      await store.putCoverage("local", coverage);
      expect(await store.getCoverage("other", "AAA")).toBeNull();
    });
  });
}
