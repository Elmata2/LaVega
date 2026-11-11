// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { beforeEach } from "vitest";
import { IDBFactory } from "fake-indexeddb";
import { createInMemoryPriceStore, createInMemorySharedPriceStore } from "./inMemoryPriceStore.js";
import {
  createIndexedDbPriceStore,
  createIndexedDbSharedPriceStore,
} from "./indexedDbPriceStore.js";
import { registerPriceStoreContract } from "./priceStore.contract.js";
import { registerSharedPriceStoreContract } from "./sharedPriceStore.contract.js";

registerPriceStoreContract("in-memory", createInMemoryPriceStore);

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
});

registerPriceStoreContract("IndexedDB", () => createIndexedDbPriceStore("lavega-prices-contract"));

registerSharedPriceStoreContract("in-memory", createInMemorySharedPriceStore);

registerSharedPriceStoreContract("IndexedDB", () =>
  createIndexedDbSharedPriceStore("lavega-prices-shared-contract"),
);
