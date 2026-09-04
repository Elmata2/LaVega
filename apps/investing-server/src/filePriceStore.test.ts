import { mkdtempSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test } from "vitest";
import { registerPriceStoreContract } from "@lavega/adapters/src/prices/priceStore.contract.js";
import { createFilePriceStore, runtimePriceStoreFile } from "./filePriceStore.js";

const temporaryDirectories: string[] = [];
afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

registerPriceStoreContract("file", () => {
  const directory = mkdtempSync(join(tmpdir(), "lavega-price-store-contract-"));
  temporaryDirectories.push(directory);
  return createFilePriceStore(join(directory, "prices.json"));
});

test("runtime price store file prefers INVESTING_PRICE_STORE_FILE", () => {
  const previous = process.env.INVESTING_PRICE_STORE_FILE;
  process.env.INVESTING_PRICE_STORE_FILE = "/tmp/custom-prices.json";
  try {
    expect(runtimePriceStoreFile()).toBe("/tmp/custom-prices.json");
  } finally {
    if (previous === undefined) delete process.env.INVESTING_PRICE_STORE_FILE;
    else process.env.INVESTING_PRICE_STORE_FILE = previous;
  }
});

test("persists price bars across store instances and purges them", async () => {
  const directory = await mkdtemp(join(tmpdir(), "lavega-price-store-"));
  temporaryDirectories.push(directory);
  const filePath = join(directory, "nested", "prices.json");
  const first = createFilePriceStore(filePath);
  await Promise.all([
    first.upsert("local", [{ symbol: "AAPL", date: "2026-01-02", close: 101, currency: "USD" }]),
    first.upsert("local", [{ symbol: "MSFT", date: "2026-01-02", close: 201, currency: "USD" }]),
  ]);

  const second = createFilePriceStore(filePath);
  await expect(second.getRange("local", "AAPL", "2026-01-01", "2026-01-03")).resolves.toEqual([
    { symbol: "AAPL", date: "2026-01-02", close: 101, currency: "USD" },
  ]);
  await expect(second.getRange("local", "MSFT", "2026-01-01", "2026-01-03")).resolves.toEqual([
    { symbol: "MSFT", date: "2026-01-02", close: 201, currency: "USD" },
  ]);
  await expect(second.lastDate("local", "AAPL")).resolves.toBe("2026-01-02");
  await second.purgeAll();
  await expect(second.getRange("local", "AAPL")).resolves.toEqual([]);
  await expect(readFile(filePath, "utf8")).resolves.toBe("[]");
});

test("rejects malformed cache rows instead of serving invalid prices", async () => {
  const directory = await mkdtemp(join(tmpdir(), "lavega-price-store-invalid-"));
  temporaryDirectories.push(directory);
  const filePath = join(directory, "prices.json");
  await writeFile(filePath, JSON.stringify([{ symbol: "AAPL", close: "not-a-number" }]));

  await expect(createFilePriceStore(filePath).getRange("local", "AAPL")).rejects.toThrow(
    "Invalid price cache file",
  );
});
