import { mkdtempSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test } from "vitest";
import { registerPriceStoreContract } from "@lavega/adapters/src/prices/priceStore.contract.js";
import { registerSharedPriceStoreContract } from "@lavega/adapters/src/prices/sharedPriceStore.contract.js";
import {
  createFilePriceStore,
  createFileSharedPriceStore,
  runtimePriceStoreFile,
} from "./filePriceStore.js";

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

registerSharedPriceStoreContract("file", () => {
  const directory = mkdtempSync(join(tmpdir(), "lavega-shared-price-contract-"));
  temporaryDirectories.push(directory);
  return createFileSharedPriceStore(join(directory, "prices.json"));
});

test("the shared file store survives a restart and keeps one series per instrument", async () => {
  const directory = await mkdtemp(join(tmpdir(), "lavega-shared-price-store-"));
  temporaryDirectories.push(directory);
  const filePath = join(directory, "prices.json");
  const first = createFileSharedPriceStore(filePath);
  await first.upsert("isin:US0378331005:USD", [
    { date: "2026-01-02", close: 201, currency: "USD" },
  ]);
  await first.putCoverage("isin:US0378331005:USD", {
    from: "2026-01-02",
    to: "2026-01-02",
    listing: "AAPL.US",
    currency: "USD",
    provider: "yahoo",
  });

  const second = createFileSharedPriceStore(filePath);
  await expect(second.getRange({ key: "isin:US0378331005:USD" })).resolves.toEqual([
    { date: "2026-01-02", close: 201, currency: "USD" },
  ]);
  await expect(second.getCoverage({ key: "isin:US0378331005:USD" })).resolves.toMatchObject({
    listing: "AAPL.US",
    provider: "yahoo",
  });
});

test("the shared file store converts old-shape rows for derivable keys only, once", async () => {
  const directory = await mkdtemp(join(tmpdir(), "lavega-shared-price-convert-"));
  temporaryDirectories.push(directory);
  const filePath = join(directory, "prices.json");
  await writeFile(
    filePath,
    JSON.stringify([
      { tenantId: "user-a", symbol: "AAA_US_EQ", date: "2026-01-01", close: 10, currency: "USD" },
      { tenantId: "user-a", symbol: "^GSPC", date: "2026-01-01", close: 5000, currency: "USD" },
      { tenantId: "user-a", symbol: "AAPL", date: "2026-01-01", close: 200, currency: "USD" },
    ]),
  );
  await writeFile(
    join(directory, "prices.coverage.json"),
    JSON.stringify([
      {
        tenantId: "user-a",
        symbol: "AAA_US_EQ",
        from: "2026-01-01",
        to: "2026-01-01",
        listing: "AAA.US",
        currency: "USD",
      },
      {
        tenantId: "user-a",
        symbol: "^GSPC",
        from: "2026-01-01",
        to: "2026-01-01",
        listing: null,
        currency: "USD",
        provider: "yahoo",
      },
      {
        tenantId: "user-a",
        symbol: "AAPL",
        from: "2026-01-01",
        to: "2026-01-01",
        listing: "AAPL.US",
        currency: "USD",
      },
    ]),
  );

  const store = createFileSharedPriceStore(filePath);
  await expect(store.getRange({ key: "sym:AAA_US_EQ:USD" })).resolves.toEqual([
    { date: "2026-01-01", close: 10, currency: "USD" },
  ]);
  await expect(store.getRange({ key: "sym:^GSPC:USD" })).resolves.toHaveLength(1);
  await expect(store.getRange({ key: "sym:AAPL:USD" })).resolves.toEqual([]);
  // The legacy provider-less row reads as "legacy", never as a guess.
  await expect(store.getCoverage({ key: "sym:AAA_US_EQ:USD" })).resolves.toMatchObject({
    provider: "legacy",
  });

  // Conversion happened once: a second store reads the shared file, not the old one.
  await writeFile(filePath, JSON.stringify([]));
  const second = createFileSharedPriceStore(filePath);
  await expect(second.getRange({ key: "sym:AAA_US_EQ:USD" })).resolves.toHaveLength(1);
});
