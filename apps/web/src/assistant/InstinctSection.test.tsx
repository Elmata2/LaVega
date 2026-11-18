// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, test, vi } from "vitest";
import type { VaultStorage } from "@lavega/adapters";
import { emptyAssistantState } from "@lavega/core";
import type { AgentApi, AgentFeedEvent, AgentFeedLoad } from "../api.js";
import { createFeedStore } from "../agent/feedStore.js";
import AgentFeed from "../views/AgentFeed.js";
import { AssistantPanel, type AssistantPanelProps } from "./AssistantPanel.js";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let container: HTMLElement | null = null;
afterEach(() => {
  if (root) act(() => root!.unmount());
  container?.remove();
  root = null;
  container = null;
  document.cookie = "lavega_locale=; max-age=0; path=/";
});

const storage = {
  getAccounts: async () => [],
  getTxs: async () => [],
  getRules: async () => [],
  getAssistant: async () => emptyAssistantState(),
  putAssistant: async () => undefined,
} as unknown as VaultStorage;

const ev = (n: number): AgentFeedEvent => ({
  id: `e${n}`,
  channel: "feed",
  type: "message",
  body: { text: `Bericht ${n}` },
  createdAt: `2026-11-1${n}T08:00:00.000Z`,
});

function fakeApi(feed: AgentFeedLoad | (() => Promise<AgentFeedLoad>)): AgentApi {
  return {
    listFeed: vi.fn(async (o: { channel?: string }) =>
      o.channel === "whatsapp"
        ? ({ kind: "ok", events: [], next: null } as AgentFeedLoad)
        : typeof feed === "function"
          ? feed()
          : feed,
    ),
    deleteEvent: vi.fn(async () => true),
    deleteConversation: vi.fn(async () => true),
  } as unknown as AgentApi;
}
const feedCalls = (api: AgentApi) =>
  (api.listFeed as ReturnType<typeof vi.fn>).mock.calls.filter(
    (c) => (c[0] as { channel?: string }).channel === "feed",
  ).length;

type Instinct = NonNullable<AssistantPanelProps["instinct"]>;

async function mount(api: AgentApi, over: Partial<Instinct> | null = {}) {
  document.cookie = "lavega_locale=nl; path=/";
  const onOpenFeed = vi.fn();
  const onOpenSettings = vi.fn();
  const instinct: Instinct | undefined =
    over === null
      ? undefined
      : {
          status: "on",
          store: createFeedStore(api),
          onOpenFeed,
          onOpenSettings,
          ...over,
        };
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(
      <AssistantPanel storage={storage} asOf="2026-11-11" {...(instinct ? { instinct } : {})} />,
    );
    await Promise.resolve();
    await Promise.resolve();
  });
  return { view: container, onOpenFeed, onOpenSettings, instinct };
}
const section = (v: HTMLElement) => v.querySelector('[data-testid="instinct-section"]');
const btn = (v: HTMLElement, label: string) =>
  [...v.querySelectorAll("button")].find((b) => b.textContent === label);

test("shows the latest 3 of 5 messages, newest first, with a link to all of them", async () => {
  const api = fakeApi({ kind: "ok", events: [1, 2, 3, 4, 5].map(ev), next: null });
  const { view, onOpenFeed } = await mount(api);
  const rows = [...view.querySelectorAll('[data-testid="instinct-section"] li')];
  expect(rows).toHaveLength(3);
  expect(rows.map((r) => r.querySelector("p")?.textContent)).toEqual([
    "Bericht 5",
    "Bericht 4",
    "Bericht 3",
  ]);
  expect(view.querySelector('[data-testid="instinct-section"] h3')?.textContent).toBe("Meldingen");
  expect(rows[0]!.querySelector("time")).not.toBeNull();
  expect(section(view)!.querySelector("button[aria-label*='Verwijder']")).toBeNull();
  await act(async () => btn(view, "Alle meldingen")!.click());
  expect(onOpenFeed).toHaveBeenCalledTimes(1);
});

test("agent off: one line and a way to Profiel, and no feed request", async () => {
  const api = fakeApi({ kind: "ok", events: [], next: null });
  const { view, onOpenSettings } = await mount(api, { status: "off" });
  expect(section(view)!.textContent).toContain("Je dagelijkse bericht staat uit.");
  await act(async () => btn(view, "Aanzetten in Profiel")!.click());
  expect(onOpenSettings).toHaveBeenCalledTimes(1);
  expect(api.listFeed).not.toHaveBeenCalled();
});

test("agent on with no messages: one plain line", async () => {
  const { view } = await mount(fakeApi({ kind: "ok", events: [], next: null }));
  expect(section(view)!.textContent).toContain(
    "Nog geen berichten. Je krijgt er hooguit één per dag.",
  );
  expect(section(view)!.querySelector("ul")).toBeNull();
});

