import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, beforeEach, expect, test } from "vitest";
import { createPartnerBudgetRepository, type Database } from "./index.js";
import { databaseOver } from "./testing.js";

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
  await pglite.exec("SET ROLE lavega_runtime;");
  db = databaseOver(async () => ({
    query: (sql: string, values?: unknown[]) => pglite.query(sql, values as never[]),
    release: () => undefined,
  }));
}, 60_000);

afterAll(async () => {
  await pglite.close();
});

beforeEach(async () => {
  await pglite.exec("DELETE FROM investing.partner_budgets;");
});

const key = { partner: "yahoo", endpoint: "any", scopeId: "shared" };

const row = async () =>
  (
    await pglite.query<{
      next_ms: string;
      blocked_ms: string | null;
      interval_ms: number | null;
    }>(
      `SELECT floor(extract(epoch FROM next_at) * 1000)::bigint AS next_ms,
              floor(extract(epoch FROM blocked_until) * 1000)::bigint AS blocked_ms,
              interval_ms
       FROM investing.partner_budgets WHERE partner = 'yahoo'`,
    )
  ).rows[0]!;

test("the first reserve is now and the next slot is one interval later", async () => {
  const budget = createPartnerBudgetRepository(db);
  const before = Date.now();
  const first = await budget.reserve(key, 300);
  const second = await budget.reserve(key, 300);
  expect(first.getTime()).toBeGreaterThanOrEqual(before - 5);
  expect(first.getTime()).toBeLessThan(before + 5_000);
  expect(second.getTime() - first.getTime()).toBeGreaterThanOrEqual(300);
});

test("ten concurrent reserves return ten distinct slots one interval apart", async () => {
  const budget = createPartnerBudgetRepository(db);
  const slots = (await Promise.all(Array.from({ length: 10 }, () => budget.reserve(key, 300))))
    .map((slot) => slot.getTime())
    .sort((a, b) => a - b);
  expect(new Set(slots).size).toBe(10);
  for (let index = 1; index < slots.length; index += 1)
    expect(slots[index]! - slots[index - 1]!).toBeGreaterThanOrEqual(300);
});

test("a rejection holds the next slot until its instant, exactly", async () => {
  const budget = createPartnerBudgetRepository(db);
  const until = new Date(Date.now() + 5_000);
  await budget.reject(key, until);
  const first = await budget.reserve(key, 300);
  const second = await budget.reserve(key, 300);
  expect(first.getTime()).toBe(until.getTime());
  expect(second.getTime()).toBe(until.getTime() + 300);
});

test("a block never moves earlier and a block in the past has no effect", async () => {
  const budget = createPartnerBudgetRepository(db);
  const far = new Date(Date.now() + 9_000);
  await budget.reject(key, far);
  await budget.reject(key, new Date(Date.now() + 1_000));
  expect((await budget.reserve(key, 300)).getTime()).toBe(far.getTime());
  await pglite.exec("DELETE FROM investing.partner_budgets;");
  await budget.reject(key, new Date(Date.now() - 60_000));
  const slot = await budget.reserve(key, 300);
  expect(slot.getTime()).toBeGreaterThan(Date.now() - 5_000);
});

test("observe sets the interval and the block and leaves next_at alone", async () => {
  const budget = createPartnerBudgetRepository(db);
  await budget.reserve(key, 300);
  const before = await row();
  const blockedUntilMs = Date.now() + 4_000;
  await budget.observe(key, { blockedUntilMs, intervalMs: 1_000 });
  const after = await row();
  expect(after.next_ms).toBe(before.next_ms);
  expect(Number(after.blocked_ms)).toBe(blockedUntilMs);
  expect(after.interval_ms).toBe(1_000);
  // A later observe without them keeps what is stored.
  await budget.observe(key, { blockedUntilMs: null, intervalMs: null });
  expect(await row()).toEqual(after);
});

test("a stored interval overrides the table interval for later slots only", async () => {
  const budget = createPartnerBudgetRepository(db);
  const first = await budget.reserve(key, 300);
  await budget.observe(key, { blockedUntilMs: null, intervalMs: 2_000 });
  const second = await budget.reserve(key, 300);
  const third = await budget.reserve(key, 300);
  expect(second.getTime() - first.getTime()).toBeGreaterThanOrEqual(300);
  expect(second.getTime() - first.getTime()).toBeLessThan(2_000);
  expect(third.getTime() - second.getTime()).toBe(2_000);
});

test("observe on a key with no row creates one that does not delay the first slot", async () => {
  const budget = createPartnerBudgetRepository(db);
  await budget.observe(key, { blockedUntilMs: null, intervalMs: 700 });
  const before = Date.now();
  const slot = await budget.reserve(key, 300);
  expect(slot.getTime()).toBeLessThan(before + 5_000);
});

test("keys differ by partner, endpoint and scope", async () => {
  const budget = createPartnerBudgetRepository(db);
  const a = { partner: "trading212", endpoint: "positions", scopeId: "aaaaaaaaaaaaaaaa" };
  const slots = await Promise.all([
    budget.reserve(a, 1_000),
    budget.reserve({ ...a, scopeId: "bbbbbbbbbbbbbbbb" }, 1_000),
    budget.reserve({ ...a, endpoint: "history-orders" }, 3_000),
  ]);
  const times = slots.map((slot) => slot.getTime());
  expect(Math.max(...times) - Math.min(...times)).toBeLessThan(2_000);
});

test("the table refuses a non-positive interval", async () => {
  await expect(
    pglite.exec(
      `INSERT INTO investing.partner_budgets (partner, endpoint, scope_id, next_at, interval_ms)
       VALUES ('x', 'y', 'shared', now(), 0)`,
    ),
  ).rejects.toThrow(/partner_budgets_interval_positive/);
});

test("reserveBefore on a key with no row seeds it and grants now", async () => {
  const budget = createPartnerBudgetRepository(db);
  const before = Date.now();
  const result = await budget.reserveBefore(key, 300, new Date(before + 60_000));
  expect(result.granted).toBe(true);
  expect(result.slot.getTime()).toBeGreaterThanOrEqual(before - 5);
  const next = await budget.reserve(key, 300);
  expect(next.getTime() - result.slot.getTime()).toBeGreaterThanOrEqual(300);
});

test("a refused reserveBefore does not move next_at and the next reserve gets the offered slot", async () => {
  const budget = createPartnerBudgetRepository(db);
  await budget.reserve(key, 300);
  const stored = await row();
  const refused = await budget.reserveBefore(key, 300, new Date(Date.now() - 60_000));
  expect(refused.granted).toBe(false);
  expect((await row()).next_ms).toBe(stored.next_ms);
  expect((await budget.reserve(key, 300)).getTime()).toBe(refused.slot.getTime());
});

test("blockedUntil reads the block, null when there is none, and writes nothing", async () => {
  const budget = createPartnerBudgetRepository(db);
  expect(await budget.blockedUntil(key)).toBeNull();
  const until = new Date(Date.now() + 5_000);
  await budget.reject(key, until);
  const before = await row();
  expect((await budget.blockedUntil(key))?.getTime()).toBe(until.getTime());
  expect(await row()).toEqual(before);
});
