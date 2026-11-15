import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, beforeEach } from "vitest";
import { createBrokerRepository, type Database } from "@lavega/database";
import { singleConnectionDatabase } from "@lavega/database/testing";
import {
  brokerSyncCommitContract,
  brokerSyncLeaseContract,
} from "@lavega/adapters/src/brokers/brokerSyncLease.contract.js";
import { createNeonBrokerSyncStateStore } from "./neonStores.js";

/* The broker lease answered the same way on Neon as on the file and memory
 * stores. This runs the shared contract against the real store over PGlite, so
 * the SQL WHERE clauses that enforce the lease are what the contract sees. */

const tenantId = "tenant-a";
const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), "../../../db/migrations");
let pglite: PGlite;
let db: Database;

beforeAll(async () => {
  process.env.LAVEGA_ENCRYPTION_KEY = "11".repeat(32);
  pglite = new PGlite();
  await pglite.exec("CREATE ROLE lavega_runtime LOGIN NOSUPERUSER;");
  for (const file of readdirSync(migrationsDir)
    .filter((name) => name.endsWith(".sql"))
    .sort())
    await pglite.exec(readFileSync(join(migrationsDir, file), "utf8"));
  /* Only a non-superuser is subject to row-level security. */
  await pglite.exec("SET ROLE lavega_runtime;");
  db = singleConnectionDatabase(pglite);
}, 60_000);

afterAll(async () => {
  delete process.env.LAVEGA_ENCRYPTION_KEY;
  await pglite.close();
});

beforeEach(async () => {
  await pglite.exec(
    "RESET ROLE; DELETE FROM investing.sync_state; DELETE FROM investing.broker_vaults; SET ROLE lavega_runtime;",
  );
  /* A connected broker is what gives the store a credential generation to
   * guard against the one a run claimed with. */
  await createBrokerRepository(db, tenantId).put("trading212", {
    broker: "trading212",
    token: "token",
  });
});

brokerSyncLeaseContract("Neon broker sync", () => createNeonBrokerSyncStateStore(db, tenantId));
brokerSyncCommitContract("Neon broker sync", () => createNeonBrokerSyncStateStore(db, tenantId), {
  enforcesCredentialGeneration: true,
});
