// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { beforeEach } from "vitest";
import { IDBFactory } from "fake-indexeddb";
import { createInMemoryPriceStore } from "./inMemoryPriceStore.js";
import { createIndexedDbPriceStore } from "./indexedDbPriceStore.js";
import { registerPriceStoreContract } from "./priceStore.contract.js";

registerPriceStoreContract("in-memory", createInMemoryPriceStore);

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
});

registerPriceStoreContract("IndexedDB", () => createIndexedDbPriceStore("lavega-prices-contract"));
