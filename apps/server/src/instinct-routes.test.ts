import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import { createAgentRepository, type AgentRepository, type Database } from "@lavega/database";
import { migratedTestDatabase } from "@lavega/database/testing";
import { afterAll, beforeAll, beforeEach, expect, test, vi } from "vitest";
import {
  CONSENT_VERSION,
  instinctRouteDependencies,
  registerInstinctRoutes,
} from "./instinct-routes.js";
import { runInstinctCron } from "./agent/instinctCron.js";

/* Real migrations and RLS on PGlite: the routes talk to the real repository, so
 * "off leaves zero rows" and "user A cannot touch user B" are checked in SQL. */

let pglite: Awaited<ReturnType<typeof migratedTestDatabase>>["pglite"];
let db: Database;
let bank = true;
/** The turn-off race: the route reads "enabled", then the user turns the agent off. */
let staleEnabled = false;
const deleteAll = vi.fn();

beforeAll(async () => {
  process.env.LAVEGA_ENCRYPTION_KEY = "22".repeat(32);
  process.env.AGENT_DEDUPE_HMAC_KEY = "33".repeat(32);
  ({ pglite, db } = await migratedTestDatabase());
}, 60_000);
afterAll(async () => {
  await pglite.close();
});
beforeEach(async () => {
  bank = true;
  staleEnabled = false;
  deleteAll.mockClear();
  await pglite.exec("RESET ROLE;");
  for (const t of ["events", "push_subscriptions", "mirror", "state", "settings", "link_codes"])
    await pglite.exec(`DELETE FROM personal.agent_${t};`);
  await pglite.exec("SELECT set_config('app.user_id', '', false); SET ROLE lavega_runtime;");
});

const repoFor = (user: string): AgentRepository => {
  const real = createAgentRepository(db, user);
  return {
    ...real,
    getSettings: async () =>
      staleEnabled
        ? {
            enabled: true,
            channels: ["feed" as const],
            sendHour: 8,
            locale: "nl" as const,
            email: null,
            consentVersion: CONSENT_VERSION,
            consentedAt: "2026-11-10T08:00:00.000Z",
          }
        : real.getSettings(),
    deleteAll: async () => {
      deleteAll();
      return real.deleteAll();
    },
  };
};

const app = new Hono();
registerInstinctRoutes(app, {
  tenantId: async (r) => r.headers.get("x-user"),
  repository: repoFor,
  bankConnected: async () => bank,
  now: () => new Date("2026-11-10T12:00:00Z"),
});

