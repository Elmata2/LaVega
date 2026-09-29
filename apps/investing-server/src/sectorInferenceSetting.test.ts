import { expect, test } from "vitest";
import { createInMemorySectorInferenceSettingStore } from "./sectorInferenceSetting.js";

test("defaults to disabled for a tenant that never set it", async () => {
  const store = createInMemorySectorInferenceSettingStore();
  expect(await store.get("user-a")).toBe(false);
});

test("a tenant can turn it on and read it back", async () => {
  const store = createInMemorySectorInferenceSettingStore();
  await store.set("user-a", true);
  expect(await store.get("user-a")).toBe(true);
});

test("the setting is isolated per tenant", async () => {
  const store = createInMemorySectorInferenceSettingStore();
  await store.set("user-a", true);
  expect(await store.get("user-b")).toBe(false);
});
