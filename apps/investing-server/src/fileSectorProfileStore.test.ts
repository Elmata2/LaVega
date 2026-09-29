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

test("a fund record's non-GICS weight is dropped on read; a valid weight in the same record survives", async () => {
  const filePath = join(await mkdtemp(join(tmpdir(), "sectors-")), "sectors.json");
  await writeFile(
    filePath,
    JSON.stringify({
      "VFEM.L": {
        kind: "fund",
        weights: [
          { sector: "Whatever", weight: 0.4 },
          { sector: "Technology", weight: 0.6 },
        ],
        source: "provider",
      },
    }),
  );
  const store = createFileSectorProfileStore(filePath);
  expect(await store.get("VFEM.L")).toEqual({
    kind: "fund",
    weights: [{ sector: "Technology", weight: 0.6 }],
    source: "provider",
  });
});

test("a fund record's out-of-range weight is dropped on read; a valid weight in the same record survives", async () => {
  const filePath = join(await mkdtemp(join(tmpdir(), "sectors-")), "sectors.json");
  await writeFile(
    filePath,
    JSON.stringify({
      "VFEM.L": {
        kind: "fund",
        weights: [
          { sector: "Energy", weight: 1.2 },
          { sector: "Utilities", weight: -0.1 },
          { sector: "Technology", weight: 0.6 },
        ],
        source: "provider",
      },
    }),
  );
  const store = createFileSectorProfileStore(filePath);
  expect(await store.get("VFEM.L")).toEqual({
    kind: "fund",
    weights: [{ sector: "Technology", weight: 0.6 }],
    source: "provider",
  });
});

test("set() strips a fund profile's invalid weights before persisting", async () => {
  const filePath = join(await mkdtemp(join(tmpdir(), "sectors-")), "sectors.json");
  const store = createFileSectorProfileStore(filePath);
  await store.set("VFEM.L", {
    kind: "fund",
    weights: [
      { sector: "Whatever", weight: 0.4 },
      { sector: "Technology", weight: 0.6 },
    ],
    source: "provider",
  });
  expect(await store.get("VFEM.L")).toEqual({
    kind: "fund",
    weights: [{ sector: "Technology", weight: 0.6 }],
    source: "provider",
  });
});
