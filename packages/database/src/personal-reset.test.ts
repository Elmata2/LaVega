import { afterAll, beforeAll, beforeEach, expect, test } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import {
  createOpaqueVaultRepository,
  erasePersonalData,
  eraseUserData,
  PERSONAL_RESET_TABLES,
  type Database,
} from "./index.js";
import { databaseOver, migratedTestDatabase } from "./testing.js";

/* Real migrations, real Postgres (PGlite) acting as `lavega_runtime`, as
 * erasure.test.ts does. The reset is a claim about which rows survive, so every
 * table it deletes AND every table it must keep is seeded for two users. Seeding
 * and counting run as the superuser (RESET ROLE), which bypasses RLS, so a count
 * of 0 means the row is gone and not merely hidden by a policy. */

const DELETED = [
  "personal.eb_sessions",
  "personal.eb_pending_auth",
  "personal.n8n_forwarding",
  "personal.vaults",
  "personal.net_worth_totals",
  // The Instinct agent, child-first as in the full erase (USER_DATA_TABLES).
  "personal.agent_whatsapp",
  "personal.agent_link_codes",
  "personal.agent_events",
  "personal.agent_push_subscriptions",
  "personal.agent_mirror",
  "personal.agent_state",
  "personal.agent_settings",
] as const;

const KEPT_BY_USER_ID = [
  "personal.vault_keys",
  "personal.ai_usage",
  "investing.broker_vaults",
  "investing.preferences",
  "investing.sync_state",
  "investing.agent_runs",
  "investing.agent_threads",
  "investing.agent_messages",
  "investing.agent_observations",
  "investing.theses",
  "investing.goals",
  "investing.portfolio_letters",
  "investing.dashboard_sources",
  "investing.dashboard_snapshots",
] as const;

const AUTH_KEPT = [
  ["public.session", '"userId"'],
  ["public.account", '"userId"'],
  ['public."user"', "id"],
] as const;

let pglite: PGlite;
let db: Database;

beforeAll(async () => {
  ({ pglite, db } = await migratedTestDatabase());
}, 60_000);

afterAll(async () => {
  await pglite.close();
});

async function asOwner<T>(run: () => Promise<T>): Promise<T> {
  await pglite.exec("RESET ROLE");
  try {
    return await run();
  } finally {
    await pglite.exec("SET ROLE lavega_runtime");
  }
}

