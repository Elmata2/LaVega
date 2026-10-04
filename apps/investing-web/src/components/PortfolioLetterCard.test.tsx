// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, test, vi } from "vitest";
import type { LetterState, PortfolioLetter } from "../lib/portfolioLetter";
import { PortfolioLetterCard } from "./PortfolioLetterCard";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

const letter: PortfolioLetter = {
  id: "11111111-1111-4111-8111-111111111111",
  snapshotHash: "s",
  holdingsHash: "h",
  createdAt: "2026-10-03T04:00:00Z",
  verdict: "Too much in one basket.",
  observations: [
    {
      title: "ASML dominates",
      body: "ASML is 42% of your portfolio.",
      figures: ["42%", "EUR 12,400"],
    },
    { title: "Cash drag", body: "Cash is 3%.", figures: [] },
  ],
};

afterEach(() => {
  document.body.replaceChildren();
});

function render(state: LetterState, onDiscuss = () => {}) {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  act(() => root.render(<PortfolioLetterCard state={state} onDiscuss={onDiscuss} />));
  return container;
}

test("a ready letter shows verdict, observations, figures and a Discuss button", () => {
  const onDiscuss = vi.fn();
  const container = render({ status: "ready", letter }, onDiscuss);
  expect(container.textContent).toContain("Too much in one basket.");
  expect(container.textContent).toContain("ASML is 42% of your portfolio.");
  expect(container.textContent).toContain("42% · EUR 12,400");
  expect(container.textContent).toContain("3 Oct 2026");
  const button = container.querySelector("button");
  expect(button?.textContent).toBe("Discuss");
  act(() => button?.click());
  expect(onDiscuss).toHaveBeenCalledOnce();
});

test("the empty state says there is no letter and offers no way to generate one", () => {
  const container = render({ status: "empty" });
  expect(container.textContent).toContain("No letter yet");
  expect(container.querySelector("button")).toBeNull();
});

test("loading and error states render without a Discuss button", () => {
  const loading = render({ status: "loading" });
  expect(loading.querySelector('[aria-busy="true"]')).not.toBeNull();
  expect(loading.querySelector("button")).toBeNull();
  document.body.replaceChildren();
  const failed = render({ status: "error", message: "Failed to load letter: 503" });
  expect(failed.querySelector('[role="alert"]')?.textContent).toContain("503");
  expect(failed.querySelector("button")).toBeNull();
});
