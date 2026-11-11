import { createHmac, randomUUID } from "node:crypto";
import type { Account, Tx } from "@lavega/core";
import {
  createAgentRepository,
  decryptBlob,
  eraseUserData,
  userForPhone,
  phoneHash,
  listAgentDueUsers,
  purgeLinkAttempts,
  type AgentChannel,
  type Database,
} from "@lavega/database";
import { databaseOver, migratedTestDatabase } from "@lavega/database/testing";
import { Hono } from "hono";
import { afterAll, afterEach, beforeAll, beforeEach, expect, test, vi } from "vitest";
import { registerAccountRoutes } from "../account-routes.js";
import { CONSENT_VERSION, registerInstinctRoutes } from "../instinct-routes.js";
import { FRAMING_PHRASES } from "../whatsapp/copy.js";
import { createWhatsAppClient } from "../whatsapp/client.js";
import { sendWhatsAppDaily } from "../whatsapp/channel.js";
import { handleUnlinked } from "../whatsapp/linking.js";
import { answerInbound, answerLinkedText, type ReplyDeps } from "../whatsapp/reply.js";
import { registerWhatsappWebhook, whatsappWebhookDependencies } from "../whatsapp/webhook.js";
import { sendAgentEmail } from "./emailChannel.js";
import { runForUser, type InstinctDeps } from "./instinct.js";
import { runInstinctCron, type CronDeps } from "./instinctCron.js";
import { sendPush } from "./pushChannel.js";
import { createRateLimiter } from "./rateLimit.js";
import type { FetchOutcome } from "./unattendedFetch.js";

/* The whole Instinct agent on a real (PGlite) database with row-level security:
 * enable, link a number, the hourly cron, a signed WhatsApp question, turning
 * the agent off, and erasing the account. Every outside service is a fake; nothing
 * touches a network. The sentinel merchant and IBAN live only in the fake bank. */

const SENTINEL = "SENTINEL-ZORGVERZEKERAAR";
// A recurring counterparty: it becomes a subscription, so upcoming_charges lists it by name.
const RECURRING = "SENTINELNAME-STREAMINGCO";
const IBAN = "NL01INGB0000000001";
const NOW = Date.parse("2026-11-11T07:05:00Z"); // 08:05 in Amsterdam
const PHONE_DIGITS = "31612345678";
const APP_SECRET = "app-secret";
const CRON_SECRET = "cron-secret";
const ALL_CHANNELS: AgentChannel[] = ["feed", "push", "email", "whatsapp"];
const AGENT_TABLES = [
  "agent_settings",
  "agent_state",
  "agent_mirror",
  "agent_push_subscriptions",
  "agent_events",
  "agent_whatsapp",
  "agent_link_codes",
] as const;

const tx = (id: string, date: string, amount: number, counterparty: string): Tx => ({
  id,
  accountKey: "acc",
  date,
  amount,
  currency: "EUR",
  counterparty,
  description: `${counterparty} ${IBAN}`,
  category: "onbekend",
  manual: false,
});
const account = {
  key: "acc",
  name: "Betaalrekening",
  currency: "EUR",
  iban: IBAN,
  balance: 1000,
} as unknown as Account;
const BANK: FetchOutcome = {
  status: "ok",
  txs: [
    tx("1", "2026-11-10", -84, SENTINEL),
    tx("2", "2026-11-10", -0.5, "Koffie"),
    tx("r1", "2026-08-21", -12.99, RECURRING),
    tx("r2", "2026-09-20", -12.99, RECURRING),
    tx("r3", "2026-10-20", -12.99, RECURRING),
  ],
  accounts: [account],
  balances: [{ accountKey: "acc", cents: 1_234_500 }],
  consentExpiresAt: new Date(NOW + 60 * 86_400_000).toISOString(),
  banks: [{ bank: "ING", state: "ok" }],
};
// A clamped range yields two facts, so the model's selection step runs too.
const TOOL_JSON = JSON.stringify({
  tool: "spending_in_range",
  from: "2026-01-01",
  to: "2026-11-10",
});
const INTRO = FRAMING_PHRASES.nl.intros[0];
const OUTRO = FRAMING_PHRASES.nl.outros[4];
const STEP_2 = JSON.stringify({ intro: 0, use: [0], outro: 4 });
/* Income of 2000 in each of three months (the oldest 89 days back), nothing else but the
 * sentinel spending (not yesterday, which would outrank a tip), and a balance whose 60-day floor is exactly 1000 on a current account:
 * the idle-balance tip applies and no higher-ranked candidate does (no due date below). */
