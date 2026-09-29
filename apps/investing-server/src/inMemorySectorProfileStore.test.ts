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
