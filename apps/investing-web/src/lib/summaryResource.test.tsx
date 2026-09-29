// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, test, vi } from "vitest";
import type { RiskRange } from "@lavega/core";
import { usePortfolioSummary, type PortfolioSummary, type SummaryState } from "./summaryResource";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

afterEach(() => {
  vi.restoreAllMocks();
});

const summary: PortfolioSummary = {
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
  sectors: [{ sector: "Technology", weight: 1 }],
  topPositions: [{ symbol: "AAPL", weight: 1 }],
};

type Sample = { state: SummaryState; refresh: () => void };

function mount(samples: Sample[]) {
  function Probe({
    range,
    benchmark,
    revision,
    enabled,
  }: {
    range: RiskRange;
    benchmark: string;
    revision: string;
    enabled?: boolean;
  }) {
    const { state, refresh } = usePortfolioSummary(range, benchmark, revision, enabled);
    samples.push({ state, refresh });
    return null;
  }
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  return { root, Probe };
}

test("requests the endpoint with the range and benchmark as query params", async () => {
  const fetcher = vi.fn(async () => new Response(JSON.stringify(summary), { status: 200 }));
  vi.stubGlobal("fetch", fetcher);
  const samples: Sample[] = [];
  const { root, Probe } = mount(samples);
  await act(async () => root.render(<Probe range="6M" benchmark="URTH" revision="" />));
  expect(fetcher).toHaveBeenCalledWith("/api/investing/summary?range=6M&benchmark=URTH", {
    signal: expect.any(AbortSignal),
  });
  expect(samples.at(-1)?.state).toEqual({ status: "ready", data: summary });
  root.unmount();
});

test("refresh requests the endpoint again with the same parameters", async () => {
  const fetcher = vi.fn(async () => new Response(JSON.stringify(summary), { status: 200 }));
  vi.stubGlobal("fetch", fetcher);
  const samples: Sample[] = [];
  const { root, Probe } = mount(samples);
  await act(async () => root.render(<Probe range="1Y" benchmark="" revision="" />));
  expect(fetcher).toHaveBeenCalledTimes(1);
  await act(async () => {
    samples.at(-1)!.refresh();
    await Promise.resolve();
    await Promise.resolve();
  });
  expect(fetcher).toHaveBeenCalledTimes(2);
  root.unmount();
});

test("disabled never calls fetch; enabling starts one request", async () => {
  const fetcher = vi.fn(async () => new Response(JSON.stringify(summary), { status: 200 }));
  vi.stubGlobal("fetch", fetcher);
  const samples: Sample[] = [];
  const { root, Probe } = mount(samples);
  await act(async () => root.render(<Probe range="1Y" benchmark="" revision="" enabled={false} />));
  expect(fetcher).not.toHaveBeenCalled();
  expect(samples.at(-1)?.state).toEqual({ status: "loading" });
  await act(async () => root.render(<Probe range="1Y" benchmark="" revision="" enabled={true} />));
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(samples.at(-1)?.state).toEqual({ status: "ready", data: summary });
  root.unmount();
});

test("a newer request wins when an older response arrives last", async () => {
  const pending: Array<(response: Response) => void> = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(() => new Promise<Response>((resolve) => pending.push(resolve))),
  );
  const withPosition = (symbol: string) =>
    new Response(JSON.stringify({ ...summary, topPositions: [{ symbol, weight: 1 }] }));
  const samples: Sample[] = [];
  const { root, Probe } = mount(samples);
  await act(async () => root.render(<Probe range="1Y" benchmark="" revision="old" />));
  await act(async () => root.render(<Probe range="1Y" benchmark="" revision="new" />));
  expect(pending).toHaveLength(2);
  await act(async () => pending[1]!(withPosition("NEWER")));
  await act(async () => pending[0]!(withPosition("OLDER")));
  const last = samples.at(-1)?.state;
  expect(last?.status).toBe("ready");
  expect(last?.status === "ready" && last.data.topPositions[0]?.symbol).toBe("NEWER");
  root.unmount();
});

test("renders error state when the API fails", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response("boom", { status: 503 })),
  );
  const samples: Sample[] = [];
  const { root, Probe } = mount(samples);
  await act(async () => root.render(<Probe range="1Y" benchmark="" revision="" />));
  expect(samples.at(-1)?.state).toEqual({ status: "error", message: "Failed to load summary: 503" });
  root.unmount();
});

test("a network failure reads as a stable message", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => {
      throw new TypeError("Failed to fetch");
    }),
  );
  const samples: Sample[] = [];
  const { root, Probe } = mount(samples);
  await act(async () => root.render(<Probe range="1Y" benchmark="" revision="" />));
  expect(samples.at(-1)?.state).toEqual({
    status: "error",
    message: "Failed to load summary: network error.",
  });
  root.unmount();
});

test("a body that is not JSON reads as an invalid format", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response("<!doctype html>", { status: 200 })),
  );
  const samples: Sample[] = [];
  const { root, Probe } = mount(samples);
  await act(async () => root.render(<Probe range="1Y" benchmark="" revision="" />));
  expect(samples.at(-1)?.state).toEqual({ status: "error", message: "Summary has an invalid format." });
  root.unmount();
});

test.each([
  ["risk benchmarks", { ...summary, risk: { ...summary.risk, benchmarks: undefined } }],
  ["missing prices", { ...summary, risk: { ...summary.risk, missingPrices: null } }],
  ["missing holdings", { ...summary, risk: { ...summary.risk, missingHoldings: "AAPL" } }],
  ["a benchmark entry", { ...summary, risk: { ...summary.risk, benchmarks: [null] } }],
  ["a sector entry", { ...summary, sectors: [null] }],
  ["a top position", { ...summary, topPositions: [7] }],
  ["a sector name", { ...summary, sectors: [{ sector: {}, weight: 1 }] }],
  ["a benchmark name", { ...summary, risk: { ...summary.risk, benchmarks: [{ symbol: "X" }] } }],
  ["a risk date", { ...summary, risk: { ...summary.risk, from: 20250910 } }],
  ["a return count", { ...summary, metrics: { ...summary.metrics, observationDays: "252" } }],
])("rejects a summary with malformed %s before resolving", async (_field, payload) => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify(payload), { status: 200 })),
  );
  const samples: Sample[] = [];
  const { root, Probe } = mount(samples);
  await act(async () => root.render(<Probe range="1Y" benchmark="" revision="" />));
  expect(samples.at(-1)?.state).toEqual({ status: "error", message: "Summary has an invalid format." });
  root.unmount();
});
