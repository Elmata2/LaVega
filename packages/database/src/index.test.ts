import { afterEach, expect, test } from "vitest";
import {
  eraseUserData,
  createAgentRunRepository,
  createBrokerRepository,
  createEbFlowRepository,
  createOpaqueVaultRepository,
  createPreferencesRepository,
  createPriceBarRepository,
  createPriceSyncStateRepository,
  createSyncStateRepository,
  decryptBlob,
  encryptBlob,
  requireUserId,
  withTenant,
} from "./index.js";
import type { QueryResultRow } from "@neondatabase/serverless";

afterEach(() => {
  delete process.env.LAVEGA_ENCRYPTION_KEY;
});

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
    query: async (sql: string) => {
      calls.push(sql);
      return { rows: [] };
    },
    release: () => calls.push("release"),
  } as never;
  const db = { connect: async () => client } as never;
  await expect(
    withTenant(db, "user-1", async () => {
      throw new Error("fail");
    }),
  ).rejects.toThrow("fail");
  expect(calls).toEqual([
    "BEGIN",
    "SELECT set_config('app.user_id', $1, true)",
    "ROLLBACK",
    "release",
  ]);
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
  calls.filter(
    (call) =>
      !["BEGIN", "COMMIT", "ROLLBACK"].includes(call.sql) &&
      !call.sql.startsWith("SELECT set_config"),
  );

test("bulk price reads use one tenant transaction and deduplicate symbols", async () => {
  const { db, calls } = fakeDatabase([
    { symbol: "AAPL", date: "2026-01-02", close: "120.5", currency: "USD" },
  ]);
  const bars = await createPriceBarRepository(db, "user-a").getRanges(["AAPL", "MSFT", "AAPL"]);
  expect(bars).toEqual([{ symbol: "AAPL", date: "2026-01-02", close: 120.5, currency: "USD" }]);
  expect(calls.filter((call) => call.sql === "BEGIN")).toHaveLength(1);
  expect(calls.find((call) => call.sql.startsWith("SELECT set_config"))?.values).toEqual([
    "user-a",
  ]);
  expect(executed(calls)).toEqual([
    {
      sql: "SELECT symbol, to_char(date, 'YYYY-MM-DD') AS date, close, currency FROM investing.price_bars WHERE symbol = ANY($1::text[]) ORDER BY date, symbol",
      values: [["AAPL", "MSFT"]],
    },
  ]);
});

test("empty bulk price reads do not open a database connection", async () => {
  const { db, calls } = fakeDatabase();
  expect(await createPriceBarRepository(db, "user-a").getRanges([])).toEqual([]);
  expect(calls).toEqual([]);
});

test("an unbounded price bar read asks for no date range at all", async () => {
  /* The whole history used to be spelled '0000-01-01'..'9999-12-31'. Postgres has
   * no year zero, so that read threw and every dashboard behind it came back
   * empty. Omitting a bound has to mean "no bound", not a sentinel date. */
  const { db, calls } = fakeDatabase();
  const repository = createPriceBarRepository(db, "user-123");

  await repository.getRange("AAPL");

  const query = executed(calls)[0];
  expect(query?.values).toEqual(["AAPL"]);
  expect(query?.sql).not.toMatch(/BETWEEN|\$2/);
});

test("a half-open price bar read keeps only the bound it was given", async () => {
  const { db, calls } = fakeDatabase();
  const repository = createPriceBarRepository(db, "user-123");

  await repository.getRange("AAPL", "2026-01-01");

  const query = executed(calls)[0];
  expect(query?.values).toEqual(["AAPL", "2026-01-01"]);
  expect(query?.sql).toContain("date >= $2");
  expect(query?.sql).not.toContain("date <= ");
});

test("price bars are read, written and purged inside the tenant transaction", async () => {
  const { db, calls } = fakeDatabase([
    { symbol: "AAPL", date: "2026-01-02", close: "120.50", currency: "USD" },
  ]);
  const repository = createPriceBarRepository(db, "user-123");

  const bars = await repository.getRange("AAPL", "2026-01-01", "2026-01-31");

  expect(bars).toEqual([{ symbol: "AAPL", date: "2026-01-02", close: 120.5, currency: "USD" }]);
  expect(calls[1]).toEqual({
    sql: "SELECT set_config('app.user_id', $1, true)",
    values: ["user-123"],
  });
  expect(executed(calls)[0]?.values).toEqual(["AAPL", "2026-01-01", "2026-01-31"]);
});

