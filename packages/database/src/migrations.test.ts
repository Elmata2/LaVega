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

test("every RLS-enabled table in personal and investing also forces it, except personal.eb_pending_auth and personal.ai_usage", async () => {
  const rows = await db.query<{ schema: string; table: string; enabled: boolean; forced: boolean }>(
    `SELECT n.nspname AS schema, c.relname AS table, c.relrowsecurity AS enabled, c.relforcerowsecurity AS forced
     FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname IN ('personal', 'investing') AND c.relkind = 'r'
     ORDER BY 1, 2`,
  );
  expect(rows.rows.length).toBeGreaterThan(0);

  const checked = rows.rows.filter(
    (row) =>
      !(row.schema === "personal" && (row.table === "eb_pending_auth" || row.table === "ai_usage")),
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

test("personal.ai_usage deliberately has neither RLS nor FORCE — aggregate owner spend, not per-user data", async () => {
  const rows = await db.query<{ enabled: boolean; forced: boolean }>(
    `SELECT c.relrowsecurity AS enabled, c.relforcerowsecurity AS forced
     FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'personal' AND c.relname = 'ai_usage'`,
  );
  expect(rows.rows).toEqual([{ enabled: false, forced: false }]);
});

test("investing.preferences gains sector_corrections and sector_inference_enabled columns with the documented defaults", async () => {
  const rows = await db.query<{
    column_name: string;
    data_type: string;
    column_default: string | null;
    is_nullable: string;
  }>(
    `SELECT column_name, data_type, column_default, is_nullable FROM information_schema.columns
     WHERE table_schema = 'investing' AND table_name = 'preferences'
       AND column_name IN ('sector_corrections', 'sector_inference_enabled')
     ORDER BY column_name`,
  );
  expect(rows.rows).toEqual([
    {
      column_name: "sector_corrections",
      data_type: "jsonb",
      column_default: "'{}'::jsonb",
      is_nullable: "NO",
    },
    {
      column_name: "sector_inference_enabled",
      data_type: "boolean",
      column_default: "false",
      is_nullable: "NO",
    },
  ]);
});

test("investing.sector_profiles deliberately has neither RLS nor FORCE — a symbol's sector is not tenant data", async () => {
  const rows = await db.query<{ enabled: boolean; forced: boolean }>(
    `SELECT c.relrowsecurity AS enabled, c.relforcerowsecurity AS forced
     FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'investing' AND c.relname = 'sector_profiles'`,
  );
  expect(rows.rows).toEqual([{ enabled: false, forced: false }]);
});

test("personal.net_worth_totals has the shape opting into Investing's net worth relies on", async () => {
  const columns = await db.query<{
    column_name: string;
    data_type: string;
    column_default: string | null;
    is_nullable: string;
  }>(
    `SELECT column_name, data_type, column_default, is_nullable FROM information_schema.columns
     WHERE table_schema = 'personal' AND table_name = 'net_worth_totals'
     ORDER BY column_name`,
  );
  expect(columns.rows).toEqual([
    { column_name: "currency", data_type: "text", column_default: "'EUR'::text", is_nullable: "NO" },
    { column_name: "date", data_type: "date", column_default: null, is_nullable: "NO" },
    {
      column_name: "total_cents",
      data_type: "bigint",
      column_default: null,
      is_nullable: "NO",
    },
    {
      column_name: "updated_at",
      data_type: "timestamp with time zone",
      column_default: "CURRENT_TIMESTAMP",
      is_nullable: "NO",
    },
    { column_name: "user_id", data_type: "text", column_default: null, is_nullable: "NO" },
  ]);

  const primaryKey = await db.query<{ column_name: string }>(
    `SELECT a.attname AS column_name
     FROM pg_index i
     JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey)
     WHERE i.indrelid = 'personal.net_worth_totals'::regclass AND i.indisprimary
     ORDER BY a.attname`,
  );
  expect(primaryKey.rows.map((row) => row.column_name)).toEqual(["date", "user_id"]);
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
