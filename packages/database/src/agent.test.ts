import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, beforeEach, expect, test } from "vitest";
import {
  assertAgentConfig,
  createAgentRepository,
  UnreadableAgentDataError,
  type AgentSettings,
  type Database,
} from "./index.js";
import { migratedTestDatabase } from "./testing.js";

/* Real migrations on PGlite as `lavega_runtime`, so forced RLS and the missing
 * UPDATE grants on events and push subscriptions apply as in production. */

const TABLES = [
  "agent_events",
  "agent_push_subscriptions",
  "agent_mirror",
  "agent_state",
  "agent_settings",
] as const;

let pglite: PGlite;
let db: Database;

beforeAll(async () => {
  process.env.LAVEGA_ENCRYPTION_KEY = "22".repeat(32);
  process.env.AGENT_DEDUPE_HMAC_KEY = "33".repeat(32);
  ({ pglite, db } = await migratedTestDatabase());
}, 60_000);

afterAll(async () => {
  await pglite.close();
});

beforeEach(async () => {
  await pglite.exec("RESET ROLE;");
  for (const table of TABLES) await pglite.exec(`DELETE FROM personal.${table};`);
  await pglite.exec("SELECT set_config('app.user_id', '', false); SET ROLE lavega_runtime;");
  // State and events are written only while the agent is on (the turn-off race guard).
  for (const user of ["a", "b"]) await createAgentRepository(db, user).putSettings(settings);
});

/** Superuser read past FORCE RLS, for what is actually stored. */
async function raw<T>(sql: string): Promise<T[]> {
  await pglite.exec("RESET ROLE;");
  try {
    return (await pglite.query<T & object>(sql)).rows as T[];
  } finally {
    await pglite.exec("SET ROLE lavega_runtime;");
  }
}

const EMAIL = "someone.private@example.com";
const settings: AgentSettings = {
  enabled: true,
  channels: ["feed", "email"],
  sendHour: 7,
  locale: "nl",
  email: EMAIL,
  consentVersion: "2026-11-10",
  consentedAt: "2026-11-10T08:00:00.000Z",
};
const repo = (user = "a") => createAgentRepository(db, user);

test("settings round-trip and the email is not stored in the clear", async () => {
  await repo().putSettings(settings);
  expect(await repo().getSettings()).toEqual(settings);

  const [row] = await raw<{ email_blob: Uint8Array; channels_blob: Uint8Array }>(
    "SELECT email_blob, channels_blob FROM personal.agent_settings WHERE user_id = 'a'",
  );
  expect(Buffer.from(row!.email_blob).includes(Buffer.from(EMAIL))).toBe(false);
  expect(Buffer.from(row!.channels_blob).includes(Buffer.from("feed"))).toBe(false);

  await repo().putSettings({ ...settings, enabled: false, email: null, sendHour: 9 });
  expect(await repo().getSettings()).toMatchObject({ enabled: false, email: null, sendHour: 9 });
  expect(await repo("nobody").getSettings()).toBeNull();
  await repo().putSettings({ ...settings, consentedAt: null });
  expect((await repo().getSettings())?.consentedAt).toBeNull();
});

test("state defaults, patches and keeps what the patch leaves out", async () => {
  expect(await repo().getState()).toEqual({
    lastSentDate: null,
    sentKeys: [],
    lastTipDate: null,
    expiryRemindedFor: null,
    expiryPausedNoted: false,
  });
  await repo().putState({
    sentKeys: [{ key: "k1", date: "2026-11-10" }],
    lastTipDate: "2026-11-09",
  });
  await repo().putState({ expiryRemindedFor: "2026-12-01", expiryPausedNoted: true });
  expect(await repo().getState()).toEqual({
    lastSentDate: null,
    sentKeys: [{ key: "k1", date: "2026-11-10" }],
    lastTipDate: "2026-11-09",
    expiryRemindedFor: "2026-12-01",
    expiryPausedNoted: true,
  });
  const [row] = await raw<{ sent_keys_blob: Uint8Array }>(
    "SELECT sent_keys_blob FROM personal.agent_state WHERE user_id = 'a'",
  );
  expect(Buffer.from(row!.sent_keys_blob).includes(Buffer.from("k1"))).toBe(false);
});

