// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, test, vi } from "vitest";
import type { AgentApi, AgentFeedEvent } from "../api.js";
import { instinctCopy } from "../copy/instinct.js";
import AgentFeed from "./AgentFeed";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let container: HTMLElement | null = null;
afterEach(() => {
  if (root) act(() => root!.unmount());
  container?.remove();
  root = null;
  container = null;
});

const ev = (id: string, createdAt: string, text: string): AgentFeedEvent => ({
  id,
  channel: "feed",
  type: "message",
  body: { text },
  createdAt,
});

function fakeApi(over: Partial<AgentApi> = {}): AgentApi {
  return {
    getSettings: vi.fn(),
    putSettings: vi.fn(),
    turnOff: vi.fn(),
    putPush: vi.fn(),
    deletePush: vi.fn(),
    listFeed: vi.fn(async () => ({ kind: "ok" as const, events: [], next: null })),
    deleteEvent: vi.fn(async () => true),
    getWhatsapp: vi.fn(),
    createLinkCode: vi.fn(),
    unlinkWhatsapp: vi.fn(),
    deleteConversation: vi.fn(async () => true),
    ...over,
  };
}

async function render(api: AgentApi, locale: "nl" | "en" = "nl") {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(<AgentFeed locale={locale} api={api} />);
  });
  return container;
}

/** The WhatsApp list shares the API; these older tests only fill the feed channel. */
const feedOnly =
  (inner: AgentApi["listFeed"]): AgentApi["listFeed"] =>
  async (o) =>
    o.channel === "whatsapp" ? { kind: "ok", events: [], next: null } : inner(o);

const texts = () => [...container!.querySelectorAll("li p:first-child")].map((p) => p.textContent);
const button = (label: string) =>
  [...container!.querySelectorAll("button")].find((b) => b.textContent === label);

test("events render newest first, whatever order the server sent", async () => {
  await render(
    fakeApi({
      listFeed: feedOnly(async () => ({
        kind: "ok" as const,
        events: [
          ev("1", "2026-11-08T08:00:00Z", "oud"),
          ev("3", "2026-11-10T08:00:00Z", "nieuw"),
          ev("2", "2026-11-09T08:00:00Z", "midden"),
        ],
        next: null,
      })),
    }),
  );
  expect(texts()).toEqual(["nieuw", "midden", "oud"]);
});

test("delete removes one item and calls the API with its id", async () => {
  const api = fakeApi({
    listFeed: feedOnly(async () => ({
      kind: "ok" as const,
      events: [ev("a", "2026-11-10T08:00:00Z", "een"), ev("b", "2026-11-09T08:00:00Z", "twee")],
      next: null,
    })),
  });
  await render(api);
  await act(async () => {
    container!.querySelectorAll<HTMLButtonElement>("li button")[0]!.click();
  });
  expect(api.deleteEvent).toHaveBeenCalledWith("a");
  expect(texts()).toEqual(["twee"]);
});

test("load more follows the cursor and appends older items", async () => {
  const listFeed = vi
    .fn()
    .mockResolvedValueOnce({
      kind: "ok",
      events: [ev("a", "2026-11-10T08:00:00Z", "een")],
      next: "CURSOR",
    })
    .mockResolvedValueOnce({
      kind: "ok",
      events: [ev("b", "2026-11-01T08:00:00Z", "twee")],
      next: null,
    });
  await render(fakeApi({ listFeed: feedOnly(listFeed) }));
  await act(async () => {
    button(instinctCopy.nl.feed.loadMore)!.click();
  });
  expect(listFeed).toHaveBeenLastCalledWith(expect.objectContaining({ before: "CURSOR" }));
  expect(texts()).toEqual(["een", "twee"]);
  expect(button(instinctCopy.nl.feed.loadMore)).toBeUndefined();
});

test("an empty feed says so, and a 503 says alerts are unavailable", async () => {
  await render(fakeApi());
  expect(container!.textContent).toContain(instinctCopy.nl.feed.empty);
  await act(async () => root!.unmount());
  root = null;
  container!.remove();
  await render(
    fakeApi({ listFeed: feedOnly(async () => ({ kind: "unavailable" as const })) }),
    "en",
  );
  expect(container!.textContent).toContain(instinctCopy.en.feed.unavailable);
});

