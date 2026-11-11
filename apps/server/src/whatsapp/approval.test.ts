import { expect, test, vi } from "vitest";
import { answerApprovalButton, parseApprovalButton } from "./approval.js";
import { WindowClosedError, type WhatsAppClient } from "./client.js";
import { WHATSAPP_COPY } from "./copy.js";

const NOW = Date.parse("2026-11-11T09:00:00Z");
const HOUR = 3_600_000;

function setup(lastInboundAt: string | null, locale: "nl" | "en" = "nl") {
  const events: { type: string; body: { text: string }; dedupeKey?: string }[] = [];
  const sentTexts: string[] = [];
  const llm = vi.fn();
  const client = {
    sendText: vi.fn(async (_to: string, text: string, open: number | null, now: number) => {
      if (open === null || now - open >= 24 * HOUR) throw new WindowClosedError();
      sentTexts.push(text);
      return { wamid: "wamid.out" };
    }),
  } as unknown as WhatsAppClient;
  const repo = {
    getSettings: vi.fn(async () => ({ locale }) as never),
    getLink: vi.fn(async () => ({
      phone: "+31612345678",
      linkedAt: "x",
      lastInboundAt,
      aiConsentAt: null,
    })),
    appendEvent: vi.fn(async (e: never) => (events.push(e), "stored" as const)),
  };
  return { repo, client, events, sentTexts, llm };
}

test("parseApprovalButton accepts only approve|reject:<caseId>", () => {
  expect(parseApprovalButton("approve:abc_1-X")).toEqual({ caseId: "abc_1-X", answer: "approve" });
  expect(parseApprovalButton("reject:abc")).toEqual({ caseId: "abc", answer: "reject" });
  for (const bad of [
    "approve",
    "approve:",
    "x:abc",
    "approve:a b",
    "approve:a:b",
    "approve:" + "a".repeat(65),
  ])
    expect(parseApprovalButton(bad)).toBeNull();
});

test("a button answer sends the fixed NL sentence and calls no tool, bank or model", async () => {
  const s = setup(new Date(NOW - HOUR).toISOString());
  await answerApprovalButton({ repo: s.repo, client: s.client, now: () => NOW });
  expect(s.sentTexts).toEqual(["Annuleren is nog niet beschikbaar."]);
  expect(s.repo.appendEvent).toHaveBeenCalledTimes(1);
  expect(s.events[0]).toMatchObject({ type: "message", dedupeKey: "wa-out:wamid.out" });
  expect(s.llm).not.toHaveBeenCalled();
});

test("the EN sentence is used for an English user", async () => {
  const s = setup(new Date(NOW - HOUR).toISOString(), "en");
  await answerApprovalButton({ repo: s.repo, client: s.client, now: () => NOW });
  expect(s.sentTexts).toEqual([WHATSAPP_COPY.en.cancelUnavailable]);
});

test("a send 25 h after the last inbound (fake sendText mirroring the 24 h rule) is recorded as an error event with the name only", async () => {
  const s = setup(new Date(NOW - 25 * HOUR).toISOString());
  await answerApprovalButton({ repo: s.repo, client: s.client, now: () => NOW });
  expect(s.sentTexts).toEqual([]);
  expect(s.events).toEqual([
    expect.objectContaining({ type: "error", body: { text: "WindowClosedError" } }),
  ]);
});

test("a never-linked-inbound window (null) is refused the same way", async () => {
  const s = setup(null);
  await answerApprovalButton({ repo: s.repo, client: s.client, now: () => NOW });
  expect(s.events.map((e) => e.type)).toEqual(["error"]);
});
