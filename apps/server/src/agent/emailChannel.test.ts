import { afterEach, expect, test, vi } from "vitest";
import type { RenderedMessage } from "@lavega/core";
import { sendAgentEmail } from "./emailChannel.js";

const msg: RenderedMessage = {
  title: "Je buffer is laag",
  short: "Buffer laag",
  long: "Over 5 dagen zakt je saldo onder je buffer.",
  whatsappParams: ["Buffer laag"],
};

afterEach(() => {
  delete process.env.RESEND_API_KEY;
  delete process.env.AUTH_EMAIL_FROM;
  delete process.env.AGENT_EMAIL_FROM;
  vi.unstubAllGlobals();
});

test("posts one mail to Resend with the title as subject and the long text as body", async () => {
  process.env.RESEND_API_KEY = "re_test";
  process.env.AUTH_EMAIL_FROM = "LaVega <accounts@lavega.dev>";
  process.env.AGENT_EMAIL_FROM = "LaVega <meldingen@lavega.dev>";
  const fetchMock = vi.fn(async () => new Response("{}", { status: 200 }));
  vi.stubGlobal("fetch", fetchMock);
  expect(await sendAgentEmail("a@b.nl", msg, "nl", "https://www.lavega.dev/")).toBe("sent");
  expect(fetchMock).toHaveBeenCalledTimes(1);
  const body = JSON.parse(
    (fetchMock.mock.calls[0] as unknown as [string, { body: string }])[1].body,
  );
  expect(body.subject).toBe(msg.title);
  expect(body.from).toBe("LaVega <meldingen@lavega.dev>");
  expect(body.to).toEqual(["a@b.nl"]);
  expect(body.text).toContain(msg.long);
  expect(body.text).toContain("https://www.lavega.dev/app");
  expect(body.text).toBe(
    `${msg.long}\n\nWil je deze meldingen niet meer? Zet meldingen uit in je instellingen: https://www.lavega.dev/app`,
  );
});

test("falls back to the auth sender", async () => {
  process.env.RESEND_API_KEY = "re_test";
  process.env.AUTH_EMAIL_FROM = "LaVega <accounts@lavega.dev>";
  const fetchMock = vi.fn(async () => new Response("{}", { status: 200 }));
  vi.stubGlobal("fetch", fetchMock);
  await sendAgentEmail("a@b.nl", msg, "en", "https://x.dev");
  const body = JSON.parse(
    (fetchMock.mock.calls[0] as unknown as [string, { body: string }])[1].body,
  );
  expect(body.from).toBe("LaVega <accounts@lavega.dev>");
});

test("a missing key returns failed without throwing or calling out", async () => {
  const fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  expect(await sendAgentEmail("a@b.nl", msg, "nl", "https://x.dev")).toBe("failed");
  expect(fetchMock).not.toHaveBeenCalled();
});

test("a Resend error returns failed", async () => {
  process.env.RESEND_API_KEY = "re_test";
  process.env.AUTH_EMAIL_FROM = "a@b.dev";
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response("{}", { status: 500 })),
  );
  expect(await sendAgentEmail("a@b.nl", msg, "nl", "https://x.dev")).toBe("failed");
});

test("html escapes markup in the message", async () => {
  process.env.RESEND_API_KEY = "re_test";
  process.env.AUTH_EMAIL_FROM = "a@b.dev";
  const fetchMock = vi.fn(async () => new Response("{}", { status: 200 }));
  vi.stubGlobal("fetch", fetchMock);
  const evil = { ...msg, long: '<img src=x onerror=1> & "Albert Heijn"' };
  await sendAgentEmail("a@b.nl", evil, "en", "https://x.dev");
  const body = JSON.parse(
    (fetchMock.mock.calls[0] as unknown as [string, { body: string }])[1].body,
  );
  expect(body.html).not.toContain("<img");
  expect(body.html).toContain("&#60;img");
});

test("a failed send logs the event, the error name and the status, never address, subject or text (F9)", async () => {
  process.env.RESEND_API_KEY = "re_test";
  process.env.AUTH_EMAIL_FROM = "a@b.dev";
  const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () =>
        new Response(JSON.stringify({ message: "bad to someone@secret.nl" }), { status: 422 }),
    ),
  );
  expect(await sendAgentEmail("someone@secret.nl", msg, "nl", "https://x.dev")).toBe("failed");
  const line = log.mock.calls.map((c) => String(c[0])).join("\n");
  expect(JSON.parse(line)).toEqual({ event: "instinct.email_failed", kind: "Error", status: 422 });
  for (const secret of ["secret.nl", msg.title, msg.long]) expect(line).not.toContain(secret);
  log.mockRestore();
});
