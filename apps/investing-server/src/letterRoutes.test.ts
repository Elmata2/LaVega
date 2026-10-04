import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, beforeEach, expect, test, vi } from "vitest";
import { createInMemoryPriceStore } from "@lavega/adapters";
import { createAgentMemoryRepository, type Database } from "@lavega/database";
import { migratedTestDatabase } from "@lavega/database/testing";
import { createRuntimeApp } from "./index.js";

/* The dev fixture holds AAPL, MSFT and ASML; memory runs on real Postgres
 * with RLS, so tenancy is the database's, not a stub's. */

let pglite: PGlite;
let db: Database;

const draft = {
  verdict: "Concentrated in a few names.",
  observations: [{ title: "Top holding", body: "It is 30% of the book.", figures: ["30%"] }],
};

beforeAll(async () => {
  process.env.LAVEGA_ENCRYPTION_KEY = "44".repeat(32);
  ({ pglite, db } = await migratedTestDatabase());
}, 60_000);

afterAll(async () => {
  delete process.env.LAVEGA_ENCRYPTION_KEY;
  await pglite.close();
});

beforeEach(async () => {
  vi.stubEnv("INVESTING_DEV_FIXTURE", "1");
  vi.stubEnv("LAVEGA_VAULT_FILE", join(tmpdir(), `lavega-missing-${Date.now()}.json`));
  await pglite.exec(
    `RESET ROLE;
     DELETE FROM investing.portfolio_letters;
     SET ROLE lavega_runtime;`,
  );
});

const runtime = (tenant: string, generate = vi.fn(async () => draft), withDatabase = true) =>
  createRuntimeApp({
    priceStore: createInMemoryPriceStore(),
    resolveTenantId: () => tenant,
    letterGenerator: generate,
    ...(withDatabase ? { agentMemory: (id: string) => createAgentMemoryRepository(db, id) } : {}),
  });

const post = (app: Awaited<ReturnType<typeof runtime>>) =>
  app.request("http://localhost/api/letters/ensure", { method: "POST" });
const latest = async (app: Awaited<ReturnType<typeof runtime>>) =>
  (await app.request("http://localhost/api/letters/latest")).json();

test("ensure generates once, then reuses the stored letter", async () => {
  const generate = vi.fn(async () => draft);
  const app = await runtime("alice", generate);
  expect(await latest(app)).toEqual({ letter: null });

  const first = (await (await post(app)).json()) as { letter: { id: string }; generated: boolean };
  const second = (await (await post(app)).json()) as { letter: { id: string }; generated: boolean };

  expect(first.generated).toBe(true);
  expect(second).toEqual({ letter: first.letter, generated: false });
  expect(generate).toHaveBeenCalledTimes(1);
  expect(await latest(app)).toEqual({ letter: first.letter });
});

test("Bob cannot read Alice's letter and gets his own", async () => {
  const alice = await runtime("alice");
  await post(alice);
  const bobGenerate = vi.fn(async () => draft);
  const bob = await runtime("bob", bobGenerate);

  expect(await latest(bob)).toEqual({ letter: null });
  expect(((await (await post(bob)).json()) as { generated: boolean }).generated).toBe(true);
  expect(bobGenerate).toHaveBeenCalledTimes(1);
});

test("without a database latest is null and ensure is refused", async () => {
  const generate = vi.fn(async () => draft);
  const app = await runtime("alice", generate, false);
  expect(await latest(app)).toEqual({ letter: null });
  expect((await post(app)).status).toBe(503);
  expect(generate).not.toHaveBeenCalled();
});

test("a failing model gives 502 and stores nothing", async () => {
  const app = await runtime(
    "alice",
    vi.fn(async () => {
      throw new Error("model down");
    }),
  );
  expect((await post(app)).status).toBe(502);
  expect(await latest(app)).toEqual({ letter: null });
});
