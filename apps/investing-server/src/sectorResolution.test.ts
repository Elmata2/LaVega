import { expect, test, vi } from "vitest";
import { createInMemorySectorProfileStore } from "./inMemorySectorProfileStore.js";
import {
  FUND_PROFILE_REFRESH_DAYS,
  resolvePortfolioSectors,
  UNKNOWN_SECTOR,
} from "./sectorResolution.js";

const positions = [
  { symbol: "AAPL", marketValue: 75 },
  { symbol: "myst", marketValue: 25 },
  { symbol: "EMPTY", marketValue: null },
];

test("stored profiles classify priced positions and weight the exposure", async () => {
  const store = createInMemorySectorProfileStore();
  await store.set("AAPL", { kind: "stock", sector: "Technology", industry: "Hardware", source: "provider" });

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
    return { kind: "stock" as const, sector: "Technology", industry: "Hardware", source: "provider" as const };
  });

  const { sectorBySymbol } = await resolvePortfolioSectors(positions, { store, fetchProfile });

  expect(sectorBySymbol.get("AAPL")).toBe("Technology");
  expect(sectorBySymbol.get("MYST")).toBe(UNKNOWN_SECTOR);
  expect(await store.get("AAPL")).toMatchObject({ sector: "Technology" });
  expect(fetchProfile).toHaveBeenCalledTimes(2);
});

test("a fund profile's weights become the symbol's exposure split", async () => {
  const store = createInMemorySectorProfileStore();
  await store.set("VFEM.L", {
    kind: "fund",
    weights: [{ sector: "Technology", weight: 0.4 }, { sector: "Healthcare", weight: 0.5 }],
    source: "provider",
  });
  const { exposure } = await resolvePortfolioSectors(
    [{ symbol: "VFEM.L", marketValue: 100 }],
    { store },
  );
  expect(exposure).toEqual([
    { sector: "Healthcare", weight: 0.5 },
    { sector: "Technology", weight: 0.4 },
    // 1 - (0.4+0.5) is 0.09999999999999998 in float, not the exact 0.1 the
    // inputs suggest (same double-rounding summary.test.ts documents for
    // buildSectorExposure's residual elsewhere).
    { sector: "Unknown", weight: 0.09999999999999998 },
  ]);
});