async function seed(id: string, tag: string): Promise<void> {
  const e = (value: string) => `'${value}'`;
  await pglite.exec(`
    INSERT INTO public."user" (id, name, email) VALUES (${e(id)}, ${e(tag)}, ${e(`${tag}@example.com`)});
    INSERT INTO public.session (id, "expiresAt", token, "userId")
      VALUES (${e(`s-${tag}`)}, CURRENT_TIMESTAMP + INTERVAL '1 day', ${e(`t-${tag}`)}, ${e(id)});
    INSERT INTO public.account (id, issuer, "accountId", "providerId", "userId", password)
      VALUES (${e(`a-${tag}`)}, 'local', ${e(`${tag}@example.com`)}, 'credential', ${e(id)}, 'hash');
    INSERT INTO public.verification (id, identifier, value, "expiresAt")
      VALUES (${e(`v-${tag}`)}, ${e(`${tag}@example.com`)}, 'x', CURRENT_TIMESTAMP + INTERVAL '1 day');

    INSERT INTO personal.eb_sessions (session_id, user_id, payload_blob)
      VALUES (${e(`eb-${tag}`)}, ${e(id)}, '\\x01');
    INSERT INTO personal.eb_pending_auth (state, user_id, aspsp_name, aspsp_country)
      VALUES (${e(`st-${tag}`)}, ${e(id)}, 'Bank', 'NL');
    INSERT INTO personal.n8n_forwarding (user_id, local_part) VALUES (${e(id)}, ${e(`fwd-${tag}`)});
    INSERT INTO personal.vaults (user_id, vault_blob) VALUES (${e(id)}, '\\x01');
    INSERT INTO personal.net_worth_totals (user_id, date, total_cents)
      VALUES (${e(id)}, '2026-11-01', 100);
    INSERT INTO personal.agent_settings (user_id, enabled) VALUES (${e(id)}, true);
    INSERT INTO personal.agent_state (user_id, last_sent_date) VALUES (${e(id)}, '2026-11-01');
    INSERT INTO personal.agent_mirror (user_id, payload_blob) VALUES (${e(id)}, '\\x01');
    INSERT INTO personal.agent_push_subscriptions (user_id, endpoint_hash, subscription_blob)
      VALUES (${e(id)}, ${e(`ep-${tag}`)}, '\\x01');
    INSERT INTO personal.agent_events (user_id, id, channel, type, body_blob)
      VALUES (${e(id)}, ${e(`00000000-0000-0000-0000-0000000000e${tag === "a" ? 1 : 2}`)}, 'feed', 'message', '\\x01');
    INSERT INTO personal.agent_whatsapp (user_id, phone_hash, phone_blob, ai_consent_at)
      VALUES (${e(id)}, ${e(`ph-${tag}`)}, '\\x01', CURRENT_TIMESTAMP);
    INSERT INTO personal.agent_link_codes (user_id, code_hash, expires_at, ai_consent_at)
      VALUES (${e(id)}, ${e(`ch-${tag}`)}, CURRENT_TIMESTAMP + INTERVAL '15 minutes', CURRENT_TIMESTAMP);
    INSERT INTO personal.vault_keys (user_id, wrapped_key) VALUES (${e(id)}, '\\x01');
    INSERT INTO personal.ai_usage (day, route, model, cost_cents, user_id)
      VALUES ('2026-11-01', 'categorize', 'm', 5, ${e(id)});

    INSERT INTO investing.broker_vaults (user_id, broker, credentials_blob)
      VALUES (${e(id)}, 'ibkr', '\\x01');
    INSERT INTO investing.preferences (user_id) VALUES (${e(id)});
    INSERT INTO investing.sync_state (user_id, broker) VALUES (${e(id)}, 'ibkr');
    INSERT INTO investing.agent_runs (user_id, run_id, status) VALUES (${e(id)}, 'r1', 'queued');
    INSERT INTO investing.agent_threads (user_id, id, agent_id, title_blob)
      VALUES (${e(id)}, '00000000-0000-0000-0000-00000000000${tag === "a" ? 1 : 2}', 'ag', '\\x01');
    INSERT INTO investing.agent_messages (user_id, thread_id, seq, message_blob)
      VALUES (${e(id)}, '00000000-0000-0000-0000-00000000000${tag === "a" ? 1 : 2}', 1, '\\x01');
    INSERT INTO investing.agent_observations (user_id, agent_id, thread_id, body_blob)
      VALUES (${e(id)}, 'ag', '00000000-0000-0000-0000-00000000000${tag === "a" ? 1 : 2}', '\\x01');
    INSERT INTO investing.theses (user_id, symbol, body_blob) VALUES (${e(id)}, 'ASML', '\\x01');
    INSERT INTO investing.goals (user_id, body_blob) VALUES (${e(id)}, '\\x01');
    INSERT INTO investing.portfolio_letters (user_id, id, snapshot_hash, holdings_hash, body_blob)
      VALUES (${e(id)}, '00000000-0000-0000-0000-0000000000a${tag === "a" ? 1 : 2}', 'h', 'h', '\\x01');
    INSERT INTO investing.dashboard_sources (user_id, version) VALUES (${e(id)}, 1)
      ON CONFLICT (user_id) DO NOTHING;
    INSERT INTO investing.dashboard_snapshots (user_id, cache_key, version, as_of, blob)
      VALUES (${e(id)}, 'k', 1, '2026-11-01', '\\x01');
  `);
}

