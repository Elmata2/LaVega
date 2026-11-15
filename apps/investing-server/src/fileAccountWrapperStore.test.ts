import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test } from "vitest";
import { createFileAccountWrapperStore } from "./fileAccountWrapperStore.js";

const directories: string[] = [];
afterEach(async () =>
  Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  ),
);

test("persists account labels across store instances and reads an unknown tenant as empty", async () => {
  const directory = await mkdtemp(join(tmpdir(), "lavega-account-wrappers-"));
  directories.push(directory);
  const file = join(directory, "nested", "account-wrappers.json");
  await createFileAccountWrapperStore(file).set({
    tenantId: "local",
    entries: [{ broker: "trading212", account: "ISA", wrapper: "isa" }],
  });
  await expect(createFileAccountWrapperStore(file).get("local")).resolves.toEqual([
    { broker: "trading212", account: "ISA", wrapper: "isa" },
  ]);
  await expect(createFileAccountWrapperStore(file).get("missing")).resolves.toEqual([]);
});

test("an invalid wrapper label never reaches the report", async () => {
  const directory = await mkdtemp(join(tmpdir(), "lavega-account-wrappers-"));
  directories.push(directory);
  const file = join(directory, "account-wrappers.json");
  await createFileAccountWrapperStore(file).set({
    tenantId: "local",
    entries: [{ broker: "ibkr", account: "Main", wrapper: "tax-free-ish" as never }],
  });
  await expect(createFileAccountWrapperStore(file).get("local")).resolves.toEqual([]);
});
