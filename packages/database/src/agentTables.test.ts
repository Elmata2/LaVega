import { readFileSync } from "node:fs";
import { afterAll, beforeAll, beforeEach, expect, test } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import {
  assertWhatsappConfig,
  consumeLinkCode,
  createAgentRepository,
  LINK_ATTEMPTS_PER_PHONE,
  linkCodeHash,
  listAgentDueUsers,
  phoneHash,
  purgeLinkAttempts,
  userForPhone,
  type Database,
} from "./index.js";
import { migratedTestDatabase } from "./testing.js";

/* Real migrations, real Postgres (via PGlite), acting as `lavega_runtime`, the
 * same harness as erasure.test.ts. RESET ROLE is the superuser, used only to
 * clear fixtures past FORCE RLS. */

const AGENT_TABLES = [
  "agent_settings",
  "agent_state",
  "agent_mirror",
  "agent_push_subscriptions",
  "agent_events",
  "agent_whatsapp",
  "agent_link_codes",
] as const;

let pglite: PGlite;
let db: Database;

beforeAll(async () => {
  process.env.LAVEGA_ENCRYPTION_KEY = "22".repeat(32);
  process.env.AGENT_PHONE_HMAC_KEY = "44".repeat(32);
  ({ pglite, db } = await migratedTestDatabase());
}, 60_000);

afterAll(async () => {
  await pglite.close();
});

beforeEach(async () => {
  await pglite.exec("RESET ROLE;");
  for (const table of AGENT_TABLES) await pglite.exec(`DELETE FROM personal.${table};`);
  await pglite.exec("DELETE FROM personal.agent_link_attempts;").catch(() => undefined);
  await pglite.exec("SELECT set_config('app.user_id', '', false); SET ROLE lavega_runtime;");
});

async function asUser<T>(
  userId: string,
  run: (q: (sql: string) => Promise<unknown[]>) => Promise<T>,
) {
  await pglite.exec(`SELECT set_config('app.user_id', '${userId}', false)`);
  try {
    return await run(async (sql) => (await pglite.query(sql)).rows as unknown[]);
  } finally {
    await pglite.exec("SELECT set_config('app.user_id', '', false)");
  }
}

test("user B cannot read or write user A's agent rows", async () => {
  await asUser("a", (q) =>
    q(
      "INSERT INTO personal.agent_settings (user_id, enabled, channels_blob) VALUES ('a', true, '\\x01')",
    ),
  );
  expect(await asUser("b", (q) => q("SELECT * FROM personal.agent_settings"))).toHaveLength(0);
  await expect(
    asUser("b", (q) =>
      q(
        "INSERT INTO personal.agent_settings (user_id, enabled, channels_blob) VALUES ('a', true, '\\x01')",
      ),
    ),
  ).rejects.toThrow(/row-level security/);
  expect(await asUser("a", (q) => q("SELECT * FROM personal.agent_settings"))).toHaveLength(1);
});

test("with no user context nothing is visible and nothing can be written", async () => {
  await asUser("a", (q) => q("INSERT INTO personal.agent_mirror (user_id) VALUES ('a')"));
  expect(await asUser("", (q) => q("SELECT * FROM personal.agent_mirror"))).toHaveLength(0);
  await expect(
    asUser("", (q) => q("INSERT INTO personal.agent_mirror (user_id) VALUES ('a')")),
  ).rejects.toThrow(/row-level security/);
});

test.each(AGENT_TABLES)("%s has forced RLS and a runtime grant", async (table) => {
  const forced = await pglite.query<{ relrowsecurity: boolean; relforcerowsecurity: boolean }>(
    `SELECT c.relrowsecurity, c.relforcerowsecurity FROM pg_class c
     JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'personal' AND c.relname = $1`,
    [table],
  );
  expect(forced.rows).toEqual([{ relrowsecurity: true, relforcerowsecurity: true }]);
  const grants = await pglite.query<{ privilege_type: string }>(
    `SELECT privilege_type FROM information_schema.table_privileges
     WHERE grantee = 'lavega_runtime' AND table_schema = 'personal' AND table_name = $1`,
    [table],
  );
  const writeOnce = table === "agent_events" || table === "agent_push_subscriptions";
  expect(grants.rows.map((row) => row.privilege_type).sort()).toEqual(
    writeOnce ? ["DELETE", "INSERT", "SELECT"] : ["DELETE", "INSERT", "SELECT", "UPDATE"],
  );
});

