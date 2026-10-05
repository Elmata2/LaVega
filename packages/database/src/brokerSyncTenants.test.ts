import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, beforeEach, expect, test } from "vitest";
import { listBrokerSyncTenants, type Database } from "./index.js";
import { migratedTestDatabase } from "./testing.js";

/* Real migrations, real Postgres, acting as lavega_runtime: the listing has to
 * cross row-level security without loosening it. */

let pglite: PGlite;
let db: Database;

beforeAll(async () => {
  ({ pglite, db } = await migratedTestDatabase());
}, 60_000);

afterAll(async () => {
  await pglite.close();
});

beforeEach(async () => {
  await pglite.exec(`RESET ROLE;
    DELETE FROM investing.sync_state; DELETE FROM investing.broker_vaults;
    SET ROLE lavega_runtime;`);
});

async function seedVault(userId: string, broker: string, startedAt?: string) {
  await pglite.exec(`RESET ROLE;
    INSERT INTO investing.broker_vaults (user_id, broker, credentials_blob)
      VALUES ('${userId}', '${broker}', '\\x01');
    ${
      startedAt
        ? `INSERT INTO investing.sync_state (user_id, broker, last_started_at)
             VALUES ('${userId}', '${broker}', '${startedAt}');`
        : ""
    }
    SET ROLE lavega_runtime;`);
}

test("lists each user with a connected broker once, across row-level security", async () => {
  await seedVault("alice", "trading212");
  await seedVault("alice", "ibkr");
  await seedVault("bob", "ibkr");

  expect([...(await listBrokerSyncTenants(db))].sort()).toEqual(["alice", "bob"]);
  // The policy is untouched: a plain read with no tenant context still sees nothing.
  const direct = await pglite.query("SELECT user_id FROM investing.broker_vaults");
  expect(direct.rows).toEqual([]);
});

test("a user with no broker connected is not listed", async () => {
  await pglite.exec(`RESET ROLE;
    INSERT INTO investing.sync_state (user_id, broker) VALUES ('carol', 'prices');
    SET ROLE lavega_runtime;`);
  await seedVault("bob", "ibkr");

  expect(await listBrokerSyncTenants(db)).toEqual(["bob"]);
});

test("never-synced users come first, then the least recently started; ties break by user id", async () => {
  await seedVault("zed", "ibkr");
  await seedVault("amy", "ibkr", "2026-10-03T04:00:00Z");
  await seedVault("ben", "ibkr", "2026-10-01T04:00:00Z");
  await seedVault("cat", "ibkr", "2026-10-02T04:00:00Z");
  await seedVault("abe", "ibkr");

  expect(await listBrokerSyncTenants(db)).toEqual(["abe", "zed", "ben", "cat", "amy"]);
});

test("the price-sync row does not count as a broker sync", async () => {
  await seedVault("amy", "ibkr", "2026-10-01T04:00:00Z");
  await seedVault("ben", "ibkr", "2026-10-02T04:00:00Z");
  await pglite.exec(`RESET ROLE;
    INSERT INTO investing.sync_state (user_id, broker, last_started_at)
      VALUES ('amy', 'prices', '2026-10-04T04:00:00Z');
    SET ROLE lavega_runtime;`);

  expect(await listBrokerSyncTenants(db)).toEqual(["amy", "ben"]);
});

test("the function returns user ids and nothing else, is pinned, and is not callable by PUBLIC", async () => {
  const meta = await pglite.query<{
    secdef: boolean;
    config: string[];
    cols: string[];
    public_exec: boolean;
    runtime_exec: boolean;
  }>(
    `SELECT p.prosecdef AS secdef, p.proconfig AS config,
            ARRAY(SELECT unnest(p.proargnames)) AS cols,
            has_function_privilege('public', p.oid, 'EXECUTE') AS public_exec,
            has_function_privilege('lavega_runtime', p.oid, 'EXECUTE') AS runtime_exec
     FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'investing' AND p.proname = 'list_broker_sync_tenants'`,
  );
  expect(meta.rows).toHaveLength(1);
  const row = meta.rows[0]!;
  expect(row.secdef).toBe(true);
  expect(row.config).toEqual(["search_path=pg_catalog, pg_temp"]);
  expect(row.cols).toEqual(["tenant_id"]);
  expect(row.public_exec).toBe(false);
  expect(row.runtime_exec).toBe(true);
});
