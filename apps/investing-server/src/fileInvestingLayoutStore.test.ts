import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test } from "vitest";
import { createFileInvestingLayoutStore } from "./fileInvestingLayoutStore.js";

const directories: string[] = [];
afterEach(async () =>
  Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  ),
);

test("persists a layout selection across store instances", async () => {
  const directory = await mkdtemp(join(tmpdir(), "lavega-investing-layout-"));
  directories.push(directory);
  const file = join(directory, "nested", "layout.json");
  await createFileInvestingLayoutStore(file).set({
    tenantId: "local",
    modules: { agents: false },
    widgets: { sectors: false },
  });
  await expect(createFileInvestingLayoutStore(file).get("local")).resolves.toEqual({
    modules: { agents: false },
    widgets: { sectors: false },
  });
});

test("an unknown tenant reads back an empty layout", async () => {
  const directory = await mkdtemp(join(tmpdir(), "lavega-investing-layout-"));
  directories.push(directory);
  const file = join(directory, "layout.json");
  await expect(createFileInvestingLayoutStore(file).get("missing")).resolves.toEqual({
    modules: {},
    widgets: {},
  });
});