test("applying 0027 twice changes nothing and keeps the UPDATE revoke", async () => {
  await pglite.exec("RESET ROLE;");
  const sql = readFileSync(
    new URL("../../../db/migrations/0027_instinct_agent.sql", import.meta.url),
    "utf8",
  );
  await pglite.exec(sql);
  await pglite.exec("SET ROLE lavega_runtime;");
  const update = await pglite.query(
    `SELECT 1 FROM information_schema.table_privileges WHERE grantee = 'lavega_runtime'
     AND table_name = 'agent_events' AND privilege_type = 'UPDATE'`,
  );
  expect(update.rows).toHaveLength(0);
});

test("dedupe_key makes a second insert of the same event a conflict, per user", async () => {
  const insert = (id: string, key: string) =>
    `INSERT INTO personal.agent_events (user_id, id, channel, type, body_blob, dedupe_key)
     VALUES (current_setting('app.user_id'), '${id}', 'feed', 'message', '\\x01', '${key}')`;
  const one = "00000000-0000-4000-8000-000000000001";
  const two = "00000000-0000-4000-8000-000000000002";
  await asUser("a", (q) =>
    q(insert(one, "9f2c41d7a0b35e68c1d4f7a9b2e05c3d8a6f1e4b7c9d0a2e5f8b1c4d7a3e6f90")),
  );
  await expect(
    asUser("a", (q) =>
      q(insert(two, "9f2c41d7a0b35e68c1d4f7a9b2e05c3d8a6f1e4b7c9d0a2e5f8b1c4d7a3e6f90")),
    ),
  ).rejects.toThrow(/duplicate key|unique/);
  await asUser("b", (q) =>
    q(insert(two, "9f2c41d7a0b35e68c1d4f7a9b2e05c3d8a6f1e4b7c9d0a2e5f8b1c4d7a3e6f90")),
  );
  expect(await asUser("a", (q) => q("SELECT id FROM personal.agent_events"))).toHaveLength(1);
});

test("channel, type, send_hour and locale are constrained", async () => {
  const bad = (sql: string) => asUser("a", (q) => q(sql));
  await expect(
    bad(`INSERT INTO personal.agent_events (user_id, id, channel, type, body_blob)
         VALUES ('a', '00000000-0000-4000-8000-000000000003', 'sms', 'message', '\\x01')`),
  ).rejects.toThrow(/channel_known/);
  await expect(
    bad(`INSERT INTO personal.agent_events (user_id, id, channel, type, body_blob)
         VALUES ('a', '00000000-0000-4000-8000-000000000004', 'feed', 'chat', '\\x01')`),
  ).rejects.toThrow(/type_known/);
  await expect(
    bad("INSERT INTO personal.agent_settings (user_id, send_hour) VALUES ('a', 24)"),
  ).rejects.toThrow(/send_hour_range/);
  await expect(
    bad("INSERT INTO personal.agent_settings (user_id, locale) VALUES ('a', 'de')"),
  ).rejects.toThrow(/locale_known/);
});

async function seedAgent(userId: string, sendHour: number, enabled: boolean, lastSent?: string) {
  await pglite.exec(`RESET ROLE;
    INSERT INTO personal.agent_settings (user_id, enabled, send_hour)
      VALUES ('${userId}', ${enabled}, ${sendHour});
    ${
      lastSent
        ? `INSERT INTO personal.agent_state (user_id, last_sent_date) VALUES ('${userId}', '${lastSent}');`
        : ""
    }
    SET ROLE lavega_runtime;`);
}

const due = async (hour: number, retry: number, date: string) =>
  (await listAgentDueUsers(db, hour, retry, date)).map((u) => u.userId);

test("list_agent_due_users lists an opted-in user at 08:00 and at 10:00, not at 11:00 or 07:00", async () => {
  await seedAgent("a", 8, true);
  expect(await due(8, 2, "2026-11-10")).toEqual(["a"]);
  expect(await due(10, 2, "2026-11-10")).toEqual(["a"]);
  expect(await due(11, 2, "2026-11-10")).toEqual([]);
  expect(await due(7, 2, "2026-11-10")).toEqual([]);
});