test("two parallel claims of a day give exactly one true, and release reopens it", async () => {
  const results = await Promise.all([repo().claimDay("2026-11-11"), repo().claimDay("2026-11-11")]);
  expect(results.filter(Boolean)).toHaveLength(1);
  expect((await repo().getState()).lastSentDate).toBe("2026-11-11");

  await repo().releaseDay("2026-11-11");
  expect(await repo().claimDay("2026-11-11")).toBe(true);
  // Releasing another day's claim must not undo today's.
  await repo().releaseDay("2026-11-10");
  expect(await repo().claimDay("2026-11-11")).toBe(false);
});

test("the fetch budget allows max takes a day and resets on the next", async () => {
  const takes = [];
  for (let i = 0; i < 4; i++) takes.push(await repo().takeFetchBudget("2026-11-11", 3));
  expect(takes).toEqual([true, true, true, false]);
  expect(await repo().takeFetchBudget("2026-11-12", 3)).toBe(true);
  expect(await repo().takeFetchBudget("2026-11-12", 0)).toBe(false);
  // Another user's budget is separate.
  expect(await repo("b").takeFetchBudget("2026-11-12", 1)).toBe(true);
});

test("mirror round-trips encrypted", async () => {
  expect(await repo().getMirror()).toBeNull();
  const mirror = {
    rules: [{ id: "r1", match: "ALBERT HEIJN", category: "boodschappen" }],
    dueDates: [{ kind: "vat" as const, label: "BTW Q4", date: "2027-01-31" }],
    cardOffer: { name: "Card X", yearlyGainCents: 6000, computedAt: "2026-11-10T00:00:00.000Z" },
  };
  await repo().putMirror(mirror);
  expect(await repo().getMirror()).toEqual(mirror);
  const [row] = await raw<{ payload_blob: Uint8Array }>(
    "SELECT payload_blob FROM personal.agent_mirror WHERE user_id = 'a'",
  );
  expect(Buffer.from(row!.payload_blob).includes(Buffer.from("ALBERT"))).toBe(false);
});

test("push subscriptions are stored sealed, keyed by endpoint hash, and deletable", async () => {
  const sub = { endpoint: "https://push.example/abc", keys: { p256dh: "k", auth: "s" } };
  await repo().putPush(sub);
  await repo().putPush(sub);
  expect(await repo().listPush()).toEqual([sub]);
  const [row] = await raw<{ endpoint_hash: string; subscription_blob: Uint8Array }>(
    "SELECT endpoint_hash, subscription_blob FROM personal.agent_push_subscriptions",
  );
  expect(row!.endpoint_hash).toMatch(/^[0-9a-f]{64}$/);
  expect(Buffer.from(row!.subscription_blob).includes(Buffer.from("push.example"))).toBe(false);
  expect(await repo("b").listPush()).toEqual([]);
  await repo("b").deletePush(sub.endpoint);
  expect(await repo().listPush()).toHaveLength(1);
  await repo().deletePush(sub.endpoint);
  expect(await repo().listPush()).toEqual([]);
});

test("deleteAll empties all five tables for the user and leaves user B alone", async () => {
  for (const user of ["a", "b"]) {
    const r = repo(user);
    await r.putSettings(settings);
    await r.putState({ lastTipDate: "2026-11-09" });
    await r.putMirror({ rules: [], dueDates: [], cardOffer: null });
    await r.putPush({ endpoint: `https://push.example/${user}` });
    await r.appendEvent({
      id: crypto.randomUUID(),
      channel: "feed",
      type: "message",
      body: { text: "hoi" },
    });
  }
  await repo("a").deleteAll();
  for (const table of TABLES) {
    const rows = await raw<{ user_id: string }>(`SELECT user_id FROM personal.${table}`);
    expect(
      rows.map((r) => r.user_id),
      table,
    ).toEqual(["b"]);
  }
});

/* ---- events ---- */

const event = (
  text = "hoi",
  over: Partial<Parameters<ReturnType<typeof repo>["appendEvent"]>[0]> = {},
) => ({
  id: crypto.randomUUID(),
  channel: "feed" as const,
  type: "message" as const,
  body: { text },
  ...over,
});

