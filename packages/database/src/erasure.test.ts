import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, beforeEach, expect, test } from "vitest";
import { createAiUsageRepository, eraseUserData, type Database } from "./index.js";
import { singleConnectionDatabase } from "./testing.js";

/* Real migrations, real Postgres (via PGlite), acting as `lavega_runtime`.
 *
 * GDPR art. 17 is a claim about what happened in the database, not about which
 * SQL string a mock was handed, so this harness is the point. `personal.ai_usage`
 * now carries FORCE row security (0025), and the erasure has to work under it:
 * a predicate that only looks right against a fake proves nothing about a
 * policy that returns no rows. `RESET ROLE` here is the PGlite superuser, which
 * bypasses RLS the way a migration owner does — used only to reset fixtures.
 */

const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), "../../../db/migrations");
let pglite: PGlite;
let db: Database;

beforeAll(async () => {
  pglite = new PGlite();
  await pglite.exec("CREATE ROLE lavega_runtime LOGIN NOSUPERUSER;");
  for (const name of readdirSync(migrationsDir)
    .filter((name) => name.endsWith(".sql"))
    .sort())
    await pglite.exec(readFileSync(join(migrationsDir, name), "utf8"));
  // Only a non-superuser is subject to row-level security.
  await pglite.exec("SET ROLE lavega_runtime;");
  db = singleConnectionDatabase(pglite);
}, 60_000);

afterAll(async () => {
  await pglite.close();
});

/** Two accounts with the same shape of data: an AI-spend row, a Better Auth
 *  user, a live session, a credential account and a pending verification. */
async function seedTwoAccounts(): Promise<void> {
  /* Session-level, not transaction-local, on purpose: each `exec` below is its
   * own transaction, and a `true` (local) setting would be gone before the next
   * statement's own transaction starts. This is a single-connection harness, so
   * "session-wide" is exactly one test. */
  await pglite.exec("SELECT set_config('app.user_id', 'user-a', false)");
  await pglite.exec(`
    INSERT INTO personal.ai_usage (day, route, model, cost_cents, user_id)
      VALUES ('2026-09-20', 'categorize', 'm', 5, 'user-a');
    INSERT INTO public."user" (id, name, email) VALUES ('user-a', 'A', 'a@example.com');
    INSERT INTO public.session (id, "expiresAt", token, "userId")
      VALUES ('s-a', CURRENT_TIMESTAMP + INTERVAL '1 day', 'token-a', 'user-a');
    INSERT INTO public.account (id, issuer, "accountId", "providerId", "userId", password)
      VALUES ('acc-a', 'local', 'a@example.com', 'credential', 'user-a', 'hash-a');
    INSERT INTO public.verification (id, identifier, value, "expiresAt")
      VALUES ('v-a', 'a@example.com', 'token-value', CURRENT_TIMESTAMP + INTERVAL '1 day');
  `);
  await pglite.exec("SELECT set_config('app.user_id', 'user-b', false)");
  await pglite.exec(`
    INSERT INTO personal.ai_usage (day, route, model, cost_cents, user_id)
      VALUES ('2026-09-20', 'categorize', 'm', 7, 'user-b');
    INSERT INTO public."user" (id, name, email) VALUES ('user-b', 'B', 'b@example.com');
    INSERT INTO public.session (id, "expiresAt", token, "userId")
      VALUES ('s-b', CURRENT_TIMESTAMP + INTERVAL '1 day', 'token-b', 'user-b');
    INSERT INTO public.account (id, issuer, "accountId", "providerId", "userId", password)
      VALUES ('acc-b', 'local', 'b@example.com', 'credential', 'user-b', 'hash-b');
    INSERT INTO public.verification (id, identifier, value, "expiresAt")
      VALUES ('v-b', 'b@example.com', 'token-value', CURRENT_TIMESTAMP + INTERVAL '1 day');
  `);
}

beforeEach(async () => {
  // RESET ROLE is the superuser: the only way past FORCE RLS to clear a fixture.
  await pglite.exec(`
    RESET ROLE;
    DELETE FROM personal.ai_usage;
    DELETE FROM public.verification;
    DELETE FROM public."user";
    SELECT set_config('app.user_id', '', false);
    SET ROLE lavega_runtime;
  `);
  await seedTwoAccounts();
});

async function rows<Row extends Record<string, unknown>>(
  sql: string,
  params: unknown[] = [],
): Promise<Row[]> {
  return (await pglite.query<Row>(sql, params as never[])).rows;
}

function spend(userId: string) {
  return createAiUsageRepository(db).spentCents({
    userId,
    day: "2026-09-20",
    month: "2026-09",
  });
}

test("erasing one account takes its ai_usage with it and leaves the other account's spend alone", async () => {
  /* M2: `USER_DATA_TABLES` had 20 entries and no `personal.ai_usage`. 0013 made
   * the ledger per-account; the erasure was written against the table's old
   * aggregate description and never revisited.
   *
   * The effect is asserted, not the report's row count: PGlite fills
   * `affectedRows`, while the Neon pool client the report is written for fills
   * `rowCount`, so the counts themselves are covered by the fake-based tests in
   * index.test.ts. What matters here is that the rows are gone. */
  const report = await eraseUserData(db, "user-a");

  expect(report.map((entry) => entry.table)).toContain("personal.ai_usage");
  expect((await spend("user-a")).dayCents).toBe(0);
  expect((await spend("user-b")).dayCents).toBe(7);
});

test("deletes the Better Auth user, session, account and verification rows", async () => {
  /* M3: deleting application rows alone left the password authenticating and a
   * fresh sign-in recreating a vault under the same id — the erasure reported
   * success and the account was still there. These are the two lookups Better
   * Auth itself makes: a session by token, a sign-in by address. */
  await eraseUserData(db, "user-a");

  // `getSession()` resolves the cookie's token against this table.
  expect(await rows("SELECT 1 FROM public.session WHERE token = 'token-a'")).toEqual([]);
  // Sign-in resolves the address against this one, then the credential hash.
  expect(await rows(`SELECT 1 FROM public."user" WHERE email = 'a@example.com'`)).toEqual([]);
  expect(await rows(`SELECT 1 FROM public.account WHERE "userId" = 'user-a'`)).toEqual([]);
  // The pending confirmation token cannot be replayed either.
  expect(
    await rows("SELECT 1 FROM public.verification WHERE identifier = 'a@example.com'"),
  ).toEqual([]);
});

test("another account's identity and session survive the erasure untouched", async () => {
  await eraseUserData(db, "user-a");

  expect(await rows("SELECT 1 FROM public.session WHERE token = 'token-b'")).toHaveLength(1);
  expect(await rows(`SELECT 1 FROM public."user" WHERE email = 'b@example.com'`)).toHaveLength(1);
  expect(await rows(`SELECT 1 FROM public.account WHERE "userId" = 'user-b'`)).toHaveLength(1);
  expect(
    await rows("SELECT 1 FROM public.verification WHERE identifier = 'b@example.com'"),
  ).toHaveLength(1);
});
