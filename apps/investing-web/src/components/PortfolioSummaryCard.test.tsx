// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, test, vi } from "vitest";
import { PortfolioSummaryCard, type PortfolioSummary } from "./PortfolioSummaryCard";

const summary: PortfolioSummary = {
  metrics: { dailyVolatility: 0.01, annualizedVolatility: 0.1587, beta: 1.1, alpha: 0.02, maxDrawdown: -0.25, observationDays: 252 },
  sectors: [{ sector: "Technology", weight: 0.6 }, { sector: "Unknown", weight: 0.4 }],
  topPositions: [{ symbol: "AAPL", weight: 0.6 }],
};

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

test("renders metrics, top positions, and sector bars", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(summary), { status: 200 })));
  const { container, root } = render();
  act(() => { root.render(<PortfolioSummaryCard />); });
  await act(async () => {});
  expect(container.textContent).toContain("Jaarvolatiliteit");
  expect(container.textContent).toContain("AAPL");
  expect(container.textContent).toContain("Technology");
  expect(container.querySelectorAll('[aria-label="Sectorverdeling"] li')).toHaveLength(2);
});

test("renders error state when the API fails", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => new Response("boom", { status: 503 })));
  const { container, root } = render();
  act(() => { root.render(<PortfolioSummaryCard />); });
  await act(async () => {});
  expect(container.querySelector('[role="alert"]')?.textContent).toContain("503");
});