test("a price bar currency is stored exactly as the provider spelled it", async () => {
  /* `GBp` is pence and `GBP` is pounds. Uppercasing on write turned one into the
   * other and repriced London holdings by a factor of 100. */
  const { db, calls } = fakeDatabase();

  await createPriceBarRepository(db, "user-123").upsert([
    { symbol: "HLMA.L", date: "2026-09-02", close: 3568, currency: "GBp" },
  ]);

  expect(executed(calls)[0]?.values?.[3]).toEqual(["GBp"]);
});

test("an empty price bar write touches the database not at all", async () => {
  const { db, calls } = fakeDatabase();

  await createPriceBarRepository(db, "user-123").upsert([]);

  expect(calls).toEqual([]);
});

test("preferences keep benchmarks and consent in one row without overwriting each other", async () => {
  const { db, calls } = fakeDatabase([
    { benchmark_symbols: ["^AEX"], market_data_consent: { accepted: true } },
  ]);
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
  const { db, calls } = fakeDatabase([
    { state: { lastSyncedAt: "2026-01-02T00:00:00.000Z", retryAfter: null } },
  ]);
  const repository = createSyncStateRepository(db, "user-123");

  expect(await repository.get("trading212")).toEqual({
    lastSyncedAt: "2026-01-02T00:00:00.000Z",
    retryAfter: null,
  });

  await repository.put("trading212", {
    lastSyncedAt: "2026-01-03T00:00:00.000Z",
    retryAfter: null,
  });
  expect(executed(calls).at(-1)?.values).toEqual([
    "trading212",
    JSON.stringify({ lastSyncedAt: "2026-01-03T00:00:00.000Z", retryAfter: null }),
    "2026-01-03T00:00:00.000Z",
  ]);
});

test("price sync claim returns the active row when another invocation owns a fresh lease", async () => {
  const active = { status: "running", leaseId: "older", updatedAt: "2026-09-03T10:00:00.000Z" };
  const { db, calls } = fakeDatabase([{ state: active, claimed: false }]);
  const repository = createPriceSyncStateRepository(db, "user-123");

  await expect(
    repository.claim(
      { status: "running", leaseId: "newer", updatedAt: "2026-09-03T10:00:10.000Z" },
      "running",
      "2026-09-03T09:59:30.000Z",
    ),
  ).resolves.toEqual(active);

  const claim = executed(calls).at(-1)!;
  expect(claim.sql).toContain("ON CONFLICT");
  expect(claim.sql).toContain("state->>'updatedAt'");
  expect(claim.values).toEqual([
    "prices",
    "running",
    JSON.stringify({ status: "running", leaseId: "newer", updatedAt: "2026-09-03T10:00:10.000Z" }),
    "2026-09-03T09:59:30.000Z",
  ]);
});

test("price sync writes require the lease that claimed the row", async () => {
  const { db, calls } = fakeDatabase();
  const repository = createPriceSyncStateRepository(db, "user-123");

  await expect(
    repository.put({ status: "paused", leaseId: "mine", problems: [] }, "paused", "mine"),
  ).resolves.toBe(false);

  const write = executed(calls).at(-1)!;
  expect(write.sql).toContain("WHERE broker = $1 AND state->>'leaseId' = $4");
  expect(write.values?.slice(0, 4)).toEqual([
    "prices",
    "partial",
    JSON.stringify({ status: "paused", leaseId: "mine", problems: [] }),
    "mine",
  ]);
});

test("agent run status is mapped onto the values the table allows", async () => {
  const { db, calls } = fakeDatabase();
  const repository = createAgentRunRepository(db, "user-123");

  await repository.put({
    id: "run-1",
    agentId: "bill_ackman",
    startedAt: "2026-01-02T00:00:00.000Z",
    finishedAt: "2026-01-02T00:01:00.000Z",
    status: "done",
    summary: "fine",
    error: null,
    result: { signal: "neutral" },
  });

  const values = executed(calls).at(-1)?.values as unknown[];
  expect(values[1]).toBe("succeeded");
  expect(JSON.parse(values[2] as string)).toEqual({
    agentId: "bill_ackman",
    summary: "fine",
    error: null,
    result: { signal: "neutral" },
  });
});

