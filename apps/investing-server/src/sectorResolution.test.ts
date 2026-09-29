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
    { sector: "Healthcare", weight: 0.5, source: "provider" },
    { sector: "Technology", weight: 0.4, source: "provider" },
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

test("an owner correction outranks a freshly-fetched stock and never invokes the classifier", async () => {
  const store = createInMemorySectorProfileStore();
  const fetchProfile = vi.fn(async (symbol: string) =>
    symbol === "AAPL"
      ? { kind: "stock" as const, sector: "Technology", industry: "Hardware", source: "provider" as const }
      : null,
  );
  const classifier = vi.fn();
  const correction = vi.fn(async (symbol: string) => (symbol === "AAPL" ? "Healthcare" : null));

  const { sectorBySymbol } = await resolvePortfolioSectors(positions, {
    store,
    fetchProfile,
    classifier,
    correction,
  });

  expect(sectorBySymbol.get("AAPL")).toBe("Healthcare");
  // Uncached, so resolveWeights still fetches once — the only way to learn
  // AAPL isn't a fund before trusting the correction — but the correction,
  // not the fetched stock's own sector, is what gets displayed and the
  // classifier is never reached for it.
  expect(fetchProfile).toHaveBeenCalledWith("AAPL");
  expect(classifier).not.toHaveBeenCalledWith(expect.objectContaining({ symbol: "AAPL" }));
});

test("a correction for a symbol with no cached profile is applied directly when no fetch is available", async () => {
  const store = createInMemorySectorProfileStore();
  const correction = vi.fn(async (symbol: string) => (symbol === "AAPL" ? "Healthcare" : null));

  const { sectorBySymbol } = await resolvePortfolioSectors([{ symbol: "AAPL", marketValue: 100 }], {
    store,
    correction,
  });

  expect(sectorBySymbol.get("AAPL")).toBe("Healthcare");
});

test("a correction for a cached stock short-circuits with zero fetch or classifier calls", async () => {
  const store = createInMemorySectorProfileStore();
  await store.set("AAPL", { kind: "stock", sector: "Technology", industry: "Hardware", source: "provider" });
  const fetchProfile = vi.fn();
  const classifier = vi.fn();
  const correction = vi.fn(async (symbol: string) => (symbol === "AAPL" ? "Healthcare" : null));

  const { sectorBySymbol } = await resolvePortfolioSectors([{ symbol: "AAPL", marketValue: 100 }], {
    store,
    fetchProfile,
    classifier,
    correction,
  });

  expect(sectorBySymbol.get("AAPL")).toBe("Healthcare");
  expect(fetchProfile).not.toHaveBeenCalled();
  expect(classifier).not.toHaveBeenCalled();
});

test("a correction suppresses the classifier for a symbol the provider has no answer for", async () => {
  const store = createInMemorySectorProfileStore();
  const classifier = vi.fn(async () => ({
    kind: "classified" as const,
    sector: "Technology",
    specificity: "sector" as const,
    confidence: 0.9,
  }));
  const correction = vi.fn(async (symbol: string) => (symbol === "MYST" ? "Healthcare" : null));

  const { sectorBySymbol } = await resolvePortfolioSectors([{ symbol: "MYST", marketValue: 100 }], {
    store,
    classifier,
    correction,
  });

  expect(sectorBySymbol.get("MYST")).toBe("Healthcare");
  expect(classifier).not.toHaveBeenCalled();
});

test("the same symbol without a correction falls through to the classifier", async () => {
  const store = createInMemorySectorProfileStore();
  const classifier = vi.fn(async () => ({
    kind: "classified" as const,
    sector: "Technology",
    specificity: "sector" as const,
    confidence: 0.9,
  }));

  const { sectorBySymbol } = await resolvePortfolioSectors([{ symbol: "MYST", marketValue: 100 }], {
    store,
    classifier,
  });

  expect(sectorBySymbol.get("MYST")).toBe("Technology");
  expect(classifier).toHaveBeenCalledWith({ symbol: "MYST", description: undefined });
});

