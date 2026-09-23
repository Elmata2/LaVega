import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test } from "vitest";
import type { BrokerSyncOperationStore, BrokerSyncState } from "@lavega/adapters";
import { createFileBrokerSyncStateStore } from "./fileBrokerSyncStateStore.js";

const progress = { status: "completed" as const, message: null, updatedAt: null, leaseId: null };

/** Stores a cursor the way a finished run would. */
async function store(operations: BrokerSyncOperationStore, state: BrokerSyncState) {
  await operations.claim("trading212", {
    leaseId: "seed",
    staleBefore: "9999-12-31T23:59:59.999Z",
    progress,
  });
  await operations.commit("trading212", {
    leaseId: "seed",
    credentialGeneration: 1,
    state,
    progress,
    data: null,
  });
}

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

async function statePath(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "lavega-sync-state-"));
  directories.push(directory);
  return join(directory, "broker-sync-state.json");
}

test("state survives a restart, which is what stops every restart re-syncing", async () => {
  const filePath = await statePath();
  await store(createFileBrokerSyncStateStore(filePath), {
    lastSyncedAt: "2026-08-19T12:00:00.000Z",
    retryAfter: "2026-08-19T12:05:00.000Z",
  });

  expect(await createFileBrokerSyncStateStore(filePath).get("trading212")).toEqual({
    lastSyncedAt: "2026-08-19T12:00:00.000Z",
    retryAfter: "2026-08-19T12:05:00.000Z",
  });
});

test("reconnect reset removes only affected broker cursor and lease", async () => {
  const filePath = await statePath();
  const operations = createFileBrokerSyncStateStore(filePath);
  await store(operations, { lastSyncedAt: "2026-08-19T12:00:00.000Z", retryAfter: null });
  await operations.claim("ibkr", {
    leaseId: "ibkr-run",
    staleBefore: new Date(0).toISOString(),
    progress,
  });
  await operations.commit("ibkr", {
    leaseId: "ibkr-run",
    credentialGeneration: 1,
    state: { lastSyncedAt: "2026-08-18T09:00:00.000Z", retryAfter: null },
    progress,
    data: null,
  });
  await operations.reset("trading212");
  const reopened = createFileBrokerSyncStateStore(filePath);
  expect((await reopened.get("trading212")).lastSyncedAt).toBeNull();
  expect((await reopened.get("ibkr")).lastSyncedAt).toBe("2026-08-18T09:00:00.000Z");
  expect(await reopened.progress("trading212")).toBeNull();
});

test("brokers keep separate state and separate claims", async () => {
  const filePath = await statePath();
  const operations = createFileBrokerSyncStateStore(filePath);
  const staleBefore = new Date(0).toISOString();
  await store(operations, { lastSyncedAt: "2026-08-19T12:00:00.000Z", retryAfter: null });
  await operations.claim("ibkr", { leaseId: "ibkr-run", staleBefore, progress });
  await operations.commit("ibkr", {
    leaseId: "ibkr-run",
    credentialGeneration: 1,
    state: { lastSyncedAt: "2026-08-18T09:00:00.000Z", retryAfter: null },
    progress,
    data: null,
  });

  expect((await operations.get("trading212")).lastSyncedAt).toBe("2026-08-19T12:00:00.000Z");
  expect((await operations.get("ibkr")).lastSyncedAt).toBe("2026-08-18T09:00:00.000Z");
});

test("a claim survives a restart, so a crashed run does not hold the broker forever", async () => {
  const filePath = await statePath();
  const now = new Date("2026-08-19T12:00:00.000Z").toISOString();
  const claimed = await createFileBrokerSyncStateStore(filePath).claim("trading212", {
    leaseId: "first",
    staleBefore: new Date(0).toISOString(),
    progress: { status: "running", message: "Positions are loaded", updatedAt: now, leaseId: null },
  });
  expect(claimed.claimed).toBe(true);

  const restarted = createFileBrokerSyncStateStore(filePath);
  const second = await restarted.claim("trading212", {
    leaseId: "second",
    staleBefore: new Date("2026-08-19T11:45:00.000Z").toISOString(),
    progress: { status: "running", message: null, updatedAt: now, leaseId: "second" },
  });
  expect(second.claimed).toBe(false);
  expect(await restarted.progress("trading212")).toMatchObject({
    status: "running",
    message: "Positions are loaded",
  });

  const afterExpiry = await restarted.claim("trading212", {
    leaseId: "third",
    staleBefore: new Date("2026-08-19T12:20:00.000Z").toISOString(),
    progress: { status: "running", message: null, updatedAt: now, leaseId: "third" },
  });
  expect(afterExpiry.claimed).toBe(true);
});