const IDLE_BANK: FetchOutcome = {
  ...BANK,
  txs: [
    tx("p1", "2026-08-14", 2000, "Werkgever BV"),
    tx("p2", "2026-09-14", 2000, "Werkgever BV"),
    tx("p3", "2026-10-14", 2000, "Werkgever BV"),
    tx("1", "2026-11-05", -84, SENTINEL),
  ],
  // 100000 floor + 2 x 2000 salaries after the floor day - 84 spent after it.
  balances: [{ accountKey: "acc", cents: 100_000 + 400_000 - 8_400 }],
};
let bank: FetchOutcome;
const FACT_0 = "Van 14 aug tot en met 10 nov gaf je € 123,47 uit.";

let pglite: Awaited<ReturnType<typeof migratedTestDatabase>>["pglite"];
let db: Database;
/** Every statement and parameter the repository layer sent, as text. */
let writes: string[];
let consoleLines: string[];
let fetchCalls: { url: string; body: string }[];
let pushCalls: { endpoint: string; payload: string }[];
let prompts: string[];
let bankFetches: number;
let wamidCounter: number;
let modelSteps: string[];

beforeAll(async () => {
  Object.assign(process.env, {
    LAVEGA_ENCRYPTION_KEY: "22".repeat(32),
    AGENT_DEDUPE_HMAC_KEY: "33".repeat(32),
    AGENT_PHONE_HMAC_KEY: "44".repeat(32),
    WHATSAPP_APP_SECRET: APP_SECRET,
    WHATSAPP_TEMPLATE_DAILY: "daily_money",
    VAPID_PUBLIC_KEY: "pub",
    VAPID_PRIVATE_KEY: "priv",
    VAPID_SUBJECT: "mailto:test@lavega.test",
    RESEND_API_KEY: "re_test",
    AUTH_EMAIL_FROM: "LaVega <noreply@lavega.test>",
    CRON_SECRET,
  });
  ({ pglite } = await migratedTestDatabase());
  db = databaseOver(async () => ({
    query: async (text: string, params?: unknown[]) => {
      writes.push(
        `${text} ${JSON.stringify(
          (params ?? []).map((p) =>
            p instanceof Uint8Array ? Buffer.from(p).toString("latin1") : p,
          ),
        )}`,
      );
      return pglite.query(text, (params ?? []) as never[]);
    },
    release: () => undefined,
  }));
}, 60_000);
afterAll(async () => {
  await pglite.close();
});

beforeEach(async () => {
  await pglite.exec("RESET ROLE;");
  for (const t of [...AGENT_TABLES, "agent_link_attempts"])
    await pglite.exec(`DELETE FROM personal.${t};`);
  await pglite.exec("SELECT set_config('app.user_id', '', false); SET ROLE lavega_runtime;");
  writes = [];
  consoleLines = [];
  fetchCalls = [];
  pushCalls = [];
  prompts = [];
  bankFetches = 0;
  wamidCounter = 0;
  modelSteps = [TOOL_JSON, STEP_2];
  bank = BANK;
  for (const m of ["log", "warn", "error", "info", "debug"] as const)
    vi.spyOn(console, m).mockImplementation(
      (...a: unknown[]) => void consoleLines.push(a.join(" ")),
    );
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: { body?: string }) => {
      fetchCalls.push({ url: String(url), body: String(init?.body ?? "") });
      if (String(url).startsWith("https://api.resend.com"))
        return new Response(JSON.stringify({ id: "mail-1" }), { status: 200 });
      wamidCounter += 1;
      return new Response(JSON.stringify({ messages: [{ id: `wamid.out.${wamidCounter}` }] }), {
        status: 200,
      });
    }),
  );
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const waClient = () =>
  createWhatsAppClient({ phoneNumberId: "pn-1", accessToken: "tok" }, fetch as typeof fetch);
const graphBodies = () =>
  fetchCalls
    .filter((c) => c.url.startsWith("https://graph.facebook.com"))
    .map(
      (c) =>
        JSON.parse(c.body) as {
          type: string;
          text?: { body: string };
          template?: { components?: { parameters: { text: string }[] }[] };
        },
    );
