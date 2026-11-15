import { describe, expect, test } from "vitest";
import type { SharedPriceBar, SharedPriceCoverage, SharedPriceStore } from "./PriceStore.js";

const bar = (date: string, close: number, currency = "EUR"): SharedPriceBar => ({
  date,
  close,
  currency,
});
const bars: SharedPriceBar[] = [
  bar("2026-01-01", 10),
  bar("2026-01-02", 11),
  bar("2026-01-03", 12),
];

const coverage = (over: Partial<SharedPriceCoverage> = {}): SharedPriceCoverage => ({
  from: "2026-01-01",
  to: "2026-01-03",
  listing: "AAA.AS",
  currency: "EUR",
  provider: "yahoo",
  ...over,
});

/**
 * The behavioural contract every `SharedPriceStore` adapter must meet (issue
 * #307). Run against in-memory, IndexedDB, file and the Neon-backed store.
 */
export function registerSharedPriceStoreContract(
  name: string,
  createStore: () => SharedPriceStore,
): void {
  describe(`${name} SharedPriceStore contract`, () => {
    test("returns inclusive range ends for one instrument", async () => {
      const store = createStore();
      await store.upsert("sym:AAA:EUR", bars);
      expect(await store.getRange({ key: "sym:AAA:EUR" }, "2026-01-01", "2026-01-03")).toEqual(
        bars,
      );
      expect(await store.getRange({ key: "sym:AAA:EUR" }, "2026-01-02", "2026-01-02")).toEqual([
        bars[1],
      ]);
      expect(await store.getRange({ key: "sym:AAA:EUR" }, "2025-01-01", "2025-01-31")).toEqual([]);
    });

    test("keeps two instruments with the same symbol apart", async () => {
      const store = createStore();
      await store.upsert("sym:AAA:EUR", bars);
      await store.upsert("isin:US0378331005:EUR", [bar("2026-01-02", 777)]);
      expect(await store.getRange({ key: "isin:US0378331005:EUR" })).toEqual([
        bar("2026-01-02", 777),
      ]);
      expect(await store.getRange({ key: "sym:AAA:EUR" })).toEqual(bars);
      expect(await store.lastDate({ key: "isin:US0378331005:EUR" })).toBe("2026-01-02");
    });

    test("getRanges groups by the requested key", async () => {
      const store = createStore();
      await store.upsert("sym:AAA:EUR", bars);
      await store.upsert("sym:BBB:USD", [bar("2026-01-02", 20, "USD")]);
      const grouped = await store.getRanges([{ key: "sym:AAA:EUR" }, { key: "sym:BBB:USD" }]);
      expect(grouped.get("sym:AAA:EUR")).toEqual(bars);
      expect(grouped.get("sym:BBB:USD")).toEqual([bar("2026-01-02", 20, "USD")]);
      expect(grouped.size).toBe(2);
    });

    test("lastDate is null without bars and upsert overwrites a date", async () => {
      const store = createStore();
      expect(await store.lastDate({ key: "sym:AAA:EUR" })).toBeNull();
      await store.upsert("sym:AAA:EUR", [bars[0]!]);
      await store.upsert("sym:AAA:EUR", [{ ...bars[0]!, close: 99 }]);
      expect(await store.lastDate({ key: "sym:AAA:EUR" })).toBe("2026-01-01");
      expect(await store.getRange({ key: "sym:AAA:EUR" })).toEqual([{ ...bars[0]!, close: 99 }]);
    });

    test("replaceRange makes the bars the whole history in the window", async () => {
      const store = createStore();
      await store.upsert("sym:AAA:EUR", bars);
      const replacement = { ...bars[1]!, close: 50 };
      await store.replaceRange("sym:AAA:EUR", [replacement], "2026-01-02", "2026-01-03");
      expect(await store.getRange({ key: "sym:AAA:EUR" })).toEqual([bars[0], replacement]);
      await store.replaceRange("sym:AAA:EUR", []);
      expect(await store.getRange({ key: "sym:AAA:EUR" })).toEqual([]);
    });

    test("coverage is null until recorded and the newest record replaces it", async () => {
      const store = createStore();
      expect(await store.getCoverage({ key: "sym:AAA:EUR" })).toBeNull();
      await store.putCoverage("sym:AAA:EUR", coverage());
      expect(await store.getCoverage({ key: "sym:AAA:EUR" })).toEqual(coverage());
      const widened = coverage({ from: "2025-06-02", listing: null, provider: "stooq" });
      await store.putCoverage("sym:AAA:EUR", widened);
      expect(await store.getCoverage({ key: "sym:AAA:EUR" })).toEqual(widened);
    });

    test("latestChange is null without a coverage row and moves with writes", async () => {
      const store = createStore();
      expect(await store.latestChange([])).toBeNull();
      await store.upsert("sym:AAA:EUR", bars);
      expect(await store.latestChange(["sym:AAA:EUR"])).toBeNull();
      await store.putCoverage("sym:AAA:EUR", coverage());
      const first = await store.latestChange(["sym:AAA:EUR"]);
      expect(first).not.toBeNull();
      await store.putCoverage("sym:AAA:EUR", coverage({ to: "2026-01-04" }));
      const second = await store.latestChange(["sym:AAA:EUR"]);
      expect(second! >= first!).toBe(true);
      expect(await store.latestChange(["sym:MISSING:EUR"])).toBeNull();
    });

    test("a read falls back to the alias only while the key has no rows", async () => {
      const store = createStore();
      await store.upsert("sym:AAA_US_EQ:USD", [bar("2026-01-02", 20, "USD")]);
      await store.putCoverage("sym:AAA_US_EQ:USD", coverage({ currency: "USD" }));
      const key = { key: "isin:US0378331005:USD", alias: "sym:AAA_US_EQ:USD" };
      expect(await store.getRange(key)).toEqual([bar("2026-01-02", 20, "USD")]);
      expect(await store.lastDate(key)).toBe("2026-01-02");
      expect(await store.getCoverage(key)).toEqual(coverage({ currency: "USD" }));
      // Once the key has a row of its own, the alias is not mixed in.
      await store.upsert("isin:US0378331005:USD", [bar("2026-01-03", 21, "USD")]);
      expect(await store.getRange(key)).toEqual([bar("2026-01-03", 21, "USD")]);
    });

    test("adoptAlias moves the alias rows and keeps the key's same-date row", async () => {
      const store = createStore();
      const key = "isin:US0378331005:USD";
      const alias = "sym:AAA_US_EQ:USD";
      await store.upsert(alias, [bar("2026-01-01", 10, "USD"), bar("2026-01-02", 11, "USD")]);
      await store.putCoverage(alias, coverage({ currency: "USD", provider: "stooq" }));
      await store.upsert(key, [bar("2026-01-02", 999, "USD")]);
      await store.adoptAlias(key, alias);

      expect(await store.getRange({ key: alias })).toEqual([]);
      expect(await store.getCoverage({ key: alias })).toBeNull();
      expect(await store.getRange({ key })).toEqual([
        bar("2026-01-01", 10, "USD"),
        bar("2026-01-02", 999, "USD"),
      ]);
      // The key had no coverage: the alias row moves over.
      expect(await store.getCoverage({ key })).toEqual(
        coverage({ currency: "USD", provider: "stooq" }),
      );
    });

    test("adoptAlias widens an existing coverage to the union and keeps the key's facts", async () => {
      const store = createStore();
      const key = "isin:US0378331005:USD";
      const alias = "sym:AAA_US_EQ:USD";
      await store.putCoverage(
        key,
        coverage({ currency: "USD", from: "2026-01-02", to: "2026-01-03" }),
      );
      await store.putCoverage(
        alias,
        coverage({ currency: "USD", from: "2025-12-30", to: "2026-01-01" }),
      );
      await store.adoptAlias(key, alias);
      expect(await store.getCoverage({ key })).toEqual(
        coverage({ currency: "USD", from: "2025-12-30", to: "2026-01-03" }),
      );
      expect(await store.getCoverage({ key: alias })).toBeNull();
    });

    test("adoptAlias is a no-op when the alias has no rows", async () => {
      const store = createStore();
      await store.putCoverage("isin:CLAIM:X:USD", coverage());
      await store.adoptAlias("isin:CLAIM:X:USD", "sym:X_US_EQ:USD");
      expect(await store.getCoverage({ key: "isin:CLAIM:X:USD" })).toEqual(coverage());
    });

    test("claim is exclusive per key, released only by its owner, and expires", async () => {
      const store = createStore();
      expect(await store.claim("isin:CLAIM:X:USD", "run-1", 120_000)).toBe(true);
      expect(await store.claim("isin:CLAIM:X:USD", "run-2", 120_000)).toBe(false);
      await store.release("isin:CLAIM:X:USD", "run-2");
      expect(await store.claim("isin:CLAIM:X:USD", "run-2", 120_000)).toBe(false);
      await store.release("isin:CLAIM:X:USD", "run-1");
      expect(await store.claim("isin:CLAIM:X:USD", "run-2", 120_000)).toBe(true);
      // A claim whose window is already over does not refuse the next owner.
      await store.release("isin:CLAIM:X:USD", "run-2");
      expect(await store.claim("isin:CLAIM:X:USD", "run-3", -1)).toBe(true);
      expect(await store.claim("isin:CLAIM:X:USD", "run-4", 120_000)).toBe(true);
    });

    test("two concurrent claims on one key leave exactly one winner", async () => {
      const store = createStore();
      const outcomes = await Promise.all([
        store.claim("isin:CLAIM-RACE:X:USD", "run-1", 120_000),
        store.claim("isin:CLAIM-RACE:X:USD", "run-2", 120_000),
      ]);
      expect(outcomes.filter(Boolean)).toHaveLength(1);
    });
  });
}
