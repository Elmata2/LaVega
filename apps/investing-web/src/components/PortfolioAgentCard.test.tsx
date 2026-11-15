// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, expect, test, vi } from "vitest";
import { PortfolioAgentCard } from "./PortfolioAgentCard";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

const agents = [
  { id: "buffett", displayName: "Warren Buffett", description: "d", investingStyle: "Moats." },
  { id: "munger", displayName: "Charlie Munger", description: "d", investingStyle: "Models." },
];

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});

async function settle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

test("changing persona retargets both actions", async () => {
  const fetchMock = vi.fn((input: RequestInfo | URL, _init?: RequestInit) => {
    const url = String(input);
    if (url.endsWith("/run"))
      return Promise.resolve(
        new Response(
          JSON.stringify({
            result: {
              agentId: "munger",
              displayName: "Charlie Munger",
              signal: "neutral",
              confidence: 50,
              summary: "s",
              reasoning: "r",
              insights: [],
              model: "m",
              snapshotHash: "h",
            },
          }),
        ),
      );
    return Promise.resolve(new Response(JSON.stringify({ agents })));
  });
  vi.stubGlobal("fetch", fetchMock);
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  await act(async () => {
    root.render(
      <MemoryRouter>
        <PortfolioAgentCard />
      </MemoryRouter>,
    );
  });
  await settle();

  const select = host.querySelector<HTMLSelectElement>("select[aria-label='Choose agent']");
  expect(select?.options.length).toBe(2);
  const link = () => host.querySelector<HTMLAnchorElement>("a[href^='/agents/']");
  expect(link()?.getAttribute("href")).toBe("/agents/buffett");
  expect(link()?.textContent).toContain("Warren Buffett");

  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")!.set!;
    setter.call(select, "munger");
    select!.dispatchEvent(new Event("change", { bubbles: true }));
  });
  expect(link()?.getAttribute("href")).toBe("/agents/munger");
  expect(link()?.textContent).toContain("Charlie Munger");
  expect(host.textContent).toContain("Models.");

  fetchMock.mockClear();
  const analyse = [...host.querySelectorAll("button")].find((b) =>
    b.textContent?.includes("Analyse portfolio"),
  );
  await act(async () => analyse!.click());
  await settle();
  const run = fetchMock.mock.calls.find(([u]) => String(u).endsWith("/run"));
  expect(JSON.parse(String(run?.[1]?.body))).toEqual({ agentId: "munger" });
  root.unmount();
});
