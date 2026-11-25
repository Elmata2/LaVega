import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test } from "vitest";
import { createFileDisposalLabelStore } from "./fileDisposalLabelStore.js";

const directories: string[] = [];
afterEach(async () =>
  Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  ),
);

test("persists disposal labels across store instances and reads an unknown tenant as empty", async () => {
  const directory = await mkdtemp(join(tmpdir(), "lavega-disposal-labels-"));
  directories.push(directory);
  const file = join(directory, "nested", "disposal-labels.json");
  await createFileDisposalLabelStore(file).set({
    tenantId: "local",
    entries: [{ disposalId: "sell-1", category: "fx-difference", note: "Broker used spot rate" }],
  });
  await expect(createFileDisposalLabelStore(file).get("local")).resolves.toEqual([
    { disposalId: "sell-1", category: "fx-difference", note: "Broker used spot rate" },
  ]);
  await expect(createFileDisposalLabelStore(file).get("missing")).resolves.toEqual([]);
});

test("drops invalid disposal label categories on write and read", async () => {
  const directory = await mkdtemp(join(tmpdir(), "lavega-disposal-labels-"));
  directories.push(directory);
  const file = join(directory, "disposal-labels.json");
  await createFileDisposalLabelStore(file).set({
    tenantId: "local",
    entries: [{ disposalId: "sell-1", category: "invalid-category" as never }],
  });
  await expect(createFileDisposalLabelStore(file).get("local")).resolves.toEqual([]);
});