test("agent runs are read back in the runtime's own vocabulary", async () => {
  const { db } = fakeDatabase([
    {
      run_id: "run-1",
      status: "failed",
      run_result: {
        agentId: "bill_ackman",
        summary: null,
        error: "boom",
        result: { signal: "neutral" },
      },
      started_at: new Date("2026-01-02T00:00:00.000Z"),
      finished_at: null,
    },
  ]);

  expect(await createAgentRunRepository(db, "user-123").get()).toEqual({
    id: "run-1",
    agentId: "bill_ackman",
    startedAt: "2026-01-02T00:00:00.000Z",
    finishedAt: null,
    status: "error",
    summary: null,
    error: "boom",
    result: { signal: "neutral" },
  });
});

test("the personal vault stores bytes the server never decrypts", async () => {
  const { db, calls } = fakeDatabase([
    { vault_blob: Buffer.from("opaque-ciphertext"), updated_at: "2026-08-31T00:00:00.000000Z" },
  ]);
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

  const outcome = await createOpaqueVaultRepository(db, "user-123").put(
    Buffer.from("new"),
    "2026-01-01T00:00:00.000Z",
  );

  expect(outcome).toEqual({ status: "conflict" });
});

test("a vault write based on the current server copy is accepted", async () => {
  const { db, calls } = fakeDatabase([{ updated_at: "2026-08-31T12:00:00.000000Z" }]);

  const outcome = await createOpaqueVaultRepository(db, "user-123").put(
    Buffer.from("new"),
    "2026-08-31T00:00:00.000000Z",
  );

  expect(outcome).toEqual({ status: "stored", updatedAt: "2026-08-31T12:00:00.000000Z" });
  expect(calls.at(-2)?.values).toEqual([Buffer.from("new"), "2026-08-31T00:00:00.000000Z"]);
});

test("an empty vault blob is refused before it reaches the table's own check", async () => {
  const { db, calls } = fakeDatabase();

  await expect(
    createOpaqueVaultRepository(db, "user-123").put(Buffer.alloc(0), null),
  ).rejects.toThrow(/empty/i);
  expect(calls).toEqual([]);
});

test("a snapshot sealed under an older key reads as absent instead of crashing the runtime", async () => {
  process.env.LAVEGA_ENCRYPTION_KEY = "11".repeat(32);
  const staleSnapshot = encryptBlob({ trading212: { positions: [] } });
  process.env.LAVEGA_ENCRYPTION_KEY = "22".repeat(32);
  const credentials = encryptBlob({ broker: "trading212", token: "t" });
  const { db } = fakeDatabase([{ credentials_blob: credentials, snapshot_blob: staleSnapshot }]);

  const row = await createBrokerRepository(db, "user-123").get("trading212");

  // The snapshot is a cache of broker data; a sync rebuilds it. Losing it must
  // not take the credentials — and the whole account — down with it.
  expect(row).toEqual({ credentials: { broker: "trading212", token: "t" }, snapshot: null });
});

test("credentials sealed under an older key fail loudly, naming the key", async () => {
  process.env.LAVEGA_ENCRYPTION_KEY = "11".repeat(32);
  const stale = encryptBlob({ broker: "trading212", token: "t" });
  process.env.LAVEGA_ENCRYPTION_KEY = "22".repeat(32);
  const { db } = fakeDatabase([{ credentials_blob: stale, snapshot_blob: null }]);

  /* Deliberately not "no credentials": that would send the user off to re-enter
   * their broker tokens, and the write would overwrite ciphertext that a fixed
   * key could still have opened. */
  await expect(createBrokerRepository(db, "user-123").get("trading212")).rejects.toThrow(
    /LAVEGA_ENCRYPTION_KEY/,
  );
});

/* Erasure (GDPR art. 17). A fake that reports rowCount, which the shared
 * `fakeDatabase` above has no reason to. */
function erasureDatabase(rowCount = 1, failOn?: string) {
  const calls: string[] = [];
  const paramCalls: Array<{ sql: string; values?: unknown[] }> = [];
  const client = {
    query: async (sql: string, values?: unknown[]) => {
      calls.push(sql);
      paramCalls.push({ sql, values });
      if (failOn && sql.includes(failOn)) throw new Error("boom");
      return { rows: [], rowCount };
    },
    release: () => undefined,
  } as never;
  return { db: { connect: async () => client } as never, calls, paramCalls };
}