const templates = () => graphBodies().filter((b) => b.type === "template");
const texts = () => graphBodies().filter((b) => b.type === "text");
const mails = () => fetchCalls.filter((c) => c.url.startsWith("https://api.resend.com"));

function instinctDeps(): InstinctDeps {
  const repo = (u: string) => createAgentRepository(db, u);
  return {
    db,
    now: () => new Date(NOW),
    fetchSessions: async () => [
      {
        sessionId: "s1",
        payload: { aspsp: "ING" } as never,
        createdAt: "2026-11-01T00:00:00.000Z",
      },
    ],
    rates: [],
    fetchOutcome: async () => {
      bankFetches += 1;
      return bank;
    },
    send: {
      feed: async () => "sent",
      push: (u, msg) =>
        sendPush(u, msg, repo(u), {
          webpush: {
            sendNotification: (async (sub: { endpoint: string }, payload: string) => {
              pushCalls.push({ endpoint: sub.endpoint, payload });
              return { statusCode: 201 };
            }) as never,
          },
        }),
      email: (_u, msg, s) => sendAgentEmail(s.email!, msg, s.locale, "https://lavega.test"),
      whatsapp: (u, msg, s) => sendWhatsAppDaily(u, msg, s.locale, repo(u), { client: waClient() }),
    },
  };
}

function cronDeps(): CronDeps {
  const instinct = instinctDeps();
  return {
    now: () => new Date(NOW),
    assertConfig: () => undefined,
    listDue: (hour, retry, today) => listAgentDueUsers(db, hour, retry, today),
    run: (u) => runForUser(instinct, u),
    purge: (u) => createAgentRepository(db, u).purgeOlderThan(30),
    purgeLinkAttempts: () => purgeLinkAttempts(db),
    budgetMs: 240_000,
  };
}
const cron = () =>
  runInstinctCron(
    new Request("https://lavega.test/api/cron/instinct", {
      headers: { authorization: `Bearer ${CRON_SECRET}` },
    }),
    cronDeps(),
  );

function replyDeps(userId: string): ReplyDeps {
  return {
    repo: createAgentRepository(db, userId),
    fetchSessions: async () => [
      {
        sessionId: "s1",
        payload: { aspsp: "ING" } as never,
        createdAt: "2026-11-01T00:00:00.000Z",
      },
    ],
    fetchOutcome: async () => {
      bankFetches += 1;
      return bank;
    },
    llm: {
      complete: async (input: { system: string; user: string }) => {
        prompts.push(`${input.system}\n${input.user}`);
        return { text: modelSteps.shift() ?? "", usage: { input: 10, output: 5 } };
      },
    } as never,
    budget: async () => ({ ok: true as const }),
    client: waClient(),
    now: () => NOW,
    recordUsage: async () => undefined,
    releaseReservation: async () => undefined,
    limiter: createRateLimiter(20, 3_600_000, () => NOW),
  };
}

function app(): Hono {
  const hono = new Hono();
  const tenant = async (r: Request) => r.headers.get("x-user");
  registerInstinctRoutes(hono, {
    tenantId: tenant,
    repository: (t) => createAgentRepository(db, t),
    bankConnected: async () => true,
    now: () => new Date(NOW),
    assertConfig: () => undefined,
  });
  registerAccountRoutes(hono, { tenantId: tenant, erase: (t) => eraseUserData(db, t) });
  const hooks = whatsappWebhookDependencies(() => db);
  hooks.unlinked = (inbound) =>
    handleUnlinked(db, inbound, { client: waClient(), limiter: createRateLimiter(50, 60_000) });
  hooks.onLinked = async (userId, inbound) => {
    if (inbound.kind === "text") await answerInbound(replyDeps(userId), userId, inbound.text);
  };
  registerWhatsappWebhook(hono, hooks);
  return hono;
}

const asUser = (user: string, method: string, body?: unknown) => ({
  method,
  headers: { "x-user": user, "content-type": "application/json" },
  ...(body === undefined ? {} : { body: JSON.stringify(body) }),
});

async function inbound(hono: Hono, text: string, signed = true) {
  const body = JSON.stringify({
    entry: [
      {
        changes: [
          {
            value: {
              messages: [
                {
                  id: `wamid.in.${randomUUID()}`,
                  from: PHONE_DIGITS,
                  timestamp: String(Math.floor(NOW / 1000)),
                  type: "text",
                  text: { body: text },
                },
              ],
            },
          },
        ],
      },
    ],
  });
  const sig = createHmac("sha256", signed ? APP_SECRET : "wrong")
    .update(body)
    .digest("hex");
  return hono.request("/api/whatsapp/webhook", {
    method: "POST",
    headers: { "x-hub-signature-256": `sha256=${sig}` },
    body,
  });
}

