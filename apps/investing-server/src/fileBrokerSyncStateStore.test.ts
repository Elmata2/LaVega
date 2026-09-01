import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test } from "vitest";
import { createFileBrokerSyncStateStore } from "./fileBrokerSyncStateStore.js";

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

async function statePath(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "lavega-sync-state-"));
  directories.push(directory);
  return join(directory, "broker-sync-state.json");
}

test("state survives a restart, which is what stops every restart re-syncing", async () => {
  const filePath = await statePath();
  await createFileBrokerSyncStateStore(filePath).put("trading212", { lastSyncedAt: "2026-08-19T12:00:00.000Z", retryAfter: "2026-08-19T12:05:00.000Z" });

  expect(await createFileBrokerSyncStateStore(filePath).get("trading212")).toEqual({ lastSyncedAt: "2026-08-19T12:00:00.000Z", retryAfter: "2026-08-19T12:05:00.000Z" });
});

test("brokers keep separate state", async () => {
  const filePath = await statePath();
  const store = createFileBrokerSyncStateStore(filePath);
  await store.put("trading212", { lastSyncedAt: "2026-08-19T12:00:00.000Z", retryAfter: null });
  await store.put("ibkr", { lastSyncedAt: "2026-08-18T09:00:00.000Z", retryAfter: null });

  expect((await store.get("trading212")).lastSyncedAt).toBe("2026-08-19T12:00:00.000Z");
  expect((await store.get("ibkr")).lastSyncedAt).toBe("2026-08-18T09:00:00.000Z");
});

test("a missing or corrupt file reads as no state rather than blocking a sync", async () => {
  const filePath = await statePath();
  expect(await createFileBrokerSyncStateStore(filePath).get("trading212")).toEqual({ lastSyncedAt: null, retryAfter: null });

  await writeFile(filePath, "{ not json", "utf8");
  expect(await createFileBrokerSyncStateStore(filePath).get("trading212")).toEqual({ lastSyncedAt: null, retryAfter: null });
});

test("a resume cursor survives a restart", async () => {
  const filePath = await statePath();
  const resume = { ordersNextPagePath: "/api/v0/equity/history/orders?limit=50&cursor=300" };
  await createFileBrokerSyncStateStore(filePath).put("trading212", { lastSyncedAt: null, retryAfter: "2026-08-19T12:05:00.000Z", resume });

  expect(await createFileBrokerSyncStateStore(filePath).get("trading212")).toEqual({ lastSyncedAt: null, retryAfter: "2026-08-19T12:05:00.000Z", resume });
});
