// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, test } from "vitest";
import type { SummaryState } from "../lib/summaryResource.js";
import { SectorAllocationCard } from "./SectorAllocationCard.js";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

afterEach(() => {
  document.body.replaceChildren();
});

function render() {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  return { container, root };
}

const readyState: SummaryState = {
  status: "ready",
  data: {
    metrics: {
      dailyVolatility: 0.01,
      annualizedVolatility: 0.1587,
      beta: 1.1,
      alpha: 0.02,
      maxDrawdown: -0.25,
      observationDays: 252,
      excludedIntervals: 0,
      pairedObservationDays: 252,
      startDate: "2025-09-10",
      endDate: "2026-09-10",
    },
    risk: {
      status: "estimate",
      range: "1Y",
      from: "2025-09-10",
      to: "2026-09-10",
      drawdownFrom: null,
      minimumObservations: 60,
      benchmark: null,
      benchmarks: [],
      reasons: [],
      missingHoldings: [],
      missingPrices: [],
      coverage: 1,
      currency: "EUR",
    },
    sectors: [
      { sector: "Technology", weight: 0.6 },
      { sector: "Unknown", weight: 0.4 },
    ],
    topPositions: [],
  },
};

test("renders sector bars from the shared summary state", () => {
  const { container, root } = render();
  act(() => root.render(<SectorAllocationCard state={readyState} />));
  expect(container.textContent).toContain("Technology");
  expect(container.querySelector('[data-dashboard-section="sectors"]')).not.toBeNull();
  expect(container.querySelectorAll('[aria-label="Sector allocation"] li')).toHaveLength(2);
});

test("no sector data yet reads as an honest empty state, not a broken card", () => {
  const { container, root } = render();
  act(() =>
    root.render(
      <SectorAllocationCard state={{ ...readyState, data: { ...readyState.data, sectors: [] } }} />,
    ),
  );
  expect(container.textContent).toContain("No sector data yet.");
});

test("renders a loading placeholder without claiming an outcome", () => {
  const { container, root } = render();
  act(() => root.render(<SectorAllocationCard state={{ status: "loading" }} />));
  expect(container.querySelector('[data-dashboard-section="sectors"]')?.getAttribute("aria-busy")).toBe(
    "true",
  );
});

test("renders the shared summary error instead of a second one", () => {
  const { container, root } = render();
  act(() =>
    root.render(<SectorAllocationCard state={{ status: "error", message: "boom" }} />),
  );
  const alert = container.querySelector('[role="alert"]');
  expect(alert?.textContent).toContain("boom");
});
