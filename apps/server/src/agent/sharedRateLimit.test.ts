import { afterAll, beforeAll, beforeEach, expect, test } from "vitest";
import type { Database } from "@lavega/database";
import { migratedTestDatabase } from "@lavega/database/testing";
import { createRateLimiter } from "./rateLimit.js";
import { createSharedRateLimiter, hashBucketKey, memoryRateLimitStore } from "./sharedRateLimit.js";

/* #246 / M8. A limiter that keeps its counters in the process is one ceiling
 * PER INSTANCE: on Vercel the effective limit was 20/min times the warm
 * instance count, and a cold start reset it. These tests drive two limiter
 * instances against one database, which is the shape the deployment actually
 * has, and pin the old per-process behaviour next to it so a revert fails
 * here. */

let pglite: Awaited<ReturnType<typeof migratedTestDatabase>>["pglite"];
let db: Database;

beforeAll(async () => {
  ({ pglite, db } = await migratedTestDatabase());
}, 60_000);

afterAll(async () => {
  await pglite.close();
});

beforeEach(async () => {
  await db.http.query("DELETE FROM personal.rate_limit_buckets");
});

test("the old per-process limiter let two instances spend the whole budget each", () => {
  const instanceA = createRateLimiter(2, 60_000, () => 0);
  const instanceB = createRateLimiter(2, 60_000, () => 0);
  expect([instanceA("chat:u:1"), instanceA("chat:u:1")]).toEqual([true, true]);
  expect(instanceA("chat:u:1")).toBe(false);
  // The second instance never saw the first one's two hits.
  expect([instanceB("chat:u:1"), instanceB("chat:u:1")]).toEqual([true, true]);
});

test("two instances sharing a database share one ceiling", async () => {
  const now = () => 0;
  const instanceA = createSharedRateLimiter({ max: 2, windowMs: 60_000, database: () => db, now });
  const instanceB = createSharedRateLimiter({ max: 2, windowMs: 60_000, database: () => db, now });

  expect(await instanceA("chat:u:1")).toBe(true);
  expect(await instanceA("chat:u:1")).toBe(true);
  expect(await instanceB("chat:u:1")).toBe(false);
});

test("separate buckets stay separate across the shared store", async () => {
  const limiter = createSharedRateLimiter({ max: 1, windowMs: 60_000, database: () => db });
  expect(await limiter("chat:u:1")).toBe(true);
  expect(await limiter("chat:u:1")).toBe(false);
  expect(await limiter("chat:u:2")).toBe(true);
});

test("the shared window frees the budget when it rolls over", async () => {
  let t = 0;
  const limiter = createSharedRateLimiter({
    max: 2,
    windowMs: 1000,
    database: () => db,
    now: () => t,
  });
  expect(await limiter("k")).toBe(true);
  expect(await limiter("k")).toBe(true);
  expect(await limiter("k")).toBe(false);
  t = 1000;
  expect(await limiter("k")).toBe(true);
});

test("the table holds a digest, not the caller's address", async () => {
  const limiter = createSharedRateLimiter({ max: 1, windowMs: 60_000, database: () => db });
  expect(await limiter("extract:ip:203.0.113.7")).toBe(true);
  const rows = await db.http.query("SELECT key_hash FROM personal.rate_limit_buckets");
  expect((rows.rows as Array<{ key_hash: string }>).map((row) => row.key_hash)).toEqual([
    hashBucketKey("extract:ip:203.0.113.7"),
  ]);
});

test("without a database the bounded local guard still limits, and says so once", async () => {
  const reports: string[] = [];
  let t = 0;
  const limiter = createSharedRateLimiter({
    max: 2,
    windowMs: 1000,
    database: () => null,
    now: () => t,
    report: (message) => reports.push(message),
  });
  expect(await limiter("k")).toBe(true);
  expect(await limiter("k")).toBe(true);
  expect(await limiter("k")).toBe(false);
  t = 1000;
  expect(await limiter("k")).toBe(true);
  expect(reports).toHaveLength(1);
  expect(reports[0]).toContain("per-process");
});

test("a failing store falls back to the local guard instead of allowing everything", async () => {
  const reports: Array<{ message: string; error?: unknown }> = [];
  const down = {
    http: {
      query: async () => {
        throw new Error("neon unreachable");
      },
    },
  } as unknown as Database;
  const limiter = createSharedRateLimiter({
    max: 2,
    windowMs: 60_000,
    database: () => down,
    report: (message, error) => reports.push({ message, error }),
  });

  expect(await limiter("k")).toBe(true);
  expect(await limiter("k")).toBe(true);
  // Still refused: the fallback is a real limit, not an open door.
  expect(await limiter("k")).toBe(false);
  expect(reports).toHaveLength(1);
  expect(reports[0]!.message).toContain("falling back");
});

test("a failing store is not retried on every request", async () => {
  let calls = 0;
  const down = {
    http: {
      query: async () => {
        calls++;
        throw new Error("neon unreachable");
      },
    },
  } as unknown as Database;
  const limiter = createSharedRateLimiter({
    max: 10,
    windowMs: 60_000,
    database: () => down,
    report: () => {},
  });
  await limiter("a");
  await limiter("a");
  await limiter("a");
  expect(calls).toBe(1);
});

test("the in-process store keeps the bounded limiter from #238", async () => {
  let t = 0;
  const store = memoryRateLimitStore(2, 1000, () => t);
  expect(store.kind).toBe("memory");
  expect(await store.hit("k")).toBe(true);
  expect(await store.hit("k")).toBe(true);
  expect(await store.hit("k")).toBe(false);
  t = 1000;
  expect(await store.hit("k")).toBe(true);
});
