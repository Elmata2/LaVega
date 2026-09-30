// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, test, vi } from "vitest";
import { AgentThreads } from "./AgentThreads";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;
afterEach(() => {
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});

const thread = {
  id: "00000000-0000-4000-8000-000000000001",
  agentId: "charlie_munger",
  title: "What about ASML?",
  updatedAt: "2026-09-20T10:00:00.000Z",
};

async function render(fetch: (url: string, init?: RequestInit) => Response) {
  const calls: Array<{ url: string; method: string }> = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: String(input), method: init?.method ?? "GET" });
      return fetch(String(input), init);
    }),
  );
  const onOpen = vi.fn();
  const onDeleted = vi.fn();
  const container = document.createElement("div");
  document.body.append(container);
  await act(async () => {
    createRoot(container).render(
      <AgentThreads
        agentId="charlie_munger"
        activeThreadId="other"
        refreshKey="0"
        onOpen={onOpen}
        onNew={() => {}}
        onDeleted={onDeleted}
      />,
    );
  });
  return { container, calls, onOpen, onDeleted };
}

const button = (container: HTMLElement, text: string) =>
  [...container.querySelectorAll("button")].find((item) => item.textContent === text)!;

test("lists saved conversations and deletes one only after a second click", async () => {
  const { container, calls, onOpen, onDeleted } = await render((url, init) =>
    init?.method === "DELETE"
      ? new Response(null, { status: 204 })
      : new Response(JSON.stringify({ threads: [thread] })),
  );
  expect(calls[0]?.url).toBe("/api/memory/threads?agentId=charlie_munger");
  expect(container.textContent).toContain("What about ASML?");

  await act(async () => button(container, "What about ASML?20 September 2026").click());
  expect(onOpen).toHaveBeenCalledWith(thread.id);

  await act(async () => button(container, "Delete").click());
  expect(calls.some((call) => call.method === "DELETE")).toBe(false);
  await act(async () => button(container, "Confirm delete").click());
  expect(calls.at(-1)).toEqual({ url: `/api/memory/threads/${thread.id}`, method: "DELETE" });
  expect(onDeleted).toHaveBeenCalledWith(thread.id);
  expect(container.textContent).toContain("No saved conversations yet.");
});

test("renders nothing when the server has no memory", async () => {
  const { container } = await render(() => new Response("{}", { status: 503 }));
  expect(container.textContent).toBe("");
});
