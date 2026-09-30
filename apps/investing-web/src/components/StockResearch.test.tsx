// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, expect, test, vi } from "vitest";
import { StockResearch } from "./StockResearch.js";
import { agentReplyStream } from "../test/fetchFixtures.js";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

afterEach(() => {
  vi.restoreAllMocks();
});

const report = {
  symbol: "AAPL",
  company: {
    symbol: "AAPL",
    providerSymbol: "AAPL",
    name: "Apple Inc",
    currency: "USD",
    priceCurrency: "USD",
    sector: "Technology",
    industry: "Consumer Electronics",
    fetchedAt: "2026-09-29T00:00:00.000Z",
    snapshot: {
      price: 220,
      forwardPe: 27,
      returnOnEquity: 1.5,
      profitMargin: 0.25,
      revenueGrowth: 0.05,
      earningsGrowth: 0.08,
      freeCashFlow: 90_000_000_000,
      marketCap: 3_300_000_000_000,
    },
    annual: [{}],
    quarterly: [{}, {}],
    estimates: [],
  },
  judgments: [
    {
      agentId: "warren_buffett",
      displayName: "Warren Buffett",
      signal: "bullish",
      confidence: 78,
      bullishProbability: 78,
      conviction: 62,
      reasoning: "Durable moat and clean balance sheet support a favorable view.",
    },
  ],
  model: "test-model",
  generatedAt: "2026-09-30T00:00:00.000Z",
  expiresAt: "2099-01-01T00:00:00.000Z",
};

test("a stock research assistant reply's markdown renders through AgentMessageText, but a user's own literal markdown stays plain text", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === "/api/agents/research/run" && init?.method === "POST")
        return Promise.resolve(new Response(JSON.stringify({ report, reportToken: "token-1" })));
      if (url === "/api/agents/research/conversation" && init?.method === "POST")
        return Promise.resolve(agentReplyStream("This view rests on **strong** margins."));
      return Promise.resolve(new Response(JSON.stringify({})));
    }),
  );
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);

  await act(async () => {
    root.render(
      <MemoryRouter initialEntries={["/agents/research"]}>
        <StockResearch />
      </MemoryRouter>,
    );
    await Promise.resolve();
    await Promise.resolve();
  });

  await act(async () => {
    Array.from(container.querySelectorAll("form"))[0]?.dispatchEvent(
      new Event("submit", { bubbles: true, cancelable: true }),
    );
  });
  await vi.waitFor(() => expect(container.textContent).toContain("Apple Inc"));

  await act(async () => {
    Array.from(container.querySelectorAll<HTMLButtonElement>("button"))
      .find((button) => button.querySelector("span")?.textContent === "Warren Buffett")
      ?.click();
  });
  await vi.waitFor(() =>
    expect(
      container.querySelector('input[aria-label="Question for Warren Buffett"]'),
    ).not.toBeNull(),
  );

  const input = container.querySelector<HTMLInputElement>(
    'input[aria-label="Question for Warren Buffett"]',
  )!;
  const form = input.closest("form")!;
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    setter?.call(input, "Is **margin** the whole thesis?");
    input.dispatchEvent(new Event("input", { bubbles: true }));
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    await Promise.resolve();
    await Promise.resolve();
  });

  const userBubble = [...container.querySelectorAll(".ml-8")].find((node) =>
    node.textContent?.includes("Is"),
  );
  expect(userBubble?.textContent).toContain("**margin**");
  expect(userBubble?.querySelector("strong")).toBeNull();

  await vi.waitFor(() => {
    const assistantBubble = [...container.querySelectorAll(".mr-4")].find((node) =>
      node.textContent?.includes("margins"),
    );
    expect(assistantBubble?.querySelector("strong")?.textContent).toBe("strong");
  });
  const assistantBubble = [...container.querySelectorAll(".mr-4")].find((node) =>
    node.textContent?.includes("margins"),
  );
  expect(assistantBubble?.textContent).not.toContain("**");
  root.unmount();
});
