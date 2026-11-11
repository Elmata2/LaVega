// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, test, vi } from "vitest";

vi.mock("@lavega/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@lavega/core")>();
  return { ...actual, buildIndexedSeries: vi.fn(actual.buildIndexedSeries) };
});

import { buildIndexedSeries } from "@lavega/core";
import { PortfolioBenchmarkChart } from "./PortfolioBenchmarkChart";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;
afterEach(() => {
  vi.restoreAllMocks();
  document.body.replaceChildren();
});

const points = [
  {
    date: "2026-01-01",
    positionsValue: 100,
    cashValue: null,
    value: 100,
    unpriced: [],
    forwardFilled: [],
    cashUnknown: [],
  },
  {
    date: "2026-01-02",
    positionsValue: 110,
    cashValue: null,
    value: 110,
    unpriced: [],
    forwardFilled: [],
    cashUnknown: [],
  },
];
const benchmarks = [
  {
    symbol: "^AEX",
    name: "AEX",
    exchange: "Amsterdam",
    currency: "EUR",
    points: [
      { date: "2026-01-01", value: 900 },
      { date: "2026-01-02", value: 909 },
    ],
  },
  {
    symbol: "^GDAXI",
    name: "DAX",
    exchange: "Frankfurt",
    currency: "EUR",
    points: [
      { date: "2026-01-01", value: 20_000 },
      { date: "2026-01-02", value: 20_100 },
    ],
  },
];

function mockSelectionFetch() {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) =>
      init?.method === "PUT"
        ? new Response(JSON.stringify({ tenantId: "local", symbols: ["^GDAXI"] }))
        : new Response(JSON.stringify({ tenantId: "local", symbols: ["^AEX", "^GDAXI"] })),
    ),
  );
}

function pointerEvent(type: string, clientX: number, pointerId = 1) {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, clientX, button: 0 });
  Object.defineProperty(event, "pointerId", { value: pointerId });
  return event;
}

test("a pointer move does not rebuild the indexed series", async () => {
  mockSelectionFetch();
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(<PortfolioBenchmarkChart data={{ "1M": points }} benchmarks={benchmarks} />);
    await Promise.resolve();
  });
  const chart = container.querySelector<HTMLElement>('[role="img"]')!;
  expect(chart).not.toBeNull();
  chart.getBoundingClientRect = () => ({
    x: 0,
    y: 0,
    left: 0,
    top: 0,
    right: 400,
    bottom: 320,
    width: 400,
    height: 320,
    toJSON: () => ({}),
  });
  const spy = vi.mocked(buildIndexedSeries);
  expect(spy).toHaveBeenCalled();
  spy.mockClear();

  await act(async () => {
    chart.dispatchEvent(pointerEvent("pointermove", 200));
  });
  await act(async () => {
    chart.dispatchEvent(pointerEvent("pointermove", 210));
  });

  expect(spy).toHaveBeenCalledTimes(0);
  await act(async () => root.unmount());
});