test("a commit writes the broker data with the cursor", async () => {
  const filePath = await statePath();
  const data = { trading212: { positions: [], trades: [], dividends: [] } };
  let written = data;
  const operations = createFileBrokerSyncStateStore(filePath, {
    read: async () => written,
    write: async (snapshot) => {
      written = snapshot as typeof data;
    },
  });
  await operations.claim("trading212", {
    leaseId: "run",
    staleBefore: new Date(0).toISOString(),
    progress,
  });

  const committed = await operations.commit("trading212", {
    leaseId: "run",
    credentialGeneration: 1,
    state: { lastSyncedAt: "2026-08-19T12:00:00.000Z", retryAfter: null },
    progress,
    data: { positions: [{ id: "p1" }], trades: [], dividends: [] } as never,
  });

  expect(committed).toBe(true);
  expect(written.trading212.positions).toHaveLength(1);
  expect((await operations.get("trading212")).lastSyncedAt).toBe("2026-08-19T12:00:00.000Z");
});

test("a run that no longer holds the claim commits nothing", async () => {
  const filePath = await statePath();
  const operations = createFileBrokerSyncStateStore(filePath);
  await operations.claim("trading212", {
    leaseId: "evicted",
    staleBefore: new Date(0).toISOString(),
    progress,
  });
  await operations.claim("trading212", {
    leaseId: "fresh",
    staleBefore: "9999-12-31T23:59:59.999Z",
    progress,
  });

  const committed = await operations.commit("trading212", {
    leaseId: "evicted",
    credentialGeneration: 1,
    state: { lastSyncedAt: "2026-08-19T12:00:00.000Z", retryAfter: null },
    progress,
    data: null,
  });

  expect(committed).toBe(false);
  expect((await operations.get("trading212")).lastSyncedAt).toBeNull();
});

test("a missing or corrupt file reads as no state rather than blocking a sync", async () => {
  const filePath = await statePath();
  expect(await createFileBrokerSyncStateStore(filePath).get("trading212")).toEqual({
    lastSyncedAt: null,
    retryAfter: null,
  });

  await writeFile(filePath, "{ not json", "utf8");
  expect(await createFileBrokerSyncStateStore(filePath).get("trading212")).toEqual({
    lastSyncedAt: null,
    retryAfter: null,
  });
});

test("a resume cursor survives a restart", async () => {
  const filePath = await statePath();
  const resume = { ordersNextPagePath: "/api/v0/equity/history/orders?limit=50&cursor=300" };
  await store(createFileBrokerSyncStateStore(filePath), {
    lastSyncedAt: null,
    retryAfter: "2026-08-19T12:05:00.000Z",
    resume,
  });

  expect(await createFileBrokerSyncStateStore(filePath).get("trading212")).toEqual({
    lastSyncedAt: null,
    retryAfter: "2026-08-19T12:05:00.000Z",
    resume,
  });
});

/* GEEN ENKELE TEST SCHRIJFT NOG IN DE WERKMAP.
 *
 * `runtimeDataFile` valt zonder override terug op `process.cwd()/.lavega`, één
 * map voor de hele suite. Een test die geen store injecteert schreef daar,
 * terwijl een andere zijn eigen tijdelijke mappen opruimde — en op CI landde
 * die opruiming tussen de `writeFile` en de `rename`:
 *
 *   ENOENT: rename '.lavega/agent-run.json.tmp' -> '.lavega/agent-run.json'
 *
 * Vijf tests liepen daarna in hun time-out. Lokaal was het vier volle runs lang
 * niet te reproduceren, want het hangt aan timing en workers — dus bewaakt deze
 * test de OORZAAK en niet het symptoom. Zie src/testSetup.ts. */
test("every runtime state file lives outside the working directory", () => {
  const variables = [
    "LAVEGA_AGENT_RUN_FILE",
    "LAVEGA_BROKER_SYNC_STATE_FILE",
    "LAVEGA_VAULT_FILE",
    "INVESTING_BENCHMARK_STORE_FILE",
    "INVESTING_MARKET_DATA_CONSENT_FILE",
    "INVESTING_SECTOR_STORE_FILE",
  ];
  for (const variable of variables) {
    const configured = process.env[variable];
    expect(configured, variable).toBeTruthy();
    expect(
      configured!.startsWith(process.cwd()),
      `${variable} points into the working directory`,
    ).toBe(false);
  }
});
