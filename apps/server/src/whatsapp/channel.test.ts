import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { RenderedMessage } from "@lavega/core";
import { WhatsAppSendError } from "./client.js";
import { LINK_MAX_IDLE_DAYS, sendWhatsAppDaily } from "./channel.js";
import { WHATSAPP_COPY } from "./copy.js";

const msg: RenderedMessage = {
  title: "Titel",
  short: "Je gaf gisteren EUR 84 uit.",
  long: "Lang bericht met EUR 84",
  whatsappParams: ["Je gaf gisteren EUR 84 uit."],
};
const NUMBER = "+31612345678";

const repoWith = (
  link: { phone: string; linkedAt?: string; lastInboundAt?: string | null } | null,
) => ({
  getLink: vi.fn(
    async () =>
      link && {
        phone: link.phone,
        linkedAt: link.linkedAt ?? "2026-11-01T00:00:00.000Z",
        lastInboundAt: link.lastInboundAt ?? null,
        aiConsentAt: null,
      },
  ),
  unlink: vi.fn(async () => undefined),
  appendEvent: vi.fn(
    async (_event: { channel: string; dedupeKey?: string | readonly string[] }) =>
      "stored" as const,
  ),
});
const clientWith = (impl?: () => Promise<{ wamid: string }>) => ({
  sendTemplate: vi.fn(impl ?? (async () => ({ wamid: "wamid.1" }))),
  sendText: vi.fn(),
  sendButtons: vi.fn(),
});

beforeEach(() => {
  process.env.WHATSAPP_TEMPLATE_DAILY = "lavega_daily";
});
afterEach(() => {
  delete process.env.WHATSAPP_TEMPLATE_DAILY;
  vi.restoreAllMocks();
});

test("the template gets only the rendered short line and is stored by wamid", async () => {
  const repo = repoWith({ phone: NUMBER });
  const client = clientWith();
  expect(await sendWhatsAppDaily("u", msg, "nl", repo, { client })).toBe("sent");
  expect(client.sendTemplate).toHaveBeenCalledWith("31612345678", "lavega_daily", "nl", [
    "Je gaf gisteren EUR 84 uit.",
  ]);
  expect((client.sendTemplate.mock.calls[0] as unknown[])[3]).toBe(msg.whatsappParams);
  const event = repo.appendEvent.mock.calls[0]![0];
  expect(event.channel).toBe("whatsapp");
  expect(event.dedupeKey).toBe("wa-out:wamid.1");
});

test("an unlinked user fails and the client is never called", async () => {
  const client = clientWith();
  expect(await sendWhatsAppDaily("u", msg, "nl", repoWith(null), { client })).toBe("failed");
  expect(client.sendTemplate).not.toHaveBeenCalled();
});

test("no client or no template configured fails without throwing", async () => {
  const repo = repoWith({ phone: NUMBER });
  expect(await sendWhatsAppDaily("u", msg, "nl", repo, { client: null })).toBe("failed");
  delete process.env.WHATSAPP_TEMPLATE_DAILY;
  const client = clientWith();
  expect(await sendWhatsAppDaily("u", msg, "nl", repo, { client })).toBe("failed");
  expect(client.sendTemplate).not.toHaveBeenCalled();
});

test("a Meta error or unreadable link fails without throwing and logs no number", async () => {
  const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
  const err = vi.spyOn(console, "error").mockImplementation(() => undefined);
  const client = clientWith(async () => {
    throw new Error("boom");
  });
  expect(await sendWhatsAppDaily("u", msg, "nl", repoWith({ phone: NUMBER }), { client })).toBe(
    "failed",
  );
  const broken = { ...repoWith(null), getLink: vi.fn(async () => Promise.reject(new Error("x"))) };
  expect(await sendWhatsAppDaily("u", msg, "nl", broken, { client })).toBe("failed");
  expect(JSON.stringify([log.mock.calls, err.mock.calls])).not.toContain("3161234");
});

test("a failed event write after a sent template still counts as sent", async () => {
  const repo = repoWith({ phone: NUMBER });
  repo.appendEvent.mockRejectedValueOnce(new Error("db"));
  expect(await sendWhatsAppDaily("u", msg, "nl", repo, { client: clientWith() })).toBe("sent");
});

