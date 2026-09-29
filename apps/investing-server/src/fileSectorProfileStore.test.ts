import { mkdtemp, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { expect, test } from "vitest";
import { createFileSectorProfileStore } from "./fileSectorProfileStore.js";

test("sector profile store persists per-symbol lookups and survives invalid rows", async () => {
  const filePath = join(await mkdtemp(join(tmpdir(), "sectors-")), "sectors.json");
  const store = createFileSectorProfileStore(filePath);
  const profile = {
    kind: "stock" as const,
    sector: "Technology",
    industry: "Software",
    source: "provider" as const,
  };
  await store.set("acme", profile);
  expect(await store.get("ACME")).toEqual(profile);
  expect(await createFileSectorProfileStore(filePath).get("ACME")).toEqual(profile);
});

test("a legacy record with no kind/source field loads as a provider-sourced stock profile", async () => {
  const filePath = join(await mkdtemp(join(tmpdir(), "sectors-")), "sectors.json");
  await writeFile(
    filePath,
    JSON.stringify({ AAPL: { sector: "Technology", industry: "Hardware" } }),
  );
  const store = createFileSectorProfileStore(filePath);
  expect(await store.get("AAPL")).toEqual({
    kind: "stock",
    sector: "Technology",
    industry: "Hardware",
    source: "provider",
  });
});

test("a fund profile round-trips through the file store", async () => {
  const filePath = join(await mkdtemp(join(tmpdir(), "sectors-")), "sectors.json");
  const store = createFileSectorProfileStore(filePath);
  const fund = {
    kind: "fund" as const,
    weights: [{ sector: "Technology", weight: 0.4 }],
    source: "provider" as const,
  };
  await store.set("VFEM.L", fund);
  expect(await store.get("VFEM.L")).toEqual(fund);
});
