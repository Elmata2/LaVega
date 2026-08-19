import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test } from "vitest";
import { createFilePriceStore } from "./filePriceStore.js";

const temporaryDirectories: string[] = [];
afterEach(async () => { await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true }))); });

test("persists price bars across store instances and purges them", async () => {
  const directory = await mkdtemp(join(tmpdir(), "lavega-price-store-"));
  temporaryDirectories.push(directory);
  const filePath = join(directory, "nested", "prices.json");
  const first = createFilePriceStore(filePath);
  await Promise.all([
    first.upsert([{ tenantId: "local", symbol: "AAPL", date: "2026-01-02", close: 101, currency: "USD" }]),
    first.upsert([{ tenantId: "local", symbol: "MSFT", date: "2026-01-02", close: 201, currency: "USD" }]),
  ]);

  const second = createFilePriceStore(filePath);
  await expect(second.getRange("AAPL", "2026-01-01", "2026-01-03")).resolves.toEqual([{ tenantId: "local", symbol: "AAPL", date: "2026-01-02", close: 101, currency: "USD" }]);
  await expect(second.getRange("MSFT", "2026-01-01", "2026-01-03")).resolves.toEqual([{ tenantId: "local", symbol: "MSFT", date: "2026-01-02", close: 201, currency: "USD" }]);
  await expect(second.lastDate("AAPL")).resolves.toBe("2026-01-02");
  await second.purgeAll();
  await expect(second.getRange("AAPL", "0000-01-01", "9999-12-31")).resolves.toEqual([]);
  await expect(readFile(filePath, "utf8")).resolves.toBe("[]");
});
