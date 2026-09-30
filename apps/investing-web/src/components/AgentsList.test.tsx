// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, expect, test, vi } from "vitest";
import { portfolioAgents } from "../test/fetchFixtures.js";
import { AgentsList } from "./AgentsList.js";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

afterEach(() => {
  document.body.replaceChildren();
  vi.unstubAllGlobals();
});

function render() {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  return { container, root };
}

test("lists every portfolio agent and links to its conversation", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify({ agents: portfolioAgents }), { status: 200 })),
  );
  const { container, root } = render();
  act(() => {
    root.render(
      <MemoryRouter>
        <AgentsList />
      </MemoryRouter>,
    );
  });
  await act(async () => {});
  for (const agent of portfolioAgents) {
    expect(container.textContent).toContain(agent.displayName);
    expect(container.querySelector(`a[href="/agents/${agent.id}"]`)).not.toBeNull();
  }
  expect(container.querySelector('a[href="/agents/research"]')?.textContent).toContain(
    "All six agents",
  );
});

test("shows an empty state with a retry action when the catalog has no agents", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify({ agents: [] }), { status: 200 })),
  );
  const { container, root } = render();
  act(() => {
    root.render(
      <MemoryRouter>
        <AgentsList />
      </MemoryRouter>,
    );
  });
  await act(async () => {});
  expect(container.textContent).toContain("Agents unavailable");
  expect(container.textContent).toContain("No portfolio agents available.");
  expect(container.querySelector("button")?.textContent).toContain("Try again");
});

test("shows a retry action when the catalog request fails", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response("", { status: 500 })),
  );
  const { container, root } = render();
  act(() => {
    root.render(
      <MemoryRouter>
        <AgentsList />
      </MemoryRouter>,
    );
  });
  await act(async () => {});
  expect(container.textContent).toContain("Agents unavailable");
  expect(container.querySelector('[role="alert"]')).not.toBeNull();
});
