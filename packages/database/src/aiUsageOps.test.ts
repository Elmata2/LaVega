import { afterAll, beforeAll, expect, test } from "vitest";
import { createAiUsageRepository, withTenant, type Database } from "./index.js";
import { migratedTestDatabase } from "./testing.js";

/*
 * The AI-ops ledger columns #300 adds on top of 0005/0009/0013/0025: provider
 * prompt-cache tokens, and a FAILED row for a call that reached the model and
 * threw. Before this, the failure path deleted its reservation and left no
 * trace. Sure source: app/models/llm_usage.rb @ 562fe09.
 */

let db: Database;
let close: () => Promise<void>;

beforeAll(async () => {
  const migrated = await migratedTestDatabase();
  db = migrated.db;
  close = () => migrated.pglite.close();
}, 60_000);

afterAll(async () => {
  await close();
});

/* RLS applies as lavega_runtime, so a direct read must run as the account, the
 * same way every repository method does. */
const rowCount = async (userId: string): Promise<number> =>
  withTenant(db, userId, async (client) => {
    const result = await client.query<{ count: number }>(
      `SELECT count(*)::int AS count FROM personal.ai_usage`,
    );
    return Number(result.rows[0]?.count ?? 0);
  });

const row = async (userId: string) =>
  withTenant(db, userId, async (client) => {
    const result = await client.query<Record<string, unknown>>(
      `SELECT route, model, input_tokens, output_tokens, cost_cents, cache_write_tokens,
              cache_read_tokens, outcome, error_code, http_status, reconciled_at
         FROM personal.ai_usage ORDER BY id DESC LIMIT 1`,
    );
    return result.rows[0];
  });

test("a completed call stores provider cache-token counts alongside its cost", async () => {
  const repo = createAiUsageRepository(db);
  await repo.record({
    userId: "usage-ok",
    day: "2026-11-11",
    route: "chat",
    model: "mistral-medium-latest",
    inputTokens: 1_000,
    outputTokens: 200,
    pages: 0,
    searches: 1,
    costCents: 7,
    cacheWriteTokens: 300,
    cacheReadTokens: 800,
  });
  expect(await row("usage-ok")).toMatchObject({
    cost_cents: 7,
    cache_write_tokens: 300,
    cache_read_tokens: 800,
    outcome: "ok",
    error_code: null,
  });
});

test("a failed call keeps a row with its error code and HTTP status, at cost 0", async () => {
  const repo = createAiUsageRepository(db);
  const reserved = await repo.reserve({
    userId: "usage-failed",
    day: "2026-11-11",
    month: "2026-11",
    route: "chat",
    worstCaseCents: 25,
    dayCapCents: 10_000,
    monthCapCents: 100_000,
  });
  expect(reserved.ok).toBe(true);
  if (!reserved.ok) return;

  await repo.fail(
    {
      id: reserved.id,
      model: "mistral-medium-latest",
      errorCode: "ai-upstream-limit",
      httpStatus: 429,
      cacheReadTokens: 42,
    },
    "usage-failed",
  );

  expect(await row("usage-failed")).toMatchObject({
    input_tokens: 0,
    output_tokens: 0,
    cost_cents: 0,
    cache_read_tokens: 42,
    outcome: "failed",
    error_code: "ai-upstream-limit",
    http_status: 429,
  });
  expect((await row("usage-failed"))?.reconciled_at).not.toBeNull();
});

test("a failed row no longer holds budget: the cap sums see cost 0", async () => {
  const repo = createAiUsageRepository(db);
  expect(
    await repo.spentCents({ userId: "usage-failed", day: "2026-11-11", month: "2026-11" }),
  ).toEqual({ dayCents: 0, monthCents: 0 });
});

test("fail() is a no-op after the row was already reconciled, so a late failure cannot rewrite a charged call", async () => {
  const repo = createAiUsageRepository(db);
  const reserved = await repo.reserve({
    userId: "usage-race",
    day: "2026-11-11",
    month: "2026-11",
    route: "chat",
    worstCaseCents: 25,
    dayCapCents: 10_000,
    monthCapCents: 100_000,
  });
  expect(reserved.ok).toBe(true);
  if (!reserved.ok) return;
  await repo.reconcile(
    {
      id: reserved.id,
      model: "mistral-medium-latest",
      inputTokens: 10,
      outputTokens: 5,
      pages: 0,
      searches: 0,
      costCents: 3,
    },
    "usage-race",
  );
  await repo.fail(
    { id: reserved.id, model: "mistral-medium-latest", errorCode: "ai-fault" },
    "usage-race",
  );
  expect(await row("usage-race")).toMatchObject({ cost_cents: 3, outcome: "ok", error_code: null });
});

test("the migration constrains the new columns", async () => {
  await expect(
    withTenant(db, "usage-bad", (client) =>
      client.query(
        `INSERT INTO personal.ai_usage (day, route, model, cost_cents, user_id, outcome)
         VALUES ('2026-11-11', 'chat', 'm', 0, 'usage-bad', 'partial')`,
      ),
    ),
  ).rejects.toThrow();
  await expect(
    withTenant(db, "usage-bad", (client) =>
      client.query(
        `INSERT INTO personal.ai_usage (day, route, model, cost_cents, user_id, cache_read_tokens)
         VALUES ('2026-11-11', 'chat', 'm', 0, 'usage-bad', -1)`,
      ),
    ),
  ).rejects.toThrow();
});

test("rowCount helper sanity: failures leave a row, not silence", async () => {
  expect(await rowCount("usage-failed")).toBe(1);
  expect(await rowCount("nobody")).toBe(0);
});
