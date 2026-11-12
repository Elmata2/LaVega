import { describe, expect, test } from "vitest";
import type { SectorProfile } from "@lavega/adapters";
import type { SectorProfileStore } from "./inMemorySectorProfileStore.js";

const AT = "2026-11-10T10:00:00.000Z";

const providerStock: SectorProfile = {
  kind: "stock",
  sector: "Technology",
  industry: "Hardware",
  source: "provider",
};

const inferredStock: SectorProfile = {
  kind: "stock",
  sector: "Healthcare",
  industry: "Unknown",
  source: "inferred",
  specificity: "sector",
  confidence: 0.8,
  inferredAt: "2026-11-01T00:00:00.000Z",
};

/** The provider-attempt behavior every SectorProfileStore must share.
 *  Run it from each store's own test file with a factory for a fresh store. */
export function describeSectorAttemptContract(
  name: string,
  createStore: () => Promise<SectorProfileStore> | SectorProfileStore,
): void {
  describe(`${name}: provider attempt contract`, () => {
    test("a recorded attempt reads back, keyed case-insensitively", async () => {
      const store = await createStore();
      expect(await store.lastProviderAttempt("X")).toBeNull();
      await store.recordProviderAttempt("x", AT);
      expect(await store.lastProviderAttempt("X")).toBe(AT);
    });

    test("get returns null for a symbol that has only an attempt record", async () => {
      const store = await createStore();
      await store.recordProviderAttempt("X", AT);
      expect(await store.get("X")).toBeNull();
    });

    test("recording an attempt leaves a stored provider profile unchanged", async () => {
      const store = await createStore();
      await store.set("AAPL", providerStock);
      const before = await store.get("AAPL");
      await store.recordProviderAttempt("AAPL", AT);
      expect(await store.get("AAPL")).toEqual(before);
      expect(await store.get("AAPL")).toEqual(providerStock);
      expect(await store.lastProviderAttempt("AAPL")).toBe(AT);
    });

    test("an inferred write after an attempt keeps the attempt time and never exposes it", async () => {
      const store = await createStore();
      await store.recordProviderAttempt("X", AT);
      await store.set("X", inferredStock);
      expect(await store.lastProviderAttempt("X")).toBe(AT);
      expect(await store.get("X")).toEqual(inferredStock);
    });

    test("a provider write replaces the profile and get never returns the attempt key", async () => {
      const store = await createStore();
      await store.recordProviderAttempt("X", AT);
      await store.set("X", providerStock);
      expect(await store.get("X")).toEqual(providerStock);
    });
  });
}