test.each([
  [
    "settings 503",
    { status: "unavailable" as const },
    { kind: "ok" as const, events: [], next: null },
  ],
  ["feed 503", {}, { kind: "unavailable" as const }],
  ["feed 401", {}, { kind: "signedOut" as const }],
  [
    "unknown status",
    { status: "unknown" as const },
    { kind: "ok" as const, events: [], next: null },
  ],
])("%s: no Instinct section and no error", async (_n, over, feed) => {
  const api = fakeApi(feed);
  const { view } = await mount(api, over);
  expect(section(view)).toBeNull();
  expect(view.querySelector("[role=alert]")).toBeNull();
  expect(view.textContent).not.toContain("laden lukte niet");
});

test("device-only: no section and no request at all", async () => {
  const fetchSpy = vi.fn();
  vi.stubGlobal("fetch", fetchSpy);
  try {
    const { view } = await mount(fakeApi({ kind: "ok", events: [], next: null }), null);
    expect(section(view)).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  } finally {
    vi.unstubAllGlobals();
  }
});

test("a failed load shows one quiet line and a retry that refetches once", async () => {
  let n = 0;
  const api = fakeApi(async () =>
    ++n === 1 ? { kind: "error" } : { kind: "ok", events: [ev(1)], next: null },
  );
  const { view } = await mount(api);
  expect(section(view)!.textContent).toContain("Berichten laden lukte niet.");
  expect(feedCalls(api)).toBe(1);
  await act(async () => btn(view, "Opnieuw")!.click());
  expect(feedCalls(api)).toBe(2);
  expect(section(view)!.textContent).toContain("Bericht 1");
});

test("the feed is fetched once when the panel and the meldingen view are both mounted", async () => {
  document.cookie = "lavega_locale=nl; path=/";
  const api = fakeApi({ kind: "ok", events: [ev(1), ev(2)], next: null });
  const store = createFeedStore(api);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(
      <>
        <AssistantPanel
          storage={storage}
          asOf="2026-11-11"
          instinct={{ status: "on", store, onOpenFeed: vi.fn(), onOpenSettings: vi.fn() }}
        />
        <AgentFeed locale="nl" api={api} feedStore={store} />
      </>,
    );
    await Promise.resolve();
    await Promise.resolve();
  });
  expect(feedCalls(api)).toBe(1);
  expect(container.textContent).toContain("Bericht 2");
});

test("the chat below still answers its sample questions", async () => {
  const { view } = await mount(fakeApi({ kind: "ok", events: [ev(1)], next: null }));
  const input = view.querySelector<HTMLInputElement>("#assistant-input")!;
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  act(() => {
    setter?.call(input, "Wat zijn mijn saldo's?");
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => {
    view
      .querySelector("form")!
      .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    await Promise.resolve();
    await Promise.resolve();
  });
  expect(view.querySelector('[data-testid="assistant-log"]')!.textContent).toContain("saldo");
});

test("rows show in full: text clamped to two lines with the full text in a title, no inner scroll", async () => {
  const { view } = await mount(fakeApi({ kind: "ok", events: [1, 2, 3].map(ev), next: null }));
  const list = section(view)!.querySelector("ul")!;
  expect(list.hasAttribute("tabindex")).toBe(false);
  expect(list.className).not.toContain("overflow");
  const text = list.querySelector("li p")!;
  expect(text.className).toContain("line-clamp-2");
  expect(text.getAttribute("title")).toBe(text.textContent);
  const rows = [...list.querySelectorAll("li")];
  expect(rows.map((r) => r.className.includes("max-height:699px"))).toEqual([false, false, true]);
});

test("a delete anywhere (store invalidated) drops the message from the panel", async () => {
  let events = [ev(1), ev(2)];
  const api = fakeApi(async () => ({ kind: "ok", events, next: null }));
  const { view, instinct } = await mount(api);
  expect(section(view)!.textContent).toContain("Bericht 2");
  events = [ev(1)];
  await act(async () => {
    instinct!.store.invalidate();
    await Promise.resolve();
    await Promise.resolve();
  });
  expect(section(view)!.textContent).not.toContain("Bericht 2");
  expect(section(view)!.textContent).toContain("Bericht 1");
});

test("status off then on again shows no old list before the fresh read", async () => {
  const api = fakeApi({ kind: "ok", events: [ev(1)], next: null });
  const store = createFeedStore(api);
  document.cookie = "lavega_locale=nl; path=/";
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  const render = (status: "on" | "off") =>
    act(async () => {
      root!.render(
        <AssistantPanel
          storage={storage}
          asOf="2026-11-11"
          instinct={{ status, store, onOpenFeed: vi.fn(), onOpenSettings: vi.fn() }}
        />,
      );
      await Promise.resolve();
      await Promise.resolve();
    });
  await render("on");
  expect(container.textContent).toContain("Bericht 1");
  await render("off");
  expect(container.textContent).not.toContain("Bericht 1");
  expect(container.textContent).toContain("Je dagelijkse bericht staat uit.");
  store.invalidate();
  (api.listFeed as ReturnType<typeof vi.fn>).mockImplementation(() => new Promise(() => undefined));
  await render("on");
  expect(container.textContent).not.toContain("Bericht 1");
});