test("a repeated dedupe key stores one row, and the stored key is an HMAC not the key", async () => {
  const key = "renewal|Netflix|1399|2026-11-14";
  expect(await repo().appendEvent(event("een", { dedupeKey: key }))).toBe("stored");
  expect(await repo().appendEvent(event("twee", { dedupeKey: key }))).toBe("duplicate");
  expect(await repo("b").appendEvent(event("drie", { dedupeKey: key }))).toBe("stored");
  expect(await repo().listEvents({ limit: 10 })).toHaveLength(1);

  const rows = await raw<{ dedupe_key: string }>(
    "SELECT dedupe_key FROM personal.agent_events WHERE user_id = 'a'",
  );
  expect(rows[0]!.dedupe_key).toMatch(/^[0-9a-f]{64}$/);
  expect(rows[0]!.dedupe_key).not.toContain("Netflix");
  // Events without a key never collide.
  expect(await repo().appendEvent(event("x"))).toBe("stored");
  expect(await repo().appendEvent(event("y"))).toBe("stored");
});

test("event bodies are sealed and list newest first with channel filter and cursor", async () => {
  const a = event("oud");
  const b = event("nieuw", { channel: "email" });
  await repo().appendEvent(a);
  await pglite.exec(
    "RESET ROLE; UPDATE personal.agent_events SET created_at = created_at - interval '1 hour'; SET ROLE lavega_runtime;",
  );
  await repo().appendEvent(b);

  const all = await repo().listEvents({ limit: 10 });
  expect(all.map((e) => e.body.text)).toEqual(["nieuw", "oud"]);
  expect(all[0]).toMatchObject({ id: b.id, channel: "email", type: "message" });
  expect(await repo().listEvents({ channel: "feed", limit: 10 })).toHaveLength(1);
  expect(await repo().listEvents({ limit: 1 })).toHaveLength(1);
  expect(
    await repo().listEvents({
      limit: 10,
      before: { createdAt: all[0]!.createdAt, id: all[0]!.id },
    }),
  ).toHaveLength(1);
  const [row] = await raw<{ body_blob: Uint8Array }>(
    "SELECT body_blob FROM personal.agent_events LIMIT 1",
  );
  expect(Buffer.from(row!.body_blob).includes(Buffer.from("oud"))).toBe(false);
});

test("deleteEvent cannot remove another user's event", async () => {
  const e = event();
  await repo("a").appendEvent(e);
  expect(await repo("b").deleteEvent(e.id)).toBe(false);
  expect(await repo("a").listEvents({ limit: 5 })).toHaveLength(1);
  expect(await repo("a").deleteEvent(e.id)).toBe(true);
  expect(await repo("a").deleteEvent(e.id)).toBe(false);
});

test("deleteConversation removes one channel's events for this user only", async () => {
  await repo("a").appendEvent(event("f1"));
  await repo("a").appendEvent(event("f2"));
  await repo("a").appendEvent(event("m1", { channel: "email" }));
  await repo("b").appendEvent(event("fb"));
  expect(await repo("a").deleteConversation("feed")).toBe(2);
  expect((await repo("a").listEvents({ limit: 10 })).map((e) => e.body.text)).toEqual(["m1"]);
  expect(await repo("b").listEvents({ limit: 10 })).toHaveLength(1);
});

test("purgeOlderThan(90) removes a 91-day-old event, keeps an 89-day-old one, and is per user", async () => {
  const old = event("old");
  const recent = event("recent");
  const otherUsers = event("other");
  await repo("a").appendEvent(old);
  await repo("a").appendEvent(recent);
  await repo("b").appendEvent(otherUsers);
  await pglite.exec(`RESET ROLE;
    UPDATE personal.agent_events SET created_at = CURRENT_TIMESTAMP - interval '91 days' WHERE id = '${old.id}';
    UPDATE personal.agent_events SET created_at = CURRENT_TIMESTAMP - interval '89 days' WHERE id = '${recent.id}';
    UPDATE personal.agent_events SET created_at = CURRENT_TIMESTAMP - interval '200 days' WHERE id = '${otherUsers.id}';
    SET ROLE lavega_runtime;`);
  expect(await repo("a").purgeOlderThan(90)).toBe(1);
  expect((await repo("a").listEvents({ limit: 10 })).map((e) => e.body.text)).toEqual(["recent"]);
  // B's stale row is B's to purge: the call for A did not reach it.
  expect(await repo("b").listEvents({ limit: 10 })).toHaveLength(1);
  expect(await repo("b").purgeOlderThan(90)).toBe(1);
});