test("a correction saved for an uncached symbol that later resolves as a fund shows the fund's weights, correction ignored", async () => {
  const store = createInMemorySectorProfileStore();
  const fetchProfile = vi.fn(async () => ({
    kind: "fund" as const,
    weights: [
      { sector: "Technology", weight: 0.4 },
      { sector: "Healthcare", weight: 0.5 },
    ],
    source: "provider" as const,
  }));
  const correction = vi.fn(async () => "Energy");

  const { sectorBySymbol, weightsBySymbol } = await resolvePortfolioSectors(
    [{ symbol: "VFEM.L", marketValue: 100 }],
    { store, fetchProfile, correction },
  );

  expect(sectorBySymbol.get("VFEM.L")).toBe("Healthcare");
  expect(weightsBySymbol.get("VFEM.L")).toEqual([
    { sector: "Healthcare", weight: 0.5, source: "provider" },
    { sector: "Technology", weight: 0.4, source: "provider" },
  ]);
  expect(await store.get("VFEM.L")).toMatchObject({ kind: "fund" });
});

test("a correction against an already-cached fund is ignored on every later resolution, without re-fetching a fresh fund", async () => {
  const store = createInMemorySectorProfileStore();
  await store.set("VFEM.L", {
    kind: "fund",
    weights: [{ sector: "Technology", weight: 1 }],
    source: "provider",
    fetchedAt: new Date().toISOString(),
  });
  const fetchProfile = vi.fn();
  const correction = vi.fn(async () => "Energy");

  const { sectorBySymbol } = await resolvePortfolioSectors([{ symbol: "VFEM.L", marketValue: 100 }], {
    store,
    fetchProfile,
    correction,
  });

  expect(sectorBySymbol.get("VFEM.L")).toBe("Technology");
  expect(fetchProfile).not.toHaveBeenCalled();
});

test("a correction is re-checked on the very next resolution, not just the first", async () => {
  const store = createInMemorySectorProfileStore();
  const correction = vi.fn(async (symbol: string) => (symbol === "AAPL" ? "Healthcare" : null));

  await resolvePortfolioSectors([{ symbol: "AAPL", marketValue: 100 }], { store, correction });
  const { sectorBySymbol } = await resolvePortfolioSectors([{ symbol: "AAPL", marketValue: 100 }], {
    store,
    correction,
  });

  expect(sectorBySymbol.get("AAPL")).toBe("Healthcare");
  expect(correction).toHaveBeenCalledTimes(2);
});

test("a provider profile is used and the classifier is never called", async () => {
  const store = createInMemorySectorProfileStore();
  const classifier = vi.fn();
  const fetchProfile = vi.fn(async () => ({
    kind: "stock" as const,
    sector: "Technology",
    industry: "Hardware",
    source: "provider" as const,
  }));

  await resolvePortfolioSectors([{ symbol: "AAPL", marketValue: 100 }], { store, fetchProfile, classifier });

  expect(classifier).not.toHaveBeenCalled();
});

test("a classified answer fills a real gap and is persisted with source inferred", async () => {
  const store = createInMemorySectorProfileStore();
  const fetchProfile = vi.fn(async () => null);
  const classifier = vi.fn(async () => ({
    kind: "classified" as const,
    sector: "Technology",
    specificity: "sector" as const,
    confidence: 0.9,
  }));

  const { sectorBySymbol } = await resolvePortfolioSectors(
    [{ symbol: "MYST", marketValue: 100, description: "Myst Robotics" }],
    { store, fetchProfile, classifier },
  );

  expect(sectorBySymbol.get("MYST")).toBe("Technology");
  expect(classifier).toHaveBeenCalledWith({ symbol: "MYST", description: "Myst Robotics" });
  const stored = await store.get("MYST");
  expect(stored).toMatchObject({
    kind: "stock",
    sector: "Technology",
    source: "inferred",
    specificity: "sector",
    confidence: 0.9,
  });
  expect(typeof (stored as { inferredAt?: string }).inferredAt).toBe("string");
});

test("a low-confidence classification is persisted and displayed as its broader division", async () => {
  const store = createInMemorySectorProfileStore();
  const classifier = vi.fn(async () => ({
    kind: "classified" as const,
    sector: "Sensitive",
    specificity: "division" as const,
    confidence: 0.3,
  }));

  const { sectorBySymbol } = await resolvePortfolioSectors([{ symbol: "MYST", marketValue: 100 }], {
    store,
    classifier,
  });

  expect(sectorBySymbol.get("MYST")).toBe("Sensitive");
  expect(await store.get("MYST")).toMatchObject({ sector: "Sensitive", specificity: "division" });
});

