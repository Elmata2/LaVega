import { expect, test, vi } from "vitest";
import {
  buildCompositionProjection,
  emptyInvestingDashboard,
  type InvestingDashboardData,
  type InvestingDashboardPosition,
} from "@lavega/core";
import { createSectorReader } from "./sectorRead.js";
import { createInMemorySectorProfileStore } from "./inMemorySectorProfileStore.js";
import { createInMemorySectorCorrectionStore } from "./sectorCorrectionStore.js";
import { createInMemorySectorInferenceSettingStore } from "./sectorInferenceSetting.js";
import { createInMemorySectorRevisionStore } from "./sectorRevision.js";
import { createInMemoryMarketDataConsentStore } from "./marketDataConsent.js";

const position = (symbol: string, marketValue: number): InvestingDashboardPosition =>
  ({
    symbol,
    entity: "personal",
    quantity: 1,
    marketValue,
    portfolioWeight: null,
    priceStatus: "priced",
    currency: "EUR",
    asOf: "2026-08-18",
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
  }) as unknown as InvestingDashboardPosition;

function dashboardWith(positions: InvestingDashboardPosition[]): InvestingDashboardData {
  const dashboard = { ...emptyInvestingDashboard(), positions };
  return { ...dashboard, composition: buildCompositionProjection(positions) };
}

function harness(options?: {
  positions?: InvestingDashboardPosition[];
  consented?: boolean;
  inferenceEnabled?: boolean;
}) {
  const positions = options?.positions ?? [position("AAPL", 100)];
  const store = createInMemorySectorProfileStore();
  const corrections = createInMemorySectorCorrectionStore();
  const inferenceSetting = createInMemorySectorInferenceSettingStore();
  const consent = createInMemoryMarketDataConsentStore();
  const revision = createInMemorySectorRevisionStore();
  const fetchProfile = vi.fn(async () => null);
  let current = positions;
  void consent.set({
    tenantId: "local",
    accepted: options?.consented ?? true,
    decidedAt: null,
    disclosureVersion: "yahoo-finance-v1",
  });
  void inferenceSetting.set("local", options?.inferenceEnabled ?? false);
  const reader = createSectorReader({
    dashboard: async () => dashboardWith(current),
    store,
    fetchProfile,
    corrections,
    inferenceSetting,
    consent,
    revision: (tenantId) => revision.get(tenantId),
    resolveListing: async (_tenantId, symbol) => symbol,
  });
  return {
    reader,
    store,
    corrections,
    inferenceSetting,
    revision,
    fetchProfile,
    setPositions: (next: InvestingDashboardPosition[]) => {
      current = next;
    },
  };
}

test("returns the value-weighted exposure and coverage over the current positions", async () => {
  const h = harness();
  await h.store.set("AAPL", {
    kind: "stock",
    sector: "Technology",
    industry: "Hardware",
    source: "provider",
  });

  const result = await h.reader({ tenantId: "local" });

  expect(result.sectors).toEqual([{ sector: "Technology", weight: 1 }]);
  expect(result.sectorCoverage).toEqual({ provider: 1, inferred: 0, correction: 0, unknown: 0 });
  expect(result.revision).toBe(0);
});

test("a correction raises the revision and appears on the very next read", async () => {
  const h = harness();
  await h.store.set("AAPL", {
    kind: "stock",
    sector: "Technology",
    industry: "Hardware",
    source: "provider",
  });
  expect((await h.reader({ tenantId: "local" })).sectors).toEqual([
    { sector: "Technology", weight: 1 },
  ]);

  await h.corrections.set("local", "AAPL", "Healthcare");
  await h.revision.raise("local");

  const result = await h.reader({ tenantId: "local" });
  expect(result.sectors).toEqual([{ sector: "Healthcare", weight: 1 }]);
  expect(result.sectorCoverage).toEqual({ provider: 0, inferred: 0, correction: 1, unknown: 0 });
  expect(result.revision).toBe(1);
});

test("a data-version write keeps the resolution cached but re-weights over the current positions", async () => {
  const h = harness({ positions: [position("AAPL", 100), position("MSFT", 100)] });
  await h.store.set("AAPL", {
    kind: "stock",
    sector: "Technology",
    industry: "Hardware",
    source: "provider",
  });
  await h.store.set("MSFT", {
    kind: "stock",
    sector: "Technology",
    industry: "Software",
    source: "provider",
  });
  const get = vi.spyOn(h.store, "get");

  await h.reader({ tenantId: "local" });
  expect(get).toHaveBeenCalledTimes(2);

  /* A broker or price write moves the values but not the sector revision. */
  h.setPositions([position("AAPL", 300), position("MSFT", 100)]);
  const second = await h.reader({ tenantId: "local" });

  expect(get).toHaveBeenCalledTimes(2);
  expect(second.revision).toBe(0);
  expect(second.sectors).toEqual([{ sector: "Technology", weight: 1 }]);
});

test("a broker sync that adds a holding resolves it, and one that does not keeps the cache", async () => {
  const h = harness({ positions: [position("AAPL", 100)] });
  await h.store.set("AAPL", {
    kind: "stock",
    sector: "Technology",
    industry: "Hardware",
    source: "provider",
  });
  const get = vi.spyOn(h.store, "get");
  await h.reader({ tenantId: "local" });
  expect(get).toHaveBeenCalledTimes(1);

  h.setPositions([position("AAPL", 100), position("MSFT", 100)]);
  await h.store.set("MSFT", {
    kind: "stock",
    sector: "Healthcare",
    industry: "Health Information Services",
    source: "provider",
  });
  const next = await h.reader({ tenantId: "local" });

  expect(get).toHaveBeenCalledTimes(2);
  expect(next.revision).toBe(0);
  expect(next.sectors).toEqual([
    { sector: "Healthcare", weight: 0.5 },
    { sector: "Technology", weight: 0.5 },
  ]);
});

test("an unconsented tenant sees no inferred sector, counting it as unknown", async () => {
  const h = harness({ consented: false });
  await h.store.set("MYST", {
    kind: "stock",
    sector: "Healthcare",
    industry: "Unknown",
    source: "inferred",
    specificity: "sector",
    confidence: 0.82,
    inferredAt: "2026-09-01T00:00:00.000Z",
  });

  const result = await h.reader({ tenantId: "local" });

  expect(result.sectors).toEqual([{ sector: "Unknown", weight: 1 }]);
  expect(result.sectorCoverage).toEqual({ provider: 0, inferred: 0, correction: 0, unknown: 1 });
});

test("inference off hides a cached inferred sector even with consent", async () => {
  const h = harness({ consented: true, inferenceEnabled: false });
  await h.store.set("MYST", {
    kind: "stock",
    sector: "Healthcare",
    industry: "Unknown",
    source: "inferred",
    specificity: "sector",
    confidence: 0.82,
    inferredAt: "2026-09-01T00:00:00.000Z",
  });

  const result = await h.reader({ tenantId: "local" });

  expect(result.sectors).toEqual([{ sector: "Unknown", weight: 1 }]);
});

test("a correction outranks a provider profile", async () => {
  const h = harness();
  await h.store.set("AAPL", {
    kind: "stock",
    sector: "Technology",
    industry: "Hardware",
    source: "provider",
  });
  await h.corrections.set("local", "AAPL", "Energy");
  await h.revision.raise("local");

  const result = await h.reader({ tenantId: "local" });

  expect(result.sectors).toEqual([{ sector: "Energy", weight: 1 }]);
  expect(result.sectorCoverage).toEqual({ provider: 0, inferred: 0, correction: 1, unknown: 0 });
});