const waEv = (id: string, text: string): AgentFeedEvent => ({
  ...ev(id, "2026-11-10T08:00:00Z", text),
  channel: "whatsapp",
});
const waApi = (over: Partial<AgentApi> = {}) =>
  fakeApi({
    listFeed: vi.fn(async (o) => ({
      kind: "ok" as const,
      events: o.channel === "whatsapp" ? [waEv("w1", "hoi"), waEv("w2", "dag")] : [],
      next: null,
    })),
    ...over,
  });
const waTexts = () =>
  [
    ...container!.querySelectorAll(
      `section[aria-label="${instinctCopy.nl.feed.whatsappTitle}"] li p:first-child`,
    ),
  ].map((p) => p.textContent);

test("the WhatsApp conversation is listed from the whatsapp channel only", async () => {
  const api = waApi();
  await render(api);
  expect(api.listFeed).toHaveBeenCalledWith(expect.objectContaining({ channel: "whatsapp" }));
  expect(waTexts().sort()).toEqual(["dag", "hoi"]);
});

test("verwijder gesprek: confirm focuses cancel, cancel returns focus to the trigger and deletes nothing", async () => {
  const api = waApi();
  await render(api);
  const trigger = button(instinctCopy.nl.feed.deleteConversation)!;
  await act(async () => trigger.click());
  const dialog = container!.querySelector('[role="alertdialog"]')!;
  expect(dialog).not.toBeNull();
  expect(document.activeElement).toBe(button(instinctCopy.nl.feed.deleteConversationNo));
  await act(async () => button(instinctCopy.nl.feed.deleteConversationNo)!.click());
  expect(container!.querySelector('[role="alertdialog"]')).toBeNull();
  expect(document.activeElement).toBe(trigger);
  expect(api.deleteConversation).not.toHaveBeenCalled();
});

test("confirming deletes the whatsapp conversation, empties the list and announces it in the status region", async () => {
  let gone = false;
  const api = waApi({
    listFeed: vi.fn(async (o) => ({
      kind: "ok" as const,
      events: o.channel === "whatsapp" && !gone ? [waEv("w1", "hoi")] : [],
      next: null,
    })),
    deleteConversation: vi.fn(async () => ((gone = true), true)),
  });
  await render(api);
  const status = container!.querySelector('[role="status"]')!;
  expect(status.textContent).toBe("");
  await act(async () => button(instinctCopy.nl.feed.deleteConversation)!.click());
  await act(async () => button(instinctCopy.nl.feed.deleteConversationYes)!.click());
  expect(api.deleteConversation).toHaveBeenCalledWith("whatsapp");
  expect(container!.querySelector('[role="status"]')).toBe(status);
  expect(status.textContent).toBe(instinctCopy.nl.feed.conversationDeleted);
  expect(waTexts()).toEqual([]);
  expect(container!.textContent).toContain(instinctCopy.nl.feed.whatsappEmpty);
});

test("a failed conversation delete keeps the list and says so", async () => {
  const api = waApi({ deleteConversation: vi.fn(async () => false) });
  await render(api);
  await act(async () => button(instinctCopy.nl.feed.deleteConversation)!.click());
  await act(async () => button(instinctCopy.nl.feed.deleteConversationYes)!.click());
  expect(container!.querySelector('[role="status"]')!.textContent).toBe(
    instinctCopy.nl.feed.conversationDeleteFailed,
  );
  expect(waTexts().sort()).toEqual(["dag", "hoi"]);
});

test("a signed-out feed shows the sign-in message, not a load error (F12)", async () => {
  await render(fakeApi({ listFeed: vi.fn(async () => ({ kind: "signedOut" as const })) }));
  expect(container!.textContent).toContain(instinctCopy.nl.signInNeeded);
  expect(container!.textContent).not.toContain(instinctCopy.nl.feed.loadFailed);
});
