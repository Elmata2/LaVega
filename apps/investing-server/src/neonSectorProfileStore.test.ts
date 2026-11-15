import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, expect, test } from "vitest";
import type { Database } from "@lavega/database";
import { singleConnectionDatabase } from "@lavega/database/testing";
import { createNeonSectorProfileStore } from "./neonSectorProfileStore.js";
import { describeSectorAttemptContract } from "./sectorProfileStoreContract.testing.js";

const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), "../../../db/migrations");
let pglite: PGlite;
let db: Database;

beforeAll(async () => {
  pglite = new PGlite();
  await pglite.exec("CREATE ROLE lavega_runtime LOGIN NOSUPERUSER;");
  for (const name of readdirSync(migrationsDir)
    .filter((name) => name.endsWith(".sql"))
    .sort())
    await pglite.exec(readFileSync(join(migrationsDir, name), "utf8"));
  await pglite.exec("SET ROLE lavega_runtime;");
  db = singleConnectionDatabase(pglite);
}, 60_000);

afterAll(async () => {
  await pglite.close();
});

test("round-trips a stock and a fund profile, keyed case-insensitively", async () => {
  const store = createNeonSectorProfileStore(db);
  await store.set("aapl", {
    kind: "stock",
    sector: "Technology",
    industry: "Hardware",
    source: "provider",
  });
  expect(await store.get("AAPL")).toEqual({
    kind: "stock",
    sector: "Technology",
    industry: "Hardware",
    source: "provider",
  });
  expect(await store.get("MISSING")).toBeNull();
});

test("set overwrites the same symbol rather than erroring on conflict", async () => {
  const store = createNeonSectorProfileStore(db);
  await store.set("VFEM.L", { kind: "fund", weights: [], source: "provider" });
  await store.set("VFEM.L", {
    kind: "fund",
    weights: [{ sector: "Technology", weight: 0.5 }],
    source: "provider",
  });
  expect(await store.get("VFEM.L")).toEqual({
    kind: "fund",
    weights: [{ sector: "Technology", weight: 0.5 }],
    source: "provider",
  });
});

test("a fund profile's fetchedAt round-trips through the Neon-backed store", async () => {
  const store = createNeonSectorProfileStore(db);
  const fetchedAt = "2026-01-01T00:00:00.000Z";
  await store.set("VWRL.L", {
    kind: "fund",
    weights: [{ sector: "Technology", weight: 0.5 }],
    source: "provider",
    fetchedAt,
  });
  expect(await store.get("VWRL.L")).toEqual({
    kind: "fund",
    weights: [{ sector: "Technology", weight: 0.5 }],
    source: "provider",
    fetchedAt,
  });
});

test("an inferred write never overwrites an existing provider profile", async () => {
  const store = createNeonSectorProfileStore(db);
  await store.set("AAPL", {
    kind: "stock",
    sector: "Technology",
    industry: "Hardware",
    source: "provider",
  });

  await store.set("AAPL", {
    kind: "stock",
    sector: "Healthcare",
    industry: "Unknown",
    source: "inferred",
    specificity: "sector",
    confidence: 0.9,
    inferredAt: "2026-09-01T00:00:00.000Z",
  });

  expect(await store.get("AAPL")).toMatchObject({ sector: "Technology", source: "provider" });
});

test("a provider write still replaces an existing provider profile", async () => {
  const store = createNeonSectorProfileStore(db);
  await store.set("MSFT", {
    kind: "stock",
    sector: "Technology",
    industry: "Hardware",
    source: "provider",
  });

  await store.set("MSFT", {
    kind: "stock",
    sector: "Healthcare",
    industry: "Biotech",
    source: "provider",
  });

  expect(await store.get("MSFT")).toMatchObject({ sector: "Healthcare", source: "provider" });
});

describeSectorAttemptContract("neon store", () => createNeonSectorProfileStore(db));

test("recordProviderAttempt on a new symbol stores a kind none row that reads as null", async () => {
  const store = createNeonSectorProfileStore(db);
  await store.recordProviderAttempt("NOROW", "2026-11-10T10:00:00.000Z");
  const row = await pglite.query<{ profile: unknown }>(
    "SELECT profile FROM investing.sector_profiles WHERE symbol = 'NOROW'",
  );
  expect(row.rows[0]?.profile).toEqual({
    kind: "none",
    providerAttemptedAt: "2026-11-10T10:00:00.000Z",
  });
  expect(await store.get("NOROW")).toBeNull();
});

test("recordProviderAttempt on an existing profile only adds the providerAttemptedAt key", async () => {
  const store = createNeonSectorProfileStore(db);
  await store.set("KEEP", { kind: "stock", sector: "Energy", industry: "Oil", source: "provider" });
  await store.recordProviderAttempt("KEEP", "2026-11-10T10:00:00.000Z");
  const row = await pglite.query<{ profile: unknown }>(
    "SELECT profile FROM investing.sector_profiles WHERE symbol = 'KEEP'",
  );
  expect(row.rows[0]?.profile).toEqual({
    kind: "stock",
    sector: "Energy",
    industry: "Oil",
    source: "provider",
    providerAttemptedAt: "2026-11-10T10:00:00.000Z",
  });
});

test("an inferred write keeps providerAttemptedAt in the stored row; a provider write drops it", async () => {
  const store = createNeonSectorProfileStore(db);
  await store.recordProviderAttempt("INF", "2026-11-10T10:00:00.000Z");
  await store.set("INF", {
    kind: "stock",
    sector: "Energy",
    industry: "Unknown",
    source: "inferred",
    specificity: "sector",
    confidence: 0.7,
    inferredAt: "2026-11-10T11:00:00.000Z",
  });
  const kept = await pglite.query<{ profile: Record<string, unknown> }>(
    "SELECT profile FROM investing.sector_profiles WHERE symbol = 'INF'",
  );
  expect(kept.rows[0]?.profile.providerAttemptedAt).toBe("2026-11-10T10:00:00.000Z");
  await store.set("INF", { kind: "stock", sector: "Energy", industry: "Oil", source: "provider" });
  const replaced = await pglite.query<{ profile: Record<string, unknown> }>(
    "SELECT profile FROM investing.sector_profiles WHERE symbol = 'INF'",
  );
  expect(replaced.rows[0]?.profile).not.toHaveProperty("providerAttemptedAt");
});
