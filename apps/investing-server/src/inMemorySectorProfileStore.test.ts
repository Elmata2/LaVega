import { expect, test } from "vitest";
import { createInMemorySectorProfileStore } from "./inMemorySectorProfileStore.js";

test("a stock profile round-trips unchanged", async () => {
  const store = createInMemorySectorProfileStore();
  const profile = {
    kind: "stock" as const,
    sector: "Technology",
    industry: "Hardware",
    source: "provider" as const,
  };
  await store.set("AAPL", profile);
  expect(await store.get("AAPL")).toEqual(profile);
});

test("a fund profile's fetchedAt round-trips through set/get", async () => {
  const store = createInMemorySectorProfileStore();
  const fetchedAt = "2026-01-01T00:00:00.000Z";
  await store.set("VFEM.L", {
    kind: "fund",
    weights: [{ sector: "Technology", weight: 0.6 }],
    source: "provider",
    fetchedAt,
  });
  expect(await store.get("VFEM.L")).toEqual({
    kind: "fund",
    weights: [{ sector: "Technology", weight: 0.6 }],
    source: "provider",
    fetchedAt,
  });
});

test("a fund profile with no fetchedAt (legacy record) loads without one", async () => {
  const store = createInMemorySectorProfileStore();
  await store.set("VFEM.L", {
    kind: "fund",
    weights: [{ sector: "Technology", weight: 0.6 }],
    source: "provider",
  });
  const loaded = await store.get("VFEM.L");
  expect(loaded).toEqual({
    kind: "fund",
    weights: [{ sector: "Technology", weight: 0.6 }],
    source: "provider",
  });
  expect(loaded).not.toHaveProperty("fetchedAt");
});

test("set() drops a malformed fetchedAt instead of persisting a value resolution can't parse", async () => {
  const store = createInMemorySectorProfileStore();
  await store.set("VFEM.L", {
    kind: "fund",
    weights: [{ sector: "Technology", weight: 0.6 }],
    source: "provider",
    fetchedAt: "not-a-date",
  });
  const loaded = await store.get("VFEM.L");
  expect(loaded).not.toHaveProperty("fetchedAt");
});

test("set() strips a fund profile's non-GICS and out-of-range weights, keeping the valid ones", async () => {
  const store = createInMemorySectorProfileStore();
  await store.set("VFEM.L", {
    kind: "fund",
    weights: [
      { sector: "Whatever", weight: 0.4 },
      { sector: "Energy", weight: 1.2 },
      { sector: "Utilities", weight: -0.1 },
      { sector: "Technology", weight: 0.6 },
    ],
    source: "provider",
  });
  expect(await store.get("VFEM.L")).toEqual({
    kind: "fund",
    weights: [{ sector: "Technology", weight: 0.6 }],
    source: "provider",
  });
});