test("a fund's headline sectorBySymbol label is its single largest weight", async () => {
  const store = createInMemorySectorProfileStore();
  await store.set("VFEM.L", {
    kind: "fund",
    weights: [{ sector: "Technology", weight: 0.4 }, { sector: "Healthcare", weight: 0.5 }],
    source: "provider",
  });
  const { sectorBySymbol, weightsBySymbol } = await resolvePortfolioSectors(
    [{ symbol: "VFEM.L", marketValue: 100 }],
    { store },
  );
  expect(sectorBySymbol.get("VFEM.L")).toBe("Healthcare");
  expect(weightsBySymbol.get("VFEM.L")).toEqual([
    { sector: "Healthcare", weight: 0.5 },
    { sector: "Technology", weight: 0.4 },
  ]);
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

test("a stock sector string outside the GICS taxonomy resolves to Unknown, never passed through raw", async () => {
  const store = createInMemorySectorProfileStore();
  await store.set("ACME", {
    kind: "stock",
    sector: "Not A Real Sector",
    industry: "Widgets",
    source: "provider",
  });

  const { sectorBySymbol, exposure } = await resolvePortfolioSectors(
    [{ symbol: "ACME", marketValue: 100 }],
    { store },
  );

  expect(sectorBySymbol.get("ACME")).toBe(UNKNOWN_SECTOR);
  expect(exposure).toEqual([{ sector: UNKNOWN_SECTOR, weight: 1 }]);
});

test("a fresh fund profile is used from the store without re-fetching", async () => {
  const store = createInMemorySectorProfileStore();
  await store.set("VFEM.L", {
    kind: "fund",
    weights: [{ sector: "Technology", weight: 1 }],
    source: "provider",
    fetchedAt: new Date().toISOString(),
  });
  const fetchProfile = vi.fn();

  await resolvePortfolioSectors([{ symbol: "VFEM.L", marketValue: 100 }], { store, fetchProfile });

  expect(fetchProfile).not.toHaveBeenCalled();
});

test("a fund profile older than the refresh window is re-fetched and re-persisted with a new fetchedAt", async () => {
  const store = createInMemorySectorProfileStore();
  const staleDate = new Date(
    Date.now() - (FUND_PROFILE_REFRESH_DAYS + 1) * 24 * 60 * 60 * 1000,
  ).toISOString();
  await store.set("VFEM.L", {
    kind: "fund",
    weights: [{ sector: "Technology", weight: 1 }],
    source: "provider",
    fetchedAt: staleDate,
  });
  const fetchProfile = vi.fn(async () => ({
    kind: "fund" as const,
    weights: [{ sector: "Healthcare", weight: 1 }],
    source: "provider" as const,
  }));

  const { sectorBySymbol } = await resolvePortfolioSectors(
    [{ symbol: "VFEM.L", marketValue: 100 }],
    { store, fetchProfile },
  );

  expect(fetchProfile).toHaveBeenCalledTimes(1);
  expect(sectorBySymbol.get("VFEM.L")).toBe("Healthcare");
  const persisted = await store.get("VFEM.L");
  expect(persisted).toMatchObject({ weights: [{ sector: "Healthcare", weight: 1 }] });
  expect(typeof (persisted as { fetchedAt?: string }).fetchedAt).toBe("string");
  expect((persisted as { fetchedAt?: string }).fetchedAt).not.toBe(staleDate);
});

test("a fund profile with no fetchedAt at all is treated as stale and re-fetched", async () => {
  const store = createInMemorySectorProfileStore();
  await store.set("VFEM.L", {
    kind: "fund",
    weights: [{ sector: "Technology", weight: 1 }],
    source: "provider",
  });
  const fetchProfile = vi.fn(async () => ({
    kind: "fund" as const,
    weights: [{ sector: "Healthcare", weight: 1 }],
    source: "provider" as const,
  }));

  await resolvePortfolioSectors([{ symbol: "VFEM.L", marketValue: 100 }], { store, fetchProfile });

  expect(fetchProfile).toHaveBeenCalledTimes(1);
});

test("a failed refresh of a stale fund profile keeps the stale profile instead of degrading to Unknown", async () => {
  const store = createInMemorySectorProfileStore();
  const staleDate = new Date(
    Date.now() - (FUND_PROFILE_REFRESH_DAYS + 1) * 24 * 60 * 60 * 1000,
  ).toISOString();
  await store.set("VFEM.L", {
    kind: "fund",
    weights: [{ sector: "Technology", weight: 1 }],
    source: "provider",
    fetchedAt: staleDate,
  });
  const fetchProfile = vi.fn(async () => {
    throw new Error("yahoo down");
  });

  const { sectorBySymbol } = await resolvePortfolioSectors(
    [{ symbol: "VFEM.L", marketValue: 100 }],
    { store, fetchProfile },
  );

  expect(sectorBySymbol.get("VFEM.L")).toBe("Technology");
  expect(await store.get("VFEM.L")).toMatchObject({ fetchedAt: staleDate });
});

test("a read-only lookup (no fetchProfile) never re-fetches a stale fund profile", async () => {
  const store = createInMemorySectorProfileStore();
  const staleDate = new Date(
    Date.now() - (FUND_PROFILE_REFRESH_DAYS + 1) * 24 * 60 * 60 * 1000,
  ).toISOString();
  await store.set("VFEM.L", {
    kind: "fund",
    weights: [{ sector: "Technology", weight: 1 }],
    source: "provider",
    fetchedAt: staleDate,
  });

  const { sectorBySymbol } = await resolvePortfolioSectors(
    [{ symbol: "VFEM.L", marketValue: 100 }],
    { store },
  );

  expect(sectorBySymbol.get("VFEM.L")).toBe("Technology");
});

test("a stock profile is never re-fetched for staleness even when very old", async () => {
  const store = createInMemorySectorProfileStore();
  await store.set("AAPL", { kind: "stock", sector: "Technology", industry: "Hardware", source: "provider" });
  const fetchProfile = vi.fn();

  await resolvePortfolioSectors([{ symbol: "AAPL", marketValue: 100 }], { store, fetchProfile });

  expect(fetchProfile).not.toHaveBeenCalled();
});
