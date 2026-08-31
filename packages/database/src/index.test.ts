import { afterEach, expect, test } from "vitest";
import { createAgentRunRepository, createOpaqueVaultRepository, createPreferencesRepository, createPriceBarRepository, createSyncStateRepository, decryptBlob, encryptBlob, requireUserId, withTenant } from "./index.js";
import type { QueryResultRow } from "@neondatabase/serverless";

afterEach(() => { delete process.env.LAVEGA_ENCRYPTION_KEY; });

test("encrypted blobs round-trip and do not contain plaintext", () => {
  process.env.LAVEGA_ENCRYPTION_KEY = "00".repeat(32);
  const blob = encryptBlob({ secret: "not-for-neon" });
  expect(blob.toString("utf8")).not.toContain("not-for-neon");
  expect(decryptBlob<{ secret: string }>(blob)).toEqual({ secret: "not-for-neon" });
});

test("encryption rejects missing or invalid key", () => {
  expect(() => encryptBlob({ value: 1 })).toThrow("LAVEGA_ENCRYPTION_KEY");
  process.env.LAVEGA_ENCRYPTION_KEY = "bad";
  expect(() => encryptBlob({ value: 1 })).toThrow("32 bytes");
});

test("tenant identity is mandatory", () => {
  expect(() => requireUserId(undefined)).toThrow("Authenticated user identity is required");
  expect(() => requireUserId(" ")).toThrow("Authenticated user identity is required");
});

test("withTenant sets transaction-local identity and rolls back on failure", async () => {
  const calls: string[] = [];
  const client = {
    query: async (sql: string) => { calls.push(sql); return { rows: [] }; },
    release: () => calls.push("release"),
  } as never;
  const db = { connect: async () => client } as never;
  await expect(withTenant(db, "user-1", async () => { throw new Error("fail"); })).rejects.toThrow("fail");
  expect(calls).toEqual(["BEGIN", "SELECT set_config('app.user_id', $1, true)", "ROLLBACK", "release"]);
});

function fakeDatabase(rows: QueryResultRow[] = []) {
  const calls: Array<{ sql: string; values?: unknown[] }> = [];
  const client = {
    query: async (sql: string, values?: unknown[]) => {
      calls.push({ sql, values });
      return { rows: sql.startsWith("SELECT set_config") ? [] : rows };
    },
    release: () => undefined,
  } as never;
  return { db: { connect: async () => client } as never, calls };
}

const executed = (calls: Array<{ sql: string; values?: unknown[] }>) =>
  calls.filter((call) => !["BEGIN", "COMMIT", "ROLLBACK"].includes(call.sql) && !call.sql.startsWith("SELECT set_config"));

test("price bars are read, written and purged inside the tenant transaction", async () => {
  const { db, calls } = fakeDatabase([{ symbol: "AAPL", date: "2026-01-02", close: "120.50", currency: "USD" }]);
  const repository = createPriceBarRepository(db, "user-123");

  const bars = await repository.getRange("AAPL", "2026-01-01", "2026-01-31");

  expect(bars).toEqual([{ tenantId: "user-123", symbol: "AAPL", date: "2026-01-02", close: 120.5, currency: "USD" }]);
  expect(calls[1]).toEqual({ sql: "SELECT set_config('app.user_id', $1, true)", values: ["user-123"] });
  expect(executed(calls)[0]?.values).toEqual(["AAPL", "2026-01-01", "2026-01-31"]);
});

test("price bar writes refuse a bar belonging to another tenant", async () => {
  const { db } = fakeDatabase();
  const repository = createPriceBarRepository(db, "user-123");

  await expect(repository.upsert([{ tenantId: "user-456", symbol: "AAPL", date: "2026-01-02", close: 1, currency: "USD" }]))
    .rejects.toThrow(/tenant/i);
});

test("an empty price bar write touches the database not at all", async () => {
  const { db, calls } = fakeDatabase();

  await createPriceBarRepository(db, "user-123").upsert([]);

  expect(calls).toEqual([]);
});

test("preferences keep benchmarks and consent in one row without overwriting each other", async () => {
  const { db, calls } = fakeDatabase([{ benchmark_symbols: ["^AEX"], market_data_consent: { accepted: true } }]);
  const repository = createPreferencesRepository(db, "user-123");

  expect(await repository.getBenchmarkSymbols()).toEqual(["^AEX"]);
  expect(await repository.getMarketDataConsent()).toEqual({ accepted: true });

  await repository.setBenchmarkSymbols(["^GSPC"]);
  const write = executed(calls).at(-1)!;
  expect(write.sql).toContain("benchmark_symbols");
  expect(write.sql).not.toContain("market_data_consent");
  expect(write.values).toEqual([JSON.stringify(["^GSPC"])]);
});

