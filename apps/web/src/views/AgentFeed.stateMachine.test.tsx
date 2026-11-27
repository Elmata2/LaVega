// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AgentEventList } from "./AgentFeed.js";
import type { AgentApi } from "../api.js";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let container: HTMLElement | null = null;

afterEach(() => {
  if (root) act(() => root!.unmount());
  container?.remove();
  root = null;
  container = null;
  vi.restoreAllMocks();
});

async function flush() {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 10));
  });
}

describe("AgentEventList loadMore error handling", () => {
  it("keeps loaded events visible when loadMore fails", async () => {
    const listFeed = vi
      .fn()
      .mockResolvedValueOnce({
        kind: "ok",
        events: [
          {
            id: "ev-1",
            channel: "feed",
            kind: "digest",
            body: { text: "First page digest" },
            createdAt: "2026-04-01T08:00:00Z",
          },
        ],
        next: "cursor-2",
      })
      .mockResolvedValueOnce({ kind: "error" });

    const api = {
      listFeed,
      deleteEvent: vi.fn(async () => true),
    } as unknown as AgentApi;

    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => {
      root!.render(<AgentEventList locale="nl" api={api} emptyText="Leeg" />);
    });
    await flush();

    expect(container.textContent).toContain("First page digest");
    const moreBtn = Array.from(container.querySelectorAll("button")).find((b) =>
      /oudere|older|meer|more/i.test(b.textContent ?? ""),
    )!;
    act(() => moreBtn.click());
    await flush();

    expect(container.textContent).toContain("First page digest");
    expect(container.querySelector('[role="alert"]')).not.toBeNull();
  });
});