/* ---- unreadable data, config, ids, cursor ---- */

test("a blob that cannot be opened is reported, never read as empty or overwritten by a patch", async () => {
  await repo().putSettings(settings);
  await repo().putState({
    sentKeys: [{ key: "k1", date: "2026-11-10" }],
    lastTipDate: "2026-11-09",
  });
  await repo().putMirror({ rules: [], dueDates: [], cardOffer: null });
  const junk = "'\\x0102030405'";
  await pglite.exec(`RESET ROLE;
    UPDATE personal.agent_settings SET channels_blob = ${junk};
    UPDATE personal.agent_state SET sent_keys_blob = ${junk};
    UPDATE personal.agent_mirror SET payload_blob = ${junk};
    SET ROLE lavega_runtime;`);
  const stored = () =>
    raw<{ sent_keys_blob: Uint8Array }>("SELECT sent_keys_blob FROM personal.agent_state");

  await expect(repo().getSettings()).rejects.toBeInstanceOf(UnreadableAgentDataError);
  await expect(repo().getState()).rejects.toBeInstanceOf(UnreadableAgentDataError);
  await expect(repo().getMirror()).rejects.toBeInstanceOf(UnreadableAgentDataError);

  const before = Buffer.from((await stored())[0]!.sent_keys_blob).toString("hex");
  await expect(repo().putState({ lastTipDate: "2026-11-10" })).rejects.toBeInstanceOf(
    UnreadableAgentDataError,
  );
  expect(Buffer.from((await stored())[0]!.sent_keys_blob).toString("hex")).toBe(before);

  // Replacing the whole value is explicit and allowed.
  await repo().putState({ sentKeys: [] });
  expect((await repo().getState()).lastTipDate).toBe("2026-11-09");
});

test("assertAgentConfig names the broken variable and never echoes a value", () => {
  const saved = { ...process.env };
  try {
    expect(() => assertAgentConfig()).not.toThrow();
    for (const bad of [undefined, "ab".repeat(16), "zz".repeat(32)]) {
      if (bad === undefined) delete process.env.AGENT_DEDUPE_HMAC_KEY;
      else process.env.AGENT_DEDUPE_HMAC_KEY = bad;
      expect(() => assertAgentConfig()).toThrow(/AGENT_DEDUPE_HMAC_KEY/);
      try {
        assertAgentConfig();
      } catch (error) {
        if (bad) expect((error as Error).message).not.toContain(bad);
      }
    }
    process.env.AGENT_DEDUPE_HMAC_KEY = saved.AGENT_DEDUPE_HMAC_KEY;
    process.env.LAVEGA_ENCRYPTION_KEY = "short";
    expect(() => assertAgentConfig()).toThrow(/LAVEGA_ENCRYPTION_KEY/);
    delete process.env.LAVEGA_ENCRYPTION_KEY;
    expect(() => assertAgentConfig()).toThrow(/LAVEGA_ENCRYPTION_KEY/);
  } finally {
    process.env.AGENT_DEDUPE_HMAC_KEY = saved.AGENT_DEDUPE_HMAC_KEY;
    process.env.LAVEGA_ENCRYPTION_KEY = saved.LAVEGA_ENCRYPTION_KEY;
  }
});

test("the same id with a different dedupe key throws; only a dedupe collision is a duplicate", async () => {
  const first = event("een", { dedupeKey: "k1" });
  await repo().appendEvent(first);
  await expect(
    repo().appendEvent({ ...event("twee", { dedupeKey: "k2" }), id: first.id }),
  ).rejects.toThrow();
  expect(await repo().appendEvent(event("drie", { dedupeKey: "k1" }))).toBe("duplicate");
});