/** Row counts of the seven agent tables for one user, read past row-level security. */
async function counts(userId: string): Promise<Record<string, number>> {
  await pglite.exec("RESET ROLE;");
  const out: Record<string, number> = {};
  for (const t of AGENT_TABLES) {
    const r = await pglite.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM personal.${t} WHERE user_id = $1`,
      [userId],
    );
    out[t] = r.rows[0]!.n;
  }
  await pglite.exec("SELECT set_config('app.user_id', '', false); SET ROLE lavega_runtime;");
  return out;
}

/** Counts plus an ordered content digest of every row of one user, past row-level security. */
async function snapshot(userId: string) {
  const digest: Record<string, string> = {};
  await pglite.exec("RESET ROLE;");
  for (const t of AGENT_TABLES) {
    const r = await pglite.query<{ d: string }>(
      `SELECT md5(coalesce(string_agg(j, '|' ORDER BY j), '')) AS d
         FROM (SELECT row_to_json(t)::text AS j FROM personal.${t} t WHERE user_id = $1) x`,
      [userId],
    );
    digest[t] = r.rows[0]!.d;
  }
  await pglite.exec("SELECT set_config('app.user_id', '', false); SET ROLE lavega_runtime;");
  return { counts: await counts(userId), digest };
}

/** Every agent table, every user, every sealed column opened: what the encryption hides. */
async function plaintextDump(): Promise<string> {
  const out: string[] = [];
  await pglite.exec("RESET ROLE;");
  for (const t of AGENT_TABLES) {
    const r = await pglite.query<Record<string, unknown>>(`SELECT * FROM personal.${t}`);
    for (const row of r.rows)
      for (const value of Object.values(row)) {
        if (value instanceof Uint8Array) {
          try {
            out.push(JSON.stringify(decryptBlob(value)));
          } catch {
            out.push(Buffer.from(value).toString("latin1"));
          }
        } else out.push(JSON.stringify(value));
      }
  }
  await pglite.exec("SELECT set_config('app.user_id', '', false); SET ROLE lavega_runtime;");
  return out.join("\n");
}

/** What must never carry the bank's merchant name or IBAN, by sink. */
async function sinks(userId: string): Promise<Record<string, string>> {
  const events = await createAgentRepository(db, userId).listEvents({ limit: 500 });
  return {
    "repository ciphertext": writes.join("\n"),
    "repository plaintext": await plaintextDump(),
    console: consoleLines.join("\n"),
    "event body": JSON.stringify(events),
    "model prompt": prompts.join("\n"),
    "outbound http body": fetchCalls.map((c) => c.body).join("\n"),
    "push payload": pushCalls.map((c) => c.payload).join("\n"),
  };
}

const NEEDLES = [SENTINEL, "ZORGVERZEKERAAR", IBAN, "INGB0000", "00000001"].map((n) =>
  n.toLowerCase().replace(/\s+/g, ""),
);
/** Names of the sinks that hold a needle: case-insensitive, whitespace ignored (spaced IBANs). */
const leaks = (all: Record<string, string>): string[] =>
  Object.entries(all)
    .filter(([, text]) => {
      const flat = text.toLowerCase().replace(/\s+/g, "");
      return NEEDLES.some((n) => flat.includes(n));
    })
    .map(([name]) => name);

/** User A fully set up (all four channels, push, linked number) and user B opted out. */
async function setup() {
  const A = randomUUID();
  const B = randomUUID();
  const hono = app();
  const put = await hono.request(
    "/api/agent/settings",
    asUser(A, "PUT", {
      enabled: true,
      channels: ALL_CHANNELS,
      sendHour: 8,
      locale: "nl",
      email: "a@example.com",
      consentVersion: CONSENT_VERSION,
    }),
  );
  expect(put.status).toBe(200);
  const push = await hono.request(
    "/api/agent/push",
    asUser(A, "POST", {
      endpoint: "https://push.example/sub-a",
      keys: { p256dh: "p256", auth: "auth" },
    }),
  );
  expect(push.status).toBe(204);
  const mirror = await hono.request(
    "/api/agent/mirror",
    asUser(A, "PUT", {
      rules: [],
      dueDates: [{ kind: "vat", label: "BTW", date: "2026-11-14" }],
      cardOffer: null,
    }),
  );
  expect(mirror.status).toBe(204);
  const code = await (
    await hono.request("/api/agent/whatsapp/link-code", asUser(A, "POST", { aiConsent: true }))
  ).json();
  expect((await inbound(hono, (code as { code: string }).code)).status).toBe(200);
  expect(await createAgentRepository(db, A).getLink()).not.toBeNull();

  // B: an account that is not opted in, with rows of every kind that must survive.
  const repoB = createAgentRepository(db, B);
  const bSettings = {
    enabled: false,
    channels: ["feed" as const],
    sendHour: 8,
    locale: "nl" as const,
    email: null,
    consentVersion: CONSENT_VERSION,
    consentedAt: null,
  };
  await repoB.putSettings(bSettings);
  await repoB.putMirror({ rules: [], dueDates: [], cardOffer: null });
  await repoB.putPush({ endpoint: "https://push.example/sub-b", keys: { p256dh: "p", auth: "a" } });
  await repoB.appendEvent({
    id: randomUUID(),
    channel: "feed",
    type: "message",
    body: { text: "b" },
  });
  await repoB.createLinkCode();
  // State is only written while the agent is on; write it, then put B back to opted out.
  await repoB.putSettings({ ...bSettings, enabled: true });
  await repoB.putState({ expiryPausedNoted: true });
  await repoB.putSettings(bSettings);
  return { A, B, hono, repoA: createAgentRepository(db, A), repoB, beforeB: await snapshot(B) };
}

test("enable, link, cron twice, signed question, erase: the whole flow", async () => {
  const { A, B, hono, repoA, beforeB } = await setup();
  expect(beforeB.counts.agent_settings).toBe(1);

  // Two runs in one hour: one send per channel for A, none for B.
  const first = await (await cron()).json();
  const second = await (await cron()).json();
  expect(first).toMatchObject({ due: 1, results: { sent: 1 }, failed: 0 });
  expect(second).toMatchObject({ due: 0, failed: 0 });
  expect(bankFetches).toBe(1);
  expect(pushCalls).toHaveLength(1);
  expect(pushCalls[0]!.endpoint).toBe("https://push.example/sub-a");
  expect(mails()).toHaveLength(1);
  expect(JSON.parse(mails()[0]!.body).to).toEqual(["a@example.com"]);
  expect(templates()).toHaveLength(1);
  const feed = await repoA.listEvents({ channel: "feed", limit: 10 });
  expect(feed).toHaveLength(1);
  const outDaily = await repoA.listEvents({ channel: "whatsapp", limit: 10 });
  const dailyOut = outDaily.filter((e) => e.body.text.startsWith("BTW is over"));
  expect(dailyOut).toHaveLength(1);
  expect(dailyOut[0]!.body.text).toBe(
    templates()[0]!.template!.components![0]!.parameters[0]!.text,
  );
  expect(await snapshot(B)).toEqual(beforeB);

  // A signed question is answered with the chosen intro phrase, the computed fact byte for
  // byte, and the chosen outro phrase: nothing else.
  const textsBefore = texts().length;
  expect((await inbound(hono, "Wat gaf ik uit dit jaar?")).status).toBe(200);
  const answers = texts().slice(textsBefore);
  expect(answers.map((a) => a.text!.body)).toEqual([`${INTRO}\n${FACT_0}\n${OUTRO}`]);
  expect(bankFetches).toBe(2);
  expect(modelSteps).toEqual([]);

  // A question that lists the recurring charge by name: its facts carry bank text, so the
  // model is called once (the tool choice) and never sees the name; the user does.
  modelSteps = [
    JSON.stringify({ tool: "upcoming_charges", days: 14 }),
    JSON.stringify({ intro: 1, use: [0], outro: 2 }),
  ];
  const beforeUpcoming = texts().length;
  expect((await inbound(hono, "Welke afschrijvingen komen eraan?")).status).toBe(200);
  const upcoming = texts().slice(beforeUpcoming);
  expect(upcoming).toHaveLength(1);
  expect(upcoming[0]!.text!.body).toContain(RECURRING);
  // Bank text in the answer: no model step, so no phrase either.
  expect(upcoming[0]!.text!.body).not.toContain(FRAMING_PHRASES.nl.intros[1]);
  expect(modelSteps).toHaveLength(1);
  expect(prompts.length).toBe(3);
  expect(prompts.join("\n").toLowerCase()).not.toContain("sentinelname");

  // A forged signature is refused and nothing is sent.
  const sentBefore = fetchCalls.length;
  expect((await inbound(hono, "Wat gaf ik uit?", false)).status).toBe(401);
  expect(fetchCalls.length).toBe(sentBefore);

  // The sentinel merchant and IBAN reach no sink: writes (cipher and plain), logs, events,
  // prompts, outbound bodies, push payloads.
  expect(leaks(await sinks(A))).toEqual([]);
  expect(prompts.length).toBe(3);
  expect(pushCalls).toHaveLength(1);

  // The account erasure empties all seven agent tables for A and not for B.
  expect(await hono.request("/api/account/data", asUser(A, "DELETE", {}))).toHaveProperty(
    "status",
    400,
  );
  const res = await hono.request("/api/account/data", asUser(A, "DELETE", { confirm: "ERASE" }));
  expect(res.status).toBe(200);
  const { erased } = (await res.json()) as { erased: { table: string }[] };
  const agentReported = erased
    .map((e) => e.table)
    .filter((t) => t.startsWith("personal.agent_"))
    .sort();
  expect(agentReported).toEqual(AGENT_TABLES.map((t) => `personal.${t}`).sort());
  expect(Object.values(await counts(A)).every((n) => n === 0)).toBe(true);
  expect(await snapshot(B)).toEqual(beforeB);
});

test("the idle-balance tip is the daily message, sent once, and nothing leaks", async () => {
  const { A, hono, repoA } = await setup();
  // No due date, so the deadline candidate does not outrank the tip.
  const cleared = await hono.request(
    "/api/agent/mirror",
    asUser(A, "PUT", { rules: [], dueDates: [], cardOffer: null }),
  );
  expect(cleared.status).toBe(204);
  bank = IDLE_BANK;
  const first = await (await cron()).json();
  const second = await (await cron()).json();
  expect(first).toMatchObject({ due: 1, results: { sent: 1 }, failed: 0 });
  expect(second).toMatchObject({ due: 0, failed: 0 });
  expect(bankFetches).toBe(1);
  const feed = await repoA.listEvents({ channel: "feed", limit: 10 });
  expect(feed).toHaveLength(1);
  expect(feed[0]!.body.text).toContain("Een deel van het geld op je betaalrekening");
  expect(feed[0]!.body.text).toContain("spaarrekening");
  expect(pushCalls).toHaveLength(1);
  expect(mails()).toHaveLength(1);
  expect(templates()).toHaveLength(1);
  expect(leaks(await sinks(A))).toEqual([]);
});

test("turning the agent off deletes all server-side agent state for A and leaves B alone", async () => {
  const { A, hono, beforeB, B } = await setup();
  await cron();
  expect(Object.values(await counts(A)).some((n) => n > 0)).toBe(true);
  expect(await userForPhone(db, phoneHash(`+${PHONE_DIGITS}`))).toBe(A);

  const off = await hono.request("/api/agent/settings", asUser(A, "PUT", { enabled: false }));
  expect(off.status).toBe(204);
  expect(await counts(A)).toEqual(Object.fromEntries(AGENT_TABLES.map((t) => [t, 0])));
  expect(await snapshot(B)).toEqual(beforeB);
  // The number is unlinked: the sender is unknown now, nothing is stored for A, nothing is sent.
  expect(await userForPhone(db, phoneHash(`+${PHONE_DIGITS}`))).toBeNull();
  const sentBefore = fetchCalls.length;
  expect((await inbound(hono, "Wat gaf ik uit dit jaar?")).status).toBe(200);
  expect((await counts(A)).agent_events).toBe(0);
  expect(await counts(A)).toEqual(Object.fromEntries(AGENT_TABLES.map((t) => [t, 0])));
  expect(fetchCalls.length).toBe(sentBefore);
  expect(prompts).toEqual([]);
});

test("two overlapping cron runs for A with all four channels send once per channel", async () => {
  const { A, repoA } = await setup();
  const [one, two] = await Promise.all([cron(), cron()]);
  expect(one.status).toBe(200);
  expect(two.status).toBe(200);
  expect(pushCalls).toHaveLength(1);
  expect(mails()).toHaveLength(1);
  expect(templates()).toHaveLength(1);
  expect(await repoA.listEvents({ channel: "feed", limit: 10 })).toHaveLength(1);
  expect(bankFetches).toBe(1);
  expect(A).toBeTruthy();
});

/* The detector has to be able to fail. Each test leaks the sentinel into exactly one
 * sink through the test fakes (product code is untouched) and expects the scan to
 * name that sink. */
test("scan finds nothing on a clean run", async () => {
  const { A } = await setup();
  await cron();
  expect(leaks(await sinks(A))).toEqual([]);
});

test("scan detects a leak in repository plaintext", async () => {
  const { A, repoA } = await setup();
  await repoA.putState({
    sentKeys: [{ key: `x ${IBAN.slice(0, 4)} ${IBAN.slice(4)}`, date: "2026-11-11" }],
  });
  expect(leaks(await sinks(A))).toContain("repository plaintext");
});

test("scan detects a leak in an event body", async () => {
  const { A, repoA } = await setup();
  await repoA.appendEvent({
    id: randomUUID(),
    channel: "feed",
    type: "message",
    body: { text: `Betaald aan ${SENTINEL.toLowerCase()}` },
  });
  expect(leaks(await sinks(A))).toContain("event body");
});

test("scan detects a leak in the console", async () => {
  const { A } = await setup();
  console.log(JSON.stringify({ event: "x", merchant: SENTINEL }));
  expect(leaks(await sinks(A))).toContain("console");
});

test("scan detects a leak in a model prompt", async () => {
  const { A, hono } = await setup();
  await inbound(hono, `Wat gaf ik uit aan ${SENTINEL}?`);
  expect(leaks(await sinks(A))).toContain("model prompt");
});

test("scan detects a leak in an outbound http body", async () => {
  const { A } = await setup();
  await fetch("https://graph.facebook.com/v21.0/pn-1/messages", {
    method: "POST",
    body: JSON.stringify({ text: { body: SENTINEL } }),
  });
  expect(leaks(await sinks(A))).toContain("outbound http body");
});

test("scan detects a leak in a push payload", async () => {
  const { A } = await setup();
  await instinctDeps().send.push(
    A,
    { title: "t", short: SENTINEL, long: SENTINEL, whatsappParams: [SENTINEL] } as never,
    {} as never,
    "e",
  );
  expect(leaks(await sinks(A))).toContain("push payload");
});

test("scan detects a leak in repository ciphertext (a plain parameter)", async () => {
  const { A } = await setup();
  await db.http.query("SELECT $1::text", [IBAN]);
  expect(leaks(await sinks(A))).toContain("repository ciphertext");
});

test("answerLinkedText: with the WhatsApp and Mistral env unset it sends nothing and does not throw", async () => {
  const { A } = await setup();
  const saved = { ...process.env };
  for (const k of ["WHATSAPP_PHONE_NUMBER_ID", "WHATSAPP_ACCESS_TOKEN", "MISTRAL_API_KEY"])
    delete process.env[k];
  const before = fetchCalls.length;
  try {
    await expect(
      answerLinkedText(db, A, {
        kind: "text",
        wamid: "w",
        from: PHONE_DIGITS,
        at: NOW,
        text: "Wat gaf ik uit?",
      }),
    ).resolves.toBeUndefined();
  } finally {
    Object.assign(process.env, saved);
  }
  expect(fetchCalls.length).toBe(before);
});

test("answerLinkedText: with the env set it reaches answerInbound and replies on the open window", async () => {
  const { A } = await setup();
  Object.assign(process.env, {
    WHATSAPP_PHONE_NUMBER_ID: "pn-1",
    WHATSAPP_ACCESS_TOKEN: "tok",
    MISTRAL_API_KEY: "mk",
  });
  vi.useFakeTimers({ toFake: ["Date"], now: NOW });
  const before = fetchCalls.length;
  try {
    await answerLinkedText(db, A, {
      kind: "text",
      wamid: "w2",
      from: PHONE_DIGITS,
      at: NOW,
      text: "Wat gaf ik uit?",
    });
  } finally {
    vi.useRealTimers();
    for (const k of ["WHATSAPP_PHONE_NUMBER_ID", "WHATSAPP_ACCESS_TOKEN", "MISTRAL_API_KEY"])
      delete process.env[k];
  }
  // Any calls reached the fakes only: the stubbed fetch saw the Mistral or Graph request.
  expect(fetchCalls.length).toBeGreaterThan(before);
});