test("a tenant with no preferences row reads empty rather than throwing", async () => {
  const repository = createPreferencesRepository(fakeDatabase().db, "user-123");

  expect(await repository.getBenchmarkSymbols()).toEqual([]);
  expect(await repository.getMarketDataConsent()).toBeNull();
});

test("broker sync state round-trips per broker", async () => {
  const { db, calls } = fakeDatabase([{ state: { lastSyncedAt: "2026-01-02T00:00:00.000Z", retryAfter: null } }]);
  const repository = createSyncStateRepository(db, "user-123");

  expect(await repository.get("trading212")).toEqual({ lastSyncedAt: "2026-01-02T00:00:00.000Z", retryAfter: null });

  await repository.put("trading212", { lastSyncedAt: "2026-01-03T00:00:00.000Z", retryAfter: null });
  expect(executed(calls).at(-1)?.values).toEqual(["trading212", JSON.stringify({ lastSyncedAt: "2026-01-03T00:00:00.000Z", retryAfter: null }), "2026-01-03T00:00:00.000Z"]);
});

test("agent run status is mapped onto the values the table allows", async () => {
  const { db, calls } = fakeDatabase();
  const repository = createAgentRunRepository(db, "user-123");

  await repository.put({ id: "run-1", startedAt: "2026-01-02T00:00:00.000Z", finishedAt: "2026-01-02T00:01:00.000Z", status: "done", summary: "fine", error: null });

  const values = executed(calls).at(-1)?.values as unknown[];
  expect(values[1]).toBe("succeeded");
  expect(JSON.parse(values[2] as string)).toEqual({ summary: "fine", error: null });
});

test("agent runs are read back in the runtime's own vocabulary", async () => {
  const { db } = fakeDatabase([{ run_id: "run-1", status: "failed", run_result: { summary: null, error: "boom" }, started_at: new Date("2026-01-02T00:00:00.000Z"), finished_at: null }]);

  expect(await createAgentRunRepository(db, "user-123").get()).toEqual({
    id: "run-1",
    startedAt: "2026-01-02T00:00:00.000Z",
    finishedAt: null,
    status: "error",
    summary: null,
    error: "boom",
  });
});

test("the personal vault stores bytes the server never decrypts", async () => {
  const { db, calls } = fakeDatabase([{ vault_blob: Buffer.from("opaque-ciphertext"), updated_at: "2026-08-31T00:00:00.000000Z" }]);
  const repository = createOpaqueVaultRepository(db, "user-123");

  const stored = await repository.get();

  expect(stored?.blob.toString("utf8")).toBe("opaque-ciphertext");
  // Full microsecond precision: this token is compared against the column verbatim.
  expect(stored?.updatedAt).toBe("2026-08-31T00:00:00.000000Z");
  // No key is read and no plaintext is produced: the row is bytes in, bytes out.
  expect(calls.some((call) => call.sql.includes("decrypt"))).toBe(false);
});

test("a vault write that is not based on the current server copy is refused", async () => {
  const { db } = fakeDatabase([]);

  const outcome = await createOpaqueVaultRepository(db, "user-123").put(Buffer.from("new"), "2026-01-01T00:00:00.000Z");

  expect(outcome).toEqual({ status: "conflict" });
});

test("a vault write based on the current server copy is accepted", async () => {
  const { db, calls } = fakeDatabase([{ updated_at: "2026-08-31T12:00:00.000000Z" }]);

  const outcome = await createOpaqueVaultRepository(db, "user-123").put(Buffer.from("new"), "2026-08-31T00:00:00.000000Z");

  expect(outcome).toEqual({ status: "stored", updatedAt: "2026-08-31T12:00:00.000000Z" });
  expect(calls.at(-2)?.values).toEqual([Buffer.from("new"), "2026-08-31T00:00:00.000000Z"]);
});

test("an empty vault blob is refused before it reaches the table's own check", async () => {
  const { db, calls } = fakeDatabase();

  await expect(createOpaqueVaultRepository(db, "user-123").put(Buffer.alloc(0), null)).rejects.toThrow(/empty/i);
  expect(calls).toEqual([]);
});
