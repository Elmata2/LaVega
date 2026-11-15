import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test } from "vitest";
import { createFileBenchmarkSelectionStore } from "./fileBenchmarkSelectionStore.js";

const directories: string[] = [];
afterEach(async () =>
  Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  ),
);

test("persists ordered benchmark selection across store instances", async () => {
  const directory = await mkdtemp(join(tmpdir(), "lavega-benchmarks-"));
  directories.push(directory);
  const file = join(directory, "nested", "benchmarks.json");
  await createFileBenchmarkSelectionStore(file).set({
    tenantId: "local",
    symbols: ["^AEX", "^GDAXI"],
  });
  await expect(createFileBenchmarkSelectionStore(file).get("local")).resolves.toEqual({
    tenantId: "local",
    symbols: ["^AEX", "^GDAXI"],
  });
});
