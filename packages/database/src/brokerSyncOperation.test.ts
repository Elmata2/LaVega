import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, beforeEach, expect, test } from "vitest";
import {
  createBrokerRepository,
  createBrokerSyncOperationRepository,
  createPriceSyncStateRepository,
  type Database,
  type SyncProgressRow,
  type SyncStateRow,
} from "./index.js";
import { priceSyncLeaseContract, type Progress } from "./priceSyncLease.contract.js";

/* These tests run the real migrations against a real Postgres. The lease and
 * the credential generation are enforced by WHERE clauses and by RLS, and a
 * SQL-string mock would assert the query text we happened to write instead of
 * what the database does with two runs arriving at once. */

const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), "../../../db/migrations");
let pglite: PGlite;
let db: Database;

priceSyncLeaseContract("Neon price progress SQL", () => ({
  get: async (tenantId) =>
    (await createPriceSyncStateRepository(db, tenantId).get()) as Progress | null,
  claim: async (tenantId, progress, staleBefore) =>
    (await createPriceSyncStateRepository(db, tenantId).claim(
      progress,
      progress.status,
      staleBefore,
    )) as Progress | null,
  put: (tenantId, progress, leaseId) =>
    createPriceSyncStateRepository(db, tenantId).put(progress, progress.status, leaseId),
}));

/** PGlite is one connection, so a transaction has to finish before the next begins. */
function pgliteDatabase(instance: PGlite): Database {
  let inUse: Promise<unknown> = Promise.resolve();
  return {
    async connect() {
      let release!: () => void;
      const held = new Promise<void>((resolve) => (release = resolve));
      const ahead = inUse;
      inUse = inUse.then(() => held);
      await ahead;
      return {
        query: (sql: string, values?: unknown[]) => instance.query(sql, values as never[]),
        release,
      };
    },
  } as unknown as Database;
}

const progress = (status: SyncProgressRow["status"], leaseId: string | null): SyncProgressRow => ({
  status,
  message: null,
  updatedAt: new Date().toISOString(),
  leaseId,
});

const iso = (offsetMs: number) => new Date(Date.now() + offsetMs).toISOString();

async function connectBroker(tenantId: string, token = "first-token") {
  await createBrokerRepository(db, tenantId).put("trading212", { broker: "trading212", token });
}

async function generationOf(tenantId: string) {
  return (await createBrokerRepository(db, tenantId).get("trading212"))!.credentialGeneration;
}

beforeAll(async () => {
  process.env.LAVEGA_ENCRYPTION_KEY = "11".repeat(32);
  pglite = new PGlite();
  await pglite.exec("CREATE ROLE lavega_runtime LOGIN NOSUPERUSER;");
  for (const file of readdirSync(migrationsDir)
    .filter((name) => name.endsWith(".sql"))
    .sort())
    await pglite.exec(readFileSync(join(migrationsDir, file), "utf8"));
  /* The runtime connects as lavega_runtime, and only a non-superuser is subject
   * to row-level security. Reading these rows as the owner would pass every
   * tenant test for the wrong reason. */
  await pglite.exec("SET ROLE lavega_runtime;");
  db = pgliteDatabase(pglite);
}, 60_000);

afterAll(async () => {
  delete process.env.LAVEGA_ENCRYPTION_KEY;
  await pglite.close();
});

beforeEach(async () => {
  await pglite.exec(
    "RESET ROLE; DELETE FROM investing.sync_state; DELETE FROM investing.broker_vaults; SET ROLE lavega_runtime;",
  );
});

/** Reads a row past RLS, to assert on what a tenant is not allowed to see. */
async function storedState(tenantId: string) {
  await pglite.exec("RESET ROLE");
  const rows = await pglite.query<{ state: SyncStateRow }>(
    "SELECT state FROM investing.sync_state WHERE user_id = $1",
    [tenantId],
  );
  await pglite.exec("SET ROLE lavega_runtime");
  return rows.rows[0]?.state ?? null;
}

