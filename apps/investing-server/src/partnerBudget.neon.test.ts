import { readdirSync, readFileSync } from "node:fs";
import { Effect } from "effect";
import { PGlite } from "@electric-sql/pglite";
import { PartnerBudget } from "@lavega/adapters";
import { partnerBudgetContract } from "@lavega/adapters/src/partnerBudget/partnerBudget.contract.js";
import { createPartnerBudgetRepository } from "@lavega/database";
import { databaseOver } from "@lavega/database/testing";
import { afterAll, beforeAll } from "vitest";

/* The Neon adapter, run through the shared contract on PGlite with every
 * migration applied and the runtime role in force, as `fxRates.test.ts` does. */
const migrations = new URL("../../../db/migrations/", import.meta.url);
let pglite: PGlite;
let repository: ReturnType<typeof createPartnerBudgetRepository>;

beforeAll(async () => {
  pglite = new PGlite();
  await pglite.exec("CREATE ROLE lavega_runtime LOGIN NOSUPERUSER;");
  for (const name of readdirSync(migrations)
    .filter((name) => name.endsWith(".sql"))
    .sort())
    await pglite.exec(readFileSync(new URL(name, migrations), "utf8"));
  await pglite.exec("SET ROLE lavega_runtime;");
  repository = createPartnerBudgetRepository(
    databaseOver(async () => ({
      query: (sql: string, values?: unknown[]) => pglite.query(sql, values as never[]),
      release: () => undefined,
    })),
  );
}, 60_000);

afterAll(async () => {
  await pglite.close();
});

partnerBudgetContract("neon (pglite)", (intervals) => ({
  run: (effect) =>
    Effect.runPromise(effect.pipe(Effect.provide(PartnerBudget.storeLayer(repository, intervals)))),
}));