test("the listEvents cursor pages through events that share a timestamp", async () => {
  const ids = [];
  for (let i = 0; i < 5; i++) {
    const e = event(`e${i}`);
    ids.push(e.id);
    await repo().appendEvent(e);
  }
  await pglite.exec(
    `RESET ROLE; UPDATE personal.agent_events SET created_at = '2026-11-10T10:00:00.123456Z'; SET ROLE lavega_runtime;`,
  );
  const seen: string[] = [];
  let before: { createdAt: string; id: string } | undefined;
  for (;;) {
    const page = await repo().listEvents({ limit: 2, before });
    if (page.length === 0) break;
    seen.push(...page.map((e) => e.id));
    const last = page.at(-1)!;
    before = { createdAt: last.createdAt, id: last.id };
  }
  expect([...seen].sort()).toEqual([...ids].sort());
  expect(new Set(seen).size).toBe(5);
});

test("purgeOlderThan rejects NaN, zero, negative and fractional days", async () => {
  for (const days of [Number.NaN, 0, -1, 1.5])
    await expect(repo().purgeOlderThan(days)).rejects.toThrow();
});

test("touchInbound never moves last_inbound_at backwards", async () => {
  await pglite.exec(`RESET ROLE;
    INSERT INTO personal.agent_whatsapp (user_id, phone_hash) VALUES ('a', 'h-touch-a');
    SET ROLE lavega_runtime;`);
  const at = async () =>
    (
      await raw<{ ms: string }>(
        "SELECT (extract(epoch FROM last_inbound_at) * 1000)::bigint::text AS ms FROM personal.agent_whatsapp WHERE user_id = 'a'",
      )
    )[0]!.ms;
  try {
    await repo("a").touchInbound("2026-11-10T10:00:00.000Z");
    await repo("a").touchInbound("2026-11-10T09:00:00.000Z");
    expect(Number(await at())).toBe(Date.parse("2026-11-10T10:00:00.000Z"));
    await repo("a").touchInbound("2026-11-10T11:00:00.000Z");
    expect(Number(await at())).toBe(Date.parse("2026-11-10T11:00:00.000Z"));
  } finally {
    await pglite.exec("RESET ROLE; DELETE FROM personal.agent_whatsapp; SET ROLE lavega_runtime;");
  }
});

test("purgeOlderThan(90) also removes 91-day-old WhatsApp message and approval_response events and keeps 89-day-old ones", async () => {
  const wa = (type: "message" | "approval_response") => event("x", { channel: "whatsapp", type });
  const oldMsg = wa("message");
  const oldApp = wa("approval_response");
  const newMsg = wa("message");
  const newApp = wa("approval_response");
  for (const e of [oldMsg, oldApp, newMsg, newApp]) await repo("a").appendEvent(e);
  await pglite.exec(`RESET ROLE;
    UPDATE personal.agent_events SET created_at = CURRENT_TIMESTAMP - interval '91 days' WHERE id IN ('${oldMsg.id}', '${oldApp.id}');
    UPDATE personal.agent_events SET created_at = CURRENT_TIMESTAMP - interval '89 days' WHERE id IN ('${newMsg.id}', '${newApp.id}');
    SET ROLE lavega_runtime;`);
  expect(await repo("a").purgeOlderThan(90)).toBe(2);
  const left = (await repo("a").listEvents({ channel: "whatsapp", limit: 10 })).map((e) => e.id);
  expect(left.sort()).toEqual([newMsg.id, newApp.id].sort());
});

test("after deleteAll a late putState, claimDay, fetch budget and event write nothing (F3)", async () => {
  await repo("a").putState({ expiryPausedNoted: true });
  await repo("a").appendEvent(event("x"));
  await repo("a").deleteAll();
  expect(await repo("a").putState({ lastTipDate: "2026-11-10" })).toBe("skipped");
  expect(await repo("a").appendEvent(event("late"))).toBe("skipped");
  expect(await repo("a").claimDay("2026-11-11")).toBe(false);
  expect(await repo("a").takeFetchBudget("2026-11-11", 5)).toBe(false);
  for (const table of TABLES)
    expect(await raw(`SELECT 1 FROM personal.${table} WHERE user_id = 'a'`), table).toHaveLength(0);
  // User B is untouched and still writes.
  expect(await repo("b").putState({ expiryPausedNoted: true })).toBe("stored");
});