test("list_agent_due_users skips a user who already has today's claim, but not yesterday's", async () => {
  await seedAgent("a", 8, true, "2026-11-10");
  await seedAgent("b", 8, true, "2026-11-09");
  expect(await due(8, 2, "2026-11-10")).toEqual(["b"]);
});

test("list_agent_due_users never lists a disabled user, and keeps the policy on the table", async () => {
  await seedAgent("a", 8, false);
  await seedAgent("b", 8, true);
  expect(await due(8, 2, "2026-11-10")).toEqual(["b"]);
  const direct = await pglite.query("SELECT user_id FROM personal.agent_settings");
  expect(direct.rows).toEqual([]);
});

test("list_agent_due_users is SECURITY DEFINER with a pinned search_path and no PUBLIC execute", async () => {
  const fn = await pglite.query<{
    prosecdef: boolean;
    proconfig: string[] | null;
    acl: string[] | null;
  }>(
    `SELECT p.prosecdef, p.proconfig, p.proacl::text[] AS acl FROM pg_proc p
     JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'personal' AND p.proname = 'list_agent_due_users'`,
  );
  expect(fn.rows).toHaveLength(1);
  expect(fn.rows[0]!.prosecdef).toBe(true);
  expect(fn.rows[0]!.proconfig?.some((c) => c.startsWith("search_path="))).toBe(true);
  // An ACL entry with an empty grantee ("=X/owner") would be PUBLIC.
  expect((fn.rows[0]!.acl ?? []).some((entry) => entry.startsWith("="))).toBe(false);
  const runtime = await pglite.query<{ ok: boolean }>(
    "SELECT has_function_privilege('lavega_runtime', 'personal.list_agent_due_users(int,int,date)', 'EXECUTE') AS ok",
  );
  expect(runtime.rows[0]!.ok).toBe(true);
});

/* WhatsApp links (0029). `RESET ROLE` is the superuser, used for what a test must
 * see past FORCE RLS or to age a code. */
const PHONE_A = "+31612345678";
const PHONE_B = "+31687654321";
const repo = (user: string) => createAgentRepository(db, user);
const SETTINGS = {
  enabled: true,
  channels: ["feed", "whatsapp"],
  sendHour: 8,
  locale: "nl",
  email: null,
  consentVersion: "v",
  consentedAt: "2026-11-10T08:00:00.000Z",
} as const;
/** A code is only written for a user whose agent is on (W1). */
async function makeCode(user: string): Promise<{ code: string; expiresAt: string }> {
  await repo(user).putSettings({ ...SETTINGS, channels: [...SETTINGS.channels] });
  const made = await repo(user).createLinkCode();
  if (made === "skipped") throw new Error("test setup: agent is off");
  return made;
}

async function asSuperuser<T>(sql: string): Promise<T[]> {
  await pglite.exec("RESET ROLE;");
  try {
    return (await pglite.query<T & object>(sql)).rows as T[];
  } finally {
    await pglite.exec("SET ROLE lavega_runtime;");
  }
}

async function link(user: string, phone: string) {
  const { code } = await makeCode(user);
  return consumeLinkCode(db, linkCodeHash(code), phoneHash(phone), Buffer.from("sealed"));
}