test("a 400 from the client is logged with its status only", async () => {
  const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
  const client = clientWith(async () => {
    throw new WhatsAppSendError(400);
  });
  expect(await sendWhatsAppDaily("u", msg, "nl", repoWith({ phone: NUMBER }), { client })).toBe(
    "failed",
  );
  const line = JSON.stringify(log.mock.calls);
  expect(line).toContain("instinct.whatsapp_failed");
  expect(line).toContain("WhatsAppSendError");
  expect(line).toContain("400");
  expect(line).not.toContain("31612345678");
  expect(line).not.toContain("EUR 84");
});

/* W4(a): a link that saw no message from the user for 90 days may belong to a recycled number. */
const NOW = Date.parse("2026-11-11T09:00:00.000Z");
const ago = (days: number) => new Date(NOW - days * 86_400_000).toISOString();

test("the idle limit is 90 days", () => {
  expect(LINK_MAX_IDLE_DAYS).toBe(90);
});

test("91 days idle: no template call, the link is removed, one feed event, 'failed' returned", async () => {
  const repo = repoWith({ phone: NUMBER, linkedAt: ago(200), lastInboundAt: ago(91) });
  const client = clientWith();
  expect(await sendWhatsAppDaily("u", msg, "nl", repo, { client, now: () => NOW })).toBe("failed");
  expect(client.sendTemplate).not.toHaveBeenCalled();
  expect(repo.unlink).toHaveBeenCalledTimes(1);
  expect(repo.appendEvent).toHaveBeenCalledTimes(1);
  const event = repo.appendEvent.mock.calls[0]![0] as {
    channel: string;
    type: string;
    body: { text: string };
    dedupeKey: unknown;
  };
  expect(event).toMatchObject({ channel: "feed", type: "message" });
  expect(event.body.text).toBe(WHATSAPP_COPY.nl.linkExpired);
  expect(WHATSAPP_COPY.nl.linkExpired).toBe(
    "Je WhatsApp-koppeling is verlopen omdat je 90 dagen niets stuurde. Koppel opnieuw in Meldingen.",
  );
  expect(event.dedupeKey).toBeTruthy();
  expect(JSON.stringify(event)).not.toContain("3161234");
});

test("the expiry notice follows the user's language", async () => {
  const repo = repoWith({ phone: NUMBER, linkedAt: ago(120) });
  await sendWhatsAppDaily("u", msg, "en", repo, { client: clientWith(), now: () => NOW });
  expect(
    (repo.appendEvent.mock.calls[0]![0] as unknown as { body: { text: string } }).body.text,
  ).toBe("Your WhatsApp link expired because you sent nothing for 90 days. Link again in Alerts.");
});

test("89 days idle is still sent; a never-answered link counts from linked_at", async () => {
  const fresh = repoWith({ phone: NUMBER, linkedAt: ago(200), lastInboundAt: ago(89) });
  expect(
    await sendWhatsAppDaily("u", msg, "nl", fresh, { client: clientWith(), now: () => NOW }),
  ).toBe("sent");
  expect(fresh.unlink).not.toHaveBeenCalled();
  const neverAnswered = repoWith({ phone: NUMBER, linkedAt: ago(89), lastInboundAt: null });
  expect(
    await sendWhatsAppDaily("u", msg, "nl", neverAnswered, {
      client: clientWith(),
      now: () => NOW,
    }),
  ).toBe("sent");
  const stale = repoWith({ phone: NUMBER, linkedAt: ago(91), lastInboundAt: null });
  const client = clientWith();
  expect(await sendWhatsAppDaily("u", msg, "nl", stale, { client, now: () => NOW })).toBe("failed");
  expect(client.sendTemplate).not.toHaveBeenCalled();
});

test("an inbound message refreshes the clock: the later of linked_at and last inbound counts", async () => {
  const repo = repoWith({ phone: NUMBER, linkedAt: ago(300), lastInboundAt: ago(2) });
  expect(
    await sendWhatsAppDaily("u", msg, "nl", repo, { client: clientWith(), now: () => NOW }),
  ).toBe("sent");
  expect(repo.unlink).not.toHaveBeenCalled();
});

test("a failing unlink still sends nothing and returns failed", async () => {
  const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
  const repo = repoWith({ phone: NUMBER, linkedAt: ago(200) });
  repo.unlink.mockRejectedValueOnce(
    Object.assign(new Error("db 31612345678"), { name: "PgError" }),
  );
  const client = clientWith();
  expect(await sendWhatsAppDaily("u", msg, "nl", repo, { client, now: () => NOW })).toBe("failed");
  expect(client.sendTemplate).not.toHaveBeenCalled();
  expect(JSON.stringify(log.mock.calls)).not.toContain("3161234");
});
