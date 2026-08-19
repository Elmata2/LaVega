import { describe, expect, test } from "vitest";
import type { PriceBar } from "@lavega/core";
import type { PriceStore } from "./PriceStore.js";

const bars: PriceBar[] = [
  { tenantId: "local", symbol: "AAA", date: "2026-01-01", close: 10, currency: "EUR" },
  { tenantId: "local", symbol: "AAA", date: "2026-01-02", close: 11, currency: "EUR" },
  { tenantId: "local", symbol: "AAA", date: "2026-01-03", close: 12, currency: "EUR" },
  { tenantId: "local", symbol: "BBB", date: "2026-01-02", close: 20, currency: "USD" },
];

export function registerPriceStoreContract(name: string, createStore: () => PriceStore): void {
  describe(`${name} PriceStore contract`, () => {
    test("returns inclusive range ends and filters by symbol", async () => {
      const store = createStore();
      await store.upsert(bars);
      expect(await store.getRange("AAA", "2026-01-01", "2026-01-03")).toEqual(bars.slice(0, 3));
    });

    test("returns empty and single-day ranges", async () => {
      const store = createStore();
      await store.upsert(bars);
      expect(await store.getRange("AAA", "2025-01-01", "2025-01-31")).toEqual([]);
      expect(await store.getRange("AAA", "2026-01-02", "2026-01-02")).toEqual([bars[1]]);
    });

    test("returns null lastDate on empty store and latest date otherwise", async () => {
      const store = createStore();
      expect(await store.lastDate("AAA")).toBeNull();
      await store.upsert(bars);
      expect(await store.lastDate("AAA")).toBe("2026-01-03");
      expect(await store.lastDate("MISSING")).toBeNull();
    });

    test("upsert overwrites duplicate bar", async () => {
      const store = createStore();
      await store.upsert([bars[0]!]);
      await store.upsert([{ ...bars[0]!, close: 99 }]);
      expect(await store.getRange("AAA", "2026-01-01", "2026-01-01")).toEqual([{ ...bars[0]!, close: 99 }]);
    });

    test("purgeAll leaves store readable and empty", async () => {
      const store = createStore();
      await store.upsert(bars);
      await store.purgeAll();
      expect(await store.getRange("AAA", "2026-01-01", "2026-01-03")).toEqual([]);
      expect(await store.lastDate("AAA")).toBeNull();
    });
  });
}
