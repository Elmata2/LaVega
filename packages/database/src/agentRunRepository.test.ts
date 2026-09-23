import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, expect, test } from "vitest";
import { createAgentRunRepository, type AgentRunRow, type Database } from "./index.js";
import { databaseOver } from "./testing.js";

const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), "../../../db/migrations");
let postgres: PGlite;
let db: Database;

beforeAll(async () => {
  postgres = new PGlite();
  await postgres.exec("CREATE ROLE lavega_runtime LOGIN NOSUPERUSER;");
  for (const file of readdirSync(migrationsDir)
    .filter((name) => name.endsWith(".sql"))
    .sort())
    await postgres.exec(readFileSync(join(migrationsDir, file), "utf8"));
  await postgres.exec("SET ROLE lavega_runtime;");
  db = databaseOver(async () => ({
    query: (sql: string, values?: unknown[]) => postgres.query(sql, values as never[]),
    release: () => undefined,
  }));
}, 60_000);

afterAll(async () => {
  await postgres.close();
});

const run = (id: string, startedAt: string): AgentRunRow => ({
  id,
  startedAt,
  finishedAt: null,
  status: "running",
  summary: null,
  error: null,
});

test("Postgres retains latest-started run and tenant isolation", async () => {
  const a = createAgentRunRepository(db, "tenant-A");
  const b = createAgentRunRepository(db, "tenant-B");
  const older = run("older", "2026-09-22T12:00:00.000Z");
  const newer = run("newer", "2026-09-22T12:00:01.000Z");
  expect(await a.start(older)).toBe(true);
  expect(await b.start(run("b-run", "2026-09-22T12:00:00.000Z"))).toBe(true);
  expect(await a.start(newer)).toBe(true);
  expect(await a.start(older)).toBe(false);
  expect(await a.finish({ ...older, status: "done", finishedAt: "2026-09-22T12:00:02.000Z" })).toBe(
    false,
  );
  expect(
    await a.finish({
      ...newer,
      status: "done",
      finishedAt: "2026-09-22T12:00:02.000Z",
      result: { signal: "new" },
    }),
  ).toBe(true);
  expect((await a.get())?.result).toEqual({ signal: "new" });
  expect((await b.get())?.id).toBe("b-run");
});