test("two instances starting at once produce one run, and the loser reads the winner's progress", async () => {
  await connectBroker("tenant-a");
  const cron = createBrokerSyncOperationRepository(db, "tenant-a");
  const browser = createBrokerSyncOperationRepository(db, "tenant-a");
  const staleBefore = iso(-60_000);

  const [first, second] = await Promise.all([
    cron.claim("trading212", {
      leaseId: "cron",
      staleBefore,
      progress: progress("running", "cron"),
    }),
    browser.claim("trading212", {
      leaseId: "browser",
      staleBefore,
      progress: progress("running", "browser"),
    }),
  ]);

  expect([first.claimed, second.claimed].filter(Boolean)).toHaveLength(1);
  const winner = first.claimed ? "cron" : "browser";
  expect(await browser.progress("trading212")).toMatchObject({
    status: "running",
    leaseId: winner,
  });
});

test("an expired lease is taken over, and the evicted run changes neither snapshot nor cursor", async () => {
  await connectBroker("tenant-a");
  const repository = createBrokerSyncOperationRepository(db, "tenant-a");
  const generation = await generationOf("tenant-a");
  const evicted = await repository.claim("trading212", {
    leaseId: "slow",
    staleBefore: iso(-60_000),
    progress: progress("running", "slow"),
  });
  expect(evicted.claimed).toBe(true);
  await repository.commit("trading212", {
    leaseId: "slow",
    state: { lastSyncedAt: "2026-01-01T00:00:00.000Z", resume: { ordersNextPagePath: "page-2" } },
    progress: progress("completed", "slow"),
    snapshot: { value: { positions: ["first"] }, credentialGeneration: generation },
  });
  await repository.claim("trading212", {
    leaseId: "slow",
    staleBefore: iso(-60_000),
    progress: progress("running", "slow"),
  });

  const takeover = await repository.claim("trading212", {
    leaseId: "fresh",
    staleBefore: iso(60_000),
    progress: progress("running", "fresh"),
  });
  expect(takeover.claimed).toBe(true);
  expect(takeover.state.resume).toEqual({ ordersNextPagePath: "page-2" });

  const committed = await repository.commit("trading212", {
    leaseId: "slow",
    state: { lastSyncedAt: "2026-06-06T00:00:00.000Z", resume: null },
    progress: progress("completed", "slow"),
    snapshot: { value: { positions: ["stale"] }, credentialGeneration: generation },
  });
  expect(committed).toBe(false);
  expect((await createBrokerRepository(db, "tenant-a").snapshots()).trading212).toEqual({
    positions: ["first"],
  });
  const still = await repository.claim("trading212", {
    leaseId: "fresh",
    staleBefore: iso(60_000),
    progress: progress("running", "fresh"),
  });
  expect(still.state.lastSyncedAt).toBe("2026-01-01T00:00:00.000Z");
});

test("a reconnect during a run stops that run from restoring the old account", async () => {
  await connectBroker("tenant-a");
  const repository = createBrokerSyncOperationRepository(db, "tenant-a");
  const claim = await repository.claim("trading212", {
    leaseId: "run",
    staleBefore: iso(-60_000),
    progress: progress("running", "run"),
  });

  await connectBroker("tenant-a", "reconnected-token");

  const committed = await repository.commit("trading212", {
    leaseId: "run",
    state: { lastSyncedAt: "2026-06-06T00:00:00.000Z" },
    progress: progress("completed", "run"),
    snapshot: {
      value: { positions: ["old-account"] },
      credentialGeneration: claim.credentialGeneration,
    },
  });
  expect(committed).toBe(false);
  const vault = createBrokerRepository(db, "tenant-a");
  expect((await vault.get<{ token: string }>("trading212"))?.credentials.token).toBe(
    "reconnected-token",
  );
  expect((await vault.snapshots()).trading212).toBeUndefined();
});

