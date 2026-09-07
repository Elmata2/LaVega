import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, expect, test } from "vitest";

const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), "../../../db/migrations");
const migrationFiles = readdirSync(migrationsDir)
  .filter((name) => name.endsWith(".sql"))
  .sort();
const lastMigrationFile = migrationFiles.at(-1)!;

let db: PGlite;
const migrationErrors: Array<{ file: string; message: string }> = [];

beforeAll(async () => {
  db = new PGlite();
  await db.exec("CREATE ROLE lavega_runtime LOGIN NOSUPERUSER;");
  for (const file of migrationFiles) {
    try {
      await db.exec(readFileSync(join(migrationsDir, file), "utf8"));
    } catch (error) {
      migrationErrors.push({ file, message: (error as Error).message });
    }
  }
}, 30_000);

afterAll(async () => {
  await db.close();
});

test("every migration file applies without error", () => {
  expect(migrationErrors).toEqual([]);
});

test("lavega_runtime is granted select, insert, update, delete on every table in personal and investing", async () => {
  const tables = await db.query<{ table_schema: string; table_name: string }>(
    `SELECT table_schema, table_name FROM information_schema.tables
     WHERE table_schema IN ('personal', 'investing') AND table_type = 'BASE TABLE'
     ORDER BY table_schema, table_name`,
  );
  const found = tables.rows.map((row) => `${row.table_schema}.${row.table_name}`);
  expect(found.length).toBeGreaterThan(0);

  const grants = await db.query<{
    table_schema: string;
    table_name: string;
    privilege_type: string;
  }>(
    `SELECT table_schema, table_name, privilege_type FROM information_schema.table_privileges
     WHERE grantee = 'lavega_runtime' AND table_schema IN ('personal', 'investing')`,
  );
  const grantedByTable = new Map<string, Set<string>>();
  for (const row of grants.rows) {
    const key = `${row.table_schema}.${row.table_name}`;
    const privileges = grantedByTable.get(key) ?? new Set<string>();
    privileges.add(row.privilege_type);
    grantedByTable.set(key, privileges);
  }

  for (const key of found) {
    const privileges = [...(grantedByTable.get(key) ?? [])].sort();
    expect(privileges, `${key} (tables found: ${found.join(", ")})`).toEqual([
      "DELETE",
      "INSERT",
      "SELECT",
      "UPDATE",
    ]);
  }
});

test("every RLS-enabled table in personal and investing also forces it, except personal.eb_pending_auth", async () => {
  const rows = await db.query<{ schema: string; table: string; enabled: boolean; forced: boolean }>(
    `SELECT n.nspname AS schema, c.relname AS table, c.relrowsecurity AS enabled, c.relforcerowsecurity AS forced
     FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname IN ('personal', 'investing') AND c.relkind = 'r'
     ORDER BY 1, 2`,
  );
  expect(rows.rows.length).toBeGreaterThan(0);

  const checked = rows.rows.filter(
    (row) => !(row.schema === "personal" && row.table === "eb_pending_auth"),
  );
  const violations = checked
    .filter((row) => row.enabled && !row.forced)
    .map((row) => `${row.schema}.${row.table}`);
  expect(
    violations,
    `checked: ${checked.map((row) => `${row.schema}.${row.table}`).join(", ")}`,
  ).toEqual([]);
});

test("personal.eb_pending_auth deliberately has neither RLS nor FORCE — the bank's cross-site redirect cannot be relied on to carry a session cookie, so the row's own unguessable key is the credential", async () => {
  const rows = await db.query<{ enabled: boolean; forced: boolean }>(
    `SELECT c.relrowsecurity AS enabled, c.relforcerowsecurity AS forced
     FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'personal' AND c.relname = 'eb_pending_auth'`,
  );
  expect(rows.rows).toEqual([{ enabled: false, forced: false }]);
});

test("a table created after the migrations in schema personal is automatically granted to lavega_runtime", async () => {
  await db.exec("CREATE TABLE personal.future_probe (id INT)");
  const grants = await db.query<{ privilege_type: string }>(
    `SELECT privilege_type FROM information_schema.table_privileges
     WHERE grantee = 'lavega_runtime' AND table_schema = 'personal' AND table_name = 'future_probe'`,
  );
  expect(grants.rows.map((row) => row.privilege_type).sort()).toEqual([
    "DELETE",
    "INSERT",
    "SELECT",
    "UPDATE",
  ]);
});

test(`applying ${lastMigrationFile} a second time succeeds`, async () => {
  await expect(
    db.exec(readFileSync(join(migrationsDir, lastMigrationFile), "utf8")),
  ).resolves.toBeDefined();
});

test(`running ${lastMigrationFile} as a non-owner role is refused`, async () => {
  await db.exec(
    "CREATE ROLE stranger NOSUPERUSER; GRANT ALL ON SCHEMA personal, investing TO stranger;",
  );
  await db.exec("SET ROLE stranger;");
  try {
    await expect(
      db.exec(readFileSync(join(migrationsDir, lastMigrationFile), "utf8")),
    ).rejects.toThrow("apply this migration connected as");
  } finally {
    await db.exec("ROLLBACK").catch(() => {});
    await db.exec("RESET ROLE");
  }
});
