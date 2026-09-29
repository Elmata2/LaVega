// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { SectorCoverage } from "@lavega/core";
import type { SummaryState } from "../lib/summaryResource.js";
import { SectorAllocationCard } from "./SectorAllocationCard.js";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify({ enabled: false }))),
  );
});

afterEach(() => {
  document.body.replaceChildren();
  vi.unstubAllGlobals();
});

const noRefresh = () => {};

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
  act(() => root.render(<SectorAllocationCard state={readyState} refresh={noRefresh} />));
  expect(container.textContent).toContain("Technology");
  expect(container.querySelector('[data-dashboard-section="sectors"]')).not.toBeNull();
  expect(container.querySelectorAll('[aria-label="Sector allocation"] li')).toHaveLength(2);
});

test("no sector data yet reads as an honest empty state, not a broken card", () => {
  const { container, root } = render();
  act(() =>
    root.render(
      <SectorAllocationCard
        state={{ ...readyState, data: { ...readyState.data, sectors: [] } }}
        refresh={noRefresh}
      />,
    ),
  );
  expect(container.textContent).toContain("No sector data yet.");
});

test("renders a loading placeholder without claiming an outcome", () => {
  const { container, root } = render();
  act(() => root.render(<SectorAllocationCard state={{ status: "loading" }} refresh={noRefresh} />));
  expect(container.querySelector('[data-dashboard-section="sectors"]')?.getAttribute("aria-busy")).toBe(
    "true",
  );
});

test("renders the shared summary error instead of a second one", () => {
  const { container, root } = render();
  act(() =>
    root.render(<SectorAllocationCard state={{ status: "error", message: "boom" }} refresh={noRefresh} />),
  );
  const alert = container.querySelector('[role="alert"]');
  expect(alert?.textContent).toContain("boom");
});

test("caption describes look-through instead of claiming holdings are excluded", () => {
  const { container, root } = render();
  act(() => root.render(<SectorAllocationCard state={readyState} refresh={noRefresh} />));
  expect(container.textContent).not.toMatch(/underlying holdings are not included/i);
  expect(container.textContent).toMatch(/look(ed)?[\s-]*through/i);
});

test("look-through caption is absent when there is no sector data", () => {
  const { container, root } = render();
  act(() =>
    root.render(
      <SectorAllocationCard
        state={{ ...readyState, data: { ...readyState.data, sectors: [] } }}
        refresh={noRefresh}
      />,
    ),
  );
  expect(container.textContent).not.toMatch(/look(ed)?[\s-]*through/i);
});

const coverage = (overrides: Partial<SectorCoverage>): SectorCoverage => ({
  provider: 0,
  inferred: 0,
  correction: 0,
  unknown: 0,
  ...overrides,
});

test("shows the coverage line with each nonzero source, omitting the rest", () => {
  const { container, root } = render();
  act(() =>
    root.render(
      <SectorAllocationCard
        state={{
          ...readyState,
          data: {
            ...readyState.data,
            sectorCoverage: coverage({ provider: 0.82, inferred: 0.1, correction: 0.03, unknown: 0.05 }),
          },
        }}
        refresh={noRefresh}
      />,
    ),
  );
  expect(container.textContent).toContain(
    "82% from provider data · 10% inferred · 3% your corrections · 5% unknown",
  );
});

test("omits a coverage source that rounds to zero", () => {
  const { container, root } = render();
  act(() =>
    root.render(
      <SectorAllocationCard
        state={{ ...readyState, data: { ...readyState.data, sectorCoverage: coverage({ provider: 1 }) } }}
        refresh={noRefresh}
      />,
    ),
  );
  expect(container.textContent).toContain("100% from provider data");
  expect(container.textContent).not.toMatch(/inferred|your corrections|unknown/);
});

test("shows no coverage line when the summary predates sectorCoverage", () => {
  const { container, root } = render();
  act(() => root.render(<SectorAllocationCard state={readyState} refresh={noRefresh} />));
  expect(container.textContent).not.toMatch(/from provider data/);
});

test("classifies unknown positions once inference is enabled, then refreshes", async () => {
  const requests: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      requests.push(url);
      if (url === "/api/investing/sector-inference") return new Response(JSON.stringify({ enabled: true }));
      if (url === "/api/investing/sectors/infer")
        return new Response(JSON.stringify({ classified: 2, remaining: 0 }));
      throw new Error(`unexpected fetch: ${url}`);
    }),
  );
  const refresh = vi.fn();
  const { root } = render();
  await act(async () => {
    root.render(
      <SectorAllocationCard
        state={{
          ...readyState,
          data: { ...readyState.data, sectorCoverage: coverage({ provider: 0.5, unknown: 0.5 }) },
        }}
        refresh={refresh}
      />,
    );
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
  expect(requests.filter((url) => url === "/api/investing/sectors/infer")).toHaveLength(1);
  expect(refresh).toHaveBeenCalledTimes(1);
});

test("never calls infer when inference is disabled, even with unknown coverage", async () => {
  const requests: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      requests.push(url);
      if (url === "/api/investing/sector-inference") return new Response(JSON.stringify({ enabled: false }));
      throw new Error(`unexpected fetch: ${url}`);
    }),
  );
  const refresh = vi.fn();
  const { root } = render();
  await act(async () => {
    root.render(
      <SectorAllocationCard
        state={{
          ...readyState,
          data: { ...readyState.data, sectorCoverage: coverage({ provider: 0.5, unknown: 0.5 }) },
        }}
        refresh={refresh}
      />,
    );
    await Promise.resolve();
    await Promise.resolve();
  });
  expect(requests).not.toContain("/api/investing/sectors/infer");
  expect(refresh).not.toHaveBeenCalled();
});

test("stops the bounded infer loop instead of looping forever when classification keeps finding more", async () => {
  let calls = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "/api/investing/sector-inference") return new Response(JSON.stringify({ enabled: true }));
      if (url === "/api/investing/sectors/infer") {
        calls += 1;
        return new Response(JSON.stringify({ classified: 10, remaining: 40 }));
      }
      throw new Error(`unexpected fetch: ${url}`);
    }),
  );
  const refresh = vi.fn();
  const { root } = render();
  await act(async () => {
    root.render(
      <SectorAllocationCard
        state={{
          ...readyState,
          data: { ...readyState.data, sectorCoverage: coverage({ provider: 0.1, unknown: 0.9 }) },
        }}
        refresh={refresh}
      />,
    );
    for (let i = 0; i < 10; i += 1) await Promise.resolve();
  });
  expect(calls).toBe(3);
  expect(refresh).toHaveBeenCalledTimes(1);
});

test("stops the infer loop on 428 without refreshing when nothing was classified", async () => {
  const requests: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      requests.push(url);
      if (url === "/api/investing/sector-inference") return new Response(JSON.stringify({ enabled: true }));
      if (url === "/api/investing/sectors/infer")
        return new Response(JSON.stringify({ problems: ["Sector inference is not enabled"] }), {
          status: 428,
        });
      throw new Error(`unexpected fetch: ${url}`);
    }),
  );
  const refresh = vi.fn();
  const { root } = render();
  await act(async () => {
    root.render(
      <SectorAllocationCard
        state={{
          ...readyState,
          data: { ...readyState.data, sectorCoverage: coverage({ provider: 0.5, unknown: 0.5 }) },
        }}
        refresh={refresh}
      />,
    );
    await Promise.resolve();
    await Promise.resolve();
  });
  expect(requests.filter((url) => url === "/api/investing/sectors/infer")).toHaveLength(1);
  expect(refresh).not.toHaveBeenCalled();
});
