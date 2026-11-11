import { readdirSync, readFileSync } from "node:fs";
import { DateTime, Effect } from "effect";
import { PGlite } from "@electric-sql/pglite";
import { PartnerBudget } from "@lavega/adapters";
import { partnerBudgetContract } from "@lavega/adapters/src/partnerBudget/partnerBudget.contract.js";
import { createPartnerBudgetRepository, type Database } from "@lavega/database";
import { databaseOver } from "@lavega/database/testing";
import { afterAll, beforeAll, expect, test } from "vitest";
import { createNeonPartnerBudget } from "./neonStores.js";

/* The Neon adapter, run through the shared contract on PGlite with every
 * migration applied and the runtime role in force, as `fxRates.test.ts` does. */
const migrations = new URL("../../../db/migrations/", import.meta.url);
let pglite: PGlite;
let repository: ReturnType<typeof createPartnerBudgetRepository>;
let database: Database;

beforeAll(async () => {
  pglite = new PGlite();
  await pglite.exec("CREATE ROLE lavega_runtime LOGIN NOSUPERUSER;");
  for (const name of readdirSync(migrations)
    .filter((name) => name.endsWith(".sql"))
    .sort())
    await pglite.exec(readFileSync(new URL(name, migrations), "utf8"));
  await pglite.exec("SET ROLE lavega_runtime;");
  database = databaseOver(async () => ({
    query: (sql: string, values?: unknown[]) => pglite.query(sql, values as never[]),
    release: () => undefined,
  }));
  repository = createPartnerBudgetRepository(database);
}, 60_000);

afterAll(async () => {
  await pglite.close();
});

partnerBudgetContract("neon (pglite)", (intervals) => ({
  run: (effect) =>
    Effect.runPromise(effect.pipe(Effect.provide(PartnerBudget.storeLayer(repository, intervals)))),
}));

test("createNeonPartnerBudget serves the table interval for a listed key", async () => {
  const slots = await Effect.runPromise(
    Effect.gen(function* () {
      const budget = yield* PartnerBudget;
      const first = yield* budget.reserve({ partner: "yahoo", endpoint: "any", scopeId: "shared" });
      const second = yield* budget.reserve({
        partner: "yahoo",
        endpoint: "any",
        scopeId: "shared",
      });
      return [first, second].map(DateTime.toEpochMillis);
    }).pipe(Effect.provide(createNeonPartnerBudget(database))),
  );
  expect(slots[1]! - slots[0]!).toBeGreaterThanOrEqual(300);
});
