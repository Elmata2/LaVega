import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { afterEach, beforeEach, expect, test } from "vitest";
import {
  adoptMigrations,
  applyMigrations,
  baselineMigrations,
  LEDGER_TABLE,
  ledgerExists,
  type MigrationClient,
  type MigrationFile,
  planMigrations,
  readMigrations,
  schemaExists,
} from "./migrate.js";

const migrationsDirectory = join(dirname(fileURLToPath(import.meta.url)), "../../../db/migrations");

let pglite: PGlite;
let client: MigrationClient;

beforeEach(async () => {
  pglite = new PGlite();
  await pglite.exec("CREATE ROLE lavega_runtime LOGIN NOSUPERUSER;");
  client = {
    exec: (sql) => pglite.exec(sql),
    query: async (sql, params) => ({ rows: (await pglite.query(sql, params)).rows as never }),
  };
});

afterEach(async () => {
  await pglite.close();
});

function file(name: string, sql: string): MigrationFile {
  return { name, sql, checksum: name };
}

async function ledgerNames(): Promise<string[]> {
  const { rows } = await client.query<{ name: string }>(
    `SELECT name FROM ${LEDGER_TABLE} ORDER BY name`,
  );
  return rows.map((row) => row.name);
}

test("the real migrations apply from empty and record themselves", async () => {
  const files = readMigrations(migrationsDirectory);
  const applied = await applyMigrations(client, files);
  expect(applied.map((entry) => entry.name)).toEqual(files.map((entry) => entry.name));
  expect(await ledgerNames()).toEqual(files.map((entry) => entry.name).sort());
}, 60_000);

/* THE TENANT BOUNDARY IS THIS CONSTRAINT, so it gets tested against a real
 * Postgres rather than reasoned about.
 *
 * The queue key is normalised twice and differently. The email worker names an
 * n8n bucket `address.slice(0, at).trim().toLowerCase()`; n8n reads one named
 * `v.trim().slice(0, 120)`, which does not lowercase. So a byte-exact unique
 * index does NOT stop two users sharing one partition — and sharing it means
 * one drains the other's invoices, which `drainQueue` then deletes. Review
 * demonstrated every row below against the real modules.
 *
 * `btrim(x) <> ''` was the original guard and is not enough twice over: it
 * permits padding, and its default trim set is the space character alone, so a
 * single tab survived it and then normalised to "" at n8n — which returns
 * OWNER_KEY, the owner's own queue. */
test("a forwarding local part that n8n would rewrite cannot be stored at all", async () => {
  await applyMigrations(client, readMigrations(migrationsDirectory));

  const store = (localPart: string) =>
    client.query("INSERT INTO personal.n8n_forwarding (user_id, local_part) VALUES ($1, $2)", [
      `u-${Math.random().toString(36).slice(2)}`,
      localPart,
    ]);

  for (const [value, why] of [
    ["Alice-7f3a", "uppercase: the worker lowercases, so this is one bucket with its twin"],
    ["alice-7f3a ", "trailing space: n8n trims, so this is one bucket with its twin"],
    [" alice-7f3a", "leading space, same reason"],
    ["\t", "a tab survives btrim and becomes OWNER_KEY at n8n"],
    ["owner@lavega.internal", "the owner sentinel itself"],
    ["a".repeat(121), "n8n slices at 120, so anything longer collides on its prefix"],
  ] as const) {
    await expect(store(value), why).rejects.toThrow();
  }

  /* And the form both ends already agree on is storable, or the constraint
   * would be protecting the queue by refusing to have one. */
  await expect(store("alice-7f3a")).resolves.toBeDefined();
}, 60_000);

/* The runner cannot wrap a file and its ledger row in one transaction, because
 * the files open their own. Idempotence is what makes a half-recorded run safe. */
test("every migration is rerunnable, so a repeated apply changes nothing", async () => {
  const files = readMigrations(migrationsDirectory);
  await applyMigrations(client, files);
  for (const entry of files) await client.exec(entry.sql);
  expect((await applyMigrations(client, files)).length).toBe(0);
}, 60_000);