test("erasure clears every table that holds personal data, in one transaction", async () => {
  const { db, calls } = erasureDatabase(3);

  const report = await eraseUserData(db, "user-123");

  expect(calls[0]).toBe("BEGIN");
  expect(calls[1]).toBe("SELECT set_config('app.user_id', $1, true)");
  expect(calls.at(-1)).toBe("COMMIT");
  expect(calls.filter((sql) => sql.startsWith("DELETE FROM"))).toEqual([
    "DELETE FROM personal.eb_sessions WHERE user_id = $1",
    "DELETE FROM personal.eb_pending_auth WHERE user_id = $1",
    "DELETE FROM investing.agent_runs WHERE user_id = $1",
    "DELETE FROM investing.sync_state WHERE user_id = $1",
    "DELETE FROM investing.preferences WHERE user_id = $1",
    "DELETE FROM investing.price_bars WHERE user_id = $1",
    "DELETE FROM investing.broker_vaults WHERE user_id = $1",
    "DELETE FROM personal.vaults WHERE user_id = $1",
  ]);
  // The personal vault — the one thing the server cannot read — is still erasable.
  expect(report).toContainEqual({ table: "personal.vaults", rows: 3 });
  expect(report).toHaveLength(8);
});

test("erasure scopes personal.eb_pending_auth by user_id — that table has no RLS to fall back on", async () => {
  // 0003_eb_flow.sql leaves eb_pending_auth deliberately without RLS (the bank
  // callback cannot be relied on to carry a session cookie). An unscoped
  // DELETE against it during erasure would empty every user's pending bank
  // authorisations, not just the identity being erased.
  const { db, paramCalls } = erasureDatabase(1);

  await eraseUserData(db, "user-123");

  const pendingAuthDelete = paramCalls.find((call) =>
    call.sql.startsWith("DELETE FROM personal.eb_pending_auth"),
  );
  expect(pendingAuthDelete?.sql).toBe("DELETE FROM personal.eb_pending_auth WHERE user_id = $1");
  expect(pendingAuthDelete?.values).toEqual(["user-123"]);
});

test("erasure reports zero rows rather than pretending it did not run", async () => {
  const { db } = erasureDatabase(0);
  const report = await eraseUserData(db, "user-123");
  expect(report.every((entry) => entry.rows === 0)).toBe(true);
  expect(report).toHaveLength(8);
});

test("a half-erased account rolls back — the caller is never told they are gone when they are not", async () => {
  // Fail on the LAST table, so five deletes have already 'succeeded'.
  const { db, calls } = erasureDatabase(1, "personal.vaults");

  await expect(eraseUserData(db, "user-123")).rejects.toThrow("boom");

  expect(calls).toContain("ROLLBACK");
  expect(calls).not.toContain("COMMIT");
});

test("erasure refuses without an authenticated identity", async () => {
  const { db, calls } = erasureDatabase();
  await expect(eraseUserData(db, undefined)).rejects.toThrow(
    "Authenticated user identity is required",
  );
  await expect(eraseUserData(db, " ")).rejects.toThrow("Authenticated user identity is required");
  // Nothing was even connected to, let alone deleted.
  expect(calls).toEqual([]);
});

/* eb_sessions carries FORCE ROW LEVEL SECURITY (0004_eb_grants.sql), scoped to
 * app.user_id. The runtime role has no BYPASSRLS, so — unlike eb_pending_auth's
 * sweepAuth — an unscoped DELETE here would only ever see the caller's own
 * rows. sweepSessions runs inside withTenant for exactly that reason. */
test("sweepSessions drops one user's own stale eb_sessions, scoped through withTenant", async () => {
  const { db, calls, paramCalls } = erasureDatabase(2);
  const repository = createEbFlowRepository(db);

  const removed = await repository.sweepSessions("user-123", 60 * 60 * 1000);

  expect(removed).toBe(2);
  expect(calls[0]).toBe("BEGIN");
  expect(paramCalls[1]).toEqual({
    sql: "SELECT set_config('app.user_id', $1, true)",
    values: ["user-123"],
  });
  const deleteCall = paramCalls.find((call) =>
    call.sql.startsWith("DELETE FROM personal.eb_sessions"),
  );
  expect(deleteCall?.sql).toBe(
    "DELETE FROM personal.eb_sessions WHERE created_at <= CURRENT_TIMESTAMP - ($1::bigint * INTERVAL '1 millisecond')",
  );
  expect(deleteCall?.values).toEqual(["3600000"]);
  expect(calls.at(-1)).toBe("COMMIT");
});

test("sweepSessions reports zero rather than pretending it did not run", async () => {
  const { db } = erasureDatabase(0);
  const removed = await createEbFlowRepository(db).sweepSessions("user-123", 60 * 60 * 1000);
  expect(removed).toBe(0);
});