test("reconnect clears old snapshot and history cursor", async () => {
  const vault = createBrokerRepository(db, "tenant-a");
  await vault.put("trading212", { token: "old" });
  const generation = (await vault.get("trading212"))!.credentialGeneration;
  await vault.putSnapshot("trading212", { positions: ["old-account"] }, generation);
  const sync = createBrokerSyncOperationRepository(db, "tenant-a");
  await sync.claim("trading212", {
    leaseId: "old-run",
    staleBefore: iso(-60_000),
    progress: progress("running", "old-run"),
  });

  await vault.put("trading212", { token: "new" });

  expect((await vault.snapshots()).trading212).toBeUndefined();
  expect(await storedState("tenant-a")).toBeNull();
  const next = await sync.claim("trading212", {
    leaseId: "new-run",
    staleBefore: iso(-60_000),
    progress: progress("running", "new-run"),
  });
  expect(next.claimed).toBe(true);
  expect(next.snapshot).toBeNull();
  expect(next.state.lastSyncedAt ?? null).toBeNull();
});

test("a failed snapshot write leaves the cursor untouched", async () => {
  await connectBroker("tenant-a");
  const repository = createBrokerSyncOperationRepository(db, "tenant-a");
  await repository.claim("trading212", {
    leaseId: "run",
    staleBefore: iso(-60_000),
    progress: progress("running", "run"),
  });

  const committed = await repository.commit("trading212", {
    leaseId: "run",
    state: { lastSyncedAt: "2026-06-06T00:00:00.000Z" },
    progress: progress("completed", "run"),
    // A generation nobody holds stands in for any rejected snapshot write.
    snapshot: { value: { positions: ["unreachable"] }, credentialGeneration: 999 },
  });

  expect(committed).toBe(false);
  const state = await storedState("tenant-a");
  expect(state?.lastSyncedAt ?? null).toBeNull();
  expect(state?.lease?.id).toBe("run");
});

test("one tenant can neither claim nor read another tenant's broker", async () => {
  await connectBroker("tenant-a");
  await connectBroker("tenant-b");
  const a = createBrokerSyncOperationRepository(db, "tenant-a");
  const b = createBrokerSyncOperationRepository(db, "tenant-b");
  await a.claim("trading212", {
    leaseId: "a-run",
    staleBefore: iso(-60_000),
    progress: progress("running", "a-run"),
  });

  const claimedByB = await b.claim("trading212", {
    leaseId: "b-run",
    staleBefore: iso(60_000),
    progress: progress("running", "b-run"),
  });
  expect(claimedByB.claimed).toBe(true);
  expect(await b.progress("trading212")).toMatchObject({ leaseId: "b-run" });
  expect(await a.progress("trading212")).toMatchObject({ leaseId: "a-run" });

  const stolen = await b.commit("trading212", {
    leaseId: "a-run",
    state: { lastSyncedAt: "2026-06-06T00:00:00.000Z" },
    progress: progress("completed", "a-run"),
  });
  expect(stolen).toBe(false);
});

test("release hands the broker back without losing the cursor", async () => {
  await connectBroker("tenant-a");
  const repository = createBrokerSyncOperationRepository(db, "tenant-a");
  await repository.claim("trading212", {
    leaseId: "run",
    staleBefore: iso(-60_000),
    progress: progress("running", "run"),
  });
  const committed = await repository.commit("trading212", {
    leaseId: "run",
    state: { lastSyncedAt: null, resume: { ordersNextPagePath: "page-3" } },
    progress: progress("problem", "run"),
  });
  expect(committed).toBe(true);
  expect((await storedState("tenant-a"))?.resume).toEqual({ ordersNextPagePath: "page-3" });
  await repository.release("trading212", "run", progress("problem", "run"));

  const next = await repository.claim("trading212", {
    leaseId: "next",
    staleBefore: iso(60_000),
    progress: progress("running", "next"),
  });
  expect(next.claimed).toBe(true);
  expect(next.state.resume).toEqual({ ordersNextPagePath: "page-3" });
});
