import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import { createAgentRepository, userForPhone, phoneHash, type Database } from "@lavega/database";
import { migratedTestDatabase } from "@lavega/database/testing";
import { afterAll, beforeAll, beforeEach, expect, test, vi } from "vitest";
import { registerInstinctRoutes } from "../instinct-routes.js";
import { createRateLimiter } from "../agent/rateLimit.js";
import type { WhatsAppClient } from "./client.js";
import { handleUnlinked, maskPhone } from "./linking.js";
import { registerWhatsappWebhook, whatsappWebhookDependencies } from "./webhook.js";
import { createHmac } from "node:crypto";

let pglite: Awaited<ReturnType<typeof migratedTestDatabase>>["pglite"];
let db: Database;

beforeAll(async () => {
  process.env.LAVEGA_ENCRYPTION_KEY = "22".repeat(32);
  process.env.AGENT_DEDUPE_HMAC_KEY = "33".repeat(32);
  process.env.AGENT_PHONE_HMAC_KEY = "44".repeat(32);
  process.env.WHATSAPP_APP_SECRET = "app-secret";
  ({ pglite, db } = await migratedTestDatabase());
}, 60_000);
afterAll(async () => {
  await pglite.close();
});
beforeEach(async () => {
  await pglite.exec("RESET ROLE;");
  for (const t of ["whatsapp", "link_codes", "link_attempts", "events", "settings"])
    await pglite.exec(`DELETE FROM personal.agent_${t};`);
  await pglite.exec("SELECT set_config('app.user_id', '', false); SET ROLE lavega_runtime;");
});

const A = randomUUID();
const B = randomUUID();
const FROM_A = "31612345678";
const FROM_B = "31687654321";
const sendText = vi.fn<WhatsAppClient["sendText"]>(async () => ({ wamid: "out" }));
const client = { sendText } as unknown as WhatsAppClient;
const text = (from: string, body: string) => ({
  wamid: randomUUID(),
  from,
  at: Date.now(),
  kind: "text" as const,
  text: body,
});
const handle = (from: string, body: string, limiter = createRateLimiter(50, 60_000)) =>
  handleUnlinked(db, text(from, body), { client, limiter });
const enable = (user: string) =>
  createAgentRepository(db, user).putSettings({
    enabled: true,
    channels: ["feed"],
    sendHour: 8,
    locale: "nl",
    email: null,
    consentVersion: "x",
    consentedAt: "2026-11-10T00:00:00.000Z",
  });

/** A code is only issued while the agent is on. */
async function newCode(user: string): Promise<{ code: string; expiresAt: string }> {
  await enable(user);
  const made = await createAgentRepository(db, user).createLinkCode();
  if (made === "skipped") throw new Error("test setup: agent is off");
  return made;
}

beforeEach(() => sendText.mockClear());

test("a valid code (trimmed, any case) links the number and replies once", async () => {
  const { code } = await newCode(A);
  expect(await handle(FROM_A, `  ${code.toLowerCase()} \n`)).toBe("linked");
  expect(await userForPhone(db, phoneHash(`+${FROM_A}`))).toBe(A);
  expect(sendText).toHaveBeenCalledTimes(1);
  expect(sendText.mock.calls[0]![1]).toBe(
    "Gekoppeld. Ik stuur je voortaan hier je dagelijkse bericht.",
  );
  /* The number is stored sealed, never as text. */
  await pglite.exec("RESET ROLE;");
  const raw = await pglite.query<{ phone_blob: Uint8Array }>(
    "SELECT phone_blob FROM personal.agent_whatsapp",
  );
  await pglite.exec("SET ROLE lavega_runtime;");
  expect(Buffer.from(raw.rows[0]!.phone_blob).includes(Buffer.from(FROM_A))).toBe(false);
  expect((await createAgentRepository(db, A).getLink())?.phone).toBe(`+${FROM_A}`);
});

test("a wrong or expired code gives no link and no reply", async () => {
  expect(await handle(FROM_A, "LV-AAAAAAAA")).toBe("ignored");
  const { code } = await newCode(A);
  await pglite.exec("RESET ROLE;");
  await pglite.exec(
    "UPDATE personal.agent_link_codes SET expires_at = CURRENT_TIMESTAMP - INTERVAL '1 second'",
  );
  await pglite.exec("SET ROLE lavega_runtime;");
  expect(await handle(FROM_A, code)).toBe("ignored");
  expect(await userForPhone(db, phoneHash(`+${FROM_A}`))).toBeNull();
  expect(sendText).not.toHaveBeenCalled();
});

test("an unknown number saying hallo gets no reply", async () => {
  expect(await handle(FROM_A, "hallo")).toBe("ignored");
  expect(await handle(FROM_A, "LV-ABCDE")).toBe("ignored");
  expect(await handle(FROM_A, "LV-ABCDEFG")).toBe("ignored");
  expect(await handle(FROM_A, "LV-ABCDEFGHJ")).toBe("ignored");
  expect(sendText).not.toHaveBeenCalled();
});

