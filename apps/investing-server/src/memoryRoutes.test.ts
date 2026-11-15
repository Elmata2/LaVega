import { Hono } from "hono";
import { expect, test, vi } from "vitest";
import type { AgentMemoryRepository, Thesis, ThesisMigrationPlanInput } from "@lavega/database";
import { attachMemoryRoutes } from "./memoryRoutes.js";

/* WS4.5 (#297): the thesis migration route moves symbol-keyed theses onto the
 * canonical instrument key, folds identical claims and flags conflicts. */

const thesis = (symbol: string, why: string, overrides: Partial<Thesis> = {}): Thesis => ({
  symbol,
  status: "active",
  why,
  worth: null,
  entry: null,
  wrongIf: null,
  instrumentKey: null,
  reviewRequired: false,
  updatedAt: "2026-11-11T00:00:00.000Z",
  ...overrides,
});

function appWith(
  theses: Thesis[],
  options: { instrumentKeys?: () => Promise<Record<string, string>> } = {},
) {
  const applyThesisMigration = vi.fn(async (plan: ThesisMigrationPlanInput) => ({
    updated: plan.assignments.length,
    merged: plan.merges.flatMap((merge) => merge.mergedSymbols).length,
    reviewed: plan.reviews.flatMap((review) => review.symbols).length,
  }));
  const memory = {
    listTheses: vi.fn(async () => theses),
    applyThesisMigration,
  } as unknown as AgentMemoryRepository;
  const app = new Hono();
  attachMemoryRoutes(app, {
    resolveTenantId: () => "alice",
    memory: () => memory,
    ...(options.instrumentKeys ? { instrumentKeys: options.instrumentKeys } : {}),
  });
  return { app, applyThesisMigration };
}

test("migrates symbol keys to the canonical key and returns the review groups", async () => {
  const { app, applyThesisMigration } = appWith(
    [thesis("GOOGL", "Search winner"), thesis("GOOGL_US_EQ", "Cloud winner")],
    {
      instrumentKeys: async () => ({
        GOOGL: "isin:US02079K3059",
        GOOGL_US_EQ: "isin:US02079K3059",
      }),
    },
  );

  const response = await app.request("/api/memory/instruments/migrate", { method: "POST" });

  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({
    updated: 2,
    merged: 0,
    reviewed: 2,
    reviews: [
      {
        instrumentKey: "isin:US02079K3059",
        symbols: ["GOOGL", "GOOGL_US_EQ"],
        reason: "conflicting-theses",
      },
    ],
  });
  expect(applyThesisMigration).toHaveBeenCalledWith(
    expect.objectContaining({
      assignments: [
        { symbol: "GOOGL", instrumentKey: "isin:US02079K3059" },
        { symbol: "GOOGL_US_EQ", instrumentKey: "isin:US02079K3059" },
      ],
    }),
  );
});

test("folds identical theses and leaves an unplaceable symbol alone", async () => {
  const { app } = appWith(
    [thesis("FB", "Ad monopoly"), thesis("META", "Ad monopoly"), thesis("OLDCO", "Legacy")],
    { instrumentKeys: async () => ({ FB: "isin:US30303M1027", META: "isin:US30303M1027" }) },
  );

  const response = await app.request("/api/memory/instruments/migrate", { method: "POST" });

  expect(await response.json()).toMatchObject({
    merged: 1,
    reviewed: 0,
    reviews: [],
  });
});

test("refuses the migration when instrument identity is unavailable", async () => {
  const { app } = appWith([thesis("GOOGL", "Search winner")]);
  const response = await app.request("/api/memory/instruments/migrate", { method: "POST" });
  expect(response.status).toBe(503);
});

test("a broker read failure is reported, never a guessed identity", async () => {
  const { app } = appWith([thesis("GOOGL", "Search winner")], {
    instrumentKeys: async () => {
      throw new Error("vault is locked");
    },
  });
  const response = await app.request("/api/memory/instruments/migrate", { method: "POST" });
  expect(response.status).toBe(503);
  expect(await response.json()).toEqual({ problems: ["vault is locked"] });
});
