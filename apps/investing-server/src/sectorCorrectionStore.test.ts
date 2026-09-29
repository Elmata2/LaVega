import { expect, test } from "vitest";
import { createInMemorySectorCorrectionStore } from "./sectorCorrectionStore.js";

test("a correction is read back for the tenant and symbol it was set for", async () => {
  const store = createInMemorySectorCorrectionStore();
  await store.set("user-a", "aapl", "Healthcare");
  expect(await store.get("user-a", "AAPL")).toBe("Healthcare");
});

test("a symbol with no correction reads null", async () => {
  const store = createInMemorySectorCorrectionStore();
  expect(await store.get("user-a", "AAPL")).toBeNull();
});

test("clearing a correction resets it to automatic", async () => {
  const store = createInMemorySectorCorrectionStore();
  await store.set("user-a", "AAPL", "Healthcare");
  await store.clear("user-a", "AAPL");
  expect(await store.get("user-a", "AAPL")).toBeNull();
});

test("corrections are isolated per tenant", async () => {
  const store = createInMemorySectorCorrectionStore();
  await store.set("user-a", "AAPL", "Healthcare");
  expect(await store.get("user-b", "AAPL")).toBeNull();
});

test("getAll reads every correction for the tenant in one call", async () => {
  const store = createInMemorySectorCorrectionStore();
  await store.set("user-a", "AAPL", "Healthcare");
  await store.set("user-a", "MSFT", "Technology");
  await store.set("user-b", "AAPL", "Energy");

  expect(await store.getAll("user-a")).toEqual({ AAPL: "Healthcare", MSFT: "Technology" });
});

test("getAll for a tenant with no corrections reads an empty object", async () => {
  const store = createInMemorySectorCorrectionStore();
  expect(await store.getAll("user-a")).toEqual({});
});
