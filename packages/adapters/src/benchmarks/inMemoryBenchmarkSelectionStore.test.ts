import { expect, test } from "vitest";
import { createInMemoryBenchmarkSelectionStore } from "./inMemoryBenchmarkSelectionStore.js";

test("benchmark selection persists order and enforces cap", async () => {
  const store = createInMemoryBenchmarkSelectionStore();
  await store.set({ tenantId: "local", symbols: ["^AEX", "^GDAXI"] });
  expect(await store.get("local")).toEqual({ tenantId: "local", symbols: ["^AEX", "^GDAXI"] });
  await expect(store.set({ tenantId: "local", symbols: ["A", "B", "C", "D"] })).rejects.toThrow(/at most 3/);
});