test("an explicit no-match is cached as an inferred Unknown, so the classifier isn't re-asked next time", async () => {
  const store = createInMemorySectorProfileStore();
  const classifier = vi.fn(async () => ({ kind: "no-match" as const }));

  const first = await resolvePortfolioSectors([{ symbol: "MYST", marketValue: 100 }], { store, classifier });
  expect(first.sectorBySymbol.get("MYST")).toBe(UNKNOWN_SECTOR);
  expect(await store.get("MYST")).toMatchObject({ source: "inferred" });

  const second = await resolvePortfolioSectors([{ symbol: "MYST", marketValue: 100 }], { store, classifier });
  expect(second.sectorBySymbol.get("MYST")).toBe(UNKNOWN_SECTOR);
  expect(classifier).toHaveBeenCalledTimes(1);
});

test("a failed classification is never cached, so it is retried on the next pass", async () => {
  const store = createInMemorySectorProfileStore();
  const classifier = vi.fn(async () => ({ kind: "failed" as const, reason: "budget refusal" }));

  const first = await resolvePortfolioSectors([{ symbol: "MYST", marketValue: 100 }], { store, classifier });
  expect(first.sectorBySymbol.get("MYST")).toBe(UNKNOWN_SECTOR);
  expect(await store.get("MYST")).toBeNull();

  await resolvePortfolioSectors([{ symbol: "MYST", marketValue: 100 }], { store, classifier });
  expect(classifier).toHaveBeenCalledTimes(2);
});

test("a classifier that throws for one symbol doesn't fail the whole batch, and nothing is cached for it", async () => {
  const store = createInMemorySectorProfileStore();
  const classifier = vi.fn(async (instrument: { symbol: string }) => {
    if (instrument.symbol === "BOOM") throw new Error("System One timed out");
    return { kind: "classified" as const, sector: "Technology", specificity: "sector" as const, confidence: 0.9 };
  });

  const { sectorBySymbol } = await resolvePortfolioSectors(
    [
      { symbol: "BOOM", marketValue: 100 },
      { symbol: "MYST", marketValue: 100 },
    ],
    { store, classifier },
  );

  expect(sectorBySymbol.get("BOOM")).toBe(UNKNOWN_SECTOR);
  expect(sectorBySymbol.get("MYST")).toBe("Technology");
  expect(await store.get("BOOM")).toBeNull();
  expect(await store.get("MYST")).toMatchObject({ source: "inferred" });
});

test("a cached inferred profile is reused without re-invoking the classifier, but the provider is still retried", async () => {
  const store = createInMemorySectorProfileStore();
  await store.set("MYST", {
    kind: "stock",
    sector: "Technology",
    industry: "Unknown",
    source: "inferred",
    specificity: "sector",
    confidence: 0.7,
    inferredAt: new Date().toISOString(),
  });
  const fetchProfile = vi.fn(async () => null);
  const classifier = vi.fn();

  const { sectorBySymbol } = await resolvePortfolioSectors([{ symbol: "MYST", marketValue: 100 }], {
    store,
    fetchProfile,
    classifier,
  });

  expect(classifier).not.toHaveBeenCalled();
  expect(fetchProfile).toHaveBeenCalledWith("MYST");
  expect(sectorBySymbol.get("MYST")).toBe("Technology");
});

test("a later provider answer replaces a cached inferred profile", async () => {
  const store = createInMemorySectorProfileStore();
  await store.set("MYST", {
    kind: "stock",
    sector: "Technology",
    industry: "Unknown",
    source: "inferred",
    specificity: "sector",
    confidence: 0.7,
    inferredAt: new Date().toISOString(),
  });
  const fetchProfile = vi.fn(async () => ({
    kind: "stock" as const,
    sector: "Healthcare",
    industry: "Biotech",
    source: "provider" as const,
  }));

  const { sectorBySymbol } = await resolvePortfolioSectors([{ symbol: "MYST", marketValue: 100 }], {
    store,
    fetchProfile,
  });

  expect(sectorBySymbol.get("MYST")).toBe("Healthcare");
  expect(await store.get("MYST")).toMatchObject({ source: "provider" });
});

test("read-only paths omitting classifier and correction cause no calls and no writes, same as omitting fetchProfile", async () => {
  const store = createInMemorySectorProfileStore();
  const set = vi.spyOn(store, "set");

  const { exposure } = await resolvePortfolioSectors(positions, { store });

  expect(set).not.toHaveBeenCalled();
  expect(exposure).toEqual([{ sector: UNKNOWN_SECTOR, weight: 1 }]);
});

