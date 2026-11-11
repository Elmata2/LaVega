import { afterAll, beforeAll, expect, test } from "vitest";
import type { Database } from "./index.js";
import { createMcpTokenRepository } from "./mcpTokens.js";
import { migratedTestDatabase } from "./testing.js";

let database: Database;
let close: () => Promise<void>;

beforeAll(async () => {
  const migrated = await migratedTestDatabase();
  database = migrated.db;
  close = () => migrated.pglite.close();
}, 30_000);

afterAll(async () => {
  await close();
});

const hash = (character: string) => character.repeat(64);

test("a live token resolves to its tenant and scopes", async () => {
  const repository = createMcpTokenRepository(database);
  const id = await repository.create({
    userId: "user-1",
    tokenHash: hash("a"),
    label: "laptop",
    scopes: ["read"],
  });
  const row = await repository.resolve(hash("a"), new Date());
  expect(row).toEqual({ id, userId: "user-1", scopes: ["read"] });
});

test("an unknown digest resolves to nothing", async () => {
  const repository = createMcpTokenRepository(database);
  expect(await repository.resolve(hash("b"), new Date())).toBeNull();
});

test("a revoked token stops resolving", async () => {
  const repository = createMcpTokenRepository(database);
  const id = await repository.create({
    userId: "user-2",
    tokenHash: hash("c"),
    label: null,
    scopes: ["read"],
  });
  expect(await repository.resolve(hash("c"), new Date())).not.toBeNull();
  expect(await repository.revoke(id, new Date())).toBe(true);
  expect(await repository.resolve(hash("c"), new Date())).toBeNull();
  // Revoking twice is a no-op, not an error.
  expect(await repository.revoke(id, new Date())).toBe(false);
});

test("an expired token stops resolving", async () => {
  const repository = createMcpTokenRepository(database);
  await database.http.query(
    `INSERT INTO investing.api_tokens (user_id, token_hash, scopes, expires_at)
     VALUES ($1, $2, ARRAY['read']::text[], $3::timestamptz)`,
    ["user-3", hash("d"), new Date("2020-01-01T00:00:00Z").toISOString()],
  );
  expect(await repository.resolve(hash("d"), new Date())).toBeNull();
});

test("touching a token records last use without changing the digest", async () => {
  const repository = createMcpTokenRepository(database);
  const id = await repository.create({
    userId: "user-4",
    tokenHash: hash("e"),
    label: null,
    scopes: ["read"],
  });
  await repository.touch(id, new Date("2026-03-04T12:00:00Z"));
  const row = (await database.http.query(
    `SELECT last_used_at, token_hash FROM investing.api_tokens WHERE id = $1::uuid`,
    [id],
  )) as unknown as { rows: Array<{ last_used_at: string | null; token_hash: string }> };
  expect(row.rows[0]?.token_hash).toBe(hash("e"));
  expect(row.rows[0]?.last_used_at).not.toBeNull();
});

test("an audit row records the call without the raw token", async () => {
  const repository = createMcpTokenRepository(database);
  await repository.audit({
    tokenId: "env",
    method: "tools/call",
    tool: "get_positions",
    durationMs: 12,
    outcome: "ok",
  });
  const rows = (await database.http.query(
    `SELECT token_id, method, tool, outcome FROM investing.mcp_audit
      WHERE token_id = 'env' ORDER BY id DESC LIMIT 1`,
  )) as unknown as { rows: Array<{ token_id: string; method: string; tool: string | null; outcome: string }> };
  expect(rows.rows[0]).toEqual({
    token_id: "env",
    method: "tools/call",
    tool: "get_positions",
    outcome: "ok",
  });
});

test("the schema refuses a digest that is not a SHA-256 hex string", async () => {
  const repository = createMcpTokenRepository(database);
  await expect(
    repository.create({ userId: "user-5", tokenHash: "not-hex", label: null, scopes: ["read"] }),
  ).rejects.toThrow();
});

test("the schema refuses a scope outside the allowlist", async () => {
  const repository = createMcpTokenRepository(database);
  await expect(
    repository.create({
      userId: "user-6",
      tokenHash: hash("f"),
      label: null,
      scopes: ["read_write"],
    }),
  ).rejects.toThrow();
});
