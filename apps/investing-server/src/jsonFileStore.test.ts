import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import { createJsonFileStore } from "./jsonFileStore.js";

test("failed JSON rename leaves memory and disk at last committed state", async () => {
  const directory = await mkdtemp(join(tmpdir(), "lavega-json-store-"));
  const path = join(directory, "state.json");
  let failRename = false;
  const fs = {
    mkdir,
    readFile,
    writeFile,
    rename: async (...args: Parameters<typeof rename>) => {
      if (failRename) {
        failRename = false;
        throw new Error("injected rename failure");
      }
      return rename(...args);
    },
  };
  const open = () =>
    createJsonFileStore(path, { empty: { values: [] as string[] }, validate: JSON.parse }, fs);
  try {
    const store = open();
    await store.update((current) => ({ values: [...current.values, "first"] }));
    failRename = true;
    await expect(
      store.update((current) => {
        current.values.push("rejected");
        return current;
      }),
    ).rejects.toThrow("injected rename failure");
    expect(await store.read()).toEqual({ values: ["first"] });
    expect(await open().read()).toEqual({ values: ["first"] });
    await store.update((current) => ({ values: [...current.values, "later"] }));
    expect(await open().read()).toEqual({ values: ["first", "later"] });
    await Promise.all([
      store.update((current) => ({ values: [...current.values, "a"] })),
      store.update((current) => ({ values: [...current.values, "b"] })),
    ]);
    expect(await open().read()).toEqual({ values: ["first", "later", "a", "b"] });
    const returned = await store.read();
    returned.values.push("read mutation");
    expect(await store.read()).toEqual({ values: ["first", "later", "a", "b"] });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