const call = (user: string | null, method: string, path: string, body?: unknown) =>
  app.request(path, {
    method,
    headers: {
      ...(user ? { "x-user": user } : {}),
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

const EB = randomUUID();
const enable = {
  enabled: true,
  channels: ["feed", "push"],
  sendHour: 8,
  locale: "nl",
  email: null,
  consentVersion: CONSENT_VERSION,
};
const mirror = {
  rules: [{ id: "r1", match: "albert heijn", category: "Boodschappen" }],
  dueDates: [{ kind: "vat", label: "BTW Q4", date: "2027-01-31" }],
  cardOffer: { name: "Kaart X", yearlyGainCents: 7000, computedAt: "2026-11-10" },
};
const sub = { endpoint: "https://push.example.com/abc", keys: { p256dh: "pk", auth: "au" } };

const rowCount = async (): Promise<number> => {
  await pglite.exec("RESET ROLE;");
  let total = 0;
  for (const t of ["events", "push_subscriptions", "mirror", "state", "settings", "link_codes"])
    total += Number(
      (await pglite.query<{ n: number }>(`SELECT count(*)::int AS n FROM personal.agent_${t}`))
        .rows[0]?.n,
    );
  await pglite.exec("SET ROLE lavega_runtime;");
  return total;
};

test("every route refuses an unsigned request", async () => {
  const cases: [string, string, unknown?][] = [
    ["GET", "/api/agent/settings"],
    ["PUT", "/api/agent/settings", enable],
    ["PUT", "/api/agent/mirror", mirror],
    ["DELETE", "/api/agent/mirror"],
    ["POST", "/api/agent/push", sub],
    ["DELETE", "/api/agent/push", { endpoint: sub.endpoint }],
    ["GET", "/api/agent/feed"],
    ["DELETE", `/api/agent/events/${randomUUID()}`],
    ["DELETE", "/api/agent/conversation/feed"],
  ];
  for (const [method, path, body] of cases)
    expect((await call(null, method, path, body)).status, `${method} ${path}`).toBe(401);
  expect(await rowCount()).toBe(0);
});

test("enabling without a connected bank is a 409 and stores nothing", async () => {
  bank = false;
  const res = await call("a", "PUT", "/api/agent/settings", enable);
  expect(res.status).toBe(409);
  expect(((await res.json()) as { code: string }).code).toBe("bank-required");
  expect(await rowCount()).toBe(0);
});

test("enabling needs the current consent version", async () => {
  const res = await call("a", "PUT", "/api/agent/settings", { ...enable, consentVersion: "old" });
  expect(res.status).toBe(400);
  expect(await rowCount()).toBe(0);
});

test("enabling stamps consent and GET reports settings with bankConnected", async () => {
  expect((await call("a", "PUT", "/api/agent/settings", enable)).status).toBe(200);
  const got = (await (await call("a", "GET", "/api/agent/settings")).json()) as {
    settings: { enabled: boolean; consentedAt: string; consentVersion: string };
    bankConnected: boolean;
  };
  expect(got.settings.enabled).toBe(true);
  expect(got.settings.consentedAt).toBe("2026-11-10T12:00:00.000Z");
  expect(got.settings.consentVersion).toBe(CONSENT_VERSION);
  expect(got.bankConnected).toBe(true);
});

test("GET settings carries the public push key, and null when none is set", async () => {
  const before = process.env.VAPID_PUBLIC_KEY;
  try {
    process.env.VAPID_PUBLIC_KEY = "pub-key";
    const withKey = (await (await call("a", "GET", "/api/agent/settings")).json()) as {
      vapidPublicKey: string | null;
    };
    expect(withKey.vapidPublicKey).toBe("pub-key");
    delete process.env.VAPID_PUBLIC_KEY;
    const without = (await (await call("a", "GET", "/api/agent/settings")).json()) as {
      vapidPublicKey: string | null;
    };
    expect(without.vapidPublicKey).toBeNull();
  } finally {
    if (before === undefined) delete process.env.VAPID_PUBLIC_KEY;
    else process.env.VAPID_PUBLIC_KEY = before;
  }
});

test("settings validation rejects bad hours, channels, extra keys and email without address", async () => {
  for (const bad of [
    { ...enable, sendHour: 24 },
    { ...enable, sendHour: 7.5 },
    { ...enable, locale: "de" },
    { ...enable, channels: [] },
    { ...enable, channels: ["feed", "feed"] },
    { ...enable, channels: ["sms"] },
    { ...enable, channels: ["email"], email: null },
    { ...enable, extra: 1 },
  ])
    expect((await call("a", "PUT", "/api/agent/settings", bad)).status).toBe(400);
  expect((await call("a", "PUT", "/api/agent/settings", "nope")).status).toBe(400);
});

test("settings accept the whatsapp channel", async () => {
  const res = await call("a", "PUT", "/api/agent/settings", {
    ...enable,
    channels: ["feed", "whatsapp"],
  });
  expect(res.status).toBe(200);
});

test("turning off calls deleteAll, answers 204 and leaves zero rows", async () => {
  await call("a", "PUT", "/api/agent/settings", enable);
  await call("a", "PUT", "/api/agent/mirror", mirror);
  await call("a", "POST", "/api/agent/push", sub);
  await repoFor("a").appendEvent({
    id: randomUUID(),
    channel: "feed",
    type: "message",
    body: { text: "hallo" },
  });
  expect(await rowCount()).toBeGreaterThan(3);
  const res = await call("a", "PUT", "/api/agent/settings", { enabled: false });
  expect(res.status).toBe(204);
  expect(deleteAll).toHaveBeenCalledTimes(1);
  expect(await rowCount()).toBe(0);
});

test("turning off one user leaves another user's rows", async () => {
  await call("a", "PUT", "/api/agent/settings", enable);
  await call("b", "PUT", "/api/agent/settings", enable);
  await call("a", "PUT", "/api/agent/settings", { enabled: false });
  const b = (await (await call("b", "GET", "/api/agent/settings")).json()) as {
    settings: { enabled: boolean } | null;
  };
  expect(b.settings?.enabled).toBe(true);
});

test("the mirror needs the agent on", async () => {
  expect((await call("a", "PUT", "/api/agent/mirror", mirror)).status).toBe(409);
  expect(await rowCount()).toBe(0);
});

test("the mirror stores rules, due dates and the card gain, and DELETE clears it", async () => {
  await call("a", "PUT", "/api/agent/settings", enable);
  expect((await call("a", "PUT", "/api/agent/mirror", mirror)).status).toBe(204);
  expect(await repoFor("a").getMirror()).toEqual(mirror);
  expect((await call("a", "DELETE", "/api/agent/mirror")).status).toBe(204);
  expect(await repoFor("a").getMirror()).toEqual({ rules: [], dueDates: [], cardOffer: null });
});

test("the mirror rejects amounts, IBANs, transactions and every unknown key", async () => {
  await call("a", "PUT", "/api/agent/settings", enable);
  const bad = [
    { ...mirror, amountCents: 5 },
    { ...mirror, transactions: [] },
    { ...mirror, dueDates: [{ ...mirror.dueDates[0], amountCents: 12000 }] },
    { ...mirror, dueDates: [{ ...mirror.dueDates[0], iban: "NL91ABNA0417164300" }] },
    { ...mirror, rules: [{ ...mirror.rules[0], amountCents: 1 }] },
    { ...mirror, cardOffer: { ...mirror.cardOffer, amountCents: 1 } },
    { ...mirror, cardOffer: { ...mirror.cardOffer, yearlyGainCents: 1.5 } },
    { ...mirror, cardOffer: { ...mirror.cardOffer, yearlyGainCents: 1e12 } },
    { ...mirror, cardOffer: { ...mirror.cardOffer, yearlyGainCents: -1 } },
    { ...mirror, dueDates: [{ kind: "vat", label: "x", date: "2027-02-31" }] },
    {
      ...mirror,
      rules: Array.from({ length: 501 }, (_, i) => ({ id: `${i}`, match: "m", category: "c" })),
    },
    { ...mirror, rules: [{ id: "r", match: "x".repeat(201), category: "c" }] },
    { ...mirror, dueDates: Array.from({ length: 101 }, () => mirror.dueDates[0]) },
  ];
  for (const body of bad)
    expect((await call("a", "PUT", "/api/agent/mirror", body)).status).toBe(400);
  expect(await repoFor("a").getMirror()).toBeNull();
});

test("push subscriptions are validated and need the agent on", async () => {
  expect((await call("a", "POST", "/api/agent/push", sub)).status).toBe(409);
  await call("a", "PUT", "/api/agent/settings", enable);
  for (const bad of [
    { ...sub, endpoint: "http://insecure.example.com/x" },
    { ...sub, endpoint: "not a url" },
    { endpoint: sub.endpoint },
    { ...sub, extra: 1 },
  ])
    expect((await call("a", "POST", "/api/agent/push", bad)).status).toBe(400);
  expect((await call("a", "POST", "/api/agent/push", sub)).status).toBe(204);
  expect(await repoFor("a").listPush()).toHaveLength(1);
  expect((await call("a", "DELETE", "/api/agent/push", { endpoint: sub.endpoint })).status).toBe(
    204,
  );
  expect(await repoFor("a").listPush()).toHaveLength(0);
});

test("the feed returns decrypted text newest first, scoped to the user, with a cursor", async () => {
  await call("a", "PUT", "/api/agent/settings", enable);
  await call("b", "PUT", "/api/agent/settings", enable);
  const a = repoFor("a");
  for (const text of ["eerste", "tweede", "derde"]) {
    await a.appendEvent({ id: randomUUID(), channel: "feed", type: "message", body: { text } });
    await new Promise((r) => setTimeout(r, 5));
  }
  await repoFor("b").appendEvent({
    id: EB,
    channel: "feed",
    type: "message",
    body: { text: "van b" },
  });
  const res = await call("a", "GET", "/api/agent/feed?limit=2");
  const page = (await res.json()) as { events: { body: { text: string } }[]; next: string | null };
  expect(page.events.map((e) => e.body.text)).toEqual(["derde", "tweede"]);
  expect(page.next).not.toBeNull();
  const rest = (await (
    await call("a", "GET", `/api/agent/feed?limit=2&before=${encodeURIComponent(page.next!)}`)
  ).json()) as { events: { body: { text: string } }[]; next: string | null };
  expect(rest.events.map((e) => e.body.text)).toEqual(["eerste"]);
  expect(rest.next).toBeNull();
  expect(res.headers.get("cache-control")).toBe("private, no-store");
});

test("the feed rejects a bad channel, limit or cursor", async () => {
  for (const q of [
    "channel=sms",
    "limit=0",
    "limit=101",
    "limit=x",
    "before=garbage",
    "before=2026-11-10T00:00:00Z_nope",
  ])
    expect((await call("a", "GET", `/api/agent/feed?${q}`)).status).toBe(400);
});

test("user A cannot delete user B's event: 404, and B still has it", async () => {
  await call("a", "PUT", "/api/agent/settings", enable);
  await call("b", "PUT", "/api/agent/settings", enable);
  await repoFor("b").appendEvent({ id: EB, channel: "feed", type: "message", body: { text: "b" } });
  expect((await call("a", "DELETE", `/api/agent/events/${EB}`)).status).toBe(404);
  expect(await repoFor("b").listEvents({ limit: 10 })).toHaveLength(1);
  expect((await call("b", "DELETE", `/api/agent/events/${EB}`)).status).toBe(204);
  expect(await repoFor("b").listEvents({ limit: 10 })).toHaveLength(0);
});

test("deleting a conversation removes that channel's events for the caller only", async () => {
  await call("a", "PUT", "/api/agent/settings", enable);
  await call("b", "PUT", "/api/agent/settings", enable);
  await repoFor("a").appendEvent({
    id: randomUUID(),
    channel: "feed",
    type: "message",
    body: { text: "1" },
  });
  await repoFor("b").appendEvent({
    id: randomUUID(),
    channel: "feed",
    type: "message",
    body: { text: "2" },
  });
  const res = await call("a", "DELETE", "/api/agent/conversation/feed");
  expect(await res.json()).toEqual({ deleted: 1 });
  expect(await repoFor("b").listEvents({ limit: 10 })).toHaveLength(1);
  expect((await call("a", "DELETE", "/api/agent/conversation/sms")).status).toBe(400);
});

test("deleting the whatsapp conversation removes every whatsapp event of the caller, keeps other channels and the other user", async () => {
  await call("a", "PUT", "/api/agent/settings", enable);
  await call("b", "PUT", "/api/agent/settings", enable);
  const ev = (channel: "whatsapp" | "feed", type: "message" | "approval_response" | "error") => ({
    id: randomUUID(),
    channel,
    type,
    body: { text: "x" },
  });
  for (const t of ["message", "approval_response", "error"] as const)
    await repoFor("a").appendEvent(ev("whatsapp", t));
  await repoFor("a").appendEvent(ev("feed", "message"));
  await repoFor("b").appendEvent(ev("whatsapp", "message"));
  const res = await call("a", "DELETE", "/api/agent/conversation/whatsapp");
  expect(await res.json()).toEqual({ deleted: 3 });
  expect((await repoFor("a").listEvents({ limit: 10 })).map((e) => e.channel)).toEqual(["feed"]);
  expect(await repoFor("b").listEvents({ channel: "whatsapp", limit: 10 })).toHaveLength(1);
});

test("a missing dedupe key never stops the server: agent routes and the cron answer 503, others serve", async () => {
  const saved = {
    dedupe: process.env.AGENT_DEDUPE_HMAC_KEY,
    db: process.env.DATABASE_URL,
    cron: process.env.CRON_SECRET,
  };
  delete process.env.AGENT_DEDUPE_HMAC_KEY;
  process.env.DATABASE_URL = "postgres://unused.invalid/db";
  process.env.CRON_SECRET = "cron-secret";
  const logs: unknown[] = [];
  const spy = vi.spyOn(console, "log").mockImplementation((...a: unknown[]) => void logs.push(a));
  try {
    const deps = instinctRouteDependencies();
    expect(deps).not.toBeNull();
    const bare = new Hono();
    bare.get("/api/rates", (c) => c.json({ ok: true }));
    registerInstinctRoutes(bare, { ...deps!, tenantId: async () => "a" });
    expect((await bare.request("/api/rates")).status).toBe(200);
    const res = await bare.request("/api/agent/settings");
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({
      problems: ["Agent is not configured"],
      code: "agent-not-configured",
    });
    expect(JSON.stringify(logs)).not.toContain("postgres://");
    const cron = await runInstinctCron(
      new Request("https://lavega.test/api/cron/instinct", {
        headers: { authorization: "Bearer cron-secret" },
      }),
      {
        now: () => new Date(),
        assertConfig: () => {
          throw new Error("AGENT_DEDUPE_HMAC_KEY is required");
        },
        listDue: async () => [],
        run: async () => "sent",
        purge: async () => 0,
        purgeLinkAttempts: async () => 0,
        budgetMs: 1,
      },
    );
    expect(cron.status).toBe(503);
  } finally {
    spy.mockRestore();
    for (const [k, v] of [
      ["AGENT_DEDUPE_HMAC_KEY", saved.dedupe],
      ["DATABASE_URL", saved.db],
      ["CRON_SECRET", saved.cron],
    ] as const)
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
  }
});

test("feed is always among the stored channels: a settings body without it gets it added (F7)", async () => {
  const res = await call("a", "PUT", "/api/agent/settings", { ...enable, channels: ["push"] });
  expect(res.status).toBe(200);
  expect((await repoFor("a").getSettings())!.channels).toEqual(["feed", "push"]);
  const again = await call("a", "PUT", "/api/agent/settings", {
    ...enable,
    channels: ["whatsapp", "feed"],
  });
  expect(again.status).toBe(200);
  expect((await repoFor("a").getSettings())!.channels).toEqual(["whatsapp", "feed"]);
});

test("the WhatsApp link code needs the explicit AI consent in the body (F2)", async () => {
  process.env.AGENT_PHONE_HMAC_KEY = "44".repeat(32);
  await call("a", "PUT", "/api/agent/settings", enable);
  for (const body of [
    undefined,
    {},
    { aiConsent: false },
    { aiConsent: "true" },
    { aiConsent: true, x: 1 },
  ]) {
    const res = await call("a", "POST", "/api/agent/whatsapp/link-code", body);
    expect(res.status, JSON.stringify(body)).toBe(400);
    expect(((await res.json()) as { code: string }).code).toBe("ai-consent-required");
  }
  await pglite.exec("RESET ROLE;");
  const none = await pglite.query("SELECT 1 FROM personal.agent_link_codes");
  await pglite.exec("SET ROLE lavega_runtime;");
  expect(none.rows).toHaveLength(0);

  const ok = await call("a", "POST", "/api/agent/whatsapp/link-code", { aiConsent: true });
  expect(ok.status).toBe(200);
  expect(((await ok.json()) as { code: string }).code).toMatch(/^LV-/);
});

test("a mirror, push or link code that loses the turn-off race answers 409 agent-off and stores nothing (W1)", async () => {
  process.env.AGENT_PHONE_HMAC_KEY = "44".repeat(32);
  // The settings row is gone (turned off meanwhile) but the route's read still said "on".
  staleEnabled = true;
  const answers = [
    await call("a", "PUT", "/api/agent/mirror", mirror),
    await call("a", "POST", "/api/agent/push", sub),
    await call("a", "POST", "/api/agent/whatsapp/link-code", { aiConsent: true }),
  ];
  for (const res of answers) {
    expect(res.status).toBe(409);
    expect(((await res.json()) as { code: string }).code).toBe("agent-off");
  }
  await pglite.exec("RESET ROLE;");
  for (const t of ["mirror", "push_subscriptions", "link_codes"])
    expect((await pglite.query(`SELECT 1 FROM personal.agent_${t}`)).rows, t).toHaveLength(0);
  await pglite.exec("SET ROLE lavega_runtime;");
});
