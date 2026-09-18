import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/*
 * Migrations used to be applied by hand, which is how `credential_generation`
 * reached the code and never reached Neon: the file was committed, the ALTER
 * was never run, and the Brokers page failed with `column does not exist`. The
 * ledger below makes "applied" a fact the database states rather than one a
 * human remembers, so `check` can fail a deploy that is missing a migration.
 *
 * Each file manages its own transaction (several already open one explicitly),
 * so the runner cannot wrap file and ledger write in one transaction. The
 * guarantee is idempotence instead: every migration must be rerunnable, and
 * `migrate.test.ts` applies the whole directory twice to prove it. A crash
 * between the file and its ledger row therefore costs one repeated apply, not
 * a broken schema.
 */

export const LEDGER_TABLE = "public.schema_migrations";

/** One advisory lock for the whole runner: two deploys must not apply at once. */
const LOCK_KEY = 4_216_089_231;

export type MigrationFile = { name: string; sql: string; checksum: string };

/** The subset of a database client the runner needs. `exec` runs multi-statement SQL. */
export type MigrationClient = {
  exec(sql: string): Promise<unknown>;
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<{ rows: T[] }>;
};

export function checksum(sql: string): string {
  return createHash("sha256").update(sql).digest("hex").slice(0, 16);
}

/**
 * Reads `db/migrations` in lexical order, which is apply order. Two files
 * sharing a numeric prefix have no defined order between them, so they are
 * refused rather than applied in whatever order the sort happened to pick.
 */
export function readMigrations(directory: string): MigrationFile[] {
  const names = readdirSync(directory)
    .filter((name) => name.endsWith(".sql"))
    .sort();
  const prefixes = new Map<string, string>();
  for (const name of names) {
    const prefix = name.split("_")[0]!;
    const previous = prefixes.get(prefix);
    if (previous)
      throw new Error(`Two migrations share the prefix ${prefix}: ${previous}, ${name}`);
    prefixes.set(prefix, name);
  }
  return names.map((name) => {
    const sql = readFileSync(join(directory, name), "utf8");
    return { name, sql, checksum: checksum(sql) };
  });
}

export async function ensureLedger(client: MigrationClient): Promise<void> {
  await client.exec(`
    CREATE TABLE IF NOT EXISTS ${LEDGER_TABLE} (
      name TEXT PRIMARY KEY,
      checksum TEXT NOT NULL,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);
}

export async function ledgerExists(client: MigrationClient): Promise<boolean> {
  const { rows } = await client.query<{ exists: boolean }>(
    `SELECT to_regclass('${LEDGER_TABLE}') IS NOT NULL AS exists`,
  );
  return rows[0]?.exists === true;
}

/** True once any application schema is present, whether or not the ledger is. */
export async function schemaExists(client: MigrationClient): Promise<boolean> {
  const { rows } = await client.query<{ exists: boolean }>(
    `SELECT EXISTS (
       SELECT 1 FROM information_schema.tables
       WHERE table_schema IN ('personal', 'investing')
     ) AS exists`,
  );
  return rows[0]?.exists === true;
}

export type MigrationPlan = {
  pending: MigrationFile[];
  /** Applied files whose contents changed since. Editing history breaks replay. */
  drifted: Array<{ name: string; recorded: string; current: string }>;
};

export async function planMigrations(
  client: MigrationClient,
  files: MigrationFile[],
): Promise<MigrationPlan> {
  const { rows } = await client.query<{ name: string; checksum: string }>(
    `SELECT name, checksum FROM ${LEDGER_TABLE}`,
  );
  const applied = new Map(rows.map((row) => [row.name, row.checksum]));
  const pending: MigrationFile[] = [];
  const drifted: MigrationPlan["drifted"] = [];
  for (const file of files) {
    const recorded = applied.get(file.name);
    if (recorded === undefined) pending.push(file);
    else if (recorded !== file.checksum)
      drifted.push({ name: file.name, recorded, current: file.checksum });
  }
  return { pending, drifted };
}

async function record(client: MigrationClient, file: MigrationFile): Promise<void> {
  await client.query(
    `INSERT INTO ${LEDGER_TABLE} (name, checksum) VALUES ($1, $2)
     ON CONFLICT (name) DO UPDATE SET checksum = EXCLUDED.checksum`,
    [file.name, file.checksum],
  );
}

export type MigrationEvent =
  | { kind: "applied"; name: string }
  | { kind: "recorded"; name: string }
  | { kind: "skipped"; name: string };

export type RunOptions = { onEvent?: (event: MigrationEvent) => void };

/**
 * Applies every pending migration in order. Drift aborts before anything runs:
 * a changed file means the recorded history no longer describes this database,
 * and guessing which half is right is worse than stopping.
 */
export async function applyMigrations(
  client: MigrationClient,
  files: MigrationFile[],
  options: RunOptions = {},
): Promise<MigrationFile[]> {
  await ensureLedger(client);
  const plan = await planMigrations(client, files);
  assertNoDrift(plan);
  for (const file of plan.pending) {
    await client.exec(file.sql);
    await record(client, file);
    options.onEvent?.({ kind: "applied", name: file.name });
  }
  return plan.pending;
}

/**
 * Records every migration as applied without running one. For the database
 * that predates the ledger: its schema is already at the head of the directory
 * and replaying 0001 from scratch is neither wanted nor safe to assume.
 */
export async function baselineMigrations(
  client: MigrationClient,
  files: MigrationFile[],
  options: RunOptions = {},
): Promise<MigrationFile[]> {
  await ensureLedger(client);
  const plan = await planMigrations(client, files);
  for (const file of plan.pending) {
    await record(client, file);
    options.onEvent?.({ kind: "recorded", name: file.name });
  }
  return plan.pending;
}

export function assertNoDrift(plan: MigrationPlan): void {
  if (plan.drifted.length === 0) return;
  const detail = plan.drifted
    .map((entry) => `${entry.name} (applied ${entry.recorded}, now ${entry.current})`)
    .join(", ");
  throw new Error(
    `These migrations changed after they were applied: ${detail}. ` +
      "Write a new migration instead of editing an applied one.",
  );
}

/** Serializes concurrent runners. The lock releases when the session ends. */
export async function withMigrationLock<T>(
  client: MigrationClient,
  fn: () => Promise<T>,
): Promise<T> {
  await client.query("SELECT pg_advisory_lock($1)", [LOCK_KEY]);
  try {
    return await fn();
  } finally {
    await client.query("SELECT pg_advisory_unlock($1)", [LOCK_KEY]).catch(() => undefined);
  }
}
