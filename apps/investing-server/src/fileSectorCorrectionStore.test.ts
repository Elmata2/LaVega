import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test } from "vitest";
import { createFileSectorCorrectionStore } from "./fileSectorCorrectionStore.js";

const directories: string[] = [];
afterEach(async () =>
  Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  ),
);

test("persists a correction across store instances", async () => {
  const directory = await mkdtemp(join(tmpdir(), "lavega-sector-correction-"));
  directories.push(directory);
  const file = join(directory, "nested", "corrections.json");
  await createFileSectorCorrectionStore(file).set("local", "aapl", "Healthcare");

  expect(await createFileSectorCorrectionStore(file).get("local", "AAPL")).toBe("Healthcare");
});

test("clearing removes only that tenant's symbol", async () => {
  const directory = await mkdtemp(join(tmpdir(), "lavega-sector-correction-clear-"));
  directories.push(directory);
  const file = join(directory, "corrections.json");
  const store = createFileSectorCorrectionStore(file);
  await store.set("local", "AAPL", "Healthcare");
  await store.set("local", "MSFT", "Technology");

  await store.clear("local", "AAPL");

  expect(await store.get("local", "AAPL")).toBeNull();
  expect(await store.get("local", "MSFT")).toBe("Technology");
});

test("corrections are isolated per tenant on disk", async () => {
  const directory = await mkdtemp(join(tmpdir(), "lavega-sector-correction-tenant-"));
  directories.push(directory);
  const file = join(directory, "corrections.json");
  const store = createFileSectorCorrectionStore(file);
  await store.set("user-a", "AAPL", "Healthcare");

  expect(await store.get("user-b", "AAPL")).toBeNull();
});

test("getAll reads every correction for the tenant from one file read", async () => {
  const directory = await mkdtemp(join(tmpdir(), "lavega-sector-correction-getall-"));
  directories.push(directory);
  const file = join(directory, "corrections.json");
  const store = createFileSectorCorrectionStore(file);
  await store.set("user-a", "AAPL", "Healthcare");
  await store.set("user-a", "MSFT", "Technology");
  await store.set("user-b", "AAPL", "Energy");

  expect(await store.getAll("user-a")).toEqual({ AAPL: "Healthcare", MSFT: "Technology" });
});
