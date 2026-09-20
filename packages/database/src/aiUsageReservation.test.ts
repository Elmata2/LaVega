import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, beforeEach, expect, test } from "vitest";
import { createAiUsageRepository, type Database } from "./index.js";

/* Real migrations, real Postgres (via PGlite) — the reservation guard is a
 * transaction and an advisory lock, and a SQL-string mock would prove the
 * query text we happened to write rather than what the database does with
 * it. Same rationale, same harness shape, as brokerSyncOperation.test.ts. */

const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), "../../../db/migrations");
let pglite: PGlite;
let db: Database;

/** PGlite is ONE connection. See the note on the concurrency test below for
 *  what that does and does not let it prove. */
function pgliteDatabase(instance: PGlite): Database {
  let inUse: Promise<unknown> = Promise.resolve();
  return {
    async connect() {
      let release!: () => void;
      const held = new Promise<void>((resolve) => (release = resolve));
      const ahead = inUse;
      inUse = inUse.then(() => held);
      await ahead;
      return {
        query: (sql: string, values?: unknown[]) => instance.query(sql, values as never[]),
        release,
      };
    },
  } as unknown as Database;
}

beforeAll(async () => {
  pglite = new PGlite();
  await pglite.exec("CREATE ROLE lavega_runtime LOGIN NOSUPERUSER;");
  for (const file of readdirSync(migrationsDir).filter((name) => name.endsWith(".sql")).sort())
    await pglite.exec(readFileSync(join(migrationsDir, file), "utf8"));
  await pglite.exec("SET ROLE lavega_runtime;");
  db = pgliteDatabase(pglite);
}, 60_000);

afterAll(async () => {
  await pglite.close();
});

beforeEach(async () => {
  await pglite.exec("RESET ROLE; DELETE FROM personal.ai_usage; SET ROLE lavega_runtime;");
});

async function dayTotal(day: string): Promise<number> {
  return (await createAiUsageRepository(db).spentCents({ day, month: day.slice(0, 7) })).dayCents;
}

/** Backdates a reservation past the 10-minute freshness window (see
 *  RESERVATION_FRESH_SQL in index.ts) without waiting 10 real minutes —
 *  simulates the orphan case: a process that reserved and then crashed
 *  before ever reconciling or releasing. */
async function expireReservation(id: number): Promise<void> {
  await pglite.query("UPDATE personal.ai_usage SET reserved_at = CURRENT_TIMESTAMP - INTERVAL '11 minutes' WHERE id = $1", [
    id,
  ]);
}

test("reserve() admits exactly one caller when the cap has room for exactly one worst-case reservation", async () => {
  const repo = createAiUsageRepository(db);
  const attempt = () =>
    repo.reserve({
      day: "2026-09-20",
      month: "2026-09",
      route: "categorize",
      worstCaseCents: 5,
      dayCapCents: 6, // room for exactly one 5-cent reservation, not two
      monthCapCents: 100_000,
    });

  /* HONEST ABOUT WHAT THIS DOES AND DOES NOT PROVE.
   *
   * PGlite is a single embedded Postgres session (see pgliteDatabase()'s own
   * comment above): one backend, so it can never hold two open transactions
   * at once the way two real connections racing against a real Postgres
   * server could. Every reserve() call's own db.connect() queues behind the
   * previous call's release(), so the five calls below run in some
   * JS-scheduler-decided ORDER, one at a time, never actually overlapping —
   * this sandbox has no docker daemon and no local Postgres binary to give a
   * genuine multi-connection substrate instead (checked before writing this:
   * `docker info` fails, no `psql`/`postgres` on PATH, no DATABASE_URL).
   *
   * I checked what that means for this specific test, not just asserted it:
   * I temporarily removed the `pg_advisory_xact_lock` call from `reserve()`
   * and reran this test. It still passed, 1 of 5 admitted — PGlite's own
   * connect()-queue already fully serializes each call's entire
   * BEGIN..COMMIT before the next one starts, so this harness cannot
   * distinguish the locked implementation from the unlocked one. This test
   * therefore does NOT demonstrate the concurrency fix; it demonstrates that
   * the cap arithmetic and the conditional-INSERT guard are correct when
   * exercised back-to-back, which is necessary but not sufficient.
   *
   * The concurrency claim itself is demonstrated for real, with a genuine
   * revert-and-fail, on the OTHER reservation path this same checkBudget()
   * has — the in-memory fallback — in budget.test.ts, where Promise.all
   * really does race two calls with no serializing harness in between. For
   * this DB path, atomicity rests on Postgres's own documented guarantee for
   * pg_advisory_xact_lock (session-exclusive, transaction-scoped) plus
   * ordinary MVCC read-committed semantics, not on a runnable proof in this
   * sandbox. That is a real gap in what I verified, not a hidden one. */
  const results = await Promise.all([attempt(), attempt(), attempt(), attempt(), attempt()]);

  const admitted = results.filter((r) => r.ok);
  expect(admitted).toHaveLength(1);
  expect(results.filter((r) => !r.ok && r.scope === "day")).toHaveLength(4);
  expect(await dayTotal("2026-09-20")).toBe(5);
});