beforeEach(async () => {
  await asOwner(async () => {
    await pglite.exec(`
      DELETE FROM personal.eb_sessions; DELETE FROM personal.eb_pending_auth;
      DELETE FROM personal.n8n_forwarding; DELETE FROM personal.vaults;
      DELETE FROM personal.net_worth_totals; DELETE FROM personal.vault_keys;
      DELETE FROM personal.agent_whatsapp; DELETE FROM personal.agent_link_codes;
      DELETE FROM personal.agent_events; DELETE FROM personal.agent_push_subscriptions;
      DELETE FROM personal.agent_mirror; DELETE FROM personal.agent_state;
      DELETE FROM personal.agent_settings;
      DELETE FROM personal.ai_usage;
      DELETE FROM investing.broker_vaults; DELETE FROM investing.preferences;
      DELETE FROM investing.sync_state; DELETE FROM investing.agent_runs;
      DELETE FROM investing.agent_threads; DELETE FROM investing.theses;
      DELETE FROM investing.goals; DELETE FROM investing.portfolio_letters;
      DELETE FROM investing.dashboard_snapshots; DELETE FROM investing.dashboard_sources;
      DELETE FROM public.verification; DELETE FROM public."user";
    `);
    await seed("user-a", "a");
    await seed("user-b", "b");
  });
});

/** Rows of `userId` in `table`, counted past RLS. Table names come from the
 *  literal lists above, never from input. */
