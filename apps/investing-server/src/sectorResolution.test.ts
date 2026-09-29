import { expect, test, vi } from "vitest";
import { createInMemorySectorProfileStore } from "./inMemorySectorProfileStore.js";
import { resolvePortfolioSectors, UNKNOWN_SECTOR } from "./sectorResolution.js";

const positions = [
  { symbol: "AAPL", marketValue: 75 },
  { symbol: "myst", marketValue: 25 },
  { symbol: "EMPTY", marketValue: null },
];

test("stored profiles classify priced positions and weight the exposure", async () => {
  const store = createInMemorySectorProfileStore();
  await store.set("AAPL", {
    kind: "stock",
    sector: "Technology",
    industry: "Hardware",
    source: "provider",
  });

  const { sectorBySymbol, exposure } = await resolvePortfolioSectors(positions, { store });

  expect(sectorBySymbol.get("AAPL")).toBe("Technology");
  expect(sectorBySymbol.get("MYST")).toBe(UNKNOWN_SECTOR);
  expect(exposure).toEqual([
    { sector: "Technology", weight: 0.75 },
    { sector: "Unknown", weight: 0.25 },
  ]);
});

test("without a fetch fallback nothing is fetched and nothing is written", async () => {
  const store = createInMemorySectorProfileStore();
  const set = vi.spyOn(store, "set");
  const fetchProfile = vi.fn();

  const { exposure } = await resolvePortfolioSectors(positions, { store });

  expect(fetchProfile).not.toHaveBeenCalled();
  expect(set).not.toHaveBeenCalled();
  expect(exposure).toEqual([{ sector: UNKNOWN_SECTOR, weight: 1 }]);
});

test("the fetch fallback persists what it resolves and degrades to Unknown on failure", async () => {
  const store = createInMemorySectorProfileStore();
  const fetchProfile = vi.fn(async (symbol: string) => {
    if (symbol === "myst") throw new Error("yahoo down");
    return {
      kind: "stock" as const,
      sector: "Technology",
      industry: "Hardware",
      source: "provider" as const,
    };
  });

  const { sectorBySymbol } = await resolvePortfolioSectors(positions, { store, fetchProfile });

  expect(sectorBySymbol.get("AAPL")).toBe("Technology");
  expect(sectorBySymbol.get("MYST")).toBe(UNKNOWN_SECTOR);
  expect(await store.get("AAPL")).toEqual({
    kind: "stock",
    sector: "Technology",
    industry: "Hardware",
    source: "provider",
  });
  expect(fetchProfile).toHaveBeenCalledTimes(2);
});

// TASK 5: replace this pin once fund profiles resolve via weight-vector look-through.
test("a fund profile resolves to Unknown (interim) until look-through ships", async () => {
  const store = createInMemorySectorProfileStore();
  await store.set("VFEM.L", {
    kind: "fund",
    weights: [{ sector: "Technology", weight: 0.4 }],
    source: "provider",
  });

  const { sectorBySymbol } = await resolvePortfolioSectors(
    [{ symbol: "VFEM.L", marketValue: 100 }],
    { store },
  );

  expect(sectorBySymbol.get("VFEM.L")).toBe(UNKNOWN_SECTOR);
});

test("an unpriced portfolio has no exposure at all", async () => {
  expect(
    await resolvePortfolioSectors([{ symbol: "AAPL", marketValue: null }], {
      store: createInMemorySectorProfileStore(),
    }),
  ).toMatchObject({ exposure: [] });
});

test("resolves sector misses concurrently instead of one at a time", async () => {
  const store = createInMemorySectorProfileStore();
  const missSymbols = ["AAA", "BBB", "CCC", "DDD", "EEE"];
  const missPositions = missSymbols.map((symbol, index) => ({
    symbol,
    marketValue: 100 + index,
  }));

  let inFlight = 0;
  let peakInFlight = 0;
  let started = 0;
  let releaseAll: () => void = () => {};
  const allStarted = new Promise<void>((resolve) => {
    releaseAll = resolve;
  });
  const fetchProfile = vi.fn(async (symbol: string) => {
    inFlight += 1;
    peakInFlight = Math.max(peakInFlight, inFlight);
    started += 1;
    if (started === missSymbols.length) releaseAll();
    await allStarted;
    inFlight -= 1;
    return {
      kind: "stock" as const,
      sector: "Technology",
      industry: symbol,
      source: "provider" as const,
    };
  });

  await resolvePortfolioSectors(missPositions, { store, fetchProfile });

  expect(peakInFlight).toBeGreaterThan(1);
}, 2000);