test("a code is single use and a second number cannot reuse it", async () => {
  const { code } = await newCode(A);
  expect(await handle(FROM_A, code)).toBe("linked");
  sendText.mockClear();
  expect(await handle(FROM_B, code)).toBe("ignored");
  expect(await userForPhone(db, phoneHash(`+${FROM_B}`))).toBeNull();
  expect(sendText).not.toHaveBeenCalled();
});

test("a phone already linked to another user gets no reply and no link", async () => {
  const first = await newCode(A);
  await handle(FROM_A, first.code);
  sendText.mockClear();
  const second = await newCode(B);
  expect(await handle(FROM_A, second.code)).toBe("ignored");
  expect(await userForPhone(db, phoneHash(`+${FROM_A}`))).toBe(A);
  expect(sendText).not.toHaveBeenCalled();
});

test("attempts are rate limited per phone hash before the code is consumed", async () => {
  const limiter = createRateLimiter(3, 60_000);
  for (let i = 0; i < 3; i++) await handle(FROM_A, "LV-AAAAAAAA", limiter);
  const { code } = await newCode(A);
  /* The right code, but over the limit: ignored, and the code is still there. */
  expect(await handle(FROM_A, code, limiter)).toBe("ignored");
  expect(await userForPhone(db, phoneHash(`+${FROM_A}`))).toBeNull();
  expect(await handle(FROM_B, code, limiter)).toBe("linked");
});

test("a failing confirmation does not undo the link", async () => {
  sendText.mockRejectedValueOnce(new Error("down"));
  const { code } = await newCode(A);
  expect(await handle(FROM_A, code)).toBe("linked");
  expect(await userForPhone(db, phoneHash(`+${FROM_A}`))).toBe(A);
});

test("F1: five wrong codes from one number block its right code even with a fresh in-memory limiter each time", async () => {
  const { code } = await newCode(A);
  for (let i = 0; i < 5; i++) await handle(FROM_A, "LV-AAAAAAAA", createRateLimiter(50, 60_000));
  expect(await handle(FROM_A, code, createRateLimiter(50, 60_000))).toBe("ignored");
  expect(await userForPhone(db, phoneHash(`+${FROM_A}`))).toBeNull();
  expect(sendText).not.toHaveBeenCalled();
});

test("F2: chatter from an unknown number does not spend the code budget", async () => {
  const { code } = await newCode(A);
  const limiter = createRateLimiter(5, 60_000);
  for (let i = 0; i < 12; i++) expect(await handle(FROM_A, "hi", limiter)).toBe("ignored");
  expect(await handle(FROM_A, code, limiter)).toBe("linked");
  await pglite.exec("RESET ROLE;");
  const n = await pglite.query("SELECT 1 FROM personal.agent_link_attempts");
  await pglite.exec("SET ROLE lavega_runtime;");
  expect(n.rows).toHaveLength(0);
});

test("F2: chatter has its own looser cap", async () => {
  const { code } = await newCode(A);
  const results = [];
  for (let i = 0; i < 200; i++) results.push(await handle(FROM_A, "spam"));
  expect(results.every((r) => r === "ignored")).toBe(true);
  expect(sendText).not.toHaveBeenCalled();
  expect(code).toBeTruthy();
});

