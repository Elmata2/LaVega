import { mkdtempSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test } from "vitest";
import { registerSharedPriceStoreContract } from "@lavega/adapters/src/prices/sharedPriceStore.contract.js";
import { createFileSharedPriceStore } from "./filePriceStore.js";

const temporaryDirectories: string[] = [];
afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

/** Clears the local shared file (issue #307 acceptance 9): the no-database
 *  mode keeps the "clear price cache" control working. */
test("clearing the shared file store empties every series, once", async () => {
  const directory = await mkdtemp(join(tmpdir(), "lavega-shared-price-clear-"));
  temporaryDirectories.push(directory);
  const filePath = join(directory, "prices.json");
  const store = createFileSharedPriceStore(filePath);
  await store.upsert("sym:AAPL:USD", [{ date: "2026-01-02", close: 201, currency: "USD" }]);
  await store.putCoverage("sym:AAPL:USD", {
    from: "2026-01-02",
    to: "2026-01-02",
    listing: "AAPL.US",
    currency: "USD",
    provider: "yahoo",
  });

  await store.clear();

  await expect(store.getRange({ key: "sym:AAPL:USD" })).resolves.toEqual([]);
  await expect(store.getCoverage({ key: "sym:AAPL:USD" })).resolves.toBeNull();
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
