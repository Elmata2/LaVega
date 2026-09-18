#!/usr/bin/env tsx
/*
 * Applies db/migrations to a PostgreSQL database and records what it applied.
 *
 *   pnpm db:migrate            apply every pending migration
 *   pnpm db:migrate:check      list pending migrations, exit 1 if there are any
 *   pnpm db:migrate:status     show the ledger against the directory
 *   pnpm db:migrate -- baseline   record every file as applied, running none
 *
 * Connect as the schema owner (`lavega_owner` on Neon), not `lavega_runtime`:
 * the runtime role cannot ALTER the tables it reads. Set MIGRATION_DATABASE_URL
 * for the owner connection; DATABASE_URL is used only when it is absent.
 */
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Pool } from "@neondatabase/serverless";
import {
  applyMigrations,
  baselineMigrations,
  ledgerExists,
  type MigrationClient,
  planMigrations,
  readMigrations,
  schemaExists,
  withMigrationLock,
} from "@lavega/database/migrate";

const migrationsDirectory = join(dirname(fileURLToPath(import.meta.url)), "..", "db", "migrations");

type Command = "apply" | "check" | "status" | "baseline";

function parseCommand(argument = "apply"): Command {
  if (
    argument === "apply" ||
    argument === "check" ||
    argument === "status" ||
    argument === "baseline"
  )
    return argument;
  throw new Error(`Unknown command ${argument}. Use apply, check, status or baseline.`);
}

function connectionString(): string {
  const value = process.env.MIGRATION_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!value?.trim())
    throw new Error("MIGRATION_DATABASE_URL (or DATABASE_URL) is required, as the schema owner");
  return value;
}

async function main(): Promise<number> {
  const command = parseCommand(process.argv[2]);
  const files = readMigrations(migrationsDirectory);
  const pool = new Pool({ connectionString: connectionString(), max: 1 });
  const connection = await pool.connect();
  const client: MigrationClient = {
    exec: (sql) => connection.query(sql),
    query: async (sql, params) => ({ rows: (await connection.query(sql, params)).rows as never }),
  };

  try {
    return await withMigrationLock(client, async () => {
      if (!(await ledgerExists(client))) {
        if (await schemaExists(client)) {
          if (command !== "baseline") {
            console.error(
              "This database has tables but no migration ledger. It predates the runner.\n" +
                "Confirm its schema matches db/migrations, then run: pnpm db:migrate:baseline",
            );
            return 1;
          }
        } else if (command === "baseline") {
          console.error("This database is empty. Run pnpm db:migrate instead of baseline.");
          return 1;
        }
      }

      if (command === "baseline") {
        const recorded = await baselineMigrations(client, files, {
          onEvent: (event) => console.log(`recorded ${event.name}`),
        });
        console.log(`Baselined ${recorded.length} migration(s). None were executed.`);
        return 0;
      }

      if (command === "check" || command === "status") {
        const plan = await planMigrations(client, files);
        for (const entry of plan.drifted)
          console.error(`drifted ${entry.name} (applied ${entry.recorded}, now ${entry.current})`);
        for (const file of plan.pending) console.log(`pending ${file.name}`);
        if (command === "status")
          console.log(`${files.length - plan.pending.length}/${files.length} applied`);
        if (plan.drifted.length > 0) return 1;
        if (plan.pending.length === 0) {
          console.log("Database is up to date.");
          return 0;
        }
        return command === "check" ? 1 : 0;
      }

      const applied = await applyMigrations(client, files, {
        onEvent: (event) => console.log(`applied ${event.name}`),
      });
      console.log(
        applied.length === 0
          ? "Database is up to date."
          : `Applied ${applied.length} migration(s).`,
      );
      return 0;
    });
  } finally {
    connection.release();
    await pool.end();
  }
}

main()
  .then((code) => process.exit(code))
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