/* Routes and the webhook, end to end on the real repository. */
const routes = new Hono();
registerInstinctRoutes(routes, {
  tenantId: async (r) => r.headers.get("x-user"),
  repository: (t) => createAgentRepository(db, t),
  bankConnected: async () => true,
});
const call = (user: string | null, method: string, path: string, body?: unknown) =>
  routes.request(path, {
    method,
    headers: {
      ...(user ? { "x-user": user } : {}),
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

test("link-code, settings (masked number) and unlink routes", async () => {
  process.env.WHATSAPP_NUMBER_DISPLAY = "+31 6 1111 1111";
  expect((await call(null, "POST", "/api/agent/whatsapp/link-code")).status).toBe(401);
  expect((await call(A, "POST", "/api/agent/whatsapp/link-code")).status).toBe(409);
  await enable(A);
  expect((await call(A, "POST", "/api/agent/whatsapp/link-code")).status).toBe(400);
  const made = await call(A, "POST", "/api/agent/whatsapp/link-code", { aiConsent: true });
  expect(made.status).toBe(200);
  const { code, number } = (await made.json()) as { code: string; number: string };
  expect(code).toMatch(/^LV-[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{8}$/);
  expect(number).toBe("+31 6 1111 1111");

  expect(await (await call(A, "GET", "/api/agent/whatsapp")).json()).toMatchObject({
    linked: false,
    phone: null,
  });
  await handle(FROM_A, code);
  const body = await (await call(A, "GET", "/api/agent/whatsapp")).text();
  expect(JSON.parse(body)).toMatchObject({ linked: true, phone: "+•••••••••78" });
  expect(body).not.toContain("3161234");
  expect((await call(B, "GET", "/api/agent/whatsapp")).status).toBe(200);
  expect(await (await call(B, "GET", "/api/agent/whatsapp")).json()).toMatchObject({
    linked: false,
  });

  expect((await call(A, "DELETE", "/api/agent/whatsapp")).status).toBe(204);
  expect(await userForPhone(db, phoneHash(`+${FROM_A}`))).toBeNull();
});

test("after unlink, later messages from that number are ignored (no event stored)", async () => {
  const { code } = await newCode(A);
  await handle(FROM_A, code);
  await call(A, "DELETE", "/api/agent/whatsapp");
  await pglite.exec("RESET ROLE; DELETE FROM personal.agent_events; SET ROLE lavega_runtime;");
  sendText.mockClear();

  const app = new Hono();
  const deps = whatsappWebhookDependencies(() => db);
  deps.unlinked = (inbound) =>
    handleUnlinked(db, inbound, { client, limiter: createRateLimiter(50, 60_000) });
  registerWhatsappWebhook(app, deps);
  const body = JSON.stringify({
    entry: [
      {
        changes: [
          {
            value: {
              messages: [
                {
                  id: "wamid.9",
                  from: FROM_A,
                  timestamp: "1700000000",
                  type: "text",
                  text: { body: "hoi" },
                },
              ],
            },
          },
        ],
      },
    ],
  });
  const res = await app.request("/api/whatsapp/webhook", {
    method: "POST",
    headers: {
      "x-hub-signature-256": `sha256=${createHmac("sha256", "app-secret").update(body).digest("hex")}`,
    },
    body,
  });
  expect(res.status).toBe(200);
  expect(sendText).not.toHaveBeenCalled();
  expect(await createAgentRepository(db, A).listEvents({ limit: 10 })).toEqual([]);
});

test("maskPhone keeps only the last two digits", () => {
  expect(maskPhone("+31612345678")).toBe("+•••••••••78");
});

test("a 6-character LV- string is no longer code-shaped: ignored, no code budget spent (W4)", async () => {
  const limiter = createRateLimiter(1, 60_000);
  const { code } = await newCode(A);
  for (let i = 0; i < 10; i++) expect(await handle(FROM_A, "LV-ABC234", limiter)).toBe("ignored");
  // The one-per-window limiter is still unspent: the real code goes through.
  expect(await handle(FROM_A, code, limiter)).toBe("linked");
  await pglite.exec("RESET ROLE;");
  const n = await pglite.query("SELECT 1 FROM personal.agent_link_attempts");
  await pglite.exec("SET ROLE lavega_runtime;");
  expect(n.rows).toHaveLength(0);
});

test("1000 failed attempts from other numbers do not stop a fresh number from linking (W4)", async () => {
  await pglite.exec(`RESET ROLE;
    INSERT INTO personal.agent_link_attempts (phone_hash)
      SELECT 'other' || g FROM generate_series(1, 1000) g;
    SET ROLE lavega_runtime;`);
  const { code } = await newCode(A);
  expect(await handle(FROM_B, code)).toBe("linked");
  expect(await userForPhone(db, phoneHash(`+${FROM_B}`))).toBe(A);
});

test("a code made before the agent was turned off does not link a phone (W1)", async () => {
  const { code } = await newCode(A);
  await call(A, "PUT", "/api/agent/settings", { enabled: false });
  expect(await handle(FROM_A, code)).toBe("ignored");
  expect(await userForPhone(db, phoneHash(`+${FROM_A}`))).toBeNull();
  expect(sendText).not.toHaveBeenCalled();
});

test("an inbound from a linked number whose settings row is gone stores no event, sends nothing, calls no model (W1)", async () => {
  const { code } = await newCode(A);
  expect(await handle(FROM_A, code)).toBe("linked");
  await pglite.exec(
    "RESET ROLE; DELETE FROM personal.agent_events; DELETE FROM personal.agent_settings; SET ROLE lavega_runtime;",
  );
  sendText.mockClear();
  const onLinked = vi.fn(async () => undefined);
  const app = new Hono();
  const deps = whatsappWebhookDependencies(() => db);
  deps.onLinked = onLinked;
  registerWhatsappWebhook(app, deps);
  const body = JSON.stringify({
    entry: [
      {
        changes: [
          {
            value: {
              messages: [
                {
                  id: "wamid.gone",
                  from: FROM_A,
                  timestamp: "1700000000",
                  type: "text",
                  text: { body: "wat gaf ik uit?" },
                },
              ],
            },
          },
        ],
      },
    ],
  });
  const res = await app.request("/api/whatsapp/webhook", {
    method: "POST",
    headers: {
      "x-hub-signature-256": `sha256=${createHmac("sha256", "app-secret").update(body).digest("hex")}`,
    },
    body,
  });
  expect(res.status).toBe(200);
  expect(onLinked).not.toHaveBeenCalled();
  expect(sendText).not.toHaveBeenCalled();
  await pglite.exec("RESET ROLE;");
  const events = await pglite.query("SELECT 1 FROM personal.agent_events");
  await pglite.exec("SET ROLE lavega_runtime;");
  expect(events.rows).toHaveLength(0);
});
