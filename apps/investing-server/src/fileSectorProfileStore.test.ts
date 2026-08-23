import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { expect, test } from "vitest";
import { createFileSectorProfileStore } from "./fileSectorProfileStore.js";

test("sector profile store persists per-symbol lookups and survives invalid rows", async () => {
  const filePath = join(await mkdtemp(join(tmpdir(), "sectors-")), "sectors.json");
  const store = createFileSectorProfileStore(filePath);
  await store.set("acme", { sector: "Technology", industry: "Software" });
  expect(await store.get("ACME")).toEqual({ sector: "Technology", industry: "Software" });
  expect(await createFileSectorProfileStore(filePath).get("ACME")).toEqual({ sector: "Technology", industry: "Software" });
});