test("a user whose agent is switched off cannot gain state or events either (F3)", async () => {
  await repo("a").putSettings({ ...settings, enabled: false });
  expect(await repo("a").putState({ expiryPausedNoted: true })).toBe("skipped");
  expect(await repo("a").appendEvent(event("off"))).toBe("skipped");
});

test("after deleteAll a late mirror, push subscription or link code writes nothing (W1)", async () => {
  process.env.AGENT_PHONE_HMAC_KEY = "44".repeat(32);
  await repo("a").deleteAll();
  const mirror = {
    rules: [{ id: "r1", match: "ALBERT HEIJN", category: "boodschappen" }],
    dueDates: [],
    cardOffer: null,
  };
  expect(await repo("a").putMirror(mirror)).toBe("skipped");
  expect(
    await repo("a").putPush({
      endpoint: "https://push.example/late",
      keys: { p256dh: "k", auth: "s" },
    }),
  ).toBe("skipped");
  expect(await repo("a").createLinkCode()).toBe("skipped");
  for (const table of ["agent_mirror", "agent_push_subscriptions", "agent_link_codes"])
    expect(await raw(`SELECT 1 FROM personal.${table} WHERE user_id = 'a'`), table).toHaveLength(0);
  // A user whose agent is only switched off is refused the same way.
  await repo("b").putSettings({ ...settings, enabled: false });
  expect(await repo("b").putMirror(mirror)).toBe("skipped");
  // And an enabled user still writes.
  const other = createAgentRepository(db, "c");
  await other.putSettings(settings);
  expect(await other.putMirror(mirror)).toBe("stored");
  expect(
    await other.putPush({ endpoint: "https://push.example/ok", keys: { p256dh: "k", auth: "s" } }),
  ).toBe("stored");
  expect(await other.createLinkCode()).toMatchObject({ code: expect.stringMatching(/^LV-/) });
  await pglite.exec("RESET ROLE; DELETE FROM personal.agent_link_codes; SET ROLE lavega_runtime;");
});

test("the day claim only moves forward: an older day cannot be claimed once a newer one is (A2)", async () => {
  expect(await repo().claimDay("2026-11-12")).toBe(true);
  expect(await repo().claimDay("2026-11-11")).toBe(false);
  expect((await repo().getState()).lastSentDate).toBe("2026-11-12");
  expect(await repo().claimDay("2026-11-13")).toBe(true);
  // After a release the previous value is gone, but an older day still cannot jump over a newer claim.
  await repo().releaseDay("2026-11-13");
  expect(await repo().claimDay("2026-11-13")).toBe(true);
});

test("createLinkCode takes the settings lock before it touches link codes (A5)", async () => {
  process.env.AGENT_PHONE_HMAC_KEY = "44".repeat(32);
  const statements: string[] = [];
  const spy: Database = {
    ...db,
    connect: async () => {
      const client = await db.connect();
      return new Proxy(client, {
        get(target, prop, receiver) {
          if (prop === "query")
            return (text: string, params?: unknown[]) => (
              statements.push(String(text)),
              target.query(text, params)
            );
          return Reflect.get(target, prop, receiver);
        },
      });
    },
  } as Database;
  await createAgentRepository(spy, "a").createLinkCode();
  const firstLinkTouch = statements.findIndex((s) => /agent_link_codes/.test(s));
  expect(firstLinkTouch).toBeGreaterThan(-1);
  // The first statement on agent_link_codes is the guarded insert (which reads settings itself),
  // never a DELETE that locks the code table first.
  expect(statements[firstLinkTouch]).toMatch(/INSERT INTO personal\.agent_link_codes/);
  expect(statements[firstLinkTouch]).toMatch(/agent_settings/);
  expect(statements.some((s) => /DELETE FROM personal\.agent_link_codes/.test(s))).toBe(false);
  await pglite.exec("RESET ROLE; DELETE FROM personal.agent_link_codes; SET ROLE lavega_runtime;");
});