test("a link code has the LV- format, lasts 15 minutes and is stored only as a hash", async () => {
  const { code, expiresAt } = await makeCode("a");
  expect(code).toMatch(/^LV-[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{8}$/);
  const minutes = (Date.parse(expiresAt) - Date.now()) / 60_000;
  expect(minutes).toBeGreaterThan(14);
  expect(minutes).toBeLessThanOrEqual(15);
  const stored = await asSuperuser<{ code_hash: string }>(
    "SELECT code_hash FROM personal.agent_link_codes",
  );
  expect(stored).toEqual([{ code_hash: linkCodeHash(code) }]);
  expect(stored[0]!.code_hash).not.toContain(code.slice(3));
});

test("a link code works exactly once", async () => {
  const { code } = await makeCode("a");
  const args = [linkCodeHash(code), phoneHash(PHONE_A), Buffer.from("sealed")] as const;
  expect(await consumeLinkCode(db, ...args)).toEqual({ ok: true, userId: "a" });
  expect(await consumeLinkCode(db, ...args)).toEqual({ ok: false, reason: "invalid" });
  expect(await asSuperuser("SELECT 1 FROM personal.agent_link_codes")).toHaveLength(0);
});

test("a wrong code hash links nothing and leaves the real code usable", async () => {
  const { code } = await makeCode("a");
  expect(
    await consumeLinkCode(db, linkCodeHash("LV-AAAAAAAA"), phoneHash(PHONE_A), Buffer.from("x")),
  ).toEqual({ ok: false, reason: "invalid" });
  expect(await asSuperuser("SELECT 1 FROM personal.agent_whatsapp")).toHaveLength(0);
  expect(
    await consumeLinkCode(db, linkCodeHash(code), phoneHash(PHONE_A), Buffer.from("x")),
  ).toEqual({ ok: true, userId: "a" });
});

test("a code older than 15 minutes is refused", async () => {
  const { code } = await makeCode("a");
  await asSuperuser(
    "UPDATE personal.agent_link_codes SET expires_at = CURRENT_TIMESTAMP - INTERVAL '1 second'",
  );
  expect(
    await consumeLinkCode(db, linkCodeHash(code), phoneHash(PHONE_A), Buffer.from("x")),
  ).toEqual({ ok: false, reason: "invalid" });
  expect(await asSuperuser("SELECT 1 FROM personal.agent_whatsapp")).toHaveLength(0);
});

test("a new code replaces the user's earlier one", async () => {
  const first = await makeCode("a");
  const second = await makeCode("a");
  expect(await asSuperuser("SELECT 1 FROM personal.agent_link_codes")).toHaveLength(1);
  expect(
    (await consumeLinkCode(db, linkCodeHash(first.code), phoneHash(PHONE_A), Buffer.from("x"))).ok,
  ).toBe(false);
  expect(
    (await consumeLinkCode(db, linkCodeHash(second.code), phoneHash(PHONE_A), Buffer.from("x"))).ok,
  ).toBe(true);
});

test("two users cannot link the same phone: phone-taken, and the second code survives", async () => {
  expect(await link("a", PHONE_A)).toEqual({ ok: true, userId: "a" });
  const { code } = await makeCode("b");
  expect(
    await consumeLinkCode(db, linkCodeHash(code), phoneHash(PHONE_A), Buffer.from("x")),
  ).toEqual({ ok: false, reason: "phone-taken" });
  expect(await userForPhone(db, phoneHash(PHONE_A))).toBe("a");
  // The statement rolled back as a whole, so b still has the code for another phone.
  expect(
    await consumeLinkCode(db, linkCodeHash(code), phoneHash(PHONE_B), Buffer.from("x")),
  ).toEqual({ ok: true, userId: "b" });
});

test("userForPhone returns the owner, never another user, and null for an unknown phone", async () => {
  await link("a", PHONE_A);
  await link("b", PHONE_B);
  expect(await userForPhone(db, phoneHash(PHONE_A))).toBe("a");
  expect(await userForPhone(db, phoneHash(PHONE_B))).toBe("b");
  expect(await userForPhone(db, phoneHash("+31600000000"))).toBeNull();
});

test("getLink round-trips the phone, hides it in the clear, and unlink removes it", async () => {
  expect(await repo("a").getLink()).toBeNull();
  const { code } = await makeCode("a");
  const sealed = (await import("./index.js")).encryptBlob(PHONE_A);
  await consumeLinkCode(db, linkCodeHash(code), phoneHash(PHONE_A), sealed);
  const link1 = await repo("a").getLink();
  expect(link1).toMatchObject({ phone: PHONE_A, lastInboundAt: null });
  expect(link1!.linkedAt).toMatch(/^\d{4}-\d\d-\d\dT/);
  const [row] = await asSuperuser<{ phone_blob: Uint8Array; phone_hash: string }>(
    "SELECT phone_blob, phone_hash FROM personal.agent_whatsapp",
  );
  expect(Buffer.from(row!.phone_blob).includes(Buffer.from(PHONE_A))).toBe(false);
  expect(row!.phone_hash).not.toContain("31612345678");
  expect(await repo("b").getLink()).toBeNull();

  await repo("a").touchInbound("2026-11-11T09:30:00.000Z");
  expect((await repo("a").getLink())!.lastInboundAt).toBe("2026-11-11T09:30:00.000Z");

  await repo("a").unlink();
  expect(await repo("a").getLink()).toBeNull();
  expect(await userForPhone(db, phoneHash(PHONE_A))).toBeNull();
});

test("user B cannot read, write or delete user A's link rows", async () => {
  await link("a", PHONE_A);
  await makeCode("a");
  for (const table of ["agent_whatsapp", "agent_link_codes"]) {
    expect(await asUser("b", (q) => q(`SELECT * FROM personal.${table}`))).toHaveLength(0);
    expect(await asUser("a", (q) => q(`SELECT * FROM personal.${table}`))).toHaveLength(1);
    expect(await asUser("", (q) => q(`SELECT * FROM personal.${table}`))).toHaveLength(0);
  }
  await expect(
    asUser("b", (q) =>
      q("INSERT INTO personal.agent_whatsapp (user_id, phone_hash) VALUES ('a', 'h')"),
    ),
  ).rejects.toThrow(/row-level security/);
  await asUser("b", (q) => q("DELETE FROM personal.agent_whatsapp"));
  expect(await asUser("a", (q) => q("SELECT * FROM personal.agent_whatsapp"))).toHaveLength(1);
});

test("the WhatsApp functions are SECURITY DEFINER, pinned, with no PUBLIC execute", async () => {
  const fns = await pglite.query<{
    proname: string;
    prosecdef: boolean;
    proconfig: string[] | null;
    acl: string[] | null;
    runtime: boolean;
  }>(
    `SELECT p.proname, p.prosecdef, p.proconfig, p.proacl::text[] AS acl,
            has_function_privilege('lavega_runtime', p.oid, 'EXECUTE') AS runtime
     FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'personal'
       AND p.proname IN ('agent_user_for_phone', 'agent_consume_link_code', 'agent_purge_link_attempts')
     ORDER BY p.proname`,
  );
  expect(fns.rows.map((r) => r.proname)).toEqual([
    "agent_consume_link_code",
    "agent_purge_link_attempts",
    "agent_user_for_phone",
  ]);
  for (const fn of fns.rows) {
    expect(fn.prosecdef).toBe(true);
    expect(fn.proconfig?.some((c) => c.startsWith("search_path="))).toBe(true);
    expect((fn.acl ?? []).some((entry) => entry.startsWith("="))).toBe(false);
    expect(fn.runtime).toBe(true);
  }
});

test("phoneHash and linkCodeHash fail closed without a valid AGENT_PHONE_HMAC_KEY and never echo it", () => {
  const saved = process.env.AGENT_PHONE_HMAC_KEY;
  try {
    expect(phoneHash(PHONE_A)).toMatch(/^[0-9a-f]{64}$/);
    expect(phoneHash(PHONE_A)).not.toBe(phoneHash(PHONE_B));
    expect(linkCodeHash("LV-ABCD2345")).not.toBe(phoneHash("LV-ABCD2345"));
    for (const bad of [undefined, "", "ab".repeat(16), "zz".repeat(32)]) {
      if (bad === undefined) delete process.env.AGENT_PHONE_HMAC_KEY;
      else process.env.AGENT_PHONE_HMAC_KEY = bad;
      expect(() => phoneHash(PHONE_A)).toThrow(/AGENT_PHONE_HMAC_KEY/);
      expect(() => linkCodeHash("LV-ABCD2345")).toThrow(/AGENT_PHONE_HMAC_KEY/);
      expect(() => assertWhatsappConfig()).toThrow(/AGENT_PHONE_HMAC_KEY/);
      try {
        phoneHash(PHONE_A);
      } catch (error) {
        if (bad) expect((error as Error).message).not.toContain(bad);
      }
    }
  } finally {
    process.env.AGENT_PHONE_HMAC_KEY = saved;
  }
});

/* Durable brute-force throttle on link codes (0029): the attempts table lives in
 * Postgres, so a cold start or a second instance cannot reset it. */
const attempts = () =>
  asSuperuser<{ phone_hash: string }>("SELECT phone_hash FROM personal.agent_link_attempts");
const backdate = (minutes: number) =>
  asSuperuser(
    `UPDATE personal.agent_link_attempts SET at = CURRENT_TIMESTAMP - INTERVAL '${minutes} minutes'`,
  );
const tryCode = (code: string, phone: string) =>
  consumeLinkCode(db, linkCodeHash(code), phoneHash(phone), Buffer.from("x"));

test("the throttle is 5 per phone and there is no global cap", async () => {
  expect(LINK_ATTEMPTS_PER_PHONE).toBe(5);
  expect(await import("./index.js")).not.toHaveProperty("LINK_ATTEMPTS_GLOBAL");
});

test("5 wrong codes block the RIGHT code from that number until the window passes", async () => {
  const { code } = await makeCode("a");
  for (let i = 0; i < LINK_ATTEMPTS_PER_PHONE; i++)
    expect(await tryCode("LV-AAAAAAAA", PHONE_A)).toEqual({ ok: false, reason: "invalid" });
  expect(await attempts()).toHaveLength(5);
  // Throttled looks exactly like invalid, and records nothing more.
  expect(await tryCode(code, PHONE_A)).toEqual({ ok: false, reason: "invalid" });
  expect(await attempts()).toHaveLength(5);
  await backdate(16);
  expect(await tryCode(code, PHONE_A)).toEqual({ ok: true, userId: "a" });
});

test("attempts older than 15 minutes are purged and a success records none", async () => {
  await tryCode("LV-AAAAAAAA", PHONE_A);
  await backdate(16);
  const { code } = await makeCode("a");
  expect(await tryCode(code, PHONE_B)).toEqual({ ok: true, userId: "a" });
  expect(await attempts()).toHaveLength(0);
});

test("1000 failures from other numbers do not block a fresh number's right code (W4)", async () => {
  await asSuperuser(
    `INSERT INTO personal.agent_link_attempts (phone_hash)
     SELECT 'h' || g FROM generate_series(1, 1000) g`,
  );
  const { code } = await makeCode("a");
  expect(await tryCode(code, PHONE_B)).toEqual({ ok: true, userId: "a" });
  expect(await userForPhone(db, phoneHash(PHONE_B))).toBe("a");
});

test("the runtime role has no direct access to the attempts table, and it holds no user id", async () => {
  await expect(pglite.query("SELECT * FROM personal.agent_link_attempts")).rejects.toThrow(
    /permission denied/,
  );
  await expect(
    pglite.query("INSERT INTO personal.agent_link_attempts (phone_hash) VALUES ('x')"),
  ).rejects.toThrow(/permission denied/);
  const cols = await asSuperuser<{ column_name: string }>(
    `SELECT column_name FROM information_schema.columns
     WHERE table_schema = 'personal' AND table_name = 'agent_link_attempts'`,
  );
  expect(cols.map((c) => c.column_name).sort()).toEqual(["at", "phone_hash"]);
});

test("unlink also deletes a pending link code, so it cannot re-link (F5)", async () => {
  await link("a", PHONE_A);
  const { code } = await makeCode("a");
  expect(await asSuperuser("SELECT 1 FROM personal.agent_link_codes")).toHaveLength(1);
  await repo("a").unlink();
  expect(await asSuperuser("SELECT 1 FROM personal.agent_link_codes")).toHaveLength(0);
  expect(await tryCode(code, PHONE_B)).toEqual({ ok: false, reason: "invalid" });
  expect(await repo("a").getLink()).toBeNull();
});

test("createLinkCode removes the user's expired code and stores the AI consent time (F5)", async () => {
  await makeCode("a");
  await asSuperuser(
    "UPDATE personal.agent_link_codes SET expires_at = CURRENT_TIMESTAMP - INTERVAL '1 minute'",
  );
  const fresh = await makeCode("a");
  const rows = await asSuperuser<{ code_hash: string; ai_consent_at: Date | null }>(
    "SELECT code_hash, ai_consent_at FROM personal.agent_link_codes",
  );
  expect(rows).toHaveLength(1);
  expect(rows[0]!.code_hash).toBe(linkCodeHash(fresh.code));
  expect(rows[0]!.ai_consent_at).not.toBeNull();
});

test("the AI consent time travels from the code to the link", async () => {
  const { code } = await makeCode("a");
  const sealed = (await import("./index.js")).encryptBlob(PHONE_A);
  await consumeLinkCode(db, linkCodeHash(code), phoneHash(PHONE_A), sealed);
  expect((await repo("a").getLink())!.aiConsentAt).toMatch(/^\d{4}-\d\d-\d\dT/);
});

test("agent_purge_link_attempts deletes only rows older than 15 minutes and returns the count (F6)", async () => {
  await tryCode("LV-AAAAAAAA", PHONE_A);
  await tryCode("LV-AAAAAAAA", PHONE_B);
  await asSuperuser(
    `UPDATE personal.agent_link_attempts SET at = CURRENT_TIMESTAMP - INTERVAL '20 minutes'
     WHERE phone_hash = '${phoneHash(PHONE_A)}'`,
  );
  expect(await attempts()).toHaveLength(2);
  expect(await purgeLinkAttempts(db)).toBe(1);
  expect(await attempts()).toEqual([{ phone_hash: phoneHash(PHONE_B) }]);
  expect(await purgeLinkAttempts(db)).toBe(0);
});

test("a link code is 8 characters from the 31 character alphabet (W4)", async () => {
  const seen = new Set<string>();
  for (let i = 0; i < 20; i++) {
    const { code } = await makeCode("a");
    expect(code).toMatch(/^LV-[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{8}$/);
    seen.add(code);
  }
  expect(seen.size).toBe(20);
});

test("a code made before the agent was turned off no longer links, and records no attempt (W1)", async () => {
  const { code } = await makeCode("a");
  await repo("a").putSettings({ ...SETTINGS, channels: ["feed"], enabled: false });
  expect(await tryCode(code, PHONE_A)).toEqual({ ok: false, reason: "invalid" });
  expect(await asSuperuser("SELECT 1 FROM personal.agent_whatsapp")).toHaveLength(0);
  expect(await attempts()).toHaveLength(0);
  // The dead code is gone, so switching back on does not revive it.
  expect(await asSuperuser("SELECT 1 FROM personal.agent_link_codes")).toHaveLength(0);
  await repo("a").putSettings({ ...SETTINGS, channels: ["feed"] });
  expect(await tryCode(code, PHONE_A)).toEqual({ ok: false, reason: "invalid" });
});

test("a code whose user has no settings row at all does not link (W1)", async () => {
  const { code } = await makeCode("a");
  await asSuperuser("DELETE FROM personal.agent_settings");
  expect(await tryCode(code, PHONE_A)).toEqual({ ok: false, reason: "invalid" });
  expect(await asSuperuser("SELECT 1 FROM personal.agent_whatsapp")).toHaveLength(0);
  expect(await attempts()).toHaveLength(0);
});

const migration0029 = () =>
  readFileSync(new URL("../../../db/migrations/0029_whatsapp_links.sql", import.meta.url), "utf8");

test("0029 over an early-draft shape adds ai_consent_at to both tables and the functions work (W3)", async () => {
  await pglite.exec("RESET ROLE;");
  await pglite.exec(`
    DELETE FROM personal.agent_link_codes;
    ALTER TABLE personal.agent_whatsapp DROP COLUMN ai_consent_at;
    ALTER TABLE personal.agent_link_codes DROP COLUMN ai_consent_at;
    INSERT INTO personal.agent_link_codes (user_id, code_hash, expires_at)
      VALUES ('old', 'oldhash', CURRENT_TIMESTAMP + INTERVAL '10 minutes');
  `);
  const columns = async () =>
    (
      await pglite.query<{ table_name: string; is_nullable: string }>(
        `SELECT table_name, is_nullable FROM information_schema.columns
         WHERE table_schema = 'personal' AND column_name = 'ai_consent_at'
           AND table_name IN ('agent_whatsapp', 'agent_link_codes') ORDER BY table_name`,
      )
    ).rows;
  expect(await columns()).toEqual([]);

  await pglite.exec(migration0029());
  expect(await columns()).toEqual([
    { table_name: "agent_link_codes", is_nullable: "NO" },
    { table_name: "agent_whatsapp", is_nullable: "YES" },
  ]);
  // The early-draft code (no consent time) is gone.
  expect((await pglite.query("SELECT 1 FROM personal.agent_link_codes")).rows).toHaveLength(0);

  // A live code made now survives a second apply, and the functions still work.
  await pglite.exec("SET ROLE lavega_runtime;");
  const { code } = await makeCode("a");
  await pglite.exec("RESET ROLE;");
  await pglite.exec(migration0029());
  expect((await pglite.query("SELECT 1 FROM personal.agent_link_codes")).rows).toHaveLength(1);
  await pglite.exec("SET ROLE lavega_runtime;");
  const sealed = (await import("./index.js")).encryptBlob(PHONE_A);
  expect(await consumeLinkCode(db, linkCodeHash(code), phoneHash(PHONE_A), sealed)).toEqual({
    ok: true,
    userId: "a",
  });
  expect((await repo("a").getLink())!.aiConsentAt).toMatch(/^\d{4}-\d\d-\d\dT/);
});

/* W5(a): the retry window wraps midnight, and the message belongs to the date on which
 * the send hour fell. The caller passes the Amsterdam hour and date of "now". */
test("a user with send hour 23 is due at 23:00, 00:00 and 01:00, and not at 02:00 (W5)", async () => {
  await seedAgent("a", 23, true);
  expect(await listAgentDueUsers(db, 23, 2, "2026-11-10")).toEqual([
    { userId: "a", day: "2026-11-10" },
  ]);
  // After midnight the message day is the previous local date.
  expect(await listAgentDueUsers(db, 0, 2, "2026-11-11")).toEqual([
    { userId: "a", day: "2026-11-10" },
  ]);
  expect(await listAgentDueUsers(db, 1, 2, "2026-11-11")).toEqual([
    { userId: "a", day: "2026-11-10" },
  ]);
  expect(await due(2, 2, "2026-11-11")).toEqual([]);
  expect(await due(22, 2, "2026-11-10")).toEqual([]);
});

test("send hour 22 is due at 22, 23 and 00 (message day moves back only after midnight) (W5)", async () => {
  await seedAgent("a", 22, true);
  expect(await listAgentDueUsers(db, 23, 2, "2026-11-10")).toEqual([
    { userId: "a", day: "2026-11-10" },
  ]);
  expect(await listAgentDueUsers(db, 0, 2, "2026-11-11")).toEqual([
    { userId: "a", day: "2026-11-10" },
  ]);
  expect(await due(1, 2, "2026-11-11")).toEqual([]);
});

test("a wrapped retry lists nobody once the previous date is claimed, but the new evening is due again (W5)", async () => {
  await seedAgent("a", 23, true, "2026-11-10");
  expect(await due(0, 2, "2026-11-11")).toEqual([]);
  expect(await listAgentDueUsers(db, 23, 2, "2026-11-11")).toEqual([
    { userId: "a", day: "2026-11-11" },
  ]);
});

test("send hour 8 keeps its day and window (W5)", async () => {
  await seedAgent("a", 8, true);
  for (const h of [8, 9, 10])
    expect(await listAgentDueUsers(db, h, 2, "2026-11-10")).toEqual([
      { userId: "a", day: "2026-11-10" },
    ]);
  for (const h of [7, 11, 0, 23]) expect(await due(h, 2, "2026-11-10")).toEqual([]);
});

test("a user is not due when the claim is on or after the message day, so the claim cannot go backwards (A2)", async () => {
  // Send hour changed from 0 to 23 after D+1 was claimed at 00:00.
  await seedAgent("a", 23, true, "2026-11-12");
  expect(await due(1, 2, "2026-11-12")).toEqual([]);
  expect(await due(23, 2, "2026-11-12")).toEqual([]);
  expect(await due(0, 2, "2026-11-13")).toEqual([]);
  expect(await listAgentDueUsers(db, 23, 2, "2026-11-13")).toEqual([
    { userId: "a", day: "2026-11-13" },
  ]);
});
