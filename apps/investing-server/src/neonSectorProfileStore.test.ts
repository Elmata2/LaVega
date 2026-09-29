import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, expect, test } from "vitest";
import type { Database } from "@lavega/database";
import { singleConnectionDatabase } from "@lavega/database/testing";
import { createNeonSectorProfileStore } from "./neonSectorProfileStore.js";

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
  await store.set("aapl", { kind: "stock", sector: "Technology", industry: "Hardware", source: "provider" });
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

test("a fund weight outside the GICS taxonomy is dropped on write, not the whole profile", async () => {
  const store = createNeonSectorProfileStore(db);
  await store.set("BOGUS.L", {
    kind: "fund",
    weights: [
      { sector: "Technology", weight: 0.5 },
      { sector: "Not A Real Sector", weight: 0.5 },
    ],
    source: "provider",
  });
  expect(await store.get("BOGUS.L")).toEqual({
    kind: "fund",
    weights: [{ sector: "Technology", weight: 0.5 }],
    source: "provider",
  });
});