test("a second run applies only what is new", async () => {
  await applyMigrations(client, [file("0001_a.sql", "CREATE TABLE a (id INT);")]);
  const applied = await applyMigrations(client, [
    file("0001_a.sql", "CREATE TABLE a (id INT);"),
    file("0002_b.sql", "CREATE TABLE b (id INT);"),
  ]);
  expect(applied.map((entry) => entry.name)).toEqual(["0002_b.sql"]);
});

test("editing an applied migration aborts the run before anything executes", async () => {
  await applyMigrations(client, [file("0001_a.sql", "CREATE TABLE a (id INT);")]);
  const edited: MigrationFile = {
    name: "0001_a.sql",
    sql: "CREATE TABLE a (id INT, extra INT);",
    checksum: "changed",
  };
  await expect(
    applyMigrations(client, [edited, file("0002_b.sql", "CREATE TABLE b (id INT);")]),
  ).rejects.toThrow(/changed after they were applied/);
  expect(await ledgerNames()).toEqual(["0001_a.sql"]);
  const { rows } = await client.query<{ exists: boolean }>(
    "SELECT to_regclass('public.b') IS NOT NULL AS exists",
  );
  expect(rows[0]?.exists).toBe(false);
});

test("a failing migration leaves later ones unapplied", async () => {
  await expect(
    applyMigrations(client, [
      file("0001_a.sql", "CREATE TABLE a (id INT);"),
      file("0002_bad.sql", "CREATE TABLE ;"),
      file("0003_c.sql", "CREATE TABLE c (id INT);"),
    ]),
  ).rejects.toThrow();
  expect(await ledgerNames()).toEqual(["0001_a.sql"]);
});

test("baseline records files without running them", async () => {
  const recorded = await baselineMigrations(client, [
    file("0001_a.sql", "CREATE TABLE a (id INT);"),
  ]);
  expect(recorded.map((entry) => entry.name)).toEqual(["0001_a.sql"]);
  const { rows } = await client.query<{ exists: boolean }>(
    "SELECT to_regclass('public.a') IS NOT NULL AS exists",
  );
  expect(rows[0]?.exists).toBe(false);
  expect((await planMigrations(client, [file("0001_a.sql", "x")])).pending).toEqual([]);
});

/* The preview branch: real tables, no ledger, and no way to tell which of the
 * newer migrations ever ran against it. Adopt runs them all and records them. */
test("adopt runs every migration against a database that predates the ledger", async () => {
  const files = readMigrations(migrationsDirectory);
  for (const entry of files.slice(0, 3)) await client.exec(entry.sql);
  expect(await ledgerExists(client)).toBe(false);

  const adopted = await adoptMigrations(client, files);

  expect(adopted.length).toBe(files.length);
  expect(await ledgerNames()).toEqual(files.map((entry) => entry.name).sort());
  const { rows } = await client.query<{ exists: boolean }>(
    `SELECT EXISTS (
       SELECT 1 FROM information_schema.columns
       WHERE table_schema = 'investing' AND table_name = 'broker_vaults'
         AND column_name = 'credential_generation'
     ) AS exists`,
  );
  expect(rows[0]?.exists).toBe(true);
}, 60_000);

test("two migrations sharing a numeric prefix are refused, because their order is undefined", () => {
  const directory = mkdtempSync(join(tmpdir(), "lavega-migrations-"));
  writeFileSync(join(directory, "0001_first.sql"), "SELECT 1;");
  writeFileSync(join(directory, "0001_second.sql"), "SELECT 1;");
  expect(() => readMigrations(directory)).toThrow(/share the prefix 0001/);
  rmSync(directory, { recursive: true, force: true });
});

test("an untouched database reports no ledger and no schema", async () => {
  expect(await ledgerExists(client)).toBe(false);
  expect(await schemaExists(client)).toBe(false);
  await applyMigrations(client, readMigrations(migrationsDirectory));
  expect(await ledgerExists(client)).toBe(true);
  expect(await schemaExists(client)).toBe(true);
}, 60_000);
