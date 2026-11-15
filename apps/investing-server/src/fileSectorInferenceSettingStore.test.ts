import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test } from "vitest";
import { createFileSectorInferenceSettingStore } from "./fileSectorInferenceSettingStore.js";

const directories: string[] = [];
afterEach(async () =>
  Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  ),
);

test("defaults to disabled and persists once turned on", async () => {
  const directory = await mkdtemp(join(tmpdir(), "lavega-sector-inference-setting-"));
  directories.push(directory);
  const file = join(directory, "nested", "setting.json");
  expect(await createFileSectorInferenceSettingStore(file).get("local")).toBe(false);

  await createFileSectorInferenceSettingStore(file).set("local", true);

  expect(await createFileSectorInferenceSettingStore(file).get("local")).toBe(true);
});

test("the setting is isolated per tenant on disk", async () => {
  const directory = await mkdtemp(join(tmpdir(), "lavega-sector-inference-setting-tenant-"));
  directories.push(directory);
  const file = join(directory, "setting.json");
  await createFileSectorInferenceSettingStore(file).set("user-a", true);

  expect(await createFileSectorInferenceSettingStore(file).get("user-b")).toBe(false);
});
