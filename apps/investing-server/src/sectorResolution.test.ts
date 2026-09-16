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
  await store.set("AAPL", { sector: "Technology", industry: "Hardware" });

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
    return { sector: "Technology", industry: "Hardware" };
  });

  const { sectorBySymbol } = await resolvePortfolioSectors(positions, { store, fetchProfile });

  expect(sectorBySymbol.get("AAPL")).toBe("Technology");
  expect(sectorBySymbol.get("MYST")).toBe(UNKNOWN_SECTOR);
  expect(await store.get("AAPL")).toEqual({ sector: "Technology", industry: "Hardware" });
  expect(fetchProfile).toHaveBeenCalledTimes(2);
});

test("an unpriced portfolio has no exposure at all", async () => {
  expect(
    await resolvePortfolioSectors([{ symbol: "AAPL", marketValue: null }], {
      store: createInMemorySectorProfileStore(),
    }),
  ).toMatchObject({ exposure: [] });
});
