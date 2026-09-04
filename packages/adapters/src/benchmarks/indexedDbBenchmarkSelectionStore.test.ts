import "fake-indexeddb/auto";
import { afterEach, expect, test } from "vitest";
import { createIndexedDbBenchmarkSelectionStore } from "./indexedDbBenchmarkSelectionStore.js";

const names: string[] = [];
afterEach(async () =>
  Promise.all(
    names.splice(0).map(
      (name) =>
        new Promise<void>((resolve, reject) => {
          const request = indexedDB.deleteDatabase(name);
          request.onsuccess = () => resolve();
          request.onerror = () => reject(request.error);
        }),
    ),
  ),
);

test("stores one ordered selection row per tenant", async () => {
  const name = `benchmark-selection-${Date.now()}`;
  names.push(name);
  const store = createIndexedDbBenchmarkSelectionStore(name);
  await store.set({ tenantId: "local", symbols: ["^AEX", "^GDAXI"] });
  await store.set({ tenantId: "local", symbols: ["^GDAXI"] });
  await expect(store.get("local")).resolves.toEqual({ tenantId: "local", symbols: ["^GDAXI"] });
});