const count = (table: string, userId: string, column = "user_id") =>
  asOwner(async () => {
    const result = await pglite.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM ${table} WHERE ${column} = $1`,
      [userId],
    );
    return result.rows[0]!.n;
  });

test("PERSONAL_RESET_TABLES is the five personal tables plus the seven Instinct agent tables, in the specified order", () => {
  expect([...PERSONAL_RESET_TABLES]).toEqual([...DELETED]);
});

test("the seed really puts a row of user A and of user B into every table under test", async () => {
  for (const table of [...DELETED, ...KEPT_BY_USER_ID]) {
    expect(await count(table, "user-a"), table).toBeGreaterThan(0);
    expect(await count(table, "user-b"), table).toBeGreaterThan(0);
  }
  for (const [table, column] of AUTH_KEPT) {
    expect(await count(table, "user-a", column), table).toBe(1);
  }
});

test("reset deletes user A's personal and Instinct tables, reports each, nothing else of A goes", async () => {
  const report = await erasePersonalData(db, "user-a");

  expect(report.map((entry) => entry.table)).toEqual([...DELETED]);
  for (const table of DELETED) expect(await count(table, "user-a"), table).toBe(0);
  for (const table of KEPT_BY_USER_ID)
    expect(await count(table, "user-a"), table).toBeGreaterThan(0);
  for (const [table, column] of AUTH_KEPT)
    expect(await count(table, "user-a", column), table).toBe(1);
  expect(
    await count("public.verification", "a@example.com", "identifier"),
    "public.verification",
  ).toBe(1);
});

test("reset leaves every row of user B untouched, including the table with no RLS", async () => {
  const before = new Map<string, number>();
  for (const table of [...DELETED, ...KEPT_BY_USER_ID])
    before.set(table, await count(table, "user-b"));

  await erasePersonalData(db, "user-a");

  for (const [table, rows] of before) expect(await count(table, "user-b"), table).toBe(rows);
  for (const [table, column] of AUTH_KEPT)
    expect(await count(table, "user-b", column), table).toBe(1);
  // eb_pending_auth has no RLS: only the WHERE user_id clause protects B here.
  expect(await count("personal.eb_pending_auth", "user-b")).toBe(1);
});

test("after a reset the Instinct agent is off: no settings row, so nothing is due and nothing is sent", async () => {
  await erasePersonalData(db, "user-a");
  expect(await count("personal.agent_settings", "user-a")).toBe(0);
  expect(await count("personal.agent_settings", "user-b")).toBe(1);
  await asOwner(async () => {
    const due = await pglite.query<{ tenant_id: string }>(
      "SELECT tenant_id FROM personal.list_agent_due_users(23, 23, '2026-11-18')",
    );
    expect(due.rows.map((r) => r.tenant_id)).toEqual(["user-b"]);
  });
});

test("after a reset the kept vault key is still there, so the browser vault stays openable", async () => {
  await erasePersonalData(db, "user-a");
  await asOwner(async () => {
    const result = await pglite.query<{ wrapped_key: Uint8Array }>(
      "SELECT wrapped_key FROM personal.vault_keys WHERE user_id = 'user-a'",
    );
    expect(result.rows).toHaveLength(1);
  });
});

test("reset is idempotent: a second run succeeds and deletes nothing more", async () => {
  await erasePersonalData(db, "user-a");
  const second = await erasePersonalData(db, "user-a");
  expect(second.map((entry) => entry.table)).toEqual([...DELETED]);
  expect(second.every((entry) => entry.rows === 0)).toBe(true);
});

test("a missing or blank user id is refused before any statement runs", async () => {
  await expect(erasePersonalData(db, undefined)).rejects.toThrow(/identity is required/);
  await expect(erasePersonalData(db, "  ")).rejects.toThrow(/identity is required/);
  expect(await count("personal.vaults", "user-a")).toBe(1);
});

test("the full erase still removes everything the reset keeps (the two are different)", async () => {
  await eraseUserData(db, "user-a");
  for (const table of [
    ...DELETED,
    "personal.vault_keys",
    "personal.ai_usage",
    "investing.broker_vaults",
  ])
    expect(await count(table, "user-a"), table).toBe(0);
  expect(await count('public."user"', "user-a", "id")).toBe(0);
  expect(await count("personal.vaults", "user-b")).toBe(1);
});

test("the exact statements: one transaction, tenant bound via set_config, twelve fixed DELETEs with the id as $1", async () => {
  const seen: { text: string; params: unknown[] | undefined }[] = [];
  const fake = databaseOver(async () => ({
    query: async (text: string, params?: unknown[]) => {
      seen.push({ text, params });
      return { rows: [], rowCount: 1 };
    },
    release: () => {},
  }));

  const report = await erasePersonalData(fake, "user-a");

  expect(seen).toEqual([
    { text: "BEGIN", params: undefined },
    { text: "SELECT set_config('app.user_id', $1, true)", params: ["user-a"] },
    ...DELETED.map((table) => ({
      text: `DELETE FROM ${table} WHERE user_id = $1`,
      params: ["user-a"],
    })),
    { text: "COMMIT", params: undefined },
  ]);
  expect(report).toEqual(DELETED.map((table) => ({ table, rows: 1 })));
});

test("a failure part-way rolls the whole reset back", async () => {
  const seen: string[] = [];
  const fake = databaseOver(async () => ({
    query: async (text: string) => {
      seen.push(text);
      if (text.includes("personal.n8n_forwarding")) throw new Error("boom");
      return { rows: [], rowCount: 0 };
    },
    release: () => {},
  }));

  await expect(erasePersonalData(fake, "user-a")).rejects.toThrow("boom");
  expect(seen.at(-1)).toBe("ROLLBACK");
  expect(seen).not.toContain("COMMIT");
});

test("after a reset, a device that still names the old server copy gets a conflict, not a silent restore", async () => {
  const repository = createOpaqueVaultRepository(db, "user-a");
  const old = (await repository.get())!.updatedAt;

  await erasePersonalData(db, "user-a");

  expect(await repository.put(Buffer.from("old-vault"), old)).toEqual({ status: "conflict" });
  expect(await repository.get()).toBeNull();
  // User B's copy was never in play.
  expect(await count("personal.vaults", "user-b")).toBe(1);
});

test("a first-ever backup (client expects nothing) still creates the row, and a matching base still replaces it", async () => {
  await erasePersonalData(db, "user-a");
  const repository = createOpaqueVaultRepository(db, "user-a");

  const first = await repository.put(Buffer.from("first"), null);
  expect(first.status).toBe("stored");
  const second = await repository.put(
    Buffer.from("second"),
    (first as { updatedAt: string }).updatedAt,
  );
  expect(second.status).toBe("stored");
  expect((await repository.get())!.blob.toString()).toBe("second");
  // Expecting nothing while a row exists is still a conflict.
  expect(await repository.put(Buffer.from("third"), null)).toEqual({ status: "conflict" });
  // And a stale base while a row exists is still a conflict.
  expect(await repository.put(Buffer.from("fourth"), "2020-01-01T00:00:00.000000Z")).toEqual({
    status: "conflict",
  });
});