test("an inferred sector outside the GICS-or-division taxonomy is never displayed raw, guarding against an entity name leaking through", async () => {
  const store = createInMemorySectorProfileStore();
  const classifier = vi.fn(async () => ({
    kind: "classified" as const,
    sector: "Private",
    specificity: "sector" as const,
    confidence: 0.95,
  }));

  const { sectorBySymbol, exposure } = await resolvePortfolioSectors([{ symbol: "MYST", marketValue: 100 }], {
    store,
    classifier,
  });

  expect(sectorBySymbol.get("MYST")).toBe(UNKNOWN_SECTOR);
  expect(exposure).toEqual([{ sector: UNKNOWN_SECTOR, weight: 1 }]);
});

test("a division label on a provider-sourced profile is not trusted and resolves to Unknown", async () => {
  const store = createInMemorySectorProfileStore();
  await store.set("ACME", { kind: "stock", sector: "Cyclical", industry: "Widgets", source: "provider" });

  const { sectorBySymbol } = await resolvePortfolioSectors([{ symbol: "ACME", marketValue: 100 }], { store });

  expect(sectorBySymbol.get("ACME")).toBe(UNKNOWN_SECTOR);
});

test("coverage attributes a provider-sourced position to provider and sums to 1", async () => {
  const store = createInMemorySectorProfileStore();
  await store.set("AAPL", { kind: "stock", sector: "Technology", industry: "Hardware", source: "provider" });

  const { coverage } = await resolvePortfolioSectors([{ symbol: "AAPL", marketValue: 100 }], { store });

  expect(coverage).toEqual({ provider: 1, inferred: 0, correction: 0, unknown: 0 });
});

test("coverage attributes an inferred position to inferred", async () => {
  const store = createInMemorySectorProfileStore();
  const classifier = vi.fn(async () => ({
    kind: "classified" as const,
    sector: "Technology",
    specificity: "sector" as const,
    confidence: 0.9,
  }));

  const { coverage } = await resolvePortfolioSectors([{ symbol: "MYST", marketValue: 100 }], {
    store,
    classifier,
  });

  expect(coverage).toEqual({ provider: 0, inferred: 1, correction: 0, unknown: 0 });
});

test("coverage attributes a corrected position to correction, outranking a stored provider profile", async () => {
  const store = createInMemorySectorProfileStore();
  await store.set("AAPL", { kind: "stock", sector: "Technology", industry: "Hardware", source: "provider" });
  const correction = vi.fn(async (symbol: string) => (symbol === "AAPL" ? "Healthcare" : null));

  const { coverage } = await resolvePortfolioSectors([{ symbol: "AAPL", marketValue: 100 }], {
    store,
    correction,
  });

  expect(coverage).toEqual({ provider: 0, inferred: 0, correction: 1, unknown: 0 });
});

test("coverage attributes an unresolved position to unknown", async () => {
  const store = createInMemorySectorProfileStore();

  const { coverage } = await resolvePortfolioSectors([{ symbol: "MYST", marketValue: 100 }], { store });

  expect(coverage).toEqual({ provider: 0, inferred: 0, correction: 0, unknown: 1 });
});

test("coverage splits across a mixed portfolio and sums to 1", async () => {
  const store = createInMemorySectorProfileStore();
  await store.set("AAPL", { kind: "stock", sector: "Technology", industry: "Hardware", source: "provider" });
  const classifier = vi.fn(async ({ symbol }: { symbol: string }) =>
    symbol === "MYST"
      ? {
          kind: "classified" as const,
          sector: "Healthcare",
          specificity: "sector" as const,
          confidence: 0.9,
        }
      : { kind: "no-match" as const },
  );

  const { coverage } = await resolvePortfolioSectors(
    [
      { symbol: "AAPL", marketValue: 500 },
      { symbol: "MYST", marketValue: 300 },
      { symbol: "ACME", marketValue: 200 },
    ],
    { store, classifier },
  );

  expect(coverage.provider).toBeCloseTo(0.5, 12);
  expect(coverage.inferred).toBeCloseTo(0.3, 12);
  expect(coverage.unknown).toBeCloseTo(0.2, 12);
  expect(coverage.provider + coverage.inferred + coverage.correction + coverage.unknown).toBeCloseTo(
    1,
    12,
  );
});
