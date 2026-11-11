import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { RenderedMessage } from "@lavega/core";
import { sendPush } from "./pushChannel.js";

const msg: RenderedMessage = {
  title: "Je buffer is laag",
  short: "Buffer laag",
  long: "Lang bericht",
  whatsappParams: ["b"],
};
const sub = (n: number) => ({
  endpoint: `https://push.example/${n}`,
  keys: { p256dh: "p", auth: "a" },
});
const repoWith = (subs: ReturnType<typeof sub>[]) => ({
  listPush: vi.fn(async () => subs),
  deletePush: vi.fn(async () => undefined),
});

beforeEach(() => {
  process.env.VAPID_PUBLIC_KEY = "pub";
  process.env.VAPID_PRIVATE_KEY = "priv";
  process.env.VAPID_SUBJECT = "mailto:x@lavega.dev";
});
afterEach(() => {
  delete process.env.VAPID_PUBLIC_KEY;
  delete process.env.VAPID_PRIVATE_KEY;
  delete process.env.VAPID_SUBJECT;
});

test("one subscription gets one notification carrying only title and short text", async () => {
  const sendNotification = vi.fn(async () => ({}));
  const repo = repoWith([sub(1)]);
  expect(await sendPush("u", msg, repo, { webpush: { sendNotification } as never })).toBe("sent");
  expect(sendNotification).toHaveBeenCalledTimes(1);
  const [target, payload] = sendNotification.mock.calls[0] as unknown as [
    { endpoint: string },
    string,
  ];
  expect(target.endpoint).toBe("https://push.example/1");
  expect(JSON.parse(payload)).toEqual({ title: msg.title, body: msg.short, url: "/app" });
});

test("410 deletes that subscription and still reports sent when another succeeded", async () => {
  const sendNotification = vi.fn(async (s: { endpoint: string }) => {
    if (s.endpoint.endsWith("/1")) throw Object.assign(new Error("gone"), { statusCode: 410 });
    return {};
  });
  const repo = repoWith([sub(1), sub(2)]);
  expect(await sendPush("u", msg, repo, { webpush: { sendNotification } as never })).toBe("sent");
  expect(repo.deletePush).toHaveBeenCalledTimes(1);
  expect(repo.deletePush).toHaveBeenCalledWith("https://push.example/1");
});

test("a 500 keeps the subscription and fails", async () => {
  const sendNotification = vi.fn(async () => {
    throw Object.assign(new Error("x"), { statusCode: 500 });
  });
  const repo = repoWith([sub(1)]);
  expect(await sendPush("u", msg, repo, { webpush: { sendNotification } as never })).toBe("failed");
  expect(repo.deletePush).not.toHaveBeenCalled();
});

test("no subscription returns failed", async () => {
  const sendNotification = vi.fn();
  expect(await sendPush("u", msg, repoWith([]), { webpush: { sendNotification } as never })).toBe(
    "failed",
  );
  expect(sendNotification).not.toHaveBeenCalled();
});

test("missing VAPID variables return failed without sending", async () => {
  delete process.env.VAPID_PRIVATE_KEY;
  const sendNotification = vi.fn();
  const repo = repoWith([sub(1)]);
  expect(await sendPush("u", msg, repo, { webpush: { sendNotification } as never })).toBe("failed");
  expect(sendNotification).not.toHaveBeenCalled();
});

test("a failed send logs the event, the error name and the status, never endpoint or text (F9)", async () => {
  const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
  const sendNotification = vi.fn(async () => {
    throw Object.assign(new Error("https://push.example/1 Je buffer is laag"), {
      name: "WebPushError",
      statusCode: 500,
    });
  });
  const repo = repoWith([sub(1)]);
  expect(await sendPush("u", msg, repo, { webpush: { sendNotification } as never })).toBe("failed");
  const line = log.mock.calls.map((c) => String(c[0])).join("\n");
  expect(JSON.parse(line)).toEqual({
    event: "instinct.push_failed",
    kind: "WebPushError",
    status: 500,
  });
  for (const secret of ["push.example", "buffer", "p256", msg.long])
    expect(line).not.toContain(secret);
  log.mockRestore();
});
