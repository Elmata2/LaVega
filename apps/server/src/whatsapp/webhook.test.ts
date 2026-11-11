import { createHmac } from "node:crypto";
import { Hono } from "hono";
import { beforeEach, expect, test, vi } from "vitest";
import {
  parseInbound,
  registerWhatsappWebhook,
  verifySignature,
  type WebhookDeps,
} from "./webhook.js";

const SECRET = "app-secret";
const sign = (body: string, secret = SECRET) =>
  `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;

const payload = (messages: unknown[]) =>
  JSON.stringify({ entry: [{ changes: [{ value: { messages } }] }] });
const text = (id: string, body = "hallo", from = "31612345678") => ({
  id,
  from,
  timestamp: "1700000000",
  type: "text",
  text: { body },
});

process.env.AGENT_PHONE_HMAC_KEY = "44".repeat(32);

const repo = {
  appendEvent: vi.fn(),
  touchInbound: vi.fn(),
};
const seen = new Set<string>();
const deps = {
  appSecret: vi.fn<() => string | undefined>(),
  verifyToken: vi.fn<() => string | undefined>(),
  lookup: vi.fn<WebhookDeps["lookup"]>(),
  repository: vi.fn(() => repo as never),
  unlinked: vi.fn<WebhookDeps["unlinked"]>(),
  onLinked: undefined as WebhookDeps["onLinked"],
};
const app = new Hono();
registerWhatsappWebhook(app, deps as WebhookDeps);

const post = (body: string, signature: string | null) =>
  app.request("/api/whatsapp/webhook", {
    method: "POST",
    headers: signature === null ? {} : { "x-hub-signature-256": signature },
    body,
  });

beforeEach(() => {
  vi.clearAllMocks();
  seen.clear();
  deps.appSecret.mockReturnValue(SECRET);
  deps.verifyToken.mockReturnValue("verify-me");
  deps.lookup.mockResolvedValue("user-1");
  deps.unlinked.mockResolvedValue("ignored");
  repo.appendEvent.mockImplementation(async (e: { dedupeKey: string }) =>
    seen.has(e.dedupeKey) ? "duplicate" : (seen.add(e.dedupeKey), "stored"),
  );
});

const untouched = () => {
  expect(deps.lookup).not.toHaveBeenCalled();
  expect(deps.repository).not.toHaveBeenCalled();
  expect(deps.unlinked).not.toHaveBeenCalled();
  expect(repo.appendEvent).not.toHaveBeenCalled();
};

test("verifySignature accepts the right HMAC and rejects a flipped byte, missing header, wrong prefix and length", () => {
  const body = payload([text("a")]);
  expect(verifySignature(body, sign(body), SECRET)).toBe(true);
  expect(verifySignature(body + " ", sign(body), SECRET)).toBe(false);
  const bad = sign(body).replace(/.$/, (c) => (c === "0" ? "1" : "0"));
  expect(verifySignature(body, bad, SECRET)).toBe(false);
  expect(verifySignature(body, null, SECRET)).toBe(false);
  expect(verifySignature(body, sign(body).slice("sha256=".length), SECRET)).toBe(false);
  expect(verifySignature(body, "sha256=abcd", SECRET)).toBe(false);
  expect(verifySignature(body, sign(body), "")).toBe(false);
});

test("a bad or missing signature is 401 with an empty body and zero repository calls", async () => {
  const body = payload([text("a")]);
  for (const signature of [null, sign(body, "other"), sign(body).slice(0, -2)]) {
    const res = await post(body, signature);
    expect(res.status).toBe(401);
    expect(await res.text()).toBe("");
  }
  untouched();
});

test("without WHATSAPP_APP_SECRET every POST is rejected, even a validly shaped one", async () => {
  deps.appSecret.mockReturnValue(undefined);
  const body = payload([text("a")]);
  const res = await post(body, sign(body, ""));
  expect(res.status).toBe(401);
  untouched();
});

test("a valid signature on invalid JSON is 200 and does nothing", async () => {
  const res = await post("{nope", sign("{nope"));
  expect(res.status).toBe(200);
  untouched();
});

test("a signed text from a linked number is stored once with a wa:<wamid> key and stamps the window", async () => {
  const body = payload([text("wamid.1", "wat is mijn saldo")]);
  expect((await post(body, sign(body))).status).toBe(200);
  expect(deps.repository).toHaveBeenCalledWith("user-1");
  expect(repo.appendEvent).toHaveBeenCalledWith(
    expect.objectContaining({
      channel: "whatsapp",
      type: "message",
      dedupeKey: "wa:wamid.1",
      body: { text: "wat is mijn saldo", meta: { direction: "in" } },
    }),
  );
  expect(repo.touchInbound).toHaveBeenCalledWith("2023-11-14T22:13:20.000Z");
});

test("a replayed wamid is handled once", async () => {
  const body = payload([text("wamid.2")]);
  const onLinked = vi.fn(async () => undefined);
  deps.onLinked = onLinked;
  await post(body, sign(body));
  await post(body, sign(body));
  deps.onLinked = undefined;
  expect(repo.appendEvent).toHaveBeenCalledTimes(2);
  expect(seen.size).toBe(1);
  expect(onLinked).toHaveBeenCalledTimes(1);
});

test("an unknown sender gets 200 and its text goes to the unlinked handler only", async () => {
  deps.lookup.mockResolvedValue(null);
  const body = payload([text("wamid.3", "LV-ABC234")]);
  const res = await post(body, sign(body));
  expect(res.status).toBe(200);
  expect(deps.unlinked).toHaveBeenCalledWith(
    expect.objectContaining({ kind: "text", text: "LV-ABC234", from: "31612345678" }),
  );
  expect(repo.appendEvent).not.toHaveBeenCalled();
});

test("a database failure on a signed POST is 500 with an empty body and logs only the error name", async () => {
  const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
  deps.lookup.mockRejectedValue(new Error("boom 31612345678 geheim"));
  const body = payload([text("wamid.4", "geheim")]);
  const res = await post(body, sign(body));
  expect(res.status).toBe(500);
  expect(await res.text()).toBe("");
  const logged = log.mock.calls.flat().join(" ");
  expect(logged).not.toContain("31612345678");
  expect(logged).not.toContain("geheim");
  log.mockRestore();
});

test("a failing appendEvent or touchInbound is also 500", async () => {
  const body = payload([text("wamid.5")]);
  repo.appendEvent.mockRejectedValueOnce(new Error("db"));
  expect((await post(body, sign(body))).status).toBe(500);
  repo.touchInbound.mockRejectedValueOnce(new Error("db"));
  const body2 = payload([text("wamid.6")]);
  expect((await post(body2, sign(body2))).status).toBe(500);
});

test("touchInbound runs before appendEvent, so a failed touch leaves no dedupe key blocking the retry", async () => {
  const body = payload([text("wamid.7")]);
  repo.touchInbound.mockRejectedValueOnce(new Error("db"));
  expect((await post(body, sign(body))).status).toBe(500);
  expect(repo.appendEvent).not.toHaveBeenCalled();
  expect((await post(body, sign(body))).status).toBe(200);
  expect(repo.appendEvent).toHaveBeenCalledTimes(1);
  expect(repo.touchInbound.mock.invocationCallOrder[1]!).toBeLessThan(
    repo.appendEvent.mock.invocationCallOrder[0]!,
  );
});

test("sender-side problems (unknown sender, ignored kinds, bad entries) stay 200", async () => {
  deps.lookup.mockResolvedValue(null);
  const body = payload([
    { id: "i", from: "316", type: "image" },
    { nonsense: 1 },
    text("w9", "hi"),
  ]);
  expect((await post(body, sign(body))).status).toBe(200);
});

test("a chunked body over the cap is 413 and touches nothing, without a content-length", async () => {
  const chunk = new Uint8Array(64 * 1024).fill(120);
  let sentChunks = 0;
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      sentChunks++;
      if (sentChunks > 100) controller.close();
      else controller.enqueue(chunk);
    },
  });
  const res = await app.request("/api/whatsapp/webhook", {
    method: "POST",
    headers: { "x-hub-signature-256": "sha256=00" },
    body: stream,
    duplex: "half",
  } as RequestInit);
  expect(res.status).toBe(413);
  expect(sentChunks).toBeLessThan(20);
  untouched();
});

test("an oversized body is refused before it is verified", async () => {
  const body = "x".repeat(300 * 1024);
  expect((await post(body, sign(body))).status).toBe(413);
  untouched();
});

test("GET echoes hub.challenge only with the right token", async () => {
  const get = (q: string) => app.request(`/api/whatsapp/webhook?${q}`);
  const good = await get("hub.mode=subscribe&hub.verify_token=verify-me&hub.challenge=12345");
  expect(good.status).toBe(200);
  expect(await good.text()).toBe("12345");
  for (const q of [
    "hub.mode=subscribe&hub.verify_token=nope&hub.challenge=12345",
    "hub.mode=subscribe&hub.challenge=12345",
    "hub.mode=subscribe&hub.verify_token=verify-me",
  ]) {
    const res = await get(q);
    expect(res.status).toBe(403);
    expect(await res.text()).toBe("");
  }
  deps.verifyToken.mockReturnValue(undefined);
  expect((await get("hub.mode=subscribe&hub.verify_token=&hub.challenge=1")).status).toBe(403);
});

test("parseInbound reads text, button and interactive replies and ignores the rest", () => {
  const parsed = parseInbound(
    JSON.parse(
      payload([
        text("t1"),
        {
          id: "b1",
          from: "316",
          timestamp: "1700000000",
          type: "button",
          button: { payload: "yes" },
        },
        {
          id: "b2",
          from: "316",
          timestamp: "1700000000",
          type: "interactive",
          interactive: { button_reply: { id: "no", title: "Nee" } },
        },
        { id: "i1", from: "316", timestamp: "1700000000", type: "image" },
        { nonsense: true },
      ]),
    ),
  );
  expect(parsed).toEqual([
    { wamid: "t1", from: "31612345678", at: 1700000000000, kind: "text", text: "hallo" },
    { wamid: "b1", from: "316", at: 1700000000000, kind: "button", buttonId: "yes" },
    { wamid: "b2", from: "316", at: 1700000000000, kind: "button", buttonId: "no" },
    { kind: "ignored" },
    { kind: "ignored" },
  ]);
  expect(parseInbound({ entry: [{ changes: [{ value: { statuses: [{}] } }] }] })).toEqual([]);
  expect(parseInbound("junk")).toEqual([]);
});

const button = (id: string, buttonId: string, from = "31612345678") => ({
  id,
  from,
  timestamp: "1700000000",
  type: "interactive",
  interactive: { button_reply: { id: buttonId, title: "x" } },
});

test("an approve button is stored as approval_response with caseId and answer, stamps the window, and reaches onLinked", async () => {
  const onLinked = vi.fn(async () => undefined);
  deps.onLinked = onLinked;
  const body = payload([button("wamid.b1", "approve:case_1-A")]);
  expect((await post(body, sign(body))).status).toBe(200);
  expect(repo.touchInbound).toHaveBeenCalledWith("2023-11-14T22:13:20.000Z");
  expect(repo.appendEvent).toHaveBeenCalledWith(
    expect.objectContaining({
      channel: "whatsapp",
      type: "approval_response",
      dedupeKey: "wa:wamid.b1",
      body: {
        text: "approve:case_1-A",
        meta: { direction: "in", caseId: "case_1-A", answer: "approve" },
      },
    }),
  );
  expect(onLinked).toHaveBeenCalledTimes(1);
  deps.onLinked = undefined;
});

test("a reject button is stored with answer reject", async () => {
  const body = payload([button("wamid.b2", "reject:abc")]);
  await post(body, sign(body));
  expect(repo.appendEvent).toHaveBeenCalledWith(
    expect.objectContaining({
      type: "approval_response",
      body: expect.objectContaining({ meta: expect.objectContaining({ answer: "reject" }) }),
    }),
  );
});

test.each([
  "yes",
  "approve:",
  "approve:a b",
  "approve:../x",
  `approve:${"a".repeat(65)}`,
  "delete:abc",
  "approve:a:b",
])("button id %j is ignored: nothing stored, no reply", async (id) => {
  const onLinked = vi.fn(async () => undefined);
  deps.onLinked = onLinked;
  const body = payload([button("wamid.bx", id)]);
  expect((await post(body, sign(body))).status).toBe(200);
  expect(repo.appendEvent).not.toHaveBeenCalled();
  expect(onLinked).not.toHaveBeenCalled();
  deps.onLinked = undefined;
});

test("an inbound for a linked number whose agent is off is not answered and stores nothing (W1)", async () => {
  const onLinked = vi.fn(async () => undefined);
  deps.onLinked = onLinked;
  repo.appendEvent.mockResolvedValue("skipped");
  const body = payload([text("wamid.off", "wat is mijn saldo")]);
  expect((await post(body, sign(body))).status).toBe(200);
  deps.onLinked = undefined;
  expect(onLinked).not.toHaveBeenCalled();
});