test("reconcile() turns a reservation into the real charge in place, not a second row", async () => {
  const repo = createAiUsageRepository(db);
  const reserved = await repo.reserve({
    day: "2026-09-20",
    month: "2026-09",
    route: "categorize",
    worstCaseCents: 5,
    dayCapCents: 1000,
    monthCapCents: 1000,
  });
  if (!reserved.ok) throw new Error("expected the reservation to succeed");
  expect(await dayTotal("2026-09-20")).toBe(5); // worst case, before the real cost is known

  await repo.reconcile({
    id: reserved.id,
    model: "mistral-small-latest",
    inputTokens: 100,
    outputTokens: 50,
    pages: 0,
    searches: 0,
    costCents: 2, // the real call cost less than the worst case it was held at
  });

  expect(await dayTotal("2026-09-20")).toBe(2);
  const { rows } = await pglite.query<{ model: string; reconciled_at: string | null }>(
    "SELECT model, reconciled_at FROM personal.ai_usage WHERE id = $1",
    [reserved.id],
  );
  expect(rows).toHaveLength(1); // still one row — reconciled, not duplicated
  expect(rows[0]!.model).toBe("mistral-small-latest");
  expect(rows[0]!.reconciled_at).not.toBeNull();
});

test("release() frees a reservation nothing ever reconciled, so the next caller is admitted", async () => {
  const repo = createAiUsageRepository(db);
  const params = {
    day: "2026-09-20",
    month: "2026-09",
    route: "categorize" as const,
    worstCaseCents: 5,
    dayCapCents: 6,
    monthCapCents: 1000,
  };
  const first = await repo.reserve(params);
  if (!first.ok) throw new Error("expected the first reservation to succeed");

  const blocked = await repo.reserve(params);
  expect(blocked).toEqual({ ok: false, scope: "day" });

  await repo.release(first.id);
  expect(await dayTotal("2026-09-20")).toBe(0);

  const afterRelease = await repo.reserve(params);
  expect(afterRelease.ok).toBe(true);
});

test("release() after reconcile() is a no-op — the real charge is not erased by a late release", async () => {
  const repo = createAiUsageRepository(db);
  const reserved = await repo.reserve({
    day: "2026-09-20",
    month: "2026-09",
    route: "categorize",
    worstCaseCents: 5,
    dayCapCents: 1000,
    monthCapCents: 1000,
  });
  if (!reserved.ok) throw new Error("expected the reservation to succeed");
  await repo.reconcile({
    id: reserved.id,
    model: "mistral-small-latest",
    inputTokens: 10,
    outputTokens: 10,
    pages: 0,
    searches: 0,
    costCents: 3,
  });

  await repo.release(reserved.id); // arrives late, e.g. a caller that reconciled then still threw

  expect(await dayTotal("2026-09-20")).toBe(3); // the reconciled charge stands
});

test("an unreconciled reservation stops counting toward the cap once it goes stale", async () => {
  const repo = createAiUsageRepository(db);
  const reserved = await repo.reserve({
    day: "2026-09-20",
    month: "2026-09",
    route: "categorize",
    worstCaseCents: 5,
    dayCapCents: 6,
    monthCapCents: 1000,
  });
  if (!reserved.ok) throw new Error("expected the reservation to succeed");

  // Never reconciled or released — the orphan case (the process holding it
  // crashed). Still fresh: it keeps blocking a second reservation.
  const stillBlocked = await repo.reserve({
    day: "2026-09-20",
    month: "2026-09",
    route: "categorize",
    worstCaseCents: 5,
    dayCapCents: 6,
    monthCapCents: 1000,
  });
  expect(stillBlocked).toEqual({ ok: false, scope: "day" });

  await expireReservation(reserved.id);

  expect(await dayTotal("2026-09-20")).toBe(0); // the stale hold no longer counts
  const admittedAfterExpiry = await repo.reserve({
    day: "2026-09-20",
    month: "2026-09",
    route: "categorize",
    worstCaseCents: 5,
    dayCapCents: 6,
    monthCapCents: 1000,
  });
  expect(admittedAfterExpiry.ok).toBe(true);
});
