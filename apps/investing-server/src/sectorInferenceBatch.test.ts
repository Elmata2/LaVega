import { expect, test, vi } from "vitest";
import type { CurrentPosition } from "@lavega/core";
import { createInMemorySectorProfileStore } from "./inMemorySectorProfileStore.js";
import type { SectorProfileStore } from "./inMemorySectorProfileStore.js";
import { inferSectorBatch, SECTOR_INFERENCE_BATCH_SIZE } from "./sectorInferenceBatch.js";
import type { SectorClassifier } from "./sectorClassifier.js";

function priced(symbol: string, marketValue: number, description?: string): CurrentPosition {
  return {
    symbol,
    entity: "personal",
    ...(description ? { description } : {}),
    quantity: 1,
    currency: "EUR",
    asOf: "2026-08-18",
    marketValue,
    portfolioWeight: null,
    priceStatus: "priced",
    returns: {
      status: "unpriced",
      remainingCostBasis: 0,
      realizedCostBasisRemoved: 0,
      unrealizedGain: 0,
      realizedGain: 0,
      dividendsReceived: 0,
      totalReturn: 0,
      totalReturnPercentage: null,
      sinceFirstBuyPercentage: null,
      firstBuyDate: null,
    },
  };
}

function classified(sector: string, confidence: number) {
  return { kind: "classified" as const, sector, specificity: "sector" as const, confidence };
}

function infer(input: {
  priced: CurrentPosition[];
  store?: SectorProfileStore;
  exclude?: string[];
  corrections?: Record<string, string>;
  resolveListing?: (symbol: string) => Promise<string | null>;
  classifier?: SectorClassifier;
  batchSize?: number;
}) {
  return inferSectorBatch({
    tenantId: "local",
    priced: input.priced,
    exclude: new Set(input.exclude ?? []),
    corrections: input.corrections ?? {},
    resolveListing: input.resolveListing ?? (async () => null),
    store: input.store ?? createInMemorySectorProfileStore(),
    ...(input.classifier ? { classifier: input.classifier } : {}),
    batchSize: input.batchSize ?? SECTOR_INFERENCE_BATCH_SIZE,
  });
}

test("is a no-op, returning the zero result, when no classifier is configured", async () => {
  const result = await infer({ priced: [priced("MYST", 100)] });

  expect(result).toEqual({ classified: 0, failed: 0, failedSymbols: [], remaining: 0 });
});

test("classifies unknown priced symbols and caches the result", async () => {
  const store = createInMemorySectorProfileStore();
  const classifier = vi.fn(async () => classified("Industrials", 0.9));

  const result = await infer({ priced: [priced("MYST", 100, "Myst Robotics")], store, classifier });

  expect(result).toEqual({ classified: 1, failed: 0, failedSymbols: [], remaining: 0 });
  expect(classifier).toHaveBeenCalledWith({ symbol: "MYST", description: "Myst Robotics" });
  expect(await store.get("MYST")).toMatchObject({ sector: "Industrials", source: "inferred" });
});

test("skips a renamed holding already cached under its price-resolved listing, and never calls the classifier for it", async () => {
  const store = createInMemorySectorProfileStore();
  await store.set("HIMS", {
    kind: "stock",
    sector: "Healthcare",
    industry: "Health Information Services",
    source: "provider",
  });
  const classifier = vi.fn();

  const result = await infer({
    priced: [priced("OAC_US_EQ", 100)],
    store,
    resolveListing: async (symbol) => (symbol === "OAC_US_EQ" ? "HIMS" : null),
    classifier,
  });

  expect(result).toEqual({ classified: 0, failed: 0, failedSymbols: [], remaining: 0 });
  expect(classifier).not.toHaveBeenCalled();
});

test("classifies a renamed holding under its price-resolved listing when nothing is cached yet", async () => {
  const store = createInMemorySectorProfileStore();
  const classifier = vi.fn(async () => classified("Healthcare", 0.9));

  const result = await infer({
    priced: [priced("OAC_US_EQ", 100, "Hims & Hers Health")],
    store,
    resolveListing: async (symbol) => (symbol === "OAC_US_EQ" ? "HIMS" : null),
    classifier,
  });

  expect(result).toEqual({ classified: 1, failed: 0, failedSymbols: [], remaining: 0 });
  expect(await store.get("HIMS")).toMatchObject({ sector: "Healthcare", source: "inferred" });
  expect(await store.get("OAC_US_EQ")).toBeNull();
});

test("classifies two broker symbols that resolve to the same listing only once", async () => {
  const store = createInMemorySectorProfileStore();
  const classifier = vi.fn(async () => classified("Healthcare", 0.9));

  const result = await infer({
    priced: [
      priced("OAC_US_EQ", 100, "Hims & Hers Health"),
      priced("HIMS_OLD", 50, "Hims & Hers Health"),
    ],
    store,
    resolveListing: async (symbol) =>
      symbol === "OAC_US_EQ" || symbol === "HIMS_OLD" ? "HIMS" : null,
    classifier,
  });

  expect(classifier).toHaveBeenCalledTimes(1);
  expect(result).toEqual({ classified: 1, failed: 0, failedSymbols: [], remaining: 0 });
  expect(await store.get("HIMS")).toMatchObject({ sector: "Healthcare", source: "inferred" });
});

test("reports classified vs failed separately, and caches nothing for a failing classifier", async () => {
  const store = createInMemorySectorProfileStore();
  const classifier = vi.fn(async ({ symbol }: { symbol: string }) =>
    symbol === "BOOM"
      ? { kind: "failed" as const, reason: "budget refusal" }
      : classified("Technology", 0.9),
  );

  const result = await infer({
    priced: [priced("BOOM", 100), priced("MYST", 100)],
    store,
    classifier,
  });

  expect(result).toEqual({ classified: 1, failed: 1, failedSymbols: ["BOOM"], remaining: 0 });
  expect(await store.get("BOOM")).toBeNull();
  expect(await store.get("MYST")).toMatchObject({ source: "inferred" });
});

test("skips symbols in the exclude list and classifies the next candidates instead", async () => {
  const classifier = vi.fn(async () => classified("Technology", 0.9));

  const result = await infer({
    priced: [priced("BOOM", 100), priced("MYST", 100)],
    exclude: ["BOOM"],
    classifier,
  });

  expect(result).toEqual({ classified: 1, failed: 0, failedSymbols: [], remaining: 0 });
  expect(classifier).toHaveBeenCalledTimes(1);
  expect(classifier).toHaveBeenCalledWith(expect.objectContaining({ symbol: "MYST" }));
});

test("skips a symbol that already has a stored profile or an owner correction", async () => {
  const store = createInMemorySectorProfileStore();
  await store.set("AAPL", {
    kind: "stock",
    sector: "Technology",
    industry: "Hardware",
    source: "provider",
  });
  const classifier = vi.fn();

  const result = await infer({
    priced: [priced("AAPL", 100), priced("MSFT", 100)],
    store,
    corrections: { MSFT: "Healthcare" },
    classifier,
  });

  expect(result).toEqual({ classified: 0, failed: 0, failedSymbols: [], remaining: 0 });
  expect(classifier).not.toHaveBeenCalled();
});

test("bounds how many unknown symbols it classifies in one call", async () => {
  const classifier = vi.fn(async () => ({ kind: "no-match" as const }));
  const positions = Array.from({ length: 15 }, (_, index) => priced(`SYM${index}`, 100));

  const result = await infer({ priced: positions, classifier });

  expect(result).toEqual({ classified: 10, failed: 0, failedSymbols: [], remaining: 5 });
  expect(classifier).toHaveBeenCalledTimes(10);
});
